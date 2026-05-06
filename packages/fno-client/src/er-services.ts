/* eslint-disable no-console */
import type {
  FnoTransport,
  FnoConnection,
  ErSolutionSummary,
  ErConfigSummary,
  ErConfigDownload,
  ErComponentType,
} from './types';
import { FnoHttpError, FnoSourceUnsupportedError, FnoEmptyContentError } from './types';
import { buildFnoPath } from './path-key';

/** F&O ER client — enumerates and downloads Electronic Reporting configurations
 * via F&O custom services under `/api/services`. */

/** Per-session cache of service operation names. Key: `${envUrl}::${servicePath}`. */
const _serviceOpsCache = new Map<string, string[]>();

/** Stable service-path constants (group + service). */
export const ER_SERVICES = {
  configurationList: 'ERConfigurationServices/ERConfigurationListService',
  configurationStorage: 'ERConfigurationServices/ERConfigurationStorageService',
  metadataProvider: 'ERMetadataProviderServices/ERMetadataProviderService',
  pullSolution: 'ERWebServices/ERPullSolutionFromRepositoryService',
} as const;

/** Candidate operation names for each ER service endpoint.
 * First entry is confirmed; subsequent entries are fallbacks for older F&O builds. */
export const ER_SERVICE_OPS: {
  listSolutions: readonly string[];
  listComponents: readonly string[];
  getConfigurationXml: readonly string[];
} = {
  listSolutions: [
    'getFormatSolutionsSubHierarchy',
    'getSolutions', 'GetSolutions', 'getSolutionList', 'getAllSolutions', 'getERSolutions', 'getList',
  ],
  listComponents: [
    'getFormatSolutionsSubHierarchy',
    'getConfigurations', 'GetConfigurations', 'getSolutionComponents',
    'getComponents', 'getConfigurationList', 'getSolutionConfigurations',
  ],
  getConfigurationXml: [
    'GetEffectiveFormatMappingByID', 'GetModelMappingByID', 'GetDataModelByIDAndRevision',
    'getConfigurationXml', 'GetConfigurationXml', 'getContent',
    'getConfigurationContent', 'getXml', 'downloadConfiguration', 'getRevisionContent',
  ],
};

/** Download ops by component type. Modern op first; legacy name-based fallbacks for environments that don't expose GUIDs. */
export const ER_STORAGE_OPS_BY_TYPE: Record<ErComponentType, readonly string[]> = {
  Format: ['GetEffectiveFormatMappingByID'],
  ModelMapping: [
    'GetModelMappingByID',
    'getRevisionContent', 'getConfigurationXml', 'GetConfigurationXml', 'getContent', 'downloadConfiguration',
  ],
  DataModel: [
    'GetDataModelByIDAndRevision',
    'getRevisionContent', 'getConfigurationXml', 'GetConfigurationXml', 'getContent', 'downloadConfiguration',
  ],
  Unknown: ['GetEffectiveFormatMappingByID', 'GetModelMappingByID', 'GetDataModelByIDAndRevision'],
};

/** Invoke an F&O custom service operation via `POST /api/services/<path>/<op>`. */
export async function callErService<T = unknown>(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  servicePath: string,
  operation: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${normalizeEnvUrl(conn.envUrl)}/api/services/${servicePath}/${operation}`;
  return transport.postJson<T>(url, token, body ?? {}, signal);
}

/** List service names in an F&O service group (used for diagnostics). */
export async function listGroupServices(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  groupName: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${normalizeEnvUrl(conn.envUrl)}/api/services/${groupName}`;
  const buffer = await transport.getBinary(url, token, signal);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  return extractServiceNames(text);
}

/** Parse service names out of the group enumeration payload. */
export function extractServiceNames(payload: string): string[] {
  const trimmed = payload.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      return collectServiceNamesFromJson(json);
    } catch {
      // fall through to XML
    }
  }

  const names: string[] = [];
  const serviceRegex = /<Service\b[^>]*>([\s\S]*?)<\/Service>/gi;
  const nameRegex = /<Name\b[^>]*>([\s\S]*?)<\/Name>/i;
  let match: RegExpExecArray | null;
  while ((match = serviceRegex.exec(payload)) !== null) {
    const inner = match[1];
    const nameMatch = nameRegex.exec(inner);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function collectServiceNamesFromJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const name = obj.Name ?? obj.name ?? obj.ServiceName;
          if (typeof name === 'string') return name;
        }
        return '';
      })
      .filter(s => s.length > 0);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const services = obj.Services ?? obj.services;
    if (services) return collectServiceNamesFromJson(services);
  }
  return [];
}

/** Fetch operation names exposed by `GET /api/services/<servicePath>`. Accepts XML and JSON. */
export async function listServiceOperations(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  servicePath: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const cacheKey = `${normalizeEnvUrl(conn.envUrl)}::${servicePath}`;
  const cached = _serviceOpsCache.get(cacheKey);
  if (cached) return cached;
  const url = `${normalizeEnvUrl(conn.envUrl)}/api/services/${servicePath}`;
  const buffer = await transport.getBinary(url, token, signal);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  const ops = extractOperationNames(text);
  if (ops.length > 0) _serviceOpsCache.set(cacheKey, ops);
  return ops;
}

/** Parse operation names from a service discovery response. Accepts XML and JSON. */
export function extractOperationNames(payload: string): string[] {
  const trimmed = payload.trim();
  if (!trimmed) return [];

  // Try JSON first — it's cheaper to detect ({ or [ prefix) and skipped on XML.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      return collectOperationNamesFromJson(json);
    } catch {
      // fall through to XML parsing
    }
  }

  const names: string[] = [];
  const operationRegex = /<Operation\b[^>]*>([\s\S]*?)<\/Operation>/gi;
  const nameRegex = /<Name\b[^>]*>([\s\S]*?)<\/Name>/i;
  let match: RegExpExecArray | null;
  while ((match = operationRegex.exec(payload)) !== null) {
    const inner = match[1];
    const nameMatch = nameRegex.exec(inner);
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function collectOperationNamesFromJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const name = obj.Name ?? obj.name ?? obj.OperationName;
          if (typeof name === 'string') return name;
        }
        return '';
      })
      .filter(s => s.length > 0);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const ops = obj.Operations ?? obj.operations;
    if (ops) return collectOperationNamesFromJson(ops);
  }
  return [];
}

/**
 * Try candidate operation names in order; return the first successful response.
 * Prefers operations actually exposed by the service (via discovery GET).
 * Throws with actionable hint if no candidate matches.
 */
async function callErServiceWithFallback<T = unknown>(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  servicePath: string,
  candidates: readonly string[],
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ operation: string; raw: T }> {
  // Discover real operation names up front. Failures here are non-fatal —
  // we just fall back to blind candidate-trying.
  let available: string[] = [];
  let discoveryErr: unknown = null;
  try {
    available = await listServiceOperations(transport, conn, token, servicePath, signal);
  } catch (err) {
    discoveryErr = err;
  }

  // Split candidates into "known-exposed" (most likely to work) and
  // "unknown" (used only when discovery didn't return anything).
  const availableSet = new Set(available);
  const known = candidates.filter(c => availableSet.has(c));
  const ordered = available.length > 0 ? known : [...candidates];

  if (ordered.length === 0) {
    // None of our candidates matches a real operation. Produce an
    // actionable error listing what the service actually exposes.
    const url = `${normalizeEnvUrl(conn.envUrl)}/api/services/${servicePath}/${candidates[0] ?? ''}`;
    const hint = available.length > 0
      ? ` Available operations on ${servicePath}: ${available.join(', ')}. None of the candidates [${candidates.join(', ')}] matches; update ER_SERVICE_OPS.`
      : discoveryFailureHint(servicePath, discoveryErr);
    throw new FnoHttpError(
      `No matching operation on ${servicePath}. Tried: (none attempted).${hint}`,
      404,
      url,
    );
  }

  const tried: string[] = [];
  let lastErr: FnoHttpError | null = null;
  // When discovery succeeded, only try candidates present in the
  // exposed-operations set (that's `ordered`). When it didn't, probe the
  // full candidate list blindly.
  const candidatesToTry = available.length > 0 ? ordered : [...candidates];

  for (const op of candidatesToTry) {
    try {
      const raw = await callErService<T>(transport, conn, token, servicePath, op, body, signal);
      return { operation: op, raw };
    } catch (err) {
      if (!(err instanceof FnoHttpError)) throw err;

      // If this op is known to exist on the server, a 4xx is not a
      // wrong-name signal — it's a bad request. Surface the body so the
      // caller can see what's actually wrong.
      if (availableSet.has(op) && err.status >= 400 && err.status < 500) {
        throw new FnoHttpError(
          `Operation ${servicePath}/${op} rejected the request (${err.status}): ${err.message}` +
            (err.body ? ` — response body: ${truncate(err.body, 800)}` : ''),
          err.status,
          err.url,
          err.body,
        );
      }

      if (err.status === 404 || err.status === 400) {
        tried.push(op);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  const url = lastErr?.url ?? `${normalizeEnvUrl(conn.envUrl)}/api/services/${servicePath}/${candidates[0]}`;
  const hint = available.length > 0
    ? ` Available operations on ${servicePath}: ${available.join(', ')}.`
    : discoveryFailureHint(servicePath, discoveryErr);
  throw new FnoHttpError(
    `No matching operation on ${servicePath}. Tried: ${tried.join(', ')}.${hint}`,
    lastErr?.status ?? 404,
    url,
    lastErr?.body,
  );
}

function discoveryFailureHint(servicePath: string, discoveryErr: unknown): string {
  if (discoveryErr instanceof FnoHttpError) {
    return ` Discovery GET /api/services/${servicePath} returned ${discoveryErr.status}: ${discoveryErr.message}.`;
  }
  if (discoveryErr) {
    const msg = discoveryErr instanceof Error ? discoveryErr.message : String(discoveryErr);
    return ` Discovery GET /api/services/${servicePath} failed: ${msg}.`;
  }
  return ` Discovery GET /api/services/${servicePath} returned no <Operation><Name>…</Name></Operation> entries; open it in a browser to inspect the response.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

/**
 * Enumerate ER solutions by probing `getFormatSolutionsSubHierarchy` for every known
 * root DataModel name in parallel. The X++ implementation recurses, so one call
 * returns the entire sub-tree. Extra roots can be injected via `options.extraRoots`.
 */
export async function listSolutions(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  signal?: AbortSignal,
  options?: { extraRoots?: readonly string[] },
): Promise<ErSolutionSummary[]> {
  const seen = new Map<string, ErSolutionSummary>();
  const probesTried: string[] = [];
  const probesWithHits: string[] = [];

  // Helper: process a flat array of solution rows, add DataModel/Unknown
  // nodes to `seen`, skip Format/ModelMapping rows (they are downloaded
  // separately via listComponents).
  // `seedName` is the root DataModel whose probe produced these rows —
  // stored as `rootSolutionName` so the UI can always fetch the full tree.
  const skippedFormats: string[] = [];
  const skippedMappings: string[] = [];
  const processFlatRows = (flat: RawErSolutionRow[], seedName: string) => {
    for (const r of flat) {
      const mapped = mapSolutionRow(r);
      if (mapped.componentType === 'Format') {
        skippedFormats.push(mapped.solutionName ?? '<unnamed>');
        continue;
      }
      if (mapped.componentType === 'ModelMapping') {
        skippedMappings.push(mapped.solutionName ?? '<unnamed>');
        continue;
      }
      if (mapped.solutionName && !seen.has(mapped.solutionName)) {
        if (mapped.solutionName !== seedName) {
          mapped.rootSolutionName = seedName;
        }
        seen.set(mapped.solutionName, mapped);
      }
    }
  };

  const extras = (options?.extraRoots ?? []).map(s => s.trim()).filter(s => s.length > 0);
  const seedModels = [
    'Tax declaration model',
    'Payment model',
    'Invoice model',
    'Audit file model',
    'Bank statement model',
    'General ledger model',
    'Fixed asset model',
    'Purchase order model',
    'Sales order model',
    'Customer model',
    'Vendor model',
    'Intrastat model',
    // Additional root DataModels often present in F&O
    'Electronic messages',
    'EU Sales list',
    'Asset leasing',
    'Regulatory configuration',
    'Standard Audit File (SAF-T)',
    'Customs declaration model',
    'Cost accounting',
    'Fiscal documents',
    'Data exchange',
    'Financial dimensions',
    'Inventory management model',
    'Project model',
    'Budget model',
    'Ledger settlement model',
    'Electronic invoicing model',
    'Financial reporting model',
    'Cash flow forecasting model',
    'Credit management model',
    'Retail model',
    'Warehouse management model',
    'Supply chain model',
    'HR model',
    'Payroll model',
    'Transportation management model',
    'Expense management model',
    'Subscription billing model',
    'Revenue recognition model',
    'Withholding tax model',
    'Document routing model',
    'Advance holder model',
    'Currency revaluation model',
    'Rebate management model',
    'Global inventory accounting model',
    'MT940 Model',
    'Camt model',
    'ACA 1095B report model',
    'ACA 1095C report model',
    'Advanced bank reconciliation statement model',
    'Aging analysis of receivable payment model',
    'Aging and due amount analysis shared model',
    'Assets declarations model',
    'BAS model',
    'BLWI model',
    'Balance report model',
    'Bank Reconciliation Report Model',
    'Bank Statement Model for BAI2',
    'Benefit statement model',
    'Bill of lading model',
    'CODA model',
    'Cash Receipt Model',
    'Cash Register Model',
    'Cash receipts model',
    'Certificate of origin model',
    'Collection letter model',
    'Construction industry scheme model',
    'Course agenda model',
    'Customer invoice context model',
    'Customer invoice context model (FR)',
    'Customer invoicing model',
    'Customer prepayment invoice model',
    'Data export model',
    'Declaration 347 model',
    'Dutch XBRL integration model',
    'EEO-1 report model',
    'EU Sales list model',
    'Electronic Messages framework model',
    'Electronic ledger accounting model MX',
    'Electronic trial balance detail report model',
    'Financial reports model',
    'Fiscal journal model (IT)',
    'Fixed assets model',
    'GAF model (MY)',
    'GBT24589-2010 model',
    'GST Returns govt. model',
    'GST Returns model',
    'GoldenTax model',
    'Hungarian VAT reporting model',
    'INTERVAT model',
    'Import invoice context model',
    'Inventory journal model',
    'Invoice Model LATAM',
    'Invoice list model',
    'Invoice turnover report model',
    'Invoices Communication Model',
    'Italian intent letter telematic model',
    'Italian tax reports model',
    'JBA Payment model',
    'Letter of credit model',
    'Model for binary data pipeline',
    'Modello770 report (IT)',
    'OSHA 300A report model',
    'Order model',
    'Packing list model',
    'Payment check model',
    'Payment check model (TR)',
    'Payment check model LATAM',
    'Payment model (BR)',
    'Performance review model',
    'Positive pay model',
    'Production consumption variance report model',
    'Products turnover model',
    'Quotation model',
    'Reconciliation model',
    'Reminder model',
    'Response message model',
    'SIE export model',
    'SPED model',
    'Sales tax model',
    'Services fiscal document model',
    'Spanish VAT model',
    'Submitted document model',
    'Tax Calculation Data Model',
    'Tax Calculation Data Model (Brazil)',
    'Tax Calculation Data Model for ISV integration',
    'Tax Data Model',
    'Unique Certification model',
    'VAT declaration model',
    'VAT declaration model (RU)',
    'VETS report model',
    'Vendor invoice declaration model',
    'Vendor size category model',
    'Waybill model',
    'e-Ledger Model (TR)',
    ...extras,
  ];
  // Deduplicate (case-sensitive).
  const allProbes = Array.from(new Set(seedModels));

  // Pre-discover the confirmed operation name ONCE so each probe doesn't
  // have to try multiple candidates.
  let confirmedListOp = '';
  try {
    const available = await listServiceOperations(
      transport, conn, token, ER_SERVICES.configurationList, signal,
    );
    confirmedListOp = ER_SERVICE_OPS.listSolutions.find(op => available.includes(op)) ?? '';
    if (!confirmedListOp) {
      console.warn(
        '[fno-client] listSolutions: none of our candidates match available ops',
        { candidates: ER_SERVICE_OPS.listSolutions, available },
      );
    }
  } catch (err) {
    console.warn('[fno-client] listSolutions: pre-discovery failed (non-fatal), will use per-probe fallback', err);
  }

  console.info('[fno-client] listSolutions starting', {
    probeCount: allProbes.length,
    confirmedOp: confirmedListOp || '(will discover per probe)',
  });

  // Track the last probe error so we can report it if every probe fails.
  let lastProbeError: FnoHttpError | null = null;

  // Run all probes IN PARALLEL. The API is fully recursive so each probe
  // returns the entire sub-tree — no BFS needed.
  await Promise.all(
    allProbes.map(async parent => {
      probesTried.push(parent);
      try {
        let operation: string;
        let raw: unknown;
        if (confirmedListOp) {
          raw = await callErService<unknown>(
            transport, conn, token,
            ER_SERVICES.configurationList, confirmedListOp,
            { _parentSolutionName: parent }, signal,
          );
          operation = confirmedListOp;
        } else {
          const result = await callErServiceWithFallback<unknown>(
            transport, conn, token,
            ER_SERVICES.configurationList, ER_SERVICE_OPS.listSolutions,
            { _parentSolutionName: parent }, signal,
          );
          operation = result.operation;
          raw = result.raw;
        }
        const rows = unwrapServiceArray<RawErSolutionRow>(raw, operation);
        if (rows.length > 0) {
          probesWithHits.push(parent);
          processFlatRows(flattenErHierarchy(rows), parent);
          // Add the probed parent itself as a DataModel entry so it
          // appears in the tree as a navigable root.
          if (!seen.has(parent)) {
            seen.set(parent, {
              solutionName: parent,
              publisher: undefined,
              version: undefined,
              displayName: undefined,
              componentType: 'DataModel',
            });
          }
        }
      } catch (err) {
        if (err instanceof FnoHttpError) {
          if (err.status === 401 || err.status === 403) throw err;
          lastProbeError = err;
        } else {
          throw err;
        }
      }
    }),
  );

  // If every probe failed, propagate the last error.
  if (seen.size === 0 && lastProbeError && probesWithHits.length === 0) {
    throw lastProbeError;
  }

  const results = Array.from(seen.values());
  results.sort((a, b) =>
    (a.solutionName ?? '').localeCompare(b.solutionName ?? '', undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  );

  if (results.length === 0) {
    // Nothing found — enumerate available ER services for diagnostics.
    const groups = [
      'ERConfigurationServices',
      'ERMetadataProviderServices',
      'ERWebServices',
    ];
    try {
      const groupOps: Record<string, Record<string, string[]>> = {};
      await Promise.all(
        groups.map(async group => {
          const perServiceOps: Record<string, string[]> = {};
          try {
            const services = await listGroupServices(transport, conn, token, group, signal);
            await Promise.all(
              services.map(async svc => {
                try {
                  perServiceOps[svc] = await listServiceOperations(
                    transport, conn, token, `${group}/${svc}`, signal,
                  );
                } catch {
                  perServiceOps[svc] = [];
                }
              }),
            );
          } catch (err) {
            perServiceOps['<group-enum-failed>'] = [
              err instanceof Error ? err.message : String(err),
            ];
          }
          groupOps[group] = perServiceOps;
        }),
      );
      console.info('[fno-client] listSolutions empty — ER service catalog', {
        probesTried: probesTried.length,
        groupOps,
      });
    } catch (err) {
      console.info('[fno-client] listSolutions empty — catalog enumeration failed', err);
    }
  } else {
    console.info('[fno-client] listSolutions done', {
      total: results.length,
      probeCount: probesTried.length,
      probesWithHits,
      skippedFormats: skippedFormats.length,
      skippedMappings: skippedMappings.length,
    });
  }

  return results;
}

/**
 * Enumerate configuration components inside a single solution.
 * One `getFormatSolutionsSubHierarchy` call returns the complete sub-tree
 * because X++ recurses into DerivedSolutions.
 */
export async function listComponents(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  solutionName: string,
  signal?: AbortSignal,
): Promise<ErConfigSummary[]> {
  // Discover the operation once to avoid a per-call discovery GET.
  let confirmedOp = '';
  try {
    const available = await listServiceOperations(
      transport, conn, token, ER_SERVICES.configurationList, signal,
    );
    confirmedOp = ER_SERVICE_OPS.listComponents.find(op => available.includes(op)) ?? '';
  } catch { /* non-fatal — fall back to per-call discovery */ }

  /** Fetch direct children of `parentName` from the ER service. */
  const fetchChildren = async (parentName: string): Promise<{ rows: RawErComponentRow[]; rawTopLevelKeys: string[] }> => {
    try {
      if (confirmedOp) {
        const raw = await callErService<unknown>(
          transport, conn, token,
          ER_SERVICES.configurationList, confirmedOp,
          { _parentSolutionName: parentName }, signal,
        );
        const rawTopLevelKeys = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.keys(raw as Record<string, unknown>)
          : [];
        return { rows: unwrapServiceArray<RawErComponentRow>(raw, confirmedOp), rawTopLevelKeys };
      }
      const { operation, raw } = await callErServiceWithFallback<unknown>(
        transport, conn, token,
        ER_SERVICES.configurationList, ER_SERVICE_OPS.listComponents,
        { _parentSolutionName: parentName }, signal,
      );
      const rawTopLevelKeys = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.keys(raw as Record<string, unknown>)
        : [];
      return { rows: unwrapServiceArray<RawErComponentRow>(raw, operation), rawTopLevelKeys };
    } catch (err) {
      console.warn('[fno-client] listComponents fetchChildren failed', { parentName, err });
      return { rows: [], rawTopLevelKeys: [] };
    }
  };

  // Initial fetch: root model and whatever DerivedSolutions the server provides.
  const { rows: rootRows, rawTopLevelKeys } = await fetchChildren(solutionName);
  console.info('[fno-client] listComponents root fetch', {
    solutionName, confirmedOp, rowCount: rootRows.length, rawTopLevelKeys,
  });

  // The X++ implementation is fully recursive so the initial response already
  // contains the complete sub-tree — no additional BFS probing needed.
  return flattenComponentsWithParent(rootRows, solutionName);
}

/**
 * Flatten a `getFormatSolutionsSubHierarchy` response tree into a list.
 * Propagates the nearest DataModel's GUID/revision down to Format/ModelMapping nodes
 * so downstream code can call `GetModelMappingByID` / `GetDataModelByIDAndRevision`.
 */
function flattenComponentsWithParent(
  rows: RawErComponentRow[],
  solutionName: string,
  nearestDmGuid?: string,
  nearestDmRev?: string,
  parentConfigName?: string,
  derivationDepth = 0,
  nearestDmName?: string,
): ErConfigSummary[] {
  const out: ErConfigSummary[] = [];
  for (const r of rows) {
    const c = mapComponentRow(r, solutionName);
    // Advance the DataModel pointer when this node is itself a DataModel.
    const nextDmGuid =
      c.componentType === 'DataModel' && c.configurationGuid
        ? c.configurationGuid
        : nearestDmGuid;
    const nextDmRev =
      c.componentType === 'DataModel' && c.revisionGuid
        ? c.revisionGuid
        : nearestDmRev;
    // Advance the DataModel name pointer.
    const nextDmName =
      c.componentType === 'DataModel' ? c.configurationName : nearestDmName;
    // For every node: ownerDataModelName is the nearest DM ancestor.
    // Depth-0 nodes that are not DataModels belong to the query root
    // (solutionName). DataModel nodes at depth 0 also belong to root.
    const ownerDmName = nearestDmName ?? solutionName;
    // Stamp the nearest DataModel, ERSolutionTable parent, and
    // derivation depth onto every node.
    const dmGuidForNode = (c.referencedModelGuid ?? nextDmGuid) || undefined;
    const dmRevForNode = c.referencedModelGuid ? undefined : nextDmRev;
    const base = {
      ...c,
      parentConfigName: parentConfigName ?? solutionName,
      derivationDepth,
      ownerDataModelName: ownerDmName,
    };
    const annotated: ErConfigSummary =
      c.componentType !== 'DataModel' && dmGuidForNode && !c.parentDataModelGuid
        ? { ...base, parentDataModelGuid: dmGuidForNode, parentDataModelRevisionGuid: dmRevForNode }
        : base;
    out.push(annotated);
    // Recurse into derived solutions — pass this node's name as the
    // ERSolutionTable parent so children know their derivation origin.
    // Derivation depth increments for each DerivedSolutions level.
    if (Array.isArray(r.DerivedSolutions) && r.DerivedSolutions.length > 0) {
      out.push(
        ...flattenComponentsWithParent(
          r.DerivedSolutions as RawErComponentRow[],
          solutionName,
          nextDmGuid,
          nextDmRev,
          c.configurationName,
          derivationDepth + 1,
          nextDmName,
        ),
      );
    }
  }
  return out;
}

/**
 * Build ordered download attempts for a component.
 * ERConfigurationStorageService exposes three typed ops (confirmed against AOT source):
 *   - `GetEffectiveFormatMappingByID(guid _formatMappingGuid)`
 *   - `GetModelMappingByID(Guid _mappingGuid, guid _dataModelGuid, Name _dataContainerDescriptorName)`
 *   - `GetDataModelByIDAndRevision(guid _dataModelGuid, ERRevisionNumber _revisionNumber)`
 * All parameters must be present in every request body (missing key → HTTP 400).
 */
export function buildDownloadAttempts(
  component: ErConfigSummary,
): { operation: string; body: Record<string, unknown> }[] {
  const cfgId = component.configurationGuid ?? '';
  const revId = component.revisionGuid ?? '';
  const ops = ER_STORAGE_OPS_BY_TYPE[component.componentType] ?? ER_STORAGE_OPS_BY_TYPE.Unknown;
  const attempts: { operation: string; body: Record<string, unknown> }[] = [];

  for (const op of ops) {
    if (op === 'GetEffectiveFormatMappingByID') {
      for (const id of [cfgId, revId].filter(Boolean)) {
        attempts.push({ operation: op, body: { _formatMappingGuid: id } });
      }
    } else if (op === 'GetModelMappingByID') {
      // Direct GUID path: F&O calls ERModelMappingTable::findByGUID and ignores the other two params.
      // All three keys must always be present (missing key → HTTP 400).
      for (const mid of [cfgId, revId].filter(Boolean)) {
        attempts.push({
          operation: op,
          body: { _mappingGuid: mid, _dataModelGuid: ZERO_GUID, _dataContainerDescriptorName: '' },
        });
      }
      // Fallback: resolve via (parentDataModelGuid, descriptorName).
      // Descriptor candidates: caller-supplied names from parsed DataModel XML first;
      // then configurationName and solutionName as heuristics; finally '' which
      // returns the default (base) mapping for the DataModel.
      const dmGuid = component.parentDataModelGuid ?? '';
      const dmRev = component.parentDataModelRevisionGuid ?? '';
      const descriptorCandidates = Array.from(
        new Set(
          [
            ...(component.descriptorNameCandidates ?? []),
            component.configurationName,
            component.solutionName,
            '',
          ].map(s => (s ?? '').trim()),
        ),
      );
      for (const dm of [dmGuid, dmRev].filter(Boolean)) {
        for (const descName of descriptorCandidates) {
          attempts.push({
            operation: op,
            body: { _mappingGuid: ZERO_GUID, _dataModelGuid: dm, _dataContainerDescriptorName: descName },
          });
        }
      }
    } else if (op === 'GetDataModelByIDAndRevision') {
      // Signature: (_dataModelGuid, _revisionNumber: int). Try every known revision
      // (highest→lowest) because the XML may be on an earlier revision than the latest.
      // NOTE: _dataModelGuid must be the ERDataModelTable GUID (from inside the XML),
      // NOT the ERSolutionTable GUID (from the listing Base field). When the only GUID
      // available is the ERSolution GUID (import-format scenario), F&O may still resolve
      // it if it stores the GUID as an alias — we try it anyway. The legacy name-based
      // ops below serve as a fallback when the GUID path fails.
      const dmGuids = [cfgId, revId].filter(Boolean);
      const revCandidates: (string | number)[] = [];
      if (component.versionNumbers && component.versionNumbers.length > 0) {
        for (const n of component.versionNumbers) revCandidates.push(n);
      }
      const displayRev = component.version;
      if (displayRev && !revCandidates.some(r => String(r) === String(displayRev))) {
        revCandidates.push(displayRev);
      }
      if (!revCandidates.includes(0) && !revCandidates.includes('0')) {
        revCandidates.push(0);
      }
      for (const dm of dmGuids) {
        for (const rev of revCandidates) {
          attempts.push({ operation: op, body: { _dataModelGuid: dm, _revisionNumber: rev } });
        }
      }
    } else {
      attempts.push({
        operation: op,
        body: {
          ConfigurationRevisionGuid: revId,
          ConfigurationGuid: cfgId,
          SolutionName: component.solutionName,
          ConfigurationName: component.configurationName,
        },
      });
    }
  }

  return attempts;
}

/** Download the XML content for a single configuration component. */
export async function downloadConfigXml(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  component: ErConfigSummary,
  signal?: AbortSignal,
): Promise<ErConfigDownload> {
  if (!component.revisionGuid && !component.configurationGuid) {
    // ModelMapping: can still download via descriptor path if parent DataModel GUID is known.
    const canDownloadMapping =
      component.componentType === 'ModelMapping' &&
      Boolean(component.parentDataModelGuid || component.parentDataModelRevisionGuid);
    // DataModel/ModelMapping without any GUID: try legacy name-based ops as a last resort.
    const canDownloadByName =
      (component.componentType === 'DataModel' || component.componentType === 'ModelMapping') &&
      Boolean(component.solutionName && component.configurationName);
    if (!canDownloadMapping && !canDownloadByName) {
      throw new FnoSourceUnsupportedError(
        `Component "${component.configurationName}" has no GUID (revisionGuid/configurationGuid). ` +
          `This usually means it's a branch node in the ER tree rather than a downloadable ` +
          `configuration revision — drill into it (click the row) to see its children. ` +
          `If you're sure it is a leaf, open DevTools → Console → filter "[fno-client] listComponents" ` +
          `and send the raw row keys so the mapper can be extended.`,
      );
    }
  }

  const attempts = buildDownloadAttempts(component);
  if (attempts.length === 0) {
    throw new FnoSourceUnsupportedError(
      `Could not build a download request for "${component.configurationName}" ` +
        `(componentType=${component.componentType}).`,
    );
  }

  // Discover exposed ops once — skip attempts whose op isn't exposed.
  let available: Set<string> | null = null;
  try {
    const list = await listServiceOperations(
      transport,
      conn,
      token,
      ER_SERVICES.configurationStorage,
      signal,
    );
    if (list.length > 0) available = new Set(list);
  } catch {
    // Non-fatal — fall back to blind attempts.
  }

  const tried: { operation: string; body: Record<string, unknown>; status?: number; body2?: string }[] = [];
  let raw: unknown = null;
  let operation = '';
  let success = false;
  let extractedXml: string | null = null;
  let lastErr: FnoHttpError | null = null;
  let successBody: Record<string, unknown> | null = null;

  for (const att of attempts) {
    if (available && !available.has(att.operation)) continue;
    try {
      const attRaw = await callErService<unknown>(
        transport,
        conn,
        token,
        ER_SERVICES.configurationStorage,
        att.operation,
        att.body,
        signal,
      );
      // F&O sometimes returns 200 OK with an empty body (or a wrapper
      // containing an empty string) when the parameter combo is
      // accepted syntactically but doesn't resolve to a configuration.
      // Treat "accepted but empty" exactly like 400/404 so we keep
      // trying alternate parameter shapes (e.g. different revision
      // number) instead of bailing out of the loop on the first such
      // response.
      const candidateXml = extractXmlFromServiceResult(attRaw, att.operation);
      if (!candidateXml) {
        tried.push({
          operation: att.operation,
          body: att.body,
          status: 200,
          body2: '<empty body>',
        });
        continue;
      }
      raw = attRaw;
      operation = att.operation;
      extractedXml = candidateXml;
      successBody = att.body;
      success = true;
      break;
    } catch (err) {
      if (err instanceof FnoHttpError) {
        // 400/404 → wrong op name or wrong parameter name; try next.
        // Other statuses (401/403/5xx) propagate so auth / server errors
        // aren't swallowed.
        if (err.status === 400 || err.status === 404) {
          lastErr = err;
          tried.push({
            operation: att.operation,
            body: att.body,
            status: err.status,
            body2: err.body ? truncate(err.body, 200) : undefined,
          });
          continue;
        }
      }
      throw err;
    }
  }

  if (!success) {
    const summary = tried
      .map(t => `${t.operation}(${Object.keys(t.body).join(',')}) → ${t.status ?? '?'}${t.body2 ? ': ' + t.body2 : ''}`)
      .join(' | ');
    // If every attempt was HTTP 200 with an empty body, the component
    // simply has no own XML (typical for derived DataModels). Surface
    // as a distinct error so UI code can skip silently instead of
    // showing a red toast.
    const allEmpty = tried.length > 0 && tried.every(t => t.status === 200);
    if (allEmpty) {
      throw new FnoEmptyContentError(
        `"${component.configurationName}" (${component.componentType}) has no own XML content — ` +
          `F&O returned HTTP 200 with an empty body for all ${tried.length} probe(s). ` +
          `This is expected for pure-inheritance derived configurations; the base model carries the definition.`,
      );
    }
    // For components that had no GUID and were probed via legacy name-based
    // ops, a total failure (all 400/404) simply means none of the legacy ops
    // exist on this F&O build. Treat as "no content" rather than a hard error
    // so the UI silently skips instead of surfacing a red toast.
    const hadNoGuid = !component.configurationGuid && !component.revisionGuid;
    if (hadNoGuid) {
      console.info('[fno-client] downloadConfigXml: no-GUID component — all legacy name-based ops failed (expected on modern F&O)', {
        configurationName: component.configurationName,
        componentType: component.componentType,
        solutionName: component.solutionName,
        triedCount: tried.length,
      });
      throw new FnoEmptyContentError(
        `"${component.configurationName}" (${component.componentType}) has no GUID and all ` +
          `name-based legacy ops failed (${tried.length} attempt(s)). ` +
          `This is expected when the F&O listing API does not expose GUIDs for this component type.`,
      );
    }
    throw new FnoSourceUnsupportedError(
      `Could not download XML for "${component.configurationName}" (componentType=${component.componentType}). ` +
        `Tried ${tried.length} attempt(s): ${summary || '(none executed)'}. ` +
        (lastErr ? `Last error: ${lastErr.message}.` : '') +
        ` Open DevTools → Network → filter "${ER_SERVICES.configurationStorage}" to inspect responses.`,
    );
  }

  const xml = extractedXml;
  if (!xml) {
    // Log the raw shape so the caller can see what fields the service
    // actually returned (field names differ between F&O versions).
    try {
      const unwrapped = unwrapServiceValue(raw, operation);
      const keys = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
        ? Object.keys(unwrapped as Record<string, unknown>)
        : Array.isArray(unwrapped) ? ['<array>', String(unwrapped.length)] : [typeof unwrapped];
      console.warn('[fno-client] downloadConfigXml: no XML in response', {
        operation,
        configurationName: component.configurationName,
        topLevelKeys: raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>) : [],
        unwrappedKeys: keys,
        raw,
      });
    } catch {
      // ignore logging failures
    }
    throw new FnoSourceUnsupportedError(
      `Custom service ${operation} returned a response without XML for "${component.configurationName}". ` +
        `Open DevTools → Console → filter "[fno-client] downloadConfigXml" to see the response shape ` +
        `so the XML field name can be added to the extractor.`,
    );
  }

  const finalVersion = component.version
    ?? (successBody?._revisionNumber != null ? String(successBody._revisionNumber) : undefined);
  const finalXml = injectNameHint(xml, component.configurationName, finalVersion);
  const {
    guids: referencedDataModelGuids,
    revisions: referencedDataModelRevisions,
  } = extractReferencedDataModelGuids(finalXml);

  return {
    xml: finalXml,
    syntheticPath: buildFnoPath({
      envUrl: conn.envUrl,
      solutionName: component.solutionName,
      configurationName: component.configurationName,
      version: finalVersion,
      componentType: component.componentType,
    }),
    source: component,
    referencedDataModelGuids: referencedDataModelGuids.length > 0 ? referencedDataModelGuids : undefined,
    referencedDataModelRevisions: Object.keys(referencedDataModelRevisions).length > 0
      ? referencedDataModelRevisions
      : undefined,
  };
}

/**
 * Scan an ER XML string for DataModel GUID references (`Model=`, `Base=`, etc.).
 * Returns unique non-zero GUIDs and the highest revision number seen per GUID.
 */
function extractReferencedDataModelGuids(xml: string): {
  guids: string[];
  revisions: Record<string, number>;
} {
  const guids = new Set<string>();
  const revisions: Record<string, number> = {};
  const guidBody = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

  // Bare-GUID attributes whose name contains "model" (but not "mapping").
  const attrGuidRe = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*"\\{?(${guidBody})\\}?"`,
    'gi',
  );
  // Paired “…Version="{guid},N"” — GUID + revision number.
  const attrVersionRe = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*Version)\\s*=\\s*"\\{?(${guidBody})\\}?,(\\d+)"`,
    'gi',
  );
  // ModelGuid / DataModelGuid immediately followed by RevisionNumber="N" in the same tag.
  const pairedRevisionRe = new RegExp(
    `(ModelGuid|DataModelGuid|DataModelID|ModelID)\\s*=\\s*"\\{?(${guidBody})\\}?"[^<>]{0,300}?RevisionNumber\\s*=\\s*"(\\d+)"`,
    'gi',
  );
  for (const m of xml.matchAll(attrGuidRe)) {
    const attr = m[1];
    const guid = m[2].toLowerCase();
    if (guid === ZERO_GUID) continue;
    const lowerAttr = attr.toLowerCase();
    if (!lowerAttr.includes('model')) continue;
    if (lowerAttr.includes('mapping')) continue;
    guids.add(guid);
  }
  for (const m of xml.matchAll(attrVersionRe)) {
    const attr = m[1];
    const guid = m[2].toLowerCase();
    if (guid === ZERO_GUID) continue;
    const lowerAttr = attr.toLowerCase();
    if (!lowerAttr.includes('model')) continue;
    if (lowerAttr.includes('mapping')) continue;
    guids.add(guid);
    const rev = parseInt(m[3], 10);
    if (Number.isFinite(rev)) {
      revisions[guid] = Math.max(revisions[guid] ?? 0, rev);
    }
  }
  for (const m of xml.matchAll(pairedRevisionRe)) {
    const guid = m[2].toLowerCase();
    const rev = parseInt(m[3], 10);
    if (guid === ZERO_GUID) continue;
    guids.add(guid);
    if (Number.isFinite(rev)) {
      revisions[guid] = Math.max(revisions[guid] ?? 0, rev);
    }
  }

  // <BaseSolution Id="{guid}" /> — direct parent ERSolution in the hierarchy.
  // For a Format child of a DataModel this IS the DataModel GUID.
  const baseSolutionIdRe = new RegExp(
    `<BaseSolution[^>]*?\\bId\\s*=\\s*"\\{?(${guidBody})\\}?"`,
    'gi',
  );
  for (const m of xml.matchAll(baseSolutionIdRe)) {
    const guid = m[1].toLowerCase();
    if (guid !== ZERO_GUID) guids.add(guid);
  }

  // ERSolution.Base="{guid},N" — parent DataModel's ERSolution GUID + version.
  // Import formats often carry ONLY this attribute and no ERModelMappingVersion section.
  const baseGuidVersionRe = new RegExp(
    `\\bBase\\s*=\\s*"\\{?(${guidBody})\\}?,(\\d+)"`,
    'gi',
  );
  for (const m of xml.matchAll(baseGuidVersionRe)) {
    const guid = m[1].toLowerCase();
    const rev = parseInt(m[2], 10);
    if (guid !== ZERO_GUID) {
      guids.add(guid);
      if (Number.isFinite(rev)) {
        revisions[guid] = Math.max(revisions[guid] ?? 0, rev);
      }
    }
  }
  // ERSolution.Base="{guid}" without version number — same field but older/alternate format.
  const baseGuidOnlyRe = new RegExp(
    `\\bBase\\s*=\\s*"(\\{${guidBody}\\})"`,
    'gi',
  );
  for (const m of xml.matchAll(baseGuidOnlyRe)) {
    const guid = m[1].replace(/^\{|\}$/g, '').toLowerCase();
    if (guid && guid !== ZERO_GUID && !guids.has(guid)) guids.add(guid);
  }

  return { guids: Array.from(guids), revisions };
}

// ─── Service-response parsing helpers ───

/** Normalizes `{ "<opName>Result": value }` / `{ "value": [...] }` service wrappers to a flat array. */
function unwrapServiceArray<T>(raw: unknown, operationName: string): T[] {
  const unwrapped = unwrapServiceValue(raw, operationName);
  if (Array.isArray(unwrapped)) return unwrapped as T[];
  if (unwrapped && typeof unwrapped === 'object') {
    const obj = unwrapped as Record<string, unknown>;
    if (Array.isArray(obj.value)) return obj.value as T[];
    if (Array.isArray(obj.results)) return obj.results as T[];
    // Sometimes the service returns a JSON-encoded string of an array.
    // Fall through.
  }
  if (typeof unwrapped === 'string') {
    try {
      const parsed = JSON.parse(unwrapped);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // not JSON — return empty
    }
  }
  return [];
}

function unwrapServiceValue(raw: unknown, operationName: string): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const resultKey = `${operationName}Result`;
    if (resultKey in obj) return obj[resultKey];
    if ('result' in obj) return obj.result;
  }
  return raw;
}

function extractXmlFromServiceResult(raw: unknown, operationName: string): string | null {
  const unwrapped = unwrapServiceValue(raw, operationName);
  const fragments = collectXml(unwrapped);
  if (fragments.length === 0) return null;
  if (fragments.length === 1) return fragments[0];
  // F&O sometimes splits payload across multiple string fields (e.g. the
  // format grammar in one field and the format mapping/bindings in
  // another). Concatenate all fragments into a single bundle so the
  // downstream parser can merge them — `wrapBareContent` in
  // `@er-visualizer/core` accepts multiple bare-root elements under one
  // synthetic envelope.
  const stripPrologAndBom = (s: string): string =>
    s.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^?]*\?>\s*/i, '');
  return `<ErFnoBundle>${fragments.map(stripPrologAndBom).join('')}</ErFnoBundle>`;
}

/**
 * Annotate an `<ErFnoBundle>` (or bare payload) with `Name=` so the parser
 * has a reliable display name fallback. Returns the XML unchanged if the
 * payload already has a proper `ERSolutionVersion` envelope.
 */
function injectNameHint(xml: string, name: string, version?: string): string {
  if (!name) return xml;
  const trimmed = xml.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^?]*\?>\s*/i, '');
  // Only rewrap F&O custom-service payloads. If the doc already has
  // the proper envelope, leave it alone.
  if (/^<\s*ERSolutionVersion[\s>]/i.test(trimmed)) return xml;
  const escaped = name
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const versionAttr = version
    ? ` Version="${version.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
    : '';
  if (/^<\s*ErFnoBundle[\s>]/i.test(trimmed)) {
    // Splice the attribute into the opening tag.
    return trimmed.replace(/^<\s*ErFnoBundle(\s|>)/i, `<ErFnoBundle Name="${escaped}"${versionAttr}$1`);
  }
  return `<ErFnoBundle Name="${escaped}"${versionAttr}>${trimmed}</ErFnoBundle>`;
}

/** Walk `value` recursively, collecting every string that is (or decodes to) XML. Deduplicates. */
function collectXml(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (v == null) return;
    if (typeof v === 'string') {
      const normalized = normalizeXmlString(v);
      if (normalized.trimStart().startsWith('<') && !seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      for (const entry of Object.values(v as Record<string, unknown>)) {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
  return out;
}

function normalizeXmlString(s: string): string {
  const stripped = s.replace(/^\uFEFF/, '');
  if (stripped.trimStart().startsWith('<')) return stripped;
  // Looks like base64 — try to decode.
  try {
    return decodeBase64Utf8(stripped);
  } catch {
    return stripped;
  }
}

function normalizeEnvUrl(envUrl: string): string {
  return envUrl.replace(/\/+$/, '');
}

/** Escape a single-quoted string literal for service parameters (double the quote). */
export function escapeServiceString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Decode UTF-8 (strip BOM) from an ArrayBuffer. Also unwraps `{ value: "<base64>" }`. */
export function decodeXmlPayload(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let offset = 0;
  // Strip UTF-8 BOM
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    offset = 3;
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(view.subarray(offset));
  if (text.startsWith('{') && text.includes('"value"')) {
    try {
      const parsed = JSON.parse(text) as { value?: string };
      if (typeof parsed.value === 'string' && parsed.value.length > 0) {
        return decodeBase64Utf8(parsed.value);
      }
    } catch {
      // fall through
    }
  }
  return text;
}

function decodeBase64Utf8(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf-8').replace(/^\uFEFF/, '');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

// ─── Row mapping ───

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * Classify an ER tree node by name and FormatMappingGUID.
 * Non-zero FormatMappingGUID → Format; name containing "mapping" → ModelMapping;
 * name containing "model" → DataModel.
 */
export function classifyErNode(name: string, formatMappingGuid: unknown): ErComponentType {
  const guid = typeof formatMappingGuid === 'string' ? formatMappingGuid.trim() : '';
  const hasRealGuid = guid.length > 0 && guid.toLowerCase() !== ZERO_GUID;
  if (hasRealGuid) return 'Format';
  const lower = (name ?? '').toLowerCase();
  if (/\bmapping\b/.test(lower)) return 'ModelMapping';
  if (/\bmodel\b/.test(lower)) return 'DataModel';
  return 'Unknown';
}

/** Recursively flatten a `DerivedSolutions` tree into a flat array. */
export function flattenErHierarchy<T extends { DerivedSolutions?: unknown }>(rows: readonly T[]): T[] {
  const out: T[] = [];
  const walk = (node: T) => {
    out.push(node);
    const kids = (node as { DerivedSolutions?: unknown }).DerivedSolutions;
    if (Array.isArray(kids)) {
      for (const k of kids) walk(k as T);
    }
  };
  for (const r of rows) walk(r);
  return out;
}

interface RawErVersion {
  // D365FO ER version status (ERSolutionVersionStatus enum):
  //   1 = Draft, 2 = Completed, 3 = Shared
  // Multiple field name variants observed across F&O versions.
  Status?: number;
  VersionStatus?: number;
  State?: number;
  VersionNumber?: number;
  Number?: number;
}

interface RawErSolutionRow {
  // Primary field names confirmed on ac365lab-factory (2026-04).
  Name?: string;
  Description?: string;
  FormatMappingGUID?: string;
  Versions?: RawErVersion[];
  DerivedSolutions?: RawErSolutionRow[];
  // Legacy / alternate casings kept for forward compat.
  SolutionName?: string;
  Publisher?: string;
  SolutionVersion?: string;
  Version?: string;
  SolutionDisplayName?: string;
  DisplayName?: string;
  ComponentType?: unknown;
  Type?: unknown;
  /**
   * Parent solution name in the ER hierarchy.
   * ROOT configurations have Base = "" (empty string) or undefined.
   * DERIVED configurations have Base = "<parent name>".
   * This field is confirmed in F&O responses (2026-04).
   */
  Base?: string;
  [extra: string]: unknown;
}

/** Pick the highest `VersionNumber` from the versions array. */
function pickDisplayVersion(versions?: RawErVersion[]): string | undefined {
  if (!Array.isArray(versions) || versions.length === 0) return undefined;
  let max = -Infinity;
  for (const v of versions) {
    const n = v?.VersionNumber ?? v?.Number;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    if (n > max) max = n;
  }
  if (!Number.isFinite(max)) return undefined;
  // D365FO listing API always surfaces the currently open Draft as the
  // highest version number. The D365FO invariant is Draft = last Completed + 1,
  // so last Completed = max - 1. Display that value.
  // When max === 1 the configuration has never been completed — omit the version.
  return max > 1 ? String(max - 1) : undefined;
}

/** Extract a component-type hint from a row under any plausible key. */
function readComponentTypeHint(r: Record<string, unknown>): unknown {
  const direct = r.ComponentType ?? r.Type ?? r.ERSolutionComponentType ?? r.ErSolutionComponentType ?? r.Component ?? r.SolutionComponent;
  if (direct !== undefined && direct !== null) return direct;
  // Last resort: any key whose name ends in "Type" or contains
  // "ComponentType".
  for (const [key, value] of Object.entries(r)) {
    const lk = key.toLowerCase();
    if (lk === 'type' || lk.endsWith('componenttype') || lk.endsWith('_type')) {
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function mapSolutionRow(r: RawErSolutionRow): ErSolutionSummary {
  const name = r.Name ?? r.SolutionName ?? '';
  const description = r.Description;
  const typeHint = readComponentTypeHint(r as Record<string, unknown>);
  const typeFromHint = mapComponentType(typeHint);
  let componentType: ErComponentType = typeFromHint !== 'Unknown'
    ? typeFromHint
    : classifyErNode(name, r.FormatMappingGUID);
  // Nodes with children are DataModels (Formats/ModelMappings are always leaves).
  if (
    componentType === 'Unknown' &&
    Array.isArray(r.DerivedSolutions) &&
    r.DerivedSolutions.length > 0
  ) {
    componentType = 'DataModel';
  }
  // Root configs (Base === '') with no other classification can only be DataModels.
  const baseField = typeof r.Base === 'string' ? r.Base : undefined;
  if (componentType === 'Unknown' && baseField === '') {
    componentType = 'DataModel';
  }

  return {
    solutionName: name,
    publisher: r.Publisher,
    version: pickDisplayVersion(r.Versions),
    displayName: description && description !== name ? description : r.SolutionDisplayName ?? r.DisplayName,
    componentType,
  };
}

interface RawErComponentRow {
  SolutionName?: string;
  ConfigurationName?: string;
  Name?: string;
  Description?: string;
  ComponentType?: string;
  Type?: string;
  ConfigurationVersion?: string;
  Version?: string;
  Versions?: RawErVersion[];
  DerivedSolutions?: RawErComponentRow[];
  FormatMappingGUID?: string;
  /** ERModelMappingTable.Guid — returned by getFormatSolutionsSubHierarchy for ModelMapping rows. */
  ModelMappingGuid?: string;
  ConfigurationRevisionGuid?: string;
  RevisionGuid?: string;
  ConfigurationGuid?: string;
  Guid?: string;
  Id?: string;
  ID?: string;
  ConfigurationID?: string;
  ConfigurationId?: string;
  RevisionID?: string;
  RevisionId?: string;
  FormatID?: string;
  FormatId?: string;
  ModelID?: string;
  ModelId?: string;
  /** ERSolution ID of the DataModel this config references (observed on Format rows). */
  Base?: string;
  base?: string;
  CountryRegion?: string;
  CountryRegionCodes?: string;
  [extra: string]: unknown;
}

const GUID_LIKE_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** Look for a GUID-shaped value on `r` under any key whose name contains `hint`. */
function findGuidByKeyHint(r: Record<string, unknown>, hint: string): string | undefined {
  const needle = hint.toLowerCase();
  for (const [key, value] of Object.entries(r)) {
    if (!key.toLowerCase().includes(needle)) continue;
    if (typeof value !== 'string') continue;
    if (!GUID_LIKE_RE.test(value)) continue;
    // F&O returns ZERO_GUID ("00000000-…") as a placeholder for
    // "no mapping/id assigned" on DataModel / ModelMapping rows.
    // Treat it as absent rather than as a valid identifier — using
    // it as a download parameter results in HTTP 200 with an empty
    // body for every revision, which cascades into misleading
    // "all revisions empty" diagnostics.
    if (value.toLowerCase() === ZERO_GUID) continue;
    return value;
  }
  return undefined;
}

/** Last-resort fallback: return the first non-zero GUID-shaped string value on `r`. */
function findAnyGuid(r: Record<string, unknown>): string | undefined {
  for (const value of Object.values(r)) {
    if (typeof value !== 'string') continue;
    if (!GUID_LIKE_RE.test(value)) continue;
    if (value.toLowerCase() === ZERO_GUID) continue;
    return value;
  }
  return undefined;
}

/** Search Versions array entries for any GUID-shaped string (for rows that don't carry a top-level GUID field). */
function findGuidInVersions(r: RawErComponentRow): string | undefined {
  if (!Array.isArray(r.Versions)) return undefined;
  for (const v of r.Versions) {
    if (typeof v !== 'object' || v === null) continue;
    for (const value of Object.values(v as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const clean = value.replace(/^\{|\}$/g, '').replace(/,\d+$/, '');
      if (!GUID_LIKE_RE.test(clean)) continue;
      if (clean.toLowerCase() === ZERO_GUID) continue;
      return clean;
    }
  }
  return undefined;
}

function mapComponentRow(r: RawErComponentRow, solutionName: string): ErConfigSummary {
  const rec = r as Record<string, unknown>;
  const name = r.ConfigurationName ?? r.Name ?? '';
  const typeHint = readComponentTypeHint(rec);
  const typeFromHint = mapComponentType(typeHint);
  const componentType = typeFromHint !== 'Unknown'
    ? typeFromHint
    : classifyErNode(name, r.FormatMappingGUID);

  const formatMappingGuid = typeof r.FormatMappingGUID === 'string' && r.FormatMappingGUID !== ZERO_GUID
    ? r.FormatMappingGUID
    : undefined;

  // Base / ModelID carries the ERSolution GUID of the DataModel this config references.
  // The Base field may carry a revision suffix: "{GUID},N" — extract just the GUID part.
  const rawModelRef = r.Base ?? r.base ?? r.ModelID ?? r.ModelId;
  const rawModelRefGuid = typeof rawModelRef === 'string'
    ? (rawModelRef.match(/^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?/i)?.[1] ?? rawModelRef)
    : rawModelRef;
  const referencedModelGuid =
    typeof rawModelRefGuid === 'string' && GUID_LIKE_RE.test(rawModelRefGuid) && rawModelRefGuid.toLowerCase() !== ZERO_GUID
      ? rawModelRefGuid
      : undefined;

  const revisionGuid =
    r.ConfigurationRevisionGuid ??
    r.RevisionGuid ??
    r.RevisionID ??
    r.RevisionId ??
    findGuidByKeyHint(rec, 'revision');
  // ModelMappingGuid = ERModelMappingTable.Guid from the listing API (explicit field for ModelMapping rows).
  // Check it BEFORE the generic findGuidByKeyHint to avoid ModelID (DataModel ERSolution GUID) winning.
  const modelMappingGuid = typeof r.ModelMappingGuid === 'string' && r.ModelMappingGuid !== ZERO_GUID
    ? r.ModelMappingGuid
    : undefined;

  const configurationGuid =
    formatMappingGuid ??
    modelMappingGuid ??
    r.ConfigurationGuid ??
    r.Guid ??
    r.ConfigurationID ??
    r.ConfigurationId ??
    r.FormatID ??
    r.FormatId ??
    r.Id ??
    r.ID ??
    findGuidByKeyHint(rec, 'format') ??
    findGuidByKeyHint(rec, 'mappingguid') ??
    findGuidByKeyHint(rec, 'config') ??
    findAnyGuid(rec) ??
    findGuidInVersions(r);

  const hasChildren = Array.isArray(r.DerivedSolutions) && r.DerivedSolutions.length > 0;

  // Keep all version numbers for download probing — GetDataModelByIDAndRevision
  // needs a specific integer and the content may live on any revision.
  const versionNumbers = Array.isArray(r.Versions)
    ? r.Versions
        .map(v => (typeof v?.VersionNumber === 'number' ? v.VersionNumber : undefined))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .sort((a, b) => b - a)
    : undefined;

  if (!configurationGuid && !revisionGuid && (componentType === 'DataModel' || componentType === 'ModelMapping')) {
    // Log all primitive fields so we can spot any GUID the interface doesn't capture yet.
    const simpleFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      simpleFields[k] = v;
    }
    console.warn('[fno-client] component row has no GUID', { componentType, name, simpleFields });
  }

  return {
    solutionName: r.SolutionName ?? solutionName,
    configurationName: name,
    componentType,
    // pickDisplayVersion prefers highest Completed (Status=2).
    // String fallbacks r.ConfigurationVersion / r.Version have no Status
    // info and may carry a draft number — omit for display field.
    version: pickDisplayVersion(r.Versions),
    revisionGuid,
    configurationGuid,
    countryRegion: r.CountryRegion ?? r.CountryRegionCodes,
    hasContent: Boolean(revisionGuid || configurationGuid),
    hasChildren,
    versionNumbers: versionNumbers && versionNumbers.length > 0 ? versionNumbers : undefined,
    // For Format / ModelMapping: GUID of the DataModel this component
    // references. Used by scopeComponentsToModel to show each format
    // under the correct model (especially when a derived format like
    // Asl MT940 sits under MT940 in DerivedSolutions but references
    // Asl BS model). DataModel rows get their own GUID here — ignored.
    referencedModelGuid: componentType !== 'DataModel' ? referencedModelGuid : undefined,
  };
}

/**
 * Map an F&O component-type hint to our internal union.
 * Accepts strings, the X++ enum int (`DataModel=0, Mapping=1, Format=2`), and booleans.
 */
function mapComponentType(raw?: unknown): ErComponentType {
  if (raw === undefined || raw === null) return 'Unknown';
  if (typeof raw === 'number') {
    switch (raw) {
      case 0: return 'DataModel';
      case 1: return 'ModelMapping';
      case 2: return 'Format';
      default: return 'Unknown';
    }
  }
  if (typeof raw !== 'string') return 'Unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('datamodel')) return 'DataModel';
  if (lower.includes('mapping')) return 'ModelMapping';
  if (lower.includes('format')) return 'Format';
  // Some F&O versions stringify the enum int: "0", "1", "2".
  if (lower === '0') return 'DataModel';
  if (lower === '1') return 'ModelMapping';
  if (lower === '2') return 'Format';
  return 'Unknown';
}

