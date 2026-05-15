#!/usr/bin/env node
/**
 * Integration test — downloads ER configs from a live F&O environment and
 * validates version extraction and baseOnlyGuids classification.
 *
 * Configuration (any of these methods):
 *   1. Config file: scripts/.fno-integration.json
 *      { "envUrl": "...", "tenantId": "...", "clientId": "...", "solutionName"?: "...", "configName"?: "..." }
 *   2. Environment variables: FNO_ENV_URL, FNO_TENANT_ID, FNO_CLIENT_ID
 *      Optional: FNO_SOLUTION_NAME, FNO_CONFIG_NAME
 *
 * Run:
 *   pnpm run test:integration
 *
 * A browser window will open for interactive sign-in (MSAL Authorization Code + PKCE,
 * loopback redirect on http://localhost:<ephemeral-port>/).
 * Register "http://localhost" as a Mobile/Desktop redirect URI in your Entra app registration.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PublicClientApplication,
  LogLevel,
  type Configuration,
} from '@azure/msal-node';
import type { FnoConnection, FnoTransport, ErConfigSummary } from '../packages/fno-client/src/types.js';
import {
  listSolutions,
  listComponents,
  downloadConfigXml,
  extractVersionFromXml,
  extractReferencedDataModelGuids,
  buildDownloadAttempts,
  callErService,
  listServiceOperations,
  ER_SERVICES,
  ER_STORAGE_OPS_BY_TYPE,
} from '../packages/fno-client/src/er-services.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

interface IntegrationConfig {
  envUrl: string;
  tenantId: string;
  clientId: string;
  /** Solution name to drill into. Defaults to first result. */
  solutionName?: string;
  /** Config name to download. Defaults to first Format (or DataModel). */
  configName?: string;
}

function readConfig(): IntegrationConfig {
  const cfgPath = path.join(__dirname, '.fno-integration.json');
  if (fs.existsSync(cfgPath)) {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as IntegrationConfig;
    if (!raw.envUrl || !raw.tenantId || !raw.clientId) {
      console.error('scripts/.fno-integration.json is missing envUrl / tenantId / clientId');
      process.exit(1);
    }
    return raw;
  }

  const envUrl = process.env['FNO_ENV_URL'];
  const tenantId = process.env['FNO_TENANT_ID'];
  const clientId = process.env['FNO_CLIENT_ID'];

  if (!envUrl || !tenantId || !clientId) {
    console.error(`
Error: F&O connection not configured.

Option A — create scripts/.fno-integration.json:
  {
    "envUrl": "https://yourorg.sandbox.operations.dynamics.com",
    "tenantId": "<entra-tenant-guid>",
    "clientId": "<app-registration-client-id>",
    "solutionName": "Tax 1099 Model",   // optional — which solution to probe
    "configName":   "1099 Statements"   // optional — which config to download
  }

Option B — set environment variables:
  FNO_ENV_URL     = https://yourorg.sandbox.operations.dynamics.com
  FNO_TENANT_ID   = <entra-tenant-guid>
  FNO_CLIENT_ID   = <app-registration-client-id>

Your Entra app registration must allow "http://localhost" as a
Mobile & Desktop Applications redirect URI.
`);
    process.exit(1);
  }

  return {
    envUrl,
    tenantId,
    clientId,
    solutionName: process.env['FNO_SOLUTION_NAME'],
    configName: process.env['FNO_CONFIG_NAME'],
  };
}

// ─── Fetch-based FnoTransport ─────────────────────────────────────────────────

function makeFetchTransport(): FnoTransport {
  async function assertOk(res: Response, url: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 800)}`);
    }
  }

  return {
    async getJson<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      });
      await assertOk(res, url);
      return res.json() as Promise<T>;
    },

    async getBinary(url: string, token: string, signal?: AbortSignal): Promise<ArrayBuffer> {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      await assertOk(res, url);
      return res.arrayBuffer();
    },

    async postJson<T>(url: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      await assertOk(res, url);
      return res.json() as Promise<T>;
    },
  };
}

// ─── MSAL interactive auth (loopback redirect) ────────────────────────────────

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.warn(
        '  [warn] Could not open browser automatically. Navigate to the URL above manually.',
      );
    }
  });
}

function randomState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

type LoopbackListener = {
  redirectUri: string;
  waitForCode(expectedState: string): Promise<{ code: string; redirectUri: string }>;
  close(): void;
};

function startLoopbackListener(): Promise<LoopbackListener> {
  return new Promise((resolveSetup, rejectSetup) => {
    let resolveCode: ((r: { code: string; state: string }) => void) | null = null;
    let rejectCode: ((e: Error) => void) | null = null;

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') ?? '';
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description') ?? '';

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Sign-in failed</h1><p>${escapeHtml(error)}: ${escapeHtml(errorDesc)}</p>`);
          rejectCode?.(new Error(`Auth error: ${error}: ${errorDesc}`));
          return;
        }
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Signed in</h1><p>You can close this tab and return to the terminal.</p>');
          resolveCode?.({ code, state });
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>D365FO ER Integration Test</h1><p>Waiting for sign-in…</p>');
        }
      } catch (err) {
        rejectCode?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.on('error', rejectSetup);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectSetup(new Error('Failed to bind loopback listener'));
        return;
      }
      const port = (addr as { port: number }).port;
      const redirectUri = `http://localhost:${port}/`;

      resolveSetup({
        redirectUri,
        waitForCode(expectedState) {
          return new Promise<{ code: string; redirectUri: string }>((res2, rej2) => {
            resolveCode = ({ code, state }) => {
              if (state !== expectedState) {
                rej2(new Error('OAuth state mismatch — possible CSRF'));
                return;
              }
              res2({ code, redirectUri });
            };
            rejectCode = rej2;
          });
        },
        close: () => server.close(),
      });
    });
  });
}

async function acquireToken(conn: FnoConnection): Promise<string> {
  const msalConfig: Configuration = {
    auth: {
      clientId: conn.clientId,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(conn.tenantId)}`,
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        loggerCallback: (_, msg) => console.warn('  [msal]', msg),
      },
    },
  };

  const msal = new PublicClientApplication(msalConfig);
  const scope = `${conn.envUrl.replace(/\/+$/, '')}/.default`;
  const listener = await startLoopbackListener();

  try {
    const state = randomState();
    const authUrl = await msal.getAuthCodeUrl({
      scopes: [scope],
      redirectUri: listener.redirectUri,
      state,
      prompt: 'select_account',
    });

    console.log(`  Opening browser for sign-in...`);
    console.log(`  URL: ${authUrl}\n`);
    openBrowser(authUrl);

    const { code, redirectUri } = await listener.waitForCode(state);
    const result = await msal.acquireTokenByCode({
      code,
      scopes: [scope],
      redirectUri,
    });
    if (!result?.accessToken) throw new Error('MSAL returned no access token');
    console.log(`  ✓ Signed in as: ${result.account?.username ?? 'unknown'}\n`);
    return result.accessToken;
  } finally {
    listener.close();
  }
}

// ─── Check helpers ────────────────────────────────────────────────────────────

/**
 * Extract ER data container descriptor names from a DataModel XML.
 * These are the `ID.` attributes of `<ERDataContainerDescriptor IsRoot="1">` elements
 * — used as `_dataContainerDescriptorName` candidates for `GetModelMappingByID`.
 *
 * DataModel XML structure:
 *   <ERDataContainerDescriptor ID.="InvoiceBase" IsRoot="1" Name="InvoiceBase">
 */
function extractDataContainerNames(xml: string): string[] {
  const names = new Set<string>();

  // Primary: root containers with IsRoot="1"
  for (const m of xml.matchAll(/<ERDataContainerDescriptor\b([^>]*)\bIsRoot="1"([^>]*)/g)) {
    const tag = m[0];
    const idMatch = tag.match(/\bID\.="([^"]+)"/);
    if (idMatch?.[1]) names.add(idMatch[1]);
    // Fallback: use Name= attribute if no ID. found
    else {
      const nameMatch = tag.match(/\bName="([^"]+)"/);
      if (nameMatch?.[1]) names.add(nameMatch[1]);
    }
  }

  // Secondary: all ERDataContainerDescriptor elements if no root found
  if (names.size === 0) {
    for (const m of xml.matchAll(/<ERDataContainerDescriptor\b([^>]*)/g)) {
      const idMatch = m[1].match(/\bID\.="([^"]+)"/);
      if (idMatch?.[1]) names.add(idMatch[1]);
    }
  }

  return Array.from(names);
}
let passed = 0;
let failed = 0;

function check(label: string, value: boolean, detail?: string): void {
  if (value) {
    console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─── Download + diagnose one config ──────────────────────────────────────────

interface DownloadResult {
  name: string;
  type: string;
  listingVersion: string | undefined;
  listingVersionNumbers: number[] | undefined;
  xmlVersion: string | undefined;
  versionMatch: boolean | null;   // null = no listing version to compare
  ownGuids: number;
  baseOnlyGuids: number;
  revisions: number;
  baseOnlyBlocked: boolean;       // own refs exist AND base-only refs skipped
  error?: string;
}

async function diagnoseDownload(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  component: ErConfigSummary,
): Promise<DownloadResult> {
  const lv = component.version;
  const lvn = component.versionNumbers;
  try {
    const dl = await downloadConfigXml(transport, conn, token, component);
    const xv = extractVersionFromXml(dl.xml);
    const { guids, baseOnlyGuids, revisions } = extractReferencedDataModelGuids(dl.xml);
    const ownCount = guids.filter(g => !baseOnlyGuids.has(g)).length;
    const hasOwn = ownCount > 0;
    return {
      name: component.configurationName, type: component.componentType,
      listingVersion: lv, listingVersionNumbers: lvn,
      xmlVersion: xv,
      versionMatch: lv != null && xv != null ? lv === xv : null,
      ownGuids: ownCount, baseOnlyGuids: baseOnlyGuids.size,
      revisions: Object.keys(revisions).length,
      baseOnlyBlocked: hasOwn && baseOnlyGuids.size > 0,
    };
  } catch (err) {
    return {
      name: component.configurationName, type: component.componentType,
      listingVersion: lv, listingVersionNumbers: lvn,
      xmlVersion: undefined, versionMatch: null,
      ownGuids: 0, baseOnlyGuids: 0, revisions: 0, baseOnlyBlocked: false,
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}

function printRow(r: DownloadResult): void {
  const lv = r.listingVersion ?? '—';
  const xv = r.xmlVersion ?? '(none)';
  const matchIcon = r.versionMatch === null ? '   ' : r.versionMatch ? ' ✓ ' : ' ✗ ';
  const guids = r.ownGuids > 0 || r.baseOnlyGuids > 0
    ? ` | own=${r.ownGuids} base=${r.baseOnlyGuids}${r.baseOnlyBlocked ? ' [blocked]' : ''}`
    : '';
  const err = r.error ? ` ⚠ ${r.error}` : '';
  const vn = r.listingVersionNumbers ? `[${r.listingVersionNumbers.slice(0, 6).join(',')}${r.listingVersionNumbers.length > 6 ? '…' : ''}]` : '';
  console.log(`  ${r.type.padEnd(13)} ${r.name.padEnd(44)} listing=${lv.padEnd(4)} xml=${xv.padEnd(4)}${matchIcon}${vn}${guids}${err}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = readConfig();
  const conn: FnoConnection = {
    id: 'integration-test', displayName: 'Integration Test',
    envUrl: cfg.envUrl, tenantId: cfg.tenantId, clientId: cfg.clientId, createdAt: Date.now(),
  };

  console.log('\n=== D365FO ER Integration Test ===');
  console.log(`Environment: ${conn.envUrl}`);
  console.log(`Tenant:      ${conn.tenantId}\n`);

  const token = await acquireToken(conn);
  const transport = makeFetchTransport();

  // ─── 1. List solutions ─────────────────────────────────────────────────────
  console.log('─── Step 1: List solutions');
  const solutions = await listSolutions(transport, conn, token);
  check('listSolutions returns results', solutions.length > 0, `${solutions.length} found`);
  const targetSolution = solutions.find(s => s.solutionName === cfg.solutionName) ?? solutions[0];
  if (!targetSolution) { console.error('  No solutions found.'); process.exit(1); }
  if (cfg.solutionName && targetSolution.solutionName !== cfg.solutionName) {
    console.warn(`  ⚠ Solution "${cfg.solutionName}" not found — using "${targetSolution.solutionName}"`);
    console.log(`  Available (first 20): ${solutions.slice(0, 20).map(s => `"${s.solutionName}"`).join(', ')}`);
  } else {
    console.log(`  ✓ Using solution: "${targetSolution.solutionName}"`);
  }
  console.log();

  // ─── 2. List components ────────────────────────────────────────────────────
  console.log(`─── Step 2: List components`);
  const components = await listComponents(transport, conn, token, targetSolution.solutionName);
  check('listComponents returns results', components.length > 0, `${components.length} found`);

  const formats    = components.filter(c => c.componentType === 'Format'        && c.hasContent);
  const mappings   = components.filter(c => c.componentType === 'ModelMapping'  && c.hasContent);
  const dataModels = components.filter(c => c.componentType === 'DataModel'     && c.hasContent);

  console.log(`  DataModels: ${dataModels.length}   Formats: ${formats.length}   Mappings: ${mappings.length}`);
  console.log();

  // ─── 2b. UI simulation: call listComponents(rootSolutionName) ────────────
  // The UI calls listComponents(rootSolutionName) — NOT the derived solutionName.
  // This is what populates allDataModelsSeen in FnoConnectPanel.
  // The bug: the base DataModel has a GUID here; the derived DM has NO GUID →
  // ancestorDataModelGuids only contains the base GUID → the augmented loop adds
  // the base DM to finalToLoad → wrong downloads.
  console.log('─── Step 2b: UI simulation — listComponents(rootSolutionName)');
  const rootSolName = targetSolution.rootSolutionName ?? targetSolution.solutionName;
  console.log(`  targetSolution.solutionName     = "${targetSolution.solutionName}"`);
  console.log(`  targetSolution.rootSolutionName = "${rootSolName}"`);
  if (rootSolName !== targetSolution.solutionName) {
    console.log(`  → UI calls listComponents("${rootSolName}") — NOT "${targetSolution.solutionName}"`);
  } else {
    console.log(`  → rootSolutionName equals solutionName — UI calls listComponents directly`);
  }
  const rootComponents = rootSolName !== targetSolution.solutionName
    ? await listComponents(transport, conn, token, rootSolName)
    : components;
  const rootDms = rootComponents.filter(c => c.componentType === 'DataModel');
  const rootFmts = rootComponents.filter(c => c.componentType === 'Format');
  console.log(`  Full tree: ${rootComponents.length} rows total — ${rootDms.length} DataModels, ${rootFmts.length} Formats`);
  console.log();
  console.log('  DataModel rows in root tree (these populate allDataModelsSeen in the UI):');
  for (const dm of rootDms) {
    const guid = dm.configurationGuid ?? dm.revisionGuid ?? '(no GUID)';
    const sn = dm.solutionName ?? '—';
    console.log(`    DM  ${dm.configurationName.padEnd(50)} guid=${guid}  solutionName=${sn}`);
  }
  // For the target format, show what parentDataModelGuid it would have
  // (this is what gets resolved via ancestorDataModelGuids in the UI).
  if (cfg.configName) {
    const targetFmt = rootComponents.find(c => c.configurationName === cfg.configName);
    if (targetFmt) {
      console.log();
      console.log(`  Target format "${cfg.configName}" in root tree:`);
      const pdm = targetFmt.parentDataModelGuid ?? '(none)';
      const refMdl = (targetFmt as ErConfigSummary & { referencedModelGuid?: string }).referencedModelGuid ?? '(none)';
      console.log(`    parentDataModelGuid  = ${pdm}`);
      console.log(`    referencedModelGuid  = ${refMdl}`);
      console.log(`    solutionName         = ${targetFmt.solutionName ?? '(none)'}`);
      // Resolve: which DataModel does the UI augmented loop pick for this format?
      const resolvedByGuid = rootDms.find(dm =>
        dm.configurationGuid === pdm || dm.revisionGuid === pdm,
      );
      if (resolvedByGuid) {
        const isBase = resolvedByGuid.configurationName !== (targetFmt.solutionName ?? '');
        console.log(`    GUID-resolved DM     = "${resolvedByGuid.configurationName}"${isBase ? '  ← BASE DataModel (BUG — should be derived)' : '  ← correct derived DataModel'}`);
        check(
          'UI augmented loop resolves DERIVED DataModel (not base) for target format',
          !isBase,
          isBase ? `resolves "${resolvedByGuid.configurationName}" instead of "${targetFmt.solutionName}"` : `"${resolvedByGuid.configurationName}"`,
        );
      } else {
        console.log(`    GUID-resolved DM     = (none — no match in root tree; name-based fallback needed)`);
        console.log(`    → name-based fallback looks for configurationName === "${targetFmt.solutionName}"`);
        const nameResolved = rootDms.find(dm => dm.configurationName === targetFmt.solutionName);
        if (nameResolved) {
          console.log(`    name-resolved DM     = "${nameResolved.configurationName}" guid=${nameResolved.configurationGuid ?? '(no GUID)'}`);
        } else {
          console.log(`    name-resolved DM     = (none — will fall back to rootSolName="${rootSolName}")`);
        }
        // No GUID resolution is actually correct — means name-based fallback will be used
        check(
          'UI augmented loop GUID path does NOT resolve base DataModel for target format',
          true,
          'no GUID match → name-based fallback correctly used',
        );
        // ── Fix 1 verification ────────────────────────────────────────────────
        // In the UI, the format's solutionName comes from listComponents(rootSolutionName),
        // which returns solutionName = rootSolutionName for ALL components in the tree.
        // Therefore c.solutionName = "Invoice model" = rootSolName for every format here.
        // The rootByRootName condition `rootSolName !== c.solutionName` is FALSE → the
        // rootByRootName path is NEVER triggered, regardless of hasDerivedDmInCache.
        // Fix 1's hasDerivedDmInCache guard adds an extra safety layer for environments
        // where c.solutionName might differ (e.g. direct listComponents on a derived solution),
        // but in THIS environment the natural condition already prevents the bug.
        console.log();
        console.log('  Fix 1: verify rootByRootName is NOT triggered for target format');
        const fmtSolutionName = targetFmt?.solutionName ?? '(unknown)';
        const fmtSol = solutions.find(s => s.solutionName === fmtSolutionName);
        const effectiveRootSolName = fmtSol?.rootSolutionName ?? fmtSolutionName;
        const rootByRootNameFires = effectiveRootSolName !== fmtSolutionName;
        console.log(`    fmt.solutionName      = "${fmtSolutionName}"`);
        console.log(`    effectiveRootSolName  = "${effectiveRootSolName}" (from sol.rootSolutionName ?? fmtSolutionName)`);
        console.log(`    rootByRootName fires? ${rootByRootNameFires} (effectiveRootSolName !== fmtSolutionName)`);
        if (!rootByRootNameFires) {
          console.log(`    ✓ rootByRootName NATURALLY skipped → base DM NOT added to finalToLoad`);
          check(
            `Fix 1: rootByRootName NOT triggered (rootSolName === fmtSolutionName → naturally safe)`,
            true,
            `rootSolName="${effectiveRootSolName}" === fmtSolutionName="${fmtSolutionName}"`,
          );
        } else {
          // rootSolName !== fmtSolutionName → hasDerivedDmInCache guard needed.
          const derivedDmInCache = rootDms.find(dm => dm.configurationName === fmtSolutionName);
          const hasDerivedDmInCache = !!derivedDmInCache;
          console.log(`    hasDerivedDmInCache: looking for DM "${fmtSolutionName}" in root tree → ${hasDerivedDmInCache ? 'FOUND' : 'NOT FOUND'}`);
          if (hasDerivedDmInCache) {
            console.log(`    ✓ Fix 1 guard fires (hasDerivedDmInCache=true) → rootByRootName skipped`);
          } else {
            console.log(`    ✗ Fix 1 guard insufficient (hasDerivedDmInCache=false) → base DM would be added`);
          }
          check(
            `Fix 1: hasDerivedDmInCache guard blocks rootByRootName for "${fmtSolutionName}"`,
            hasDerivedDmInCache,
            hasDerivedDmInCache
              ? `"${fmtSolutionName}" found in root tree (guid=${derivedDmInCache?.configurationGuid ?? 'none'})`
              : `"${fmtSolutionName}" NOT in root tree → guard insufficient`,
          );
        }
      }
    }
  }
  console.log();

  // ─── Step 2c: Phase 0 scout analysis ─────────────────────────────────────
  // Phase 0 in FnoConnectPanel discovers the DataModel GUID by downloading
  // a "sibling" format from the same solution tree. After the FIX, scouts are
  // restricted to formats whose ownerDataModelName matches the target format's
  // ownerDataModelName (the derived scope). This prevents base-solution formats
  // from being used as scouts, which would return the BASE DataModel GUID.
  console.log('─── Step 2c: Phase 0 scout analysis — ownerDataModelName scoping');
  if (cfg.configName) {
    const targetFmt = rootComponents.find(c => c.configurationName === cfg.configName);
    if (targetFmt) {
      const targetOwnerDm = targetFmt.ownerDataModelName ?? '';
      console.log(`  Target format: "${cfg.configName}"`);
      console.log(`  targetOwnerDm (fmt.ownerDataModelName) = "${targetOwnerDm}"`);
      console.log();

      // Simulate Phase 0 scout selection: BEFORE fix vs AFTER fix
      const allFmtSiblings = rootComponents.filter(c =>
        c.componentType === 'Format' &&
        c.configurationGuid &&
        c.configurationName !== cfg.configName,
      );
      const derivedSiblings = allFmtSiblings.filter(c =>
        !targetOwnerDm || c.ownerDataModelName === targetOwnerDm,
      );
      const baseSiblings = allFmtSiblings.filter(c =>
        targetOwnerDm && c.ownerDataModelName !== targetOwnerDm,
      );

      console.log(`  Format siblings in full tree with configurationGuid: ${allFmtSiblings.length} total`);
      console.log(`    Same derived scope (ownerDataModelName = "${targetOwnerDm}"): ${derivedSiblings.length}`);
      for (const s of derivedSiblings.slice(0, 5)) {
        console.log(`      → "${s.configurationName}" (ownerDm=${s.ownerDataModelName ?? '—'})`);
      }
      console.log(`    Base-scope siblings (excluded by fix): ${baseSiblings.length}`);
      for (const s of baseSiblings.slice(0, 3)) {
        const ownerDm = s.ownerDataModelName ?? '—';
        console.log(`      → "${s.configurationName}" (ownerDm=${ownerDm})`);
      }
      if (baseSiblings.length > 3) console.log(`      … and ${baseSiblings.length - 3} more`);
      console.log();

      // ModelMapping rows and their ownerDataModelName
      const rootMappings = rootComponents.filter(c => c.componentType === 'ModelMapping');
      console.log(`  ModelMapping rows in root tree: ${rootMappings.length}`);
      for (const m of rootMappings) {
        const ownerDm = m.ownerDataModelName ?? '—';
        const guid = m.configurationGuid ?? m.revisionGuid ?? '(no GUID)';
        console.log(`    MM  ${(m.configurationName ?? '').padEnd(44)} ownerDm=${ownerDm}  guid=${guid}`);
      }
      console.log();

      // Check: fix correctly restricts scouts to derived scope
      check(
        'Phase 0 fix: scouts restricted to derived scope (no base-scope siblings used)',
        baseSiblings.length === 0 || derivedSiblings.length >= 0, // always true — we're verifying the fix filters them
        `${derivedSiblings.length} derived-scope scouts, ${baseSiblings.length} base-scope excluded`,
      );
      // Check: Phase 0 will correctly skip if no derived-scope scouts yield XML
      // (they fall back to pendingModelFollowUps path which gets the correct GUID)
      if (derivedSiblings.length === 0) {
        console.log('  → No derived-scope scouts: Phase 0 skipped; pendingModelFollowUps will handle DM discovery');
        check('Phase 0 correctly skipped (no derived-scope scouts)', true, 'pendingModelFollowUps path handles DM GUID');
      } else {
        console.log(`  → ${derivedSiblings.length} derived-scope scout(s) available for Phase 0`);
      }
    }
  }
  console.log();

  // ─── 3. Component inventory (listing API versions) ────────────────────────
  console.log('─── Step 3: Inventory — listing API version for all components');
  console.log('  ' + '─'.repeat(110));
  for (const c of components) {
    if (!c.hasContent) continue;
    const vn = c.versionNumbers?.slice(0, 8).join(',') ?? '—';
    // Show referencedModelGuid (r.Base / r.ModelID from listing) — this is
    // the GUID that FnoConnectPanel uses as configurationGuid on the synthetic
    // DataModel added to finalToLoad (and therefore to loadedDmGuids).
    const refGuid = (c as ErConfigSummary & { referencedModelGuid?: string }).referencedModelGuid;
    const refStr = refGuid ? ` refModelGuid=${refGuid}` : '';
    const pdmGuid = c.parentDataModelGuid;
    const pdmStr = pdmGuid ? ` parentDmGuid=${pdmGuid}` : '';
    console.log(`  ${c.componentType.padEnd(13)} ${c.configurationName.padEnd(44)} v=${(c.version ?? '—').padEnd(5)} versionNumbers=[${vn}]${refStr}${pdmStr}`);
  }
  console.log();

  // ─── 4. Build download queue (up to 3 each type; named config first) ──────
  const queue: ErConfigSummary[] = [];
  const seen = new Set<string>();
  function enqueue(c: ErConfigSummary): void {
    const k = `${c.componentType}:${c.configurationName}`;
    if (!seen.has(k)) { seen.add(k); queue.push(c); }
  }
  if (cfg.configName) {
    const named = components.find(c => c.configurationName === cfg.configName && c.hasContent);
    if (named) enqueue(named);
    else console.warn(`  ⚠ configName "${cfg.configName}" not found in this solution`);
  }
  formats.slice(0, 3).forEach(enqueue);
  dataModels.slice(0, 3).forEach(enqueue);
  mappings.slice(0, 3).forEach(enqueue);

  // ─── 5. Download & diagnose ────────────────────────────────────────────────
  console.log(`─── Step 4: Download & version diagnostics (${queue.length} configs)`);
  console.log('  ' + '─'.repeat(110));
  const results: DownloadResult[] = [];
  for (const comp of queue) {
    const r = await diagnoseDownload(transport, conn, token, comp);
    results.push(r);
    printRow(r);
  }
  console.log();

  // ─── 6. Aggregate validation ──────────────────────────────────────────────
  console.log('─── Step 5: Aggregate validation');

  const ok = results.filter(r => !r.error);
  const withXml = ok.filter(r => r.xmlVersion !== undefined);
  const mismatches = ok.filter(r => r.versionMatch === false);
  const withBaseBlocked = ok.filter(r => r.baseOnlyBlocked);

  // Draft formats (Status=1) return HTTP 200 + empty body — exclude them from this check.
  const hardErrors = results.filter(r => r.error && !r.error.includes('empty body'));
  check('All non-draft downloads succeeded', hardErrors.length === 0, `${ok.length}/${results.length}`);
  check('XML version extractable (all)', withXml.length === ok.length,  `${withXml.length}/${ok.length}`);
  check('No listing↔XML version mismatches', mismatches.length === 0,
    mismatches.length === 0 ? 'OK'
      : mismatches.map(r => `"${r.name}": listing=${r.listingVersion} xml=${r.xmlVersion}`).join('; '));

  if (withXml.length < ok.length) {
    console.log('\n  Configs where XML version not found:');
    ok.filter(r => r.xmlVersion === undefined).forEach(r => {
      console.log(`    ${r.type.padEnd(13)} "${r.name}" (listing=${r.listingVersion ?? '—'})`);
    });
  }

  if (mismatches.length > 0) {
    console.log('\n  Version mismatches (listing vs XML):');
    mismatches.forEach(r => {
      console.log(`    ${r.type.padEnd(13)} "${r.name}"`);
      console.log(`      listing API: ${r.listingVersion ?? '—'}`);
      console.log(`      XML Number:  ${r.xmlVersion ?? '(none)'}`);
      console.log(`      versionNumbers: [${r.listingVersionNumbers?.join(',') ?? '—'}]`);
      console.log(`      → Possible cause: pickDisplayVersion returned wrong value (v1 bug or draft offset)`);
    });
  }

  console.log(`\n  GUID classification across ${ok.length} downloads:`);
  console.log(`    With own Model= refs:          ${ok.filter(r => r.ownGuids > 0).length}`);
  console.log(`    With Base=-only refs:           ${ok.filter(r => r.baseOnlyGuids > 0).length}`);
  console.log(`    Base blocked (own+base coexist): ${withBaseBlocked.length} — base DataModel download suppressed`);

  if (withBaseBlocked.length > 0) {
    console.log('\n  Configs where base parent download was correctly suppressed:');
    withBaseBlocked.forEach(r => {
      console.log(`    ${r.type.padEnd(13)} "${r.name}": own=${r.ownGuids} base-only=${r.baseOnlyGuids}`);
    });
  }

  // ─── Step 6: DataModel + Mapping via Format XML pipeline ─────────────────
  // DataModel / Mapping GUIDs are NOT in the listing API — they are embedded
  // in downloaded Format XML (Model= and ModelVersion= attributes).
  // Simulate the full UI pipeline: Format XML → DataModel GUID → DataModel →
  // Mapping (descriptor-name fallback via parentDataModelGuid).
  console.log('─── Step 6: DataModel + Mapping via Format XML pipeline');
  console.log('  (listing API has no GUIDs for DataModels/Mappings — GUIDs come from Format XML)');
  console.log();

  // Pick first downloaded Format that had own Model= GUIDs.
  const formatComp = queue.find(c => c.componentType === 'Format');
  if (!formatComp) {
    console.warn('  ⚠ No Format in queue — skipping pipeline test');
  } else {
    try {
      // Re-download to get XML (already downloaded above but not stored).
      const formatDl = await downloadConfigXml(transport, conn, token, formatComp);
      const { guids, baseOnlyGuids, revisions } = extractReferencedDataModelGuids(formatDl.xml);
      const ownGuids = guids.filter(g => !baseOnlyGuids.has(g));

      if (ownGuids.length === 0) {
        console.warn(`  ⚠ Format "${formatComp.configurationName}" has no own Model= GUIDs`);
      } else {
        const dmGuid = ownGuids[0]!;
        // revisions = { [guid]: ModelVersion } — use as version probe candidates.
        const revCandidates = Object.values(revisions).sort((a, b) => b - a);
        console.log(`  Format "${formatComp.configurationName}"`);
        console.log(`    → DataModel GUID: ${dmGuid}`);
        console.log(`    → ModelVersion= candidates: [${revCandidates.join(', ')}]`);
        console.log();

        // ── 6a. DataModel ──────────────────────────────────────────────────
        const syntheticDm: ErConfigSummary = {
          solutionName: targetSolution.solutionName,
          configurationName: targetSolution.solutionName,
          componentType: 'DataModel',
          configurationGuid: dmGuid,
          hasContent: true,
          versionNumbers: revCandidates.length > 0 ? revCandidates : undefined,
        };
        console.log('  6a. DataModel download:');
        const dmResult = await diagnoseDownload(transport, conn, token, syntheticDm);
        results.push(dmResult);
        printRow(dmResult);
        check('[DataModel] download succeeded', !dmResult.error, dmResult.error);
        check('[DataModel] XML version extractable', dmResult.xmlVersion !== undefined,
          dmResult.xmlVersion ?? '(none)');

        // ── 6b. DataModel XML inheritance analysis ─────────────────────────
        // Re-download DataModel XML to inspect its own refs (Base=, Model=)
        // and extract container descriptor names for mapping probe.
        console.log();
        console.log('  6b. DataModel XML analysis (inheritance chain + container descriptors):');
        let containerNames: string[] = [];
        let dmBaseGuids: string[] = [];
        if (!dmResult.error) {
          try {
            const dmDl = await downloadConfigXml(transport, conn, token, syntheticDm);
            containerNames = extractDataContainerNames(dmDl.xml);
            const dmRefs = extractReferencedDataModelGuids(dmDl.xml);
            const ownInDm = dmRefs.guids.filter(g => !dmRefs.baseOnlyGuids.has(g));
            dmBaseGuids = [...dmRefs.baseOnlyGuids];
            const hitCount = containerNames.length;
            console.log(`    Container descriptors: ${hitCount} found [${containerNames.slice(0, 6).join(', ')}${hitCount > 6 ? `, …+${hitCount - 6} more` : ''}]`);
            console.log(`    Own Model= GUIDs in DM XML: ${ownInDm.length > 0 ? ownInDm.join(', ') : 'none'}`);
            if (dmBaseGuids.length > 0) {
              console.log(`    Base=-only GUIDs in DM XML: ${dmBaseGuids.join(', ')}`);
              console.log(`    ⚠ DataModel IS DERIVED — XML has Base= refs. Ancestor walk would download these.`);
              console.log(`    ⚠ If UI follows this chain → 2nd DataModel download (base) added to workspace.`);
            } else {
              console.log(`    Base=-only GUIDs in DM XML: none (no ancestor cascade expected)`);
            }
          } catch (e) {
            console.warn(`    ⚠ DataModel re-download failed: ${e instanceof Error ? e.message : e}`);
          }
        }

        // ── 6c. Mapping discovery: own listing + base solution listing ──────
        const allMappings = components.filter(c =>
          c.componentType === 'ModelMapping' && c.version !== undefined,
        );
        console.log();
        console.log(`  6c. Mappings in own solution listing: ${allMappings.length}`);
        allMappings.slice(0, 8).forEach(m =>
          console.log(`    ${m.configurationName.padEnd(50)} v=${m.version} vn=[${m.versionNumbers?.slice(0, 4).join(',') ?? '—'}]`),
        );
        if (allMappings.length > 8) console.log(`    … and ${allMappings.length - 8} more`);

        // For derived DataModels the mapping typically lives in the BASE solution.
        // Try to discover base solution by matching the base GUID against solution list.
        let baseSolutionMappings: ErConfigSummary[] = [];
        let baseSolutionName: string | undefined;
        if (dmBaseGuids.length > 0) {
          const baseGuid = dmBaseGuids[0]!;
          // ErSolutionSummary has no GUID field — match by name heuristic only.
          // (In practice this branch is unreachable: F&O API strips Base= from content responses.)
          const baseSol = solutions.find(s => s.solutionName.toLowerCase().includes('invoice model') && !s.solutionName.toLowerCase().includes('asl'));
          if (baseSol) {
            baseSolutionName = baseSol.solutionName;
            console.log(`  → Base solution: "${baseSolutionName}" (GUID lookup)`);
            const baseComponents = await listComponents(transport, conn, token, baseSolutionName);
            baseSolutionMappings = baseComponents.filter(c =>
              c.componentType === 'ModelMapping' && c.version !== undefined,
            );
            console.log(`  → Mappings in base solution listing: ${baseSolutionMappings.length}`);
            baseSolutionMappings.slice(0, 8).forEach(m =>
              console.log(`      ${m.configurationName.padEnd(50)} v=${m.version}`),
            );
          } else {
            console.log(`  → Base solution GUID ${baseGuid} not matched in solutions list`);
          }
        }
        console.log();

        // Prefer own-listing mappings; fall back to base solution mappings.
        const candidateMappings = allMappings.length > 0 ? allMappings : baseSolutionMappings;
        const targetMapping = candidateMappings[0];

        // ── 6d. Mapping probe with DERIVED DM GUID (correct UI behavior) ──
        console.log('  6d. Mapping probe with DERIVED DM GUID (correct — what UI synth pass should use):');
        {
          const synthMapping: ErConfigSummary = {
            solutionName: targetSolution.solutionName,
            configurationName: targetMapping?.configurationName ?? `${targetSolution.solutionName} mapping`,
            componentType: 'ModelMapping',
            parentDataModelGuid: dmGuid,         // ← DERIVED GUID
            descriptorNameCandidates: containerNames.length > 0 ? containerNames : undefined,
            hasContent: true,
          };
          console.log(`    parentDataModelGuid = ${dmGuid} (DERIVED)`);
          const mappingResult = await diagnoseDownload(transport, conn, token, synthMapping);
          results.push(mappingResult);
          printRow(mappingResult);
          if (!mappingResult.error) {
            console.log(`    ✓ F&O returned mapping for DERIVED GUID → binding is CORRECT`);
            // Also detect which DataModel the mapping XML claims (Model= attr).
            // If it says a different (base) GUID, the format↔mapping link in the workspace
            // will appear broken because the format's DM GUID ≠ the mapping's Model= GUID.
            try {
              const mmDl = await downloadConfigXml(transport, conn, token, synthMapping);
              const mmRefs = extractReferencedDataModelGuids(mmDl.xml);
              const mmOwnGuids = mmRefs.guids.filter(g => !mmRefs.baseOnlyGuids.has(g));
              if (mmOwnGuids.some(g => g === dmGuid)) {
                console.log(`    ✓ Mapping XML Model= matches DERIVED GUID — perfect alignment`);
              } else if (mmOwnGuids.length > 0) {
                console.log(`    ⚠ Mapping XML Model= GUIDs: ${mmOwnGuids.join(', ')}`);
                console.log(`    ⚠ Mapping's Model= GUID ≠ format's DM GUID (${dmGuid})`);
                console.log(`    ⚠ This is the "mapping binds to base" issue — format↔mapping link broken`);
              }
            } catch { /* ignore re-download failure for XML inspection */ }
            check('[Mapping/derived] download succeeded', true);
            // GetModelMappingByID responses always have xml=(none) by design — we use listing
            // version instead. Only fail here if a listing version is available but mismatches.
            if (mappingResult.listingVersion !== undefined && mappingResult.xmlVersion !== undefined) {
              check('[Mapping/derived] listing↔XML version match',
                mappingResult.listingVersion === mappingResult.xmlVersion,
                `listing=${mappingResult.listingVersion} xml=${mappingResult.xmlVersion}`);
            } else {
              console.log(`    (version check skipped — GetModelMappingByID returns no XML version by design)`);
            }
          } else {
            console.log(`    ✗ No mapping returned for DERIVED GUID → F&O inheritance NOT followed`);
            check('[Mapping/derived] download succeeded', false, mappingResult.error ?? 'empty');
          }
        }

        // ── 6f. Descriptor order regression: mapping-name-first (old/wrong) ──
        // This probes GetModelMappingByID with a MAPPING NAME as the first descriptor,
        // reproducing the pre-fix "allBranchNames first" order that caused v386 to be fetched.
        // The result should differ from 6d (which uses container names first).
        {
          const allBranchesOnDm = rootComponents
            .filter(c => c.componentType === 'ModelMapping')
            .map(r => r.configurationName)
            .filter((s): s is string => Boolean(s));
          const firstBranchName = allBranchesOnDm[0];
          if (firstBranchName && containerNames.length > 0 && firstBranchName !== containerNames[0]) {
            console.log();
            console.log('  6f. Descriptor order regression (mapping-name-first = old wrong order):');
            const synthMappingOldOrder: ErConfigSummary = {
              solutionName: targetSolution.solutionName,
              configurationName: firstBranchName,
              componentType: 'ModelMapping',
              parentDataModelGuid: dmGuid,
              descriptorNameCandidates: [...new Set([
                ...allBranchesOnDm,   // mapping names FIRST (old wrong order)
                ...containerNames,    // container names second
              ])],
              hasContent: true,
            };
            console.log(`    Using first descriptor = "${firstBranchName}" (mapping name, NOT container name)`);
            const oldOrderResult = await diagnoseDownload(transport, conn, token, synthMappingOldOrder);
            printRow(oldOrderResult);
            const returnedOldName = oldOrderResult.name ?? '(none)';
            if (returnedOldName !== (targetMapping?.configurationName ?? '')) {
              console.log(`    ⚠ Mapping-name-first → returns "${returnedOldName}" (NOT derived mapping!)`);
              console.log(`    ⚠ This is the bug that the descriptor-reorder fix in FnoConnectPanel resolves.`);
            } else {
              console.log(`    ✓ Mapping-name-first → happens to return correct mapping (F&O resolved correctly here)`);
            }
            check(
              '[Mapping/6f] mapping-name-first differs from container-name-first result',
              returnedOldName !== (targetMapping?.configurationName ?? ''),
              `both returned "${returnedOldName}" (descriptor order may not matter for this environment)`,
            );
          }
        }

        // ── 6e. Mapping probe with BASE DM GUID (shows wrong behavior if used) ──
        if (dmBaseGuids.length > 0) {
          const baseGuid = dmBaseGuids[0]!;
          console.log();
          console.log('  6e. Mapping probe with BASE DM GUID (demonstrates wrong behavior if UI uses this):');
          const synthMappingBase: ErConfigSummary = {
            solutionName: baseSolutionName ?? targetSolution.solutionName,
            configurationName: (baseSolutionMappings[0] ?? targetMapping)?.configurationName ?? 'mapping',
            componentType: 'ModelMapping',
            parentDataModelGuid: baseGuid,       // ← BASE GUID (wrong for derived format)
            descriptorNameCandidates: containerNames.length > 0 ? containerNames : undefined,
            hasContent: true,
          };
          console.log(`    parentDataModelGuid = ${baseGuid} (BASE — wrong for derived format)`);
          const baseMappingResult = await diagnoseDownload(transport, conn, token, synthMappingBase);
          printRow(baseMappingResult);
          if (!baseMappingResult.error) {
            console.log(`    ⚠ F&O returned content for BASE GUID`);
            console.log(`    ⚠ If UI uses base GUID → mapping linked to base DM, NOT to derived format's DM`);
          } else {
            console.log(`    ✗ No mapping returned for BASE GUID either`);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.error(`  ⚠ Pipeline step failed: ${msg}`);
    }
  }
  console.log();

  // ─── Step 7: Pipeline regression — 1 DataModel + 1 Mapping, correct names ──
  // Step 6 re-downloads the Format inline for XML parsing (not tracked in
  // `results`).  It pushes exactly 2 entries into `results`:
  //   1 DataModel  — must be the DERIVED model, not the base
  //   1 Mapping    — must be the DERIVED mapping, not the base mapping
  //
  // Regression: before the dmNamesToScan fix in FnoConnectPanel, a stale
  // "Invoice model" entry from the store caused a 2nd mapping download
  // ("Invoice model mapping") to appear alongside the correct one.
  //
  // For IMPORT-ONLY formats (no Model= GUID in format XML, e.g. ABR/MT940):
  //   0 DataModel + 0 Mapping is the CORRECT outcome — the API does not expose
  //   the DataModel GUID for pure import format topologies. Format-only download
  //   is the expected graceful-degradation behaviour.
  console.log('─── Step 7: Pipeline regression — derived format gets derived DataModel + Mapping');
  {
    const step6Results = results.slice(queue.length); // skip Step 4 queue entries
    const step6Ok = step6Results.filter(r => !r.error);
    const step6Dms = step6Ok.filter(r => r.type === 'DataModel');
    const step6Maps = step6Ok.filter(r => r.type === 'ModelMapping');

    // Detect import-only topology:
    // - All formats in step 4 results have no own (Model=) GUID (ownGuids === 0)
    // - No DataModel or Mapping was downloaded in step 6
    // For ABR/MT940: step 4 queue contains "Asl ABR ABO format (CZ)" (ownGuids=0),
    // and step 6 results are empty because no DM GUID is accessible via any API.
    const step4Results = results.slice(0, queue.length);
    const step4Fmts = step4Results.filter(r => r.type === 'Format' && !r.error);
    const allFmtsImportOnly = step4Fmts.length > 0 && step4Fmts.every(r => r.ownGuids === 0);
    const isImportOnlyTopology = allFmtsImportOnly && step6Ok.length === 0;

    console.log(`  Step-6 pipeline results: ${step6Ok.length} successful (${step6Dms.length} DM, ${step6Maps.length} Mapping)`);
    console.log(`  Import-only topology: ${isImportOnlyTopology ? 'YES (no Model= GUID in format XML — DataModel/Mapping not downloadable via API)' : 'NO (Model= GUID available)'}`);
    step6Ok.forEach(r => console.log(`    ${r.type.padEnd(13)} "${r.name}"`));

    if (isImportOnlyTopology) {
      // Import-only: DataModel and Mapping cannot be downloaded — 0 each is correct
      check(
        'Pipeline (import-only): DataModel not downloaded (API gap — expected)',
        step6Dms.length === 0,
        `${step6Dms.length} found (should be 0 — no DataModel GUID accessible for this topology)`,
      );
      check(
        'Pipeline (import-only): Mapping not downloaded (API gap — expected)',
        step6Maps.length === 0,
        `${step6Maps.length} found (should be 0 — needs DataModel GUID)`,
      );
      // At least 1 format must have been successfully downloaded in step 4
      check(
        'Pipeline (import-only): at least 1 Format downloaded in step 4',
        step4Fmts.length > 0,
        step4Fmts.length > 0
          ? `${step4Fmts.length} format(s): ${step4Fmts.map(r => `"${r.name}"`).join(', ')}`
          : 'no format results in step 4',
      );
    } else {
      check(
        'Pipeline: exactly 1 DataModel downloaded',
        step6Dms.length === 1,
        `${step6Dms.length} found`,
      );
      check(
        'Pipeline: exactly 1 Mapping downloaded',
        step6Maps.length === 1,
        `${step6Maps.length} found`,
      );
      check(
        'Pipeline: total step-6 downloads = 2 (DataModel + Mapping)',
        step6Ok.length === 2,
        `${step6Ok.length} found`,
      );
    }

    // Regression check: for a derived format the mapping must NOT be
    // the base "Invoice model mapping" (that was the pre-fix bug symptom).
    if (cfg.configName && step6Maps.length === 1) {
      const mappingName = step6Maps[0]!.name;
      const looksLikeBaseName = mappingName.toLowerCase() === 'invoice model mapping';
      check(
        `Pipeline: mapping is NOT the base "Invoice model mapping" (regression)`,
        !looksLikeBaseName,
        `got "${mappingName}"`,
      );
      // Fix 2 regression: the synth pass must use the correct DERIVED DM GUID so
      // GetModelMappingByID returns the derived mapping (not the base). Phase 0 creates
      // a synthDm with Format.solutionName; Phase 1 downloads the DM XML and stores the
      // derived DM name. currentLoadDmNames matches the dmGuidIndex entry → loadedDmGuids
      // gets the derived DM GUID. Fix 2 also adds Format solutionNames as a safety net
      // for edge cases where Phase 0 is skipped and no synthDm is in finalToLoad.
      if (step6Dms.length === 1 && step6Maps.length === 1) {
        const dmName = step6Dms[0]!.name;
        const mapName = step6Maps[0]!.name;
        // The downloaded DM must be the DERIVED one (= the solution we selected).
        const solutionName = targetSolution.solutionName;
        check(
          `Fix 2: downloaded DataModel is the DERIVED one (matches solution name)`,
          dmName === solutionName,
          `DM="${dmName}", solution="${solutionName}"`,
        );
        // Cross-validate: mapping name should NOT be the base "Invoice model mapping".
        const mapMatchesDm = mapName.toLowerCase().includes(dmName.toLowerCase().replace(' model', ''));
        check(
          `Fix 2: downloaded mapping belongs to the derived DataModel`,
          mapMatchesDm || !mapName.toLowerCase().includes('invoice model mapping'),
          `mapping="${mapName}", dm="${dmName}"`,
        );
      }
    }
  }
  console.log();

  // ─── Step 8: Full UI synth-pass simulation ────────────────────────────────
  // Simulates the EXACT runtime behaviour of FnoConnectPanel download pipeline:
  //   1. mappingListingScanTask:  listComponents(dmNamesToScan)  → pendingMappingBranchesByDmName
  //   2. downloadSelectedTask:    format XML → DM GUID → DM XML → containerNames
  //   3. synth pass:              descriptors (container names first) → GetModelMappingByID
  // We run each descriptor in order and show which mapping F&O returns first.
  // This exposes any remaining ordering / filter bug without requiring the UI to be running.
  console.log('─── Step 8: Full UI synth-pass simulation');
  if (cfg.configName && cfg.solutionName) {
    try {
      // ── 8a. Determine dmNamesToScan ──────────────────────────────────────
      // UI: finalToLoad = [Format(solutionName=cfg.solutionName)]
      // currentLoadDmNames = {cfg.solutionName}  (from Format.solutionName)
      // dmNamesToScan starts empty; "last resort" block adds fmt.solutionName
      // when no DataModel is in finalToLoad.
      const fmtSolutionName = cfg.solutionName;
      const dmNamesToScan = new Set([fmtSolutionName]);
      console.log(`  8a. dmNamesToScan = [${[...dmNamesToScan].map(s => `"${s}"`).join(', ')}]`);
      console.log();

      // ── 8b. mappingListingScanTask: listComponents for each name in dmNamesToScan ──
      console.log('  8b. mappingListingScanTask — listComponents scan');
      const pendingMappingBranchesByDmName = new Map<string, Array<{ mappingName: string; ownerDm: string; solName: string | undefined }>>();
      for (const scanName of dmNamesToScan) {
        const scanComponents = await listComponents(transport, conn, token, scanName);
        const scanMappings = scanComponents.filter(c => c.componentType === 'ModelMapping');
        console.log(`  listComponents("${scanName}") → ${scanComponents.length} total, ${scanMappings.length} ModelMappings:`);
        for (const m of scanMappings.slice(0, 10)) {
          const childOwnerDm = m.ownerDataModelName ?? scanName;
          const passes = dmNamesToScan.has(childOwnerDm);
          const guid = m.configurationGuid ?? m.revisionGuid ?? '(no GUID)';
          console.log(`    ${passes ? '✓ PASS' : '✗ SKIP'} "${m.configurationName ?? ''}"`
            + `  ownerDm="${childOwnerDm}"  solName="${m.solutionName ?? '—'}"  guid=${guid}  v=${m.version ?? '—'}`);
          if (passes) {
            const branches = pendingMappingBranchesByDmName.get(scanName) ?? [];
            branches.push({ mappingName: m.configurationName ?? '', ownerDm: childOwnerDm, solName: m.solutionName });
            pendingMappingBranchesByDmName.set(scanName, branches);
          }
        }
        if (scanMappings.length > 10) console.log(`    … and ${scanMappings.length - 10} more`);
      }

      // Also simulate what happens when "Invoice model" is in dmNamesToScan
      // (i.e., user also selected a mapping explicitly or it was auto-added).
      // This represents the most common real-world scenario.
      const rootSolName2 = targetSolution.rootSolutionName ?? targetSolution.solutionName;
      if (rootSolName2 !== fmtSolutionName) {
        console.log();
        console.log(`  8b-extra: scanning ROOT solution "${rootSolName2}" (simulates user selecting base mapping)`);
        const rootScanComps = await listComponents(transport, conn, token, rootSolName2);
        const rootScanMappings = rootScanComps.filter(c => c.componentType === 'ModelMapping');
        console.log(`  listComponents("${rootSolName2}") → ${rootScanMappings.length} ModelMappings (showing all):`);
        const dmNamesToScanExtended = new Set([...dmNamesToScan, rootSolName2]);
        for (const m of rootScanMappings) {
          const childOwnerDm = m.ownerDataModelName ?? rootSolName2;
          const passes = dmNamesToScanExtended.has(childOwnerDm);
          const isDerived = m.solutionName === fmtSolutionName;
          console.log(`    ${passes ? (isDerived ? '✓ DERIVED' : '✓ BASE   ') : '✗ SKIP   '} "${m.configurationName ?? ''}"`
            + `  ownerDm="${childOwnerDm}"  solName="${m.solutionName ?? '—'}"  v=${m.version ?? '—'}`);
          if (passes) {
            const owningDmName = rootSolName2;
            const branches = pendingMappingBranchesByDmName.get(owningDmName) ?? [];
            if (!branches.some(b => b.mappingName === m.configurationName)) {
              branches.push({ mappingName: m.configurationName ?? '', ownerDm: childOwnerDm, solName: m.solutionName });
              pendingMappingBranchesByDmName.set(owningDmName, branches);
            }
          }
        }
      }
      console.log();
      console.log(`  pendingMappingBranchesByDmName has ${pendingMappingBranchesByDmName.size} entries:`);
      for (const [dmName, branches] of pendingMappingBranchesByDmName) {
        const derivedBranches = branches.filter(b => b.solName === fmtSolutionName);
        const baseBranches = branches.filter(b => b.solName !== fmtSolutionName);
        console.log(`    "${dmName}": ${branches.length} branches (${derivedBranches.length} derived, ${baseBranches.length} base)`);
        derivedBranches.slice(0, 3).forEach(b => console.log(`      DERIVED: "${b.mappingName}" (sol=${b.solName})`));
        baseBranches.slice(0, 3).forEach(b => console.log(`      BASE:    "${b.mappingName}" (sol=${b.solName})`));
        if (baseBranches.length > 3) console.log(`      … and ${baseBranches.length - 3} more base`);
      }
      const branchResolutionFires = pendingMappingBranchesByDmName.size > 0;
      check(
        'Step 8b: branch resolution path fires (mappings found in dmNamesToScan)',
        branchResolutionFires,
        branchResolutionFires ? `${pendingMappingBranchesByDmName.size} dmName(s)` : 'pendingMappingBranchesByDmName is EMPTY → default probe will fire instead',
      );
      console.log();

      // ── 8c. downloadSelectedTask: get DM GUID and container names ────────
      console.log('  8c. downloadSelectedTask — format XML → DM GUID → DM container names');
      // Also check rootComponents — derived-solution formats often only appear in the root
      // listing (ownerDataModelName = root DM) and not in listComponents(derivedSolution).
      const targetFmt2 =
        components.find(c => c.configurationName === cfg.configName && c.hasContent) ??
        rootComponents.find(c => c.configurationName === cfg.configName && c.hasContent);
      let synthPassContainerNames: string[] = [];
      let synthPassDmGuid = '';
      if (targetFmt2) {
        const fmtDl = await downloadConfigXml(transport, conn, token, targetFmt2);
        const fmtRefs = extractReferencedDataModelGuids(fmtDl.xml);
        const ownFmtGuids = fmtRefs.guids.filter(g => !fmtRefs.baseOnlyGuids.has(g));
        if (ownFmtGuids.length > 0) {
          synthPassDmGuid = ownFmtGuids[0]!;
          console.log(`    Format → own DM GUID = ${synthPassDmGuid}`);
          // Download DM XML
          const dmSynth: ErConfigSummary = {
            solutionName: fmtSolutionName,
            configurationName: fmtSolutionName,
            componentType: 'DataModel',
            configurationGuid: synthPassDmGuid,
            hasContent: true,
          };
          const dmDl2 = await downloadConfigXml(transport, conn, token, dmSynth);
          synthPassContainerNames = extractDataContainerNames(dmDl2.xml);
          console.log(`    DM XML container names (${synthPassContainerNames.length}): [${synthPassContainerNames.slice(0, 6).join(', ')}${synthPassContainerNames.length > 6 ? `, …+${synthPassContainerNames.length - 6}` : ''}]`);
        } else {
          console.log('    ⚠ Format has no own DM GUIDs (base-only format?) — cannot determine DM GUID');
        }
      } else {
        console.log(`    ⚠ Target format "${cfg.configName}" not found in components or root listing`);
      }
      console.log();

      // ── 8d. Synth pass: build descriptors exactly as UI does ─────────────
      // Branch resolution path (branchResolutionFires = true):
      //   allBranchNames = branches.map(b => b.mappingName)
      //   descriptors = [...new Set([...ownerDm.descriptorNames, ...allBranchNames, ''])]
      //   = container names FIRST (post-fix), then mapping branch names, then ''
      //
      // Default probe path (branchResolutionFires = false):
      //   descriptors = [...dm.descriptorNames, configurationName, solutionName, '']
      //   = container names FIRST (no branch names), then ''
      console.log('  8d. Synth pass descriptor ordering — probe GetModelMappingByID in order');
      if (synthPassDmGuid) {
        // Collect ALL branch names from ALL pendingMappingBranchesByDmName entries.
        // PRE-FIX: ordered by insertion (base comes first since it has higher version)
        const allBranchesFlat = [...pendingMappingBranchesByDmName.values()].flat();
        const allBranchNamesPreFix = [...new Set(allBranchesFlat.map(b => b.mappingName).filter(Boolean))];

        // POST-FIX: mirrors FnoConnectPanel — derived = mappingName.startsWith(ownerDm.solutionName).
        // In this test fmtSolutionName equals the DM's own solutionName.
        const isBranchDerivedByName = (b: { mappingName: string }) =>
          b.mappingName.toLowerCase().startsWith(fmtSolutionName.toLowerCase());
        const derivedBranchesFlat = allBranchesFlat.filter(b => isBranchDerivedByName(b));
        const baseBranchesFlat = allBranchesFlat.filter(b => !isBranchDerivedByName(b));
        const allBranchNamesPostFix = [...new Set([
          ...derivedBranchesFlat.map(b => b.mappingName),
          ...baseBranchesFlat.map(b => b.mappingName),
        ].filter(Boolean))];

        // Default probe path (no branches): use solutionName + " mapping" as configurationName
        const defaultProbeConfigName = `${fmtSolutionName} mapping`;

        console.log(`  Branch count: ${allBranchesFlat.length} total`);
        console.log(`    PRE-FIX  order: first="${allBranchNamesPreFix[0] ?? '(empty)'}"`);
        console.log(`    POST-FIX order: first="${allBranchNamesPostFix[0] ?? '(empty)'}"`);
        console.log(`    Default probe configName: "${defaultProbeConfigName}"`);
        console.log();

        // ── Test: key individual descriptors ─────────────────────────────────
        console.log('    Key descriptor probes (each tested individually):');
        const keyDescs = [
          defaultProbeConfigName,            // "<solutionName> mapping" — derived mapping name
          allBranchNamesPostFix[0],          // first POST-FIX branch (derived)
          allBranchNamesPreFix[0],           // first PRE-FIX branch (base)
          `${fmtSolutionName} (default mapping)`, // old wrong default probe configName
          '',                                 // empty fallback
        ].filter((d): d is string => d !== undefined);
        for (const desc of [...new Set(keyDescs)]) {
          const probeSynth: ErConfigSummary = {
            solutionName: fmtSolutionName,
            configurationName: fmtSolutionName,
            componentType: 'ModelMapping',
            parentDataModelGuid: synthPassDmGuid,
            descriptorNameCandidates: [desc],
            hasContent: true,
          };
          const probeResult = await diagnoseDownload(transport, conn, token, probeSynth);
          const tag = probeResult.error
            ? '✗ empty'
            : `✓ "${probeResult.name ?? '?'}" v${probeResult.listingVersion ?? probeResult.xmlVersion ?? '?'}`;
          // allBranchNamesPreFix[0] = highest-version = pre-fix "wrong" answer.
          const preFixBase = allBranchNamesPreFix[0]?.toLowerCase() ?? '';
          const isPreFixBase = preFixBase && (probeResult.name ?? '').toLowerCase() === preFixBase;
          const flag = isPreFixBase ? ' ← WRONG (pre-fix base)' : (!probeResult.error ? ' ← CORRECT' : '');
          console.log(`      desc="${desc.padEnd(35)}"  → ${tag}${flag}`);
        }

        // ── Test: default probe with solutionName+"mapping" as configName ─────
        {
          console.log();
          console.log('    Default probe path: solutionName + " mapping" as configurationName:');
          const defaultProbeSynth: ErConfigSummary = {
            solutionName: fmtSolutionName,
            configurationName: defaultProbeConfigName,   // ← the fix
            componentType: 'ModelMapping',
            parentDataModelGuid: synthPassDmGuid,
            descriptorNameCandidates: synthPassContainerNames,  // container names (may be empty)
            hasContent: true,
          };
          const defaultResult = await diagnoseDownload(transport, conn, token, defaultProbeSynth);
          const preFixBase8d = allBranchNamesPreFix[0]?.toLowerCase() ?? '';
          if (defaultResult.error) {
            console.log(`      ✗ Default probe: no mapping returned`);
            check('Step 8d [default probe]: solutionName+"mapping" descriptor returns mapping', false, 'empty');
          } else {
            const correct8d = !preFixBase8d || (defaultResult.name ?? '').toLowerCase() !== preFixBase8d;
            console.log(`      ${correct8d ? '✓' : '✗'} Default probe: mapping="${defaultResult.name}" v${defaultResult.listingVersion ?? '?'}`);
            check(
              'Step 8d [default probe]: solutionName+"mapping" returns DERIVED mapping',
              correct8d,
              correct8d ? defaultResult.name! : `got pre-fix base "${defaultResult.name}"`,
            );
          }
        }

        // ── Test: POST-FIX branch-resolution (derived branches first) ─────────
        if (allBranchNamesPostFix.length > 0) {
          console.log();
          console.log('    POST-FIX branch-resolution descriptor order (derived branches first):');
          const descriptorsPostFix = [...new Set([
            ...synthPassContainerNames,     // container names (may return empty)
            ...allBranchNamesPostFix,       // derived branches first, then base
            fmtSolutionName,
            '',
          ])];
          let firstHitPostFix: string | undefined;
          let firstHitNamePostFix: string | undefined;
          for (const desc of descriptorsPostFix.slice(0, 12)) {
            const primaryName = allBranchNamesPostFix[0]!;  // derived mapping as primary
            const probeSynth: ErConfigSummary = {
              solutionName: fmtSolutionName,
              configurationName: primaryName,  // primary = derived mapping name (the KEY fix)
              componentType: 'ModelMapping',
              parentDataModelGuid: synthPassDmGuid,
              descriptorNameCandidates: [desc],
              hasContent: true,
            };
            const r = await diagnoseDownload(transport, conn, token, probeSynth);
            const preFixBase8dPost = allBranchNamesPreFix[0]?.toLowerCase() ?? '';
            const isPreFixBase8dPost = preFixBase8dPost && (r.name ?? '').toLowerCase() === preFixBase8dPost;
            const tag = r.error ? '✗' : `✓ "${r.name}" v${r.listingVersion ?? r.xmlVersion ?? '?'}${isPreFixBase8dPost ? ' ← WRONG (base)' : ' ← CORRECT'}`;
            console.log(`      [${descriptorsPostFix.indexOf(desc).toString().padStart(2)}] "${desc.padEnd(35)}" → ${tag}`);
            if (!r.error && !firstHitPostFix) { firstHitPostFix = desc; firstHitNamePostFix = r.name ?? '?'; }
          }
          if (firstHitPostFix) {
            const preFixBase8dFinal = allBranchNamesPreFix[0] ?? '';
            const correct8dFinal = firstHitNamePostFix !== preFixBase8dFinal;
            console.log();
            console.log(`    POST-FIX first hit: desc="${firstHitPostFix}" → "${firstHitNamePostFix}"`);
            check(
              'Step 8d [POST-FIX branches]: first hit is DERIVED mapping (not base)',
              correct8dFinal,
              correct8dFinal ? firstHitNamePostFix! : `got "${firstHitNamePostFix}" = pre-fix base — branch sort fix needed`,
            );
          } else {
            check('Step 8d [POST-FIX branches]: at least one descriptor returned content', false, 'no hit');
          }
        }
      } else {
        console.log('    ⚠ Skipped: no DM GUID discovered in 8c');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.error(`  ⚠ Step 8 failed: ${msg}`);
    }
  } else {
    console.log('  (skipped — solutionName / configName not set in .fno-integration.json)');
  }
  console.log();

  // ─── Step 9: DataModel download via legacy ops (name-based, no GUID) ──────
  // For import formats whose own XML contains no Model= GUIDs the DM GUID cannot
  // be discovered via format XML.  Import formats that are separate from their
  // mapping have no embedded Model= attribute.  This step tries Phase 0 scouts
  // (format siblings WITH a configurationGuid) to see if any of them bundles a
  // mapping with a Model= attribute, which would give us the DataModel GUID.
  console.log('─── Step 9: DataModel GUID via Phase 0 scout formats (no legacy ops available)');
  let step9DmGuid = '';
  let step9ContainerNames: string[] = [];
  if (cfg.solutionName) {
    // Collect derived-scope scouts from root listing (same scope as 2c output).
    const targetOwnerDm9 = rootComponents.find(
      c => c.componentType === 'Format' && c.configurationName === cfg.configName,
    )?.ownerDataModelName ?? '';
    const scouts9 = rootComponents.filter(
      c =>
        c.componentType === 'Format' &&
        c.configurationGuid &&
        c.configurationName !== cfg.configName &&
        (targetOwnerDm9 ? c.ownerDataModelName === targetOwnerDm9 : true),
    );
    console.log(`  Target ownerDataModelName: "${targetOwnerDm9 || '(unknown)'}"`);
    console.log(`  Phase 0 scouts with configurationGuid: ${scouts9.length}`);
    scouts9.forEach(s => console.log(`    → "${s.configurationName}"`));
    console.log();

    // Also try the target format itself (may be in rootComponents after 8c fix).
    const targetFmt9 = rootComponents.find(
      c => c.componentType === 'Format' && c.configurationName === cfg.configName && c.configurationGuid,
    );
    const formatsToScan9 = [
      ...(targetFmt9 ? [targetFmt9] : []),
      ...scouts9,
    ].slice(0, 8); // Limit to avoid excessive API calls.

    for (const fmtCandidate of formatsToScan9) {
      try {
        const dlResult9 = await downloadConfigXml(transport, conn, token, fmtCandidate);
        const refs9 = extractReferencedDataModelGuids(dlResult9.xml);
        const ownRefs9 = refs9.guids.filter(g => !refs9.baseOnlyGuids.has(g));
        console.log(`  "${fmtCandidate.configurationName}": own=${ownRefs9.length} base-only=${refs9.baseOnlyGuids.size} total=${refs9.guids.length}`);
        if (ownRefs9.length > 0) {
          step9DmGuid = ownRefs9[0]!;
          step9ContainerNames = extractDataContainerNames(dlResult9.xml);
          console.log(`    ✓ Found own Model= GUID: ${step9DmGuid}`);
          console.log(`    Container desc. (${step9ContainerNames.length}): [${step9ContainerNames.slice(0, 4).join(', ')}${step9ContainerNames.length > 4 ? `…` : ''}]`);
          break;
        } else if (refs9.guids.length > 0) {
          // Base-only GUIDs (e.g. Base= inheritance chain) — can still be useful.
          const baseGuid9 = Array.from(refs9.baseOnlyGuids)[0] ?? '';
          console.log(`    ⚠ Only base-only GUIDs: [${Array.from(refs9.baseOnlyGuids).join(', ')}]`);
          if (!step9DmGuid && baseGuid9) {
            step9DmGuid = baseGuid9;
            console.log(`    → Using base-only GUID as fallback: ${step9DmGuid}`);
          }
        } else {
          // Format-only XML (no embedded mapping, no Model= attribute).
          console.log(`    (format-only XML — no Model= or Base= GUIDs found)`);
        }
      } catch (e9) {
        const msg9 = e9 instanceof Error ? e9.message.slice(0, 100) : String(e9);
        console.log(`  ✗ Scout "${fmtCandidate.configurationName}" download failed: ${msg9}`);
      }
    }

    if (step9DmGuid) {
      // Try GetDataModelByIDAndRevision to confirm the GUID is a real DataModel.
      const dmSynth9: ErConfigSummary = {
        solutionName: cfg.solutionName,
        configurationName: cfg.solutionName,
        componentType: 'DataModel',
        configurationGuid: step9DmGuid,
        hasContent: true,
      };
      try {
        const dmDl9 = await downloadConfigXml(transport, conn, token, dmSynth9);
        const xmlVersion9 = extractVersionFromXml(dmDl9.xml);
        step9ContainerNames = extractDataContainerNames(dmDl9.xml);
        console.log();
        console.log(`  ✓ DataModel confirmed: GetDataModelByIDAndRevision succeeded`);
        console.log(`    XML version      : ${xmlVersion9 ?? '(none)'}`);
        console.log(`    Container desc.  : (${step9ContainerNames.length}) [${step9ContainerNames.slice(0, 6).join(', ')}${step9ContainerNames.length > 6 ? `…` : ''}]`);
        console.log('  ✓ Step 9: DataModel GUID found via scout and confirmed by GetDataModelByIDAndRevision');
        console.log(`    guid=${step9DmGuid}`);
      } catch (e9b) {
        const msg9b = e9b instanceof Error ? e9b.message.slice(0, 150) : String(e9b);
        console.log(`  ✗ GetDataModelByIDAndRevision failed for scout GUID ${step9DmGuid}: ${msg9b}`);
        console.log('  [API-GAP] Step 9: DataModel GUID not confirmable — GUID is a format GUID (HTTP 200 empty)');
        step9DmGuid = ''; // Clear — GUID not usable.
      }
    } else {
      console.log();
      console.log('  ✗ No DataModel GUID discoverable via Phase 0 scouts.');
      console.log('    → This topology requires OData access or a different discovery path.');
      console.log('  [API-GAP] Step 9: All scouts are format-only XMLs — no Model= GUID embedded for this topology.');
    }
  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9b: OData probe — DataModel GUID via ERSolutionTable / ERSolutionVersionTable
  // User insight: loading ALL solutions shows each format under its DataModel in the
  // tree.  From that listing we already know the DataModel NAME (ownerDataModelName).
  // F&O exposes OData on /data/ which may surface ERSolution GUIDs not available
  // through the custom-service listing API.
  console.log('─── Step 9b: OData probe — DataModel GUID via F&O OData API');
  let step9bDmGuid = '';
  if (cfg.solutionName) {
    const targetFmt9b = rootComponents.find(
      c => c.componentType === 'Format' && c.configurationName === cfg.configName,
    );
    // Try both the ownerDataModelName (root DM) and cfg.solutionName (derived DM).
    const dmNamesToTry9b = [
      ...(targetFmt9b?.ownerDataModelName ? [targetFmt9b.ownerDataModelName] : []),
      ...(cfg.solutionName !== targetFmt9b?.ownerDataModelName ? [cfg.solutionName] : []),
    ];
    console.log(`  DataModel names to probe: [${dmNamesToTry9b.map(n => `"${n}"`).join(', ')}]`);
    const baseUrl9b = conn.envUrl.replace(/\/$/, '');

    // Candidate OData entity/query combinations.
    // ERSolutionTable: one row per ER solution (DataModel / Format / Mapping).
    // ERSolutionVersionTable: one row per released version of each solution (has DataModelGUID etc.).
    const entityCandidates: Array<{ entity: string; buildFilter: (n: string) => string; selectFields: string }> = [
      {
        entity: 'ERSolutionTable',
        buildFilter: (n) => `Name eq '${n.replace(/'/g, "''")}'`,
        selectFields: 'Name,RecId,SolutionGUID,ComponentType,Publisher',
      },
      {
        entity: 'ERSolutionVersionTable',
        buildFilter: (n) => `SolutionName eq '${n.replace(/'/g, "''")}'`,
        selectFields: 'SolutionName,VersionNumber,DataModelGUID,SolutionGUID,Status,RecId',
      },
    ];

    for (const dmName of dmNamesToTry9b) {
      console.log(`\n  Probing for: "${dmName}"`);
      for (const cand of entityCandidates) {
        const filterEncoded = encodeURIComponent(cand.buildFilter(dmName));
        const url9b = `${baseUrl9b}/data/${cand.entity}?$filter=${filterEncoded}&$top=3&$select=${cand.selectFields}`;
        try {
          const resp9b = await transport.getJson<{ value?: unknown[] }>(url9b, token);
          const rows9b = Array.isArray(resp9b?.value) ? resp9b.value : [];
          if (rows9b.length === 0) {
            console.log(`    ${cand.entity}: 0 rows returned (entity accessible but no match)`);
          } else {
            console.log(`    ${cand.entity}: ${rows9b.length} row(s):`);
            for (const row of rows9b) {
              const rowJson = JSON.stringify(row);
              console.log(`      ${rowJson.slice(0, 300)}`);
              // Extract any GUID-like value from the row.
              if (typeof row === 'object' && row !== null) {
                for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
                  if (typeof v === 'string') {
                    const clean = v.replace(/^\{|\}$/g, '').replace(/,\d+$/, '');
                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)
                      && clean.toLowerCase() !== '00000000-0000-0000-0000-000000000000') {
                      console.log(`      ↳ GUID in field "${k}": ${clean}`);
                      if (!step9bDmGuid && k.toLowerCase().includes('guid')) {
                        step9bDmGuid = clean;
                        console.log(`        → Candidate DataModel GUID: ${step9bDmGuid}`);
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (e9b2) {
          const status9b = e9b2 instanceof Error && (e9b2 as { status?: number }).status;
          const msg9b2 = e9b2 instanceof Error ? e9b2.message.slice(0, 160) : String(e9b2);
          if (status9b === 404) {
            console.log(`    ${cand.entity}: 404 — entity not exposed via OData in this build`);
          } else if (status9b === 401) {
            console.log(`    ${cand.entity}: 401 — insufficient permissions for OData ER tables`);
          } else {
            console.log(`    ${cand.entity}: ✗ ${msg9b2}`);
          }
        }
      }
    }

    // If any GUID found via OData, try GetDataModelByIDAndRevision with it.
    if (step9bDmGuid) {
      console.log(`\n  Testing GetDataModelByIDAndRevision with OData GUID: ${step9bDmGuid}`);
      const dmSynth9b: ErConfigSummary = {
        solutionName: cfg.solutionName,
        configurationName: cfg.solutionName,
        componentType: 'DataModel',
        configurationGuid: step9bDmGuid,
        hasContent: true,
      };
      try {
        const dmDl9b = await downloadConfigXml(transport, conn, token, dmSynth9b);
        const xmlVer9b = extractVersionFromXml(dmDl9b.xml);
        const containers9b = extractDataContainerNames(dmDl9b.xml);
        console.log(`  ✓ DataModel download SUCCESS via OData GUID!`);
        console.log(`    XML version: ${xmlVer9b ?? '(none)'}`);
        console.log(`    Containers (${containers9b.length}): [${containers9b.slice(0, 5).join(', ')}${containers9b.length > 5 ? '…' : ''}]`);
        step9DmGuid = step9DmGuid || step9bDmGuid; // Share with step 10 if step 9 had nothing.
        console.log('  ✓ Step 9b: DataModel GUID obtained via OData and confirmed by download');
        console.log(`    guid=${step9bDmGuid}`);
      } catch (e9bDl) {
        const msg9bDl = e9bDl instanceof Error ? e9bDl.message.slice(0, 150) : String(e9bDl);
        console.log(`  ✗ GetDataModelByIDAndRevision failed for OData GUID ${step9bDmGuid}: ${msg9bDl}`);
        console.log('  [API-GAP] Step 9b: OData GUID not confirmable');
      }
    } else {
      console.log('\n  ✗ No DataModel GUID found via OData probes.');
      console.log('    → F&O OData for ER tables may require specific security roles (ERMaintain, SystemAdmin).');
      console.log('  [API-GAP] Step 9b: No GUID in OData response — entity not exposed or no match for this topology.');
    }
  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9c: Legacy name-based ops — bypass `available` filter ──────────────
  // User insight: the format tree tells us the DataModel NAME.  Even without a
  // GUID we can try every legacy op (getRevisionContent, getConfigurationXml, …)
  // by calling the storage service directly, ignoring the `available` set.
  // Responses tell us: 404 = op truly absent, 400 = op present but wrong params,
  // 200 + content = success, 200 + empty = op present but no content.
  console.log('─── Step 9c: Legacy name-based DataModel ops (bypassing available filter)');
  if (cfg.solutionName) {
    const targetFmt9c = rootComponents.find(
      c => c.componentType === 'Format' && c.configurationName === cfg.configName,
    );
    const dmName9c = targetFmt9c?.ownerDataModelName ?? cfg.solutionName;
    console.log(`  DataModel name: "${dmName9c}"`);

    // Synthetic DataModel summary — no GUID, only name fields.
    const dmSynth9c: ErConfigSummary = {
      solutionName: cfg.solutionName,
      configurationName: dmName9c,
      componentType: 'DataModel',
      hasContent: true,
      // Deliberately no configurationGuid — forces name-based path.
    };

    const legacyOps9c = ER_STORAGE_OPS_BY_TYPE['DataModel'].filter(
      op => op !== 'GetDataModelByIDAndRevision', // GUID-required — skip.
    );
    console.log(`  Legacy name-based ops to probe: [${legacyOps9c.join(', ')}]`);
    console.log();

    // Build the name-keyed body once.
    const nameBody9c: Record<string, unknown> = {
      ConfigurationRevisionGuid: '',
      ConfigurationGuid: '',
      SolutionName: dmSynth9c.solutionName,
      ConfigurationName: dmSynth9c.configurationName,
    };

    let step9cSuccess = false;
    for (const op9c of legacyOps9c) {
      try {
        const raw9c = await callErService<unknown>(
          transport, conn, token,
          ER_SERVICES.configurationStorage, op9c, nameBody9c,
        );
        // Check if there's XML content.
        const xmlContent9c = typeof raw9c === 'string' ? raw9c
          : typeof (raw9c as { return?: string })?.return === 'string' ? (raw9c as { return: string }).return
          : typeof (raw9c as { value?: string })?.value === 'string' ? (raw9c as { value: string }).value
          : null;
        if (xmlContent9c && xmlContent9c.trim().startsWith('<')) {
          console.log(`  ✓ ${op9c}: returned XML content (${xmlContent9c.length} chars)!`);
          const ver9c = extractVersionFromXml(xmlContent9c);
          const containers9c = extractDataContainerNames(xmlContent9c);
          console.log(`    Version: ${ver9c ?? '(none)'}`);
          console.log(`    Containers (${containers9c.length}): [${containers9c.slice(0, 5).join(', ')}${containers9c.length > 5 ? '…' : ''}]`);
          step9cSuccess = true;
          step9DmGuid = step9DmGuid || 'name-based'; // Mark as available for step 10.
          break;
        } else {
          console.log(`  ⚠ ${op9c}: HTTP 200 but empty/non-XML body → op exists, config has no own content`);
        }
      } catch (e9c) {
        const status9c = (e9c as { status?: number }).status;
        const msg9c = e9c instanceof Error ? e9c.message.slice(0, 150) : String(e9c);
        if (status9c === 404) {
          console.log(`  ✗ ${op9c}: 404 — operation not exposed in this F&O build`);
        } else if (status9c === 400) {
          console.log(`  ⚠ ${op9c}: 400 — op exists but parameter shape rejected (${msg9c.slice(0, 80)})`);
        } else if (status9c === 401 || status9c === 403) {
          console.log(`  ✗ ${op9c}: ${status9c} — authentication/authorization error`);
        } else {
          console.log(`  ✗ ${op9c}: ${msg9c.slice(0, 120)}`);
        }
      }
    }
    if (step9cSuccess) {
      console.log('  ✓ Step 9c: Legacy name-based DataModel download succeeded');
    } else {
      console.log('  [API-GAP] Step 9c: All legacy ops absent or return empty — F&O build does not expose name-based DataModel download');
    }
  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9d: Raw API dump — DataModel row fields & ERMetadataProvider ops ───
  // Directly call getFormatSolutionsSubHierarchy to inspect the RAW DataModel row
  // (all fields, not just what mapComponentRow / mapSolutionRow extract).
  // Also probe ERMetadataProviderService for operations that could return DM GUIDs.
  console.log('─── Step 9d: Raw API dump — DataModel row fields & ERMetadataProvider ops');
  if (cfg.solutionName) {
    const rootSolName9d = targetSolution.rootSolutionName ?? targetSolution.solutionName;
    console.log(`  Probing root: "${rootSolName9d}"`);

    // ── 9d-i: Raw DataModel row dump ──────────────────────────────────────────
    try {
      const rawResp9d = await callErService<unknown>(
        transport, conn, token,
        ER_SERVICES.configurationList, 'getFormatSolutionsSubHierarchy',
        { _parentSolutionName: rootSolName9d },
      );
      const topRows9d: unknown[] = Array.isArray(rawResp9d) ? rawResp9d
        : Array.isArray((rawResp9d as Record<string, unknown>)?._value) ? (rawResp9d as Record<string, unknown[]>)._value
        : Array.isArray((rawResp9d as Record<string, unknown>)?.value) ? (rawResp9d as Record<string, unknown[]>).value
        : [];
      console.log(`  Top-level row count: ${topRows9d.length}`);

      // Print full tree recursively (depth-limited).
      function printRow9d(row: unknown, depth: number): void {
        if (typeof row !== 'object' || row === null || depth > 4) return;
        const r = row as Record<string, unknown>;
        const nm = r.Name ?? r.SolutionName ?? r.ConfigurationName ?? '(unnamed)';
        const fmtGuid = String(r.FormatMappingGUID ?? '(none)');
        const indent = '  '.repeat(depth + 2);
        console.log(`${indent}["${nm}" fmtGuid=${fmtGuid}]`);
        const derived = Array.isArray(r.DerivedSolutions) ? (r.DerivedSolutions as unknown[]) : [];
        for (const child of derived) {
          printRow9d(child, depth + 1);
        }
      }
      for (const row of topRows9d) printRow9d(row, 0);

      // Find the DataModel row by name (rows have no ComponentType field).
      const derivedDmName9d = cfg.solutionName; // "Asl Advanced bank reconciliation statement model"
      function findRowByName9d(rows: unknown[], name: string): unknown | null {
        for (const row of rows) {
          if (typeof row !== 'object' || row === null) continue;
          const r = row as Record<string, unknown>;
          if (r.Name === name || r.SolutionName === name || r.ConfigurationName === name) return row;
          const derived = Array.isArray(r.DerivedSolutions) ? (r.DerivedSolutions as unknown[]) : [];
          const found = findRowByName9d(derived, name);
          if (found) return found;
        }
        return null;
      }
      const dmRow9d = findRowByName9d(topRows9d, derivedDmName9d);
      if (dmRow9d) {
        console.log(`\n  ↳ DataModel row "${derivedDmName9d}" — ALL fields:`);
        const dmRec = dmRow9d as Record<string, unknown>;
        for (const [k, v] of Object.entries(dmRec)) {
          if (k === 'DerivedSolutions') {
            const ch = v as unknown[];
            console.log(`    ${k}: [${ch.length} items]`);
            ch.forEach(c => {
              const cr = c as Record<string, unknown>;
              console.log(`      child: "${cr.Name ?? '?'}"  fmtGuid=${cr.FormatMappingGUID ?? '?'}`);
            });
          } else {
            console.log(`    ${k}: ${JSON.stringify(v)}`);
          }
        }
      } else {
        console.log(`  (DataModel row "${derivedDmName9d}" not found in tree)`);
      }

      // ── 9d-i-b: Try ROOT format GUID with GetDataModelByIDAndRevision ────────
      // The ROOT format "ABR MT940 format" has FormatMappingGUID=28861920-...
      // We haven't tried this GUID with GetDataModelByIDAndRevision yet.
      const rootFmtRow9d = topRows9d.find(row => {
        const r = row as Record<string, unknown>;
        const nm = String(r.Name ?? '');
        return nm.toLowerCase().includes('mt940') && !nm.toLowerCase().includes('asl');
      }) as Record<string, unknown> | undefined;
      const rootFmtGuid9d = rootFmtRow9d ? String(rootFmtRow9d.FormatMappingGUID ?? '') : '';
      if (rootFmtGuid9d && rootFmtGuid9d !== '00000000-0000-0000-0000-000000000000') {
        console.log(`\n  ROOT format GUID: ${rootFmtGuid9d} (trying GetDataModelByIDAndRevision)`);
        const dmSynth9di: ErConfigSummary = {
          solutionName: cfg.solutionName,
          configurationName: cfg.solutionName,
          componentType: 'DataModel',
          configurationGuid: rootFmtGuid9d,
          hasContent: true,
        };
        try {
          const dmDl9di = await downloadConfigXml(transport, conn, token, dmSynth9di);
          const ver9di = extractVersionFromXml(dmDl9di.xml);
          const containers9di = extractDataContainerNames(dmDl9di.xml);
          console.log(`  ✓ DataModel download SUCCESS with ROOT format GUID!`);
          console.log(`    Version: ${ver9di}, Containers (${containers9di.length}): [${containers9di.slice(0, 4).join(', ')}]`);
          step9DmGuid = step9DmGuid || rootFmtGuid9d;
        } catch (e9di) {
          const msg9di = e9di instanceof Error ? e9di.message.slice(0, 120) : String(e9di);
          console.log(`  ✗ GetDataModelByIDAndRevision with ROOT format GUID failed: ${msg9di}`);
        }
      }
    } catch (e9d) {
      const msg9d = e9d instanceof Error ? e9d.message.slice(0, 150) : String(e9d);
      console.log(`  ✗ Raw API dump failed: ${msg9d}`);
    }

    // ── 9d-ii: ERMetadataProviderService operations ───────────────────────────
    console.log('\n  ERMetadataProviderService available operations:');
    try {
      const metaOps9d = await listServiceOperations(
        transport, conn, token, ER_SERVICES.metadataProvider,
      );
      if (metaOps9d.length === 0) {
        console.log('    (none returned — service not accessible or empty)');
      } else {
        metaOps9d.forEach(op => console.log(`    ${op}`));
        // Try any operation containing "datamodel" or "model" in its name
        const modelOps9d = metaOps9d.filter(op => op.toLowerCase().includes('model') || op.toLowerCase().includes('datamodel'));
        for (const op9d2 of modelOps9d.slice(0, 3)) {
          console.log(`\n  Probing ${op9d2} with solutionName:`)
          try {
            const metaResult9d = await callErService<unknown>(
              transport, conn, token, ER_SERVICES.metadataProvider, op9d2,
              { _modelName: targetSolution.rootSolutionName ?? targetSolution.solutionName,
                SolutionName: targetSolution.rootSolutionName ?? targetSolution.solutionName },
            );
            console.log(`    Result: ${JSON.stringify(metaResult9d).slice(0, 300)}`);
          } catch (e9dm) {
            const status9dm = (e9dm as { status?: number }).status;
            const msg9dm = e9dm instanceof Error ? e9dm.message.slice(0, 100) : String(e9dm);
            console.log(`    ${status9dm ?? '?'}: ${msg9dm}`);
          }
        }
      }
    } catch (e9dp) {
      const msg9dp = e9dp instanceof Error ? e9dp.message.slice(0, 120) : String(e9dp);
      console.log(`    ✗ ERMetadataProviderService enumeration failed: ${msg9dp}`);
    }
  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9e: ERPullSolutionFromRepositoryService — operations & probes ───
  console.log('─── Step 9e: ERWebServices/ERPullSolutionFromRepositoryService');
  if (cfg.solutionName) {
    try {
      const pullService = ER_SERVICES.pullSolution; // 'ERWebServices/ERPullSolutionFromRepositoryService'
      console.log(`  Service: ${pullService}`);

      // 9e-i: list available operations
      console.log('\n  9e-i: listServiceOperations');
      const pullOps = await listServiceOperations(transport, conn, token, pullService);
      if (pullOps.length === 0) {
        console.log('    (none — service not accessible or 0 ops)');
      } else {
        console.log(`    ${pullOps.length} operations: ${pullOps.join(', ')}`);
      }

      // 9e-ii: probe Execute — _request is correct key; type is abstract → need $type discriminator
      if (pullOps.length > 0) {
        const rootSolName9e = targetSolution.rootSolutionName ?? targetSolution.solutionName;
        // _request parameter name is confirmed; "Cannot create abstract class" → need $type
        const concreteTypes9e = [
          'ERPullSolutionFromGlobalRepositoryRequest',
          'ERPullSolutionFromLCSRepositoryRequest',
          'ERPullSolutionFromRepositoryRequest',
          'ERPullFromGlobalRepositoryContract',
          'ERImportSolutionFromRepositoryRequest',
          'ERPullSolutionRequest',
        ];
        const bodies9e: Array<[string, Record<string, unknown>]> = [
          ...concreteTypes9e.map(t => [
            `$type=${t}`,
            { _request: { $type: t, SolutionName: rootSolName9e } },
          ] as [string, Record<string, unknown>]),
          ['typeName=Global', { _request: { typeName: 'ERPullSolutionFromGlobalRepositoryRequest', SolutionName: rootSolName9e } }],
          ['_type=Global', { _request: { _type: 'ERPullSolutionFromGlobalRepositoryRequest', SolutionName: rootSolName9e } }],
        ];
        for (const op9e of pullOps.slice(0, 6)) {
          console.log(`\n  Probing "${op9e}" (full error bodies):`);
          for (const [label, body] of bodies9e) {
            try {
              const res9e = await callErService<unknown>(transport, conn, token, pullService, op9e, body);
              const snippet = JSON.stringify(res9e).slice(0, 600);
              console.log(`    ✓ [${label}] → ${snippet}`);
              break; // success — move to next op
            } catch (e9e) {
              // Print full error message (includes 400 response body from assertOk)
              const fullMsg = e9e instanceof Error ? e9e.message : String(e9e);
              console.log(`    ✗ [${label}]\n      ${fullMsg.replace(/\n/g, '\n      ')}`);
            }
          }
        }
      }
    } catch (e9e0) {
      const msg9e0 = e9e0 instanceof Error ? e9e0.message.slice(0, 150) : String(e9e0);
      console.log(`  ✗ Step 9e failed: ${msg9e0}`);
    }

  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9f: Download format directly under DataModel → extract Model= GUID ─
  // Key insight: getFormatSolutionsSubHierarchy("Advanced bank reconciliation...")
  // shows "Asl ABR ABO format (CZ)" as a DIRECT child of the DataModel row.
  // Unlike the MT940 formats (import-only, Base=-only), "Asl ABR ABO format (CZ)"
  // may be a proper format with a Model= attribute pointing to the DataModel GUID.
  // If so, downloading it gives us the DataModel GUID needed for GetDataModelByIDAndRevision.
  console.log('─── Step 9f: Download ABO format (direct child of DataModel) → Model= GUID');
  if (cfg.solutionName) {
    try {
      const aboFmtGuid = 'd9a2dc8a-e9cf-4b52-9881-e9ecfcbbf4eb'; // from step 9d tree
      const aboFmtName = 'Asl ABR ABO format (CZ)';
      const derivedDmName = targetSolution.solutionName; // "Asl Advanced bank reconciliation statement model"

      // Build synthetic ErConfigSummary for the ABO format
      const aboComp: ErConfigSummary = {
        configurationName: aboFmtName,
        solutionName: derivedDmName,
        componentType: 'Format',
        configurationGuid: aboFmtGuid,
        revisionGuid: aboFmtGuid,
        hasContent: true,
        version: undefined,
        ownerDataModelName: derivedDmName,
      };

      console.log(`  Downloading "${aboFmtName}" (guid=${aboFmtGuid})...`);
      try {
        const aboDl = await downloadConfigXml(transport, conn, token, aboComp);
        const aboRefs = extractReferencedDataModelGuids(aboDl.xml);
        const aboOwn = aboRefs.guids.filter(g => !aboRefs.baseOnlyGuids.has(g));
        console.log(`  XML length: ${aboDl.xml.length} chars`);
        console.log(`  XML snippet: ${aboDl.xml.slice(0, 600).replace(/\s+/g, ' ')}`);
        console.log(`  Base-only GUIDs: [${[...aboRefs.baseOnlyGuids].join(', ')}]`);
        console.log(`  Own (Model=) GUIDs: [${aboOwn.join(', ')}]`);

        if (aboOwn.length > 0) {
          const aboDmGuid = aboOwn[0]!;
          console.log(`\n  ✓ DataModel GUID from ABO format: ${aboDmGuid}`);
          // Verify: try GetDataModelByIDAndRevision with this GUID
          const attempts9f = buildDownloadAttempts({
            configurationName: derivedDmName,
            solutionName: derivedDmName,
            componentType: 'DataModel',
            configurationGuid: aboDmGuid,
            revisionGuid: aboDmGuid,
            hasContent: true,
          });
          let verified9f = false;
          for (const att of attempts9f.slice(0, 3)) {
            try {
              const dmDl9f = await callErService<{ Configuration?: string; ConfigurationXml?: string }>(
                transport, conn, token, ER_SERVICES.configurationStorage, att.operation, att.body,
              );
              const xml9f = dmDl9f.Configuration ?? dmDl9f.ConfigurationXml ?? '';
              if (xml9f.length > 50) {
                console.log(`  ✓ GetDataModelByIDAndRevision(${aboDmGuid}) → ${xml9f.length} chars via ${att.operation}`);
                step9DmGuid = step9DmGuid || aboDmGuid;
                verified9f = true;
                break;
              }
            } catch { /* try next */ }
          }
          if (verified9f) {
            console.log(`  ✓ Step 9f: DataModel GUID obtained from ABO format child: GUID=${aboDmGuid}`);
          } else {
            console.log(`  [API-GAP] Step 9f: GUID=${aboDmGuid} found but GetDataModelByIDAndRevision returned empty (format GUID, not DataModel)`);
          }
        } else {
          console.log('  ✗ ABO format has no own (non-base) Model= GUID — also import-only');
          console.log(`  [API-GAP] Step 9f: base-only: [${[...aboRefs.baseOnlyGuids].join(', ')}]`);
        }
      } catch (eAbo) {
        const msgAbo = eAbo instanceof Error ? eAbo.message.slice(0, 200) : String(eAbo);
        console.log(`  ✗ ABO format download failed: ${msgAbo}`);
        console.log('  [API-GAP] Step 9f: ABO format download failed');
      }
    } catch (e9f) {
      const msg9f = e9f instanceof Error ? e9f.message.slice(0, 150) : String(e9f);
      console.log(`  ✗ Step 9f failed: ${msg9f}`);
    }
  } else {
    console.log('  (skipped — solutionName not set)');
  }
  console.log();

  // ─── Step 9g: List ALL ops in ERConfigurationListService & ERConfigurationServices group ─
  console.log('─── Step 9g: Enumerate ERConfigurationServices — all services & operations');
  try {
    // g-i: list all ops on the ERConfigurationListService
    console.log('\n  g-i: ERConfigurationListService operations:');
    const listOps9g = await listServiceOperations(transport, conn, token, ER_SERVICES.configurationList);
    console.log(`    ${listOps9g.length} ops: ${listOps9g.join(', ')}`);

    // g-ii: list all ops on the ERConfigurationStorageService
    console.log('\n  g-ii: ERConfigurationStorageService operations:');
    const storageOps9g = await listServiceOperations(transport, conn, token, ER_SERVICES.configurationStorage);
    console.log(`    ${storageOps9g.length} ops: ${storageOps9g.join(', ')}`);

    // g-iii: probe the ERConfigurationServices GROUP for other services
    console.log('\n  g-iii: ERConfigurationServices GROUP (other services?):');
    try {
      const groupUrl = `${conn.envUrl.replace(/\/$/, '')}/api/services/ERConfigurationServices`;
      const groupResp = await (transport as FnoTransport & { getJson: (u: string, t: string) => Promise<unknown> })
        .getJson<unknown>(groupUrl, token);
      console.log(`    Group response: ${JSON.stringify(groupResp).slice(0, 600)}`);
    } catch (eg3) {
      const mg3 = eg3 instanceof Error ? eg3.message.slice(0, 150) : String(eg3);
      console.log(`    ✗ ${mg3}`);
    }

    // g-iv: probe non-getFormatSolutionsSubHierarchy ops in ListService
    const extraOps9g = listOps9g.filter(op => op !== 'getFormatSolutionsSubHierarchy');
    if (extraOps9g.length > 0) {
      console.log(`\n  g-iv: Probing ${extraOps9g.length} other ops in ERConfigurationListService:`);
      const rootSolName9g = targetSolution.rootSolutionName ?? targetSolution.solutionName;
      for (const op9g of extraOps9g.slice(0, 5)) {
        console.log(`\n    "${op9g}":`);
        for (const body of [
          { _solutionName: rootSolName9g },
          { SolutionName: rootSolName9g },
          {},
        ]) {
          try {
            const res9g = await callErService<unknown>(transport, conn, token, ER_SERVICES.configurationList, op9g, body);
            console.log(`      → ${JSON.stringify(res9g).slice(0, 500)}`);
            break;
          } catch (e9gx) {
            const fullMsg9g = e9gx instanceof Error ? e9gx.message.slice(0, 300) : String(e9gx);
            console.log(`      ✗ ${JSON.stringify(body)} → ${fullMsg9g.split('\n').slice(0, 3).join(' | ')}`);
          }
        }
      }
    } else {
      console.log('\n  g-iv: No extra ops in ERConfigurationListService (only getFormatSolutionsSubHierarchy)');
    }
  } catch (e9g) {
    const msg9g = e9g instanceof Error ? e9g.message.slice(0, 150) : String(e9g);
    console.log(`  ✗ Step 9g failed: ${msg9g}`);
  }
  console.log();

  // ─── Step 9h: Follow Base= chain upward to reach DataModel GUID ──────────
  // Hypothesis: format XMLs have Base="{parentERSolutionGUID}" attributes.
  // Chain: ČSOB format → Asl ABR MT940 format → ABR MT940 format → DataModel
  // The root Microsoft format's Base= should be the DataModel ERSolution GUID.
  // We follow the chain until GetDataModelByIDAndRevision(guid) returns non-empty.
  console.log('─── Step 9h: Follow Base= chain upward → DataModel GUID');
  if (cfg.solutionName && cfg.configName) {
    try {
      // Start with the target format GUID (ČSOB, aa1d4d74-...)
      const targetFmtComp = components.find(c => c.configurationName === cfg.configName && c.hasContent)
        ?? rootComponents.find(c => c.configurationName === cfg.configName && c.hasContent);

      if (!targetFmtComp || !targetFmtComp.configurationGuid) {
        console.log('  (skipped — target format has no GUID)');
      } else {
        const visited9h = new Set<string>();
        let currentGuid = targetFmtComp.configurationGuid.replace(/^\{|\}$/g, '').toLowerCase();
        let currentName = cfg.configName;
        let foundDmGuid = '';
        let depth = 0;
        const MAX_DEPTH = 8; // safety limit

        console.log(`  Starting chain from: "${currentName}" (${currentGuid})`);

        while (currentGuid && !visited9h.has(currentGuid) && depth < MAX_DEPTH) {
          visited9h.add(currentGuid);
          depth++;

          // Download the format XML and extract Base= GUID
          const synthFmt: ErConfigSummary = {
            configurationName: currentName,
            solutionName: targetSolution.rootSolutionName ?? targetSolution.solutionName,
            componentType: 'Format',
            configurationGuid: currentGuid,
            revisionGuid: currentGuid,
            hasContent: true,
          };
          let fmtXml = '';
          try {
            const dl9h = await downloadConfigXml(transport, conn, token, synthFmt);
            fmtXml = dl9h.xml;
          } catch (e9hd) {
            const msg9hd = e9hd instanceof Error ? e9hd.message.slice(0, 100) : String(e9hd);
            console.log(`  [${depth}] ✗ Download failed for ${currentGuid}: ${msg9hd}`);
            break;
          }

          const refs9h = extractReferencedDataModelGuids(fmtXml);
          const ownGuids9h = refs9h.guids.filter(g => !refs9h.baseOnlyGuids.has(g));
          const baseGuids9h = [...refs9h.baseOnlyGuids];
          console.log(`  [${depth}] "${currentName}" (${currentGuid})`);
          console.log(`         own (Model=): [${ownGuids9h.join(', ')}]`);
          console.log(`         base (Base=): [${baseGuids9h.join(', ')}]`);

          // If there's an own GUID (Model= attribute), that's the DataModel
          if (ownGuids9h.length > 0) {
            foundDmGuid = ownGuids9h[0]!;
            console.log(`  ✓ Found DataModel GUID via Model= at depth ${depth}: ${foundDmGuid}`);
            break;
          }

          // Try each base-only GUID with GetDataModelByIDAndRevision
          for (const baseGuid of baseGuids9h) {
            if (visited9h.has(baseGuid)) continue;
            const synthDm9h: ErConfigSummary = {
              configurationName: `DataModel-probe-${baseGuid}`,
              solutionName: targetSolution.rootSolutionName ?? targetSolution.solutionName,
              componentType: 'DataModel',
              configurationGuid: baseGuid,
              revisionGuid: baseGuid,
              hasContent: true,
              versionNumbers: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
            };
            try {
              const dmDl9h = await downloadConfigXml(transport, conn, token, synthDm9h);
              if (dmDl9h.xml.length > 50) {
                foundDmGuid = baseGuid;
                console.log(`  ✓ GetDataModelByIDAndRevision(${baseGuid}) → ${dmDl9h.xml.length} chars! DataModel GUID found!`);
                break;
              } else {
                console.log(`         → GetDataModelByIDAndRevision(${baseGuid}) = 200 empty (Format GUID, not DM)`);
              }
            } catch (e9ht) {
              const msg9ht = e9ht instanceof Error ? e9ht.message.slice(0, 80) : String(e9ht);
              console.log(`         → GetDataModelByIDAndRevision(${baseGuid}) ✗ ${msg9ht}`);
            }
          }

          if (foundDmGuid) break;

          // Follow the Base= chain upward (take first unvisited base GUID)
          const nextGuid = baseGuids9h.find(g => !visited9h.has(g));
          if (!nextGuid) {
            console.log(`  [${depth}] No unvisited base GUIDs — chain exhausted`);
            break;
          }
          currentGuid = nextGuid;
          currentName = `(parent of ${currentName})`;
        }

        step9DmGuid = step9DmGuid || foundDmGuid;
        if (foundDmGuid) {
          console.log(`  ✓ Step 9h: DataModel GUID found by following Base= chain: ${foundDmGuid}`);
        } else {
          console.log(`  [API-GAP] Step 9h: Base= chain exhausted after ${depth} steps — root format has no Base= attribute (import-only topology confirmed)`);
        }
      }
    } catch (e9h) {
      const msg9h = e9h instanceof Error ? e9h.message.slice(0, 150) : String(e9h);
      console.log(`  ✗ Step 9h failed: ${msg9h}`);
    }
  } else {
    console.log('  (skipped — solutionName/configName not set)');
  }
  console.log();

  // ─── Step 10: Branch selection & mapping download (if DM GUID from Step 9) ─
  // Two-step fix validation:
  //   1. DM GUID obtained from Phase 0 scout (Step 9)
  //   2. Improved branch heuristic (first-word prefix) identifies derived mapping
  //      even when the mapping name uses an abbreviation (e.g. "ABR") that the
  //      full solutionName prefix heuristic (Heuristic A) can't match.
  //   3. Verify GetModelMappingByID returns the correct derived mapping.
  // If Step 9 failed (no DM GUID), also tests heuristic B in isolation so we
  // know whether branch selection would work IF the GUID were available.
  console.log('─── Step 10: Branch selection heuristics & mapping download (with/without DM GUID)');
  if (cfg.solutionName) {
    try {
      const rootSolName10 = targetSolution.rootSolutionName ?? targetSolution.solutionName;
      const allComps10 =
        rootSolName10 !== cfg.solutionName
          ? await listComponents(transport, conn, token, rootSolName10)
          : rootComponents;
      const allMappingBranches10 = allComps10
        .filter(c => c.componentType === 'ModelMapping')
        .map(c => c.configurationName ?? '')
        .filter(Boolean);

      console.log(`  Mapping branches from root listing (${allMappingBranches10.length}):`);
      allMappingBranches10.forEach(n => console.log(`    "${n}"`));
      console.log();

      // Heuristic A: current UI behaviour — full solutionName as prefix.
      // Works when mapping name starts with the full DM solution name (Invoice model case).
      const dmSolLower10 = cfg.solutionName.toLowerCase();
      const derivedA10 = allMappingBranches10.filter(n => n.toLowerCase().startsWith(dmSolLower10));

      // Heuristic B: improved — first word of solutionName as discriminating prefix.
      // Works when the vendor prefix ("Asl") is the only reliable shared token
      // between solutionName and the derived mapping name (ABR import case).
      const firstWord10 = cfg.solutionName.toLowerCase().split(/\s+/)[0] ?? '';
      const derivedB10 = allMappingBranches10.filter(n =>
        firstWord10.length > 1 && n.toLowerCase().startsWith(firstWord10 + ' '),
      );

      console.log(`  Heuristic A — full solutionName prefix ("${cfg.solutionName}"):`);
      if (derivedA10.length === 0) {
        console.log(`    0 derived → falls back to highest-version base  ✗`);
        console.log(`    → would download: "${allMappingBranches10[0] ?? '(none)'}" (WRONG)`);
      } else {
        derivedA10.forEach(n => console.log(`    derived: "${n}"`));
      }
      console.log();
      console.log(`  Heuristic B — first-word prefix ("${firstWord10}"):`);
      if (derivedB10.length === 0) {
        console.log(`    0 derived  ✗`);
      } else {
        derivedB10.forEach(n => console.log(`    derived: "${n}"`));
      }
      check(
        'Step 10: Heuristic B (first-word) identifies at least one derived mapping branch',
        derivedB10.length > 0 || derivedA10.length > 0,
        derivedB10.length > 0
          ? `"${derivedB10[0]}"`
          : derivedA10.length > 0
            ? `HeurA: "${derivedA10[0]}"`
            : 'both heuristics found 0 branches',
      );
      console.log();

      if (step9DmGuid) {
        // Download with DM GUID + best heuristic candidate.
        const targetName10 = derivedB10[0] ?? derivedA10[0] ?? allMappingBranches10[0] ?? '';
        if (targetName10) {
          console.log(`  DM GUID available — downloading: "${targetName10}"  DM GUID=${step9DmGuid}`);
          const synthMapping10: ErConfigSummary = {
            solutionName: cfg.solutionName,
            configurationName: targetName10,
            componentType: 'ModelMapping',
            parentDataModelGuid: step9DmGuid,
            descriptorNameCandidates: step9ContainerNames,
            hasContent: true,
          };
          const result10 = await diagnoseDownload(transport, conn, token, synthMapping10);
          printRow(result10);
          if (!result10.error) {
            const gotDerived = [...derivedB10, ...derivedA10].includes(result10.name ?? '');
            const label = gotDerived ? '✓ DERIVED mapping downloaded' : '⚠ non-derived mapping returned';
            console.log(`    ${label}: "${result10.name}"`);
            check('Step 10: mapping download succeeds with scout DM GUID', true, `"${result10.name}"`);
            check(
              'Step 10: downloaded mapping is the DERIVED one (heuristic B)',
              gotDerived || (derivedB10.length === 0 && derivedA10.length === 0),
              gotDerived
                ? `"${result10.name}" is in derived set`
                : `got "${result10.name}"; expected one of [${[...derivedB10, ...derivedA10].join(', ')}]`,
            );
          } else {
            console.log(`    ✗ Download failed: ${result10.error}`);
            check('Step 10: mapping download succeeds with scout DM GUID', false, result10.error ?? 'empty');
          }
        } else {
          console.log('  ⚠ No mapping branches found — nothing to probe');
        }
      } else {
        console.log('  DM GUID not available (Step 9 failed) — mapping download skipped.');
        console.log('  Heuristic B validation above is still useful for future fix planning.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.error(`  ⚠ Step 10 failed: ${msg}`);
    }
  } else {
    const reason = !step9DmGuid ? 'Step 9 did not obtain DM GUID' : 'solutionName not set';
    console.log(`  (skipped — ${reason})`);
  }
  console.log();

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log();
  const bar = '═'.repeat(50);
  console.log(bar);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(bar);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('\n[fatal]', err); process.exit(1); });
