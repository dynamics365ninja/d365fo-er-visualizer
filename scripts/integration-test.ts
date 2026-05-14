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

  // ─── 3. Component inventory (listing API versions) ────────────────────────
  console.log('─── Step 3: Inventory — listing API version for all components');
  console.log('  ' + '─'.repeat(100));
  for (const c of components) {
    if (!c.hasContent) continue;
    const vn = c.versionNumbers?.slice(0, 8).join(',') ?? '—';
    console.log(`  ${c.componentType.padEnd(13)} ${c.configurationName.padEnd(44)} v=${(c.version ?? '—').padEnd(5)} versionNumbers=[${vn}]`);
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

  check('All downloads succeeded',       results.every(r => !r.error), `${ok.length}/${results.length}`);
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

        // ── 6b. Mapping (descriptor fallback via parentDataModelGuid) ──────
        // Find mapping from listing with a completed (Status=2) version.
        const allMappings = components.filter(c =>
          c.componentType === 'ModelMapping' && c.version !== undefined,
        );
        console.log();
        console.log(`  6b. Mappings available in listing (${allMappings.length} with completed version, all hasContent=false):`);
        allMappings.slice(0, 8).forEach(m =>
          console.log(`    ${m.configurationName.padEnd(50)} v=${m.version} vn=[${m.versionNumbers?.slice(0, 4).join(',') ?? '—'}]`),
        );
        if (allMappings.length > 8) console.log(`    … and ${allMappings.length - 8} more`);
        console.log();

        const targetMapping = allMappings[0];
        if (!targetMapping) {
          console.warn('  ⚠ No mappings with completed version found');
        } else {
          // Extract data container names from DataModel XML.
          // GetModelMappingByID uses _dataContainerDescriptorName from
          // <ERDataContainerDescriptor IsRoot="1"> elements — NOT the mapping
          // display name. Not every descriptor has a registered mapping;
          // downloadConfigXml silently skips HTTP 200 + empty responses and
          // proceeds to the next candidate, so passing all descriptor names
          // as candidates is sufficient.
          let containerNames: string[] = [];
          if (!dmResult.error) {
            try {
              const dmDl = await downloadConfigXml(transport, conn, token, syntheticDm);
              containerNames = extractDataContainerNames(dmDl.xml);
              const hitCount = containerNames.length;
              console.log(`  DataModel container descriptors: ${hitCount} found`);
              console.log(`  [${containerNames.slice(0, 6).join(', ')}${hitCount > 6 ? `, …+${hitCount - 6} more` : ''}]`);
            } catch (e) {
              console.warn(`  ⚠ DataModel re-download failed: ${e instanceof Error ? e.message : e}`);
            }
          }
          console.log();

          const augmented: ErConfigSummary = {
            ...targetMapping,
            parentDataModelGuid: dmGuid,
            descriptorNameCandidates: containerNames.length > 0 ? containerNames : undefined,
          };
          console.log(`  Attempting: "${augmented.configurationName}" (${containerNames.length} descriptor candidates)`);
          const mappingResult = await diagnoseDownload(transport, conn, token, augmented);
          results.push(mappingResult);
          printRow(mappingResult);

          if (mappingResult.error) {
            console.warn(`  ⚠ Mapping download failed: ${mappingResult.error}`);
          } else {
            check('[Mapping] download succeeded', true);
            check('[Mapping] XML version extractable', mappingResult.xmlVersion !== undefined,
              mappingResult.xmlVersion ?? '(none)');
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.error(`  ⚠ Pipeline step failed: ${msg}`);
    }
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
