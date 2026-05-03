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

/**
 * F&O ER client — enumerates and downloads Electronic Reporting
 * configurations via F&O **custom services** exposed under `/api/services`.
 *
 * ER uses custom service groups (not OData entities).
 * All communication goes through the ER custom service groups. See
 * `https://<envUrl>/api/services` for the authoritative list; the groups we
 * consume are `ERConfigurationServices` and `ERMetadataProviderServices`.
 *
 * This module stays host-agnostic: network I/O is delegated to a
 * {@link FnoTransport}.
 *
 * ⚠️ TODO(ops): The operation names below are **best-guess** placeholders
 * based on X++ naming conventions. Once the XML from
 * `GET /api/services/<group>/<service>` has been collected from the test
 * environment, update {@link ER_SERVICE_OPS} to match the real operations
 * (and, if needed, the request/response field names below).
 */

/** Stable service-path constants (group + service). */
export const ER_SERVICES = {
  configurationList: 'ERConfigurationServices/ERConfigurationListService',
  configurationStorage: 'ERConfigurationServices/ERConfigurationStorageService',
  metadataProvider: 'ERMetadataProviderServices/ERMetadataProviderService',
  pullSolution: 'ERWebServices/ERPullSolutionFromRepositoryService',
} as const;

/**
 * Candidate operation names on each ER custom service.
 *
 * ⚠️ The exact names differ between F&O versions. Until the XML from
 * `GET /api/services/<group>/<service>` is collected and pinned, we try
 * several candidates in order and use the first one that doesn't 404.
 *
 * When you confirm the real names, move the winning entry to the front of
 * each array (or shrink the array to a single name).
 */
export const ER_SERVICE_OPS: {
  listSolutions: readonly string[];
  listComponents: readonly string[];
  /**
   * Download ops on ERConfigurationStorageService. Confirmed on
   * ac365lab-factory (2026-04) the only non-Execute ops are:
   *  - GetEffectiveFormatMappingByID (Format / FormatMapping)
   *  - GetModelMappingByID (ModelMapping)
   *  - GetDataModelByIDAndRevision (DataModel)
   *
   * `getConfigurationXml` is the union list kept as a compat helper and
   * for tests; {@link ER_STORAGE_OPS_BY_TYPE} holds the typed dispatch.
   */
  getConfigurationXml: readonly string[];
} = {
  listSolutions: [
    // Confirmed via GET /api/services/ERConfigurationServices/ERConfigurationListService
    // on the ac365lab-factory sandbox (2026-04). The service only exposes
    // two operations: getFormatSolutionsSubHierarchy and
    // getCountOfConfigurationsByCountryCode. The former returns the
    // hierarchy of Format solutions (= ER solutions) and is what we want
    // for enumeration.
    'getFormatSolutionsSubHierarchy',
    // Legacy/alternate guesses kept as a safety net for other F&O versions.
    'getSolutions',
    'GetSolutions',
    'getSolutionList',
    'getAllSolutions',
    'getERSolutions',
    'getList',
  ],
  listComponents: [
    // In the ac365lab-factory sandbox (2026-04) the same operation that
    // lists solutions also lists configurations — the ER hierarchy is a
    // single tree rooted in ERSolutionTable. Children of a leaf-ish
    // solution are the configurations/components.
    'getFormatSolutionsSubHierarchy',
    // Legacy/alternate guesses for other F&O versions.
    'getConfigurations',
    'GetConfigurations',
    'getSolutionComponents',
    'getComponents',
    'getConfigurationList',
    'getSolutionConfigurations',
  ],
  getConfigurationXml: [
    // Real ops (2026-04 ac365lab-factory).
    'GetEffectiveFormatMappingByID',
    'GetModelMappingByID',
    'GetDataModelByIDAndRevision',
    // Legacy/alternate guesses for other F&O versions.
    'getConfigurationXml',
    'GetConfigurationXml',
    'getContent',
    'getConfigurationContent',
    'getXml',
    'downloadConfiguration',
    'getRevisionContent',
  ],
};

/**
 * ERConfigurationStorageService download-ops dispatched by component type.
 * First element is the preferred (confirmed) op; subsequent entries are
 * legacy fallbacks for older F&O versions.
 */
export const ER_STORAGE_OPS_BY_TYPE: Record<ErComponentType, readonly string[]> = {
  Format: ['GetEffectiveFormatMappingByID'],
  ModelMapping: ['GetModelMappingByID'],
  DataModel: ['GetDataModelByIDAndRevision'],
  // Unknown → try all three; the one with a matching ID will succeed.
  Unknown: [
    'GetEffectiveFormatMappingByID',
    'GetModelMappingByID',
    'GetDataModelByIDAndRevision',
  ],
};

/**
 * Low-level helper: invoke an F&O custom service operation.
 *
 * Builds `POST <envUrl>/api/services/<servicePath>/<operation>` with a
 * JSON body and parses the JSON response. Callers should pass the exact
 * parameter names expected by the X++ operation (PascalCase).
 */
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

/**
 * Fetch the list of service names exposed in a service group.
 *
 * `GET <envUrl>/api/services/<groupName>` returns a payload listing the
 * services in that group. Used for diagnostics when the service we call
 * returns an unexpected empty result — we enumerate siblings so the user
 * can discover the right service to target. Accepts both XML and JSON
 * shapes (newer F&O versions prefer JSON).
 */
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

/**
 * Fetch the list of operation names exposed by a custom service.
 *
 * `GET <envUrl>/api/services/<servicePath>` typically returns XML of the form
 *
 * ```xml
 * <Service>
 *   <Name>ERConfigurationListService</Name>
 *   <Operations>
 *     <Operation><Name>foo</Name> ... </Operation>
 *   </Operations>
 * </Service>
 * ```
 *
 * but newer F&O versions sometimes return the equivalent JSON
 * (`{"Name":"...","Operations":[{"Name":"foo"}]}`). We accept both.
 */
export async function listServiceOperations(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  servicePath: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${normalizeEnvUrl(conn.envUrl)}/api/services/${servicePath}`;
  const buffer = await transport.getBinary(url, token, signal);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  return extractOperationNames(text);
}

/**
 * Parse operation names from the response of `/api/services/<servicePath>`.
 *
 * Handles three shapes:
 *  - XML: `<Operation><Name>foo</Name>...</Operation>` repeated.
 *  - JSON: `{ "Operations": [ { "Name": "foo" }, ... ] }`.
 *  - Top-level array of operation strings or `{Name}` objects.
 *
 * Returns `[]` if the payload matches none of them.
 */
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
 * Try a list of candidate operation names on the same service and return
 * the first non-4xx response together with the operation name that worked.
 *
 * Strategy:
 *  1. Discover the real operation names exposed by the service
 *     (`GET /api/services/<servicePath>`).
 *  2. Reorder candidates so those actually exposed are tried first.
 *  3. When an exposed candidate fails with a 4xx, surface the server's
 *     response body verbatim — F&O usually explains which parameter is
 *     missing or wrong. Do **not** keep trying other names in that case,
 *     because the op is real and the problem is the request shape.
 *  4. If none of the candidates is in the exposed list, throw with the
 *     discovered operation names so the caller can update
 *     {@link ER_SERVICE_OPS}.
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
 * Enumerate all ER solutions available in the environment.
 *
 * Strategy: probe `getFormatSolutionsSubHierarchy(parentName)` for every
 * known root DataModel name. The X++ implementation is fully recursive —
 * `getFormatSolutionsSubHierarchyByRecId` recurses into DerivedSolutions,
 * so a single probe on a root model returns its entire sub-tree.
 *
 * An empty `_parentSolutionName` always returns an empty list (the X++
 * `WHERE Name == ''` matches no ERSolutionTable row), so we skip it.
 *
 * Callers can supply additional root names via `options.extraRoots`.
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
  const skippedFormats: string[] = [];
  const skippedMappings: string[] = [];
  const processFlatRows = (flat: RawErSolutionRow[]) => {
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
        seen.set(mapped.solutionName, mapped);
      }
    }
  };

  // Build the full list of root model names to probe.
  const extras = (options?.extraRoots ?? []).map(s => s.trim()).filter(s => s.length > 0);
  const seedModels = [
    // Common Microsoft root DataModels (stable across F&O versions)
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
    // Discovered from Dataverse global repository export (2026-05)
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
  let firstOperation = '';
  try {
    const available = await listServiceOperations(
      transport, conn, token, ER_SERVICES.configurationList, signal,
    );
    confirmedListOp = ER_SERVICE_OPS.listSolutions.find(op => available.includes(op)) ?? '';
    if (!confirmedListOp) {
      // eslint-disable-next-line no-console
      console.warn(
        '[fno-client] listSolutions: none of our candidates match available ops',
        { candidates: ER_SERVICE_OPS.listSolutions, available },
      );
    }
    firstOperation = confirmedListOp;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[fno-client] listSolutions: pre-discovery failed (non-fatal), will use per-probe fallback', err);
  }

  // eslint-disable-next-line no-console
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
          if (!firstOperation) firstOperation = operation;
        }
        const rows = unwrapServiceArray<RawErSolutionRow>(raw, operation);
        if (rows.length > 0) {
          probesWithHits.push(parent);
          processFlatRows(flattenErHierarchy(rows));
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
      // eslint-disable-next-line no-console
      console.info('[fno-client] listSolutions empty — ER service catalog', {
        probesTried: probesTried.length,
        groupOps,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info('[fno-client] listSolutions empty — catalog enumeration failed', err);
    }
  } else {
    // eslint-disable-next-line no-console
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

/** Produce a bounded JSON preview of an arbitrary value for error messages. */
function previewJson(raw: unknown, max = 600): string {
  let s: string;
  try {
    s = JSON.stringify(raw);
  } catch {
    s = String(raw);
  }
  if (!s) return '<empty>';
  return s.length <= max ? s : `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

/**
 * Enumerate configuration components inside a single solution.
 *
 * Uses BFS to discover the full component tree. A single call to
 * `getFormatSolutionsSubHierarchy(solutionName)` returns only what the
 * server includes in `DerivedSolutions` (typically 1-2 levels). For every
 * DataModel node found we make an additional parallel call to fetch ITS
 * children (formats, mappings), repeating until no new DataModels appear.
 *
 * Each Format / ModelMapping is annotated with the nearest DataModel
 * ancestor GUID so download helpers can pass `_dataModelGuid`.
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
  const fetchChildren = async (parentName: string): Promise<RawErComponentRow[]> => {
    try {
      if (confirmedOp) {
        const raw = await callErService<unknown>(
          transport, conn, token,
          ER_SERVICES.configurationList, confirmedOp,
          { _parentSolutionName: parentName }, signal,
        );
        return unwrapServiceArray<RawErComponentRow>(raw, confirmedOp);
      }
      const { operation, raw } = await callErServiceWithFallback<unknown>(
        transport, conn, token,
        ER_SERVICES.configurationList, ER_SERVICE_OPS.listComponents,
        { _parentSolutionName: parentName }, signal,
      );
      return unwrapServiceArray<RawErComponentRow>(raw, operation);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[fno-client] listComponents fetchChildren failed', { parentName, err });
      return [];
    }
  };

  // Initial fetch: root model and whatever DerivedSolutions the server provides.
  const rootRows = await fetchChildren(solutionName);
  // eslint-disable-next-line no-console
  console.info('[fno-client] listComponents root fetch', { solutionName, confirmedOp, rowCount: rootRows.length });

  // Flatten the initial response (respects DerivedSolutions nesting from the API).
  const initialFlat = flattenComponentsWithParent(rootRows, solutionName);

  // BFS: for every derived DataModel in the initial result, call the service
  // again with that model's name as parent to fetch its children (formats /
  // mappings). The API may only populate DerivedSolutions 1-2 levels deep,
  // so this ensures the full tree is discovered regardless of hierarchy depth.
  const probedNames = new Set<string>([solutionName]);

  // Build initial BFS queue from DataModel nodes found in the initial response.
  let bfsQueue: ErConfigSummary[] = initialFlat.filter(
    c => c.componentType === 'DataModel' &&
         c.configurationName &&
         !probedNames.has(c.configurationName),
  );
  for (const dm of bfsQueue) probedNames.add(dm.configurationName!);

  const allExtra: ErConfigSummary[] = [];
  const BFS_ROUNDS = 5;

  for (let round = 0; round < BFS_ROUNDS && bfsQueue.length > 0; round++) {
    // Run the entire current batch in parallel.
    const batch = bfsQueue.splice(0, bfsQueue.length);
    const batchRows = await Promise.all(batch.map(dm => fetchChildren(dm.configurationName!)));

    bfsQueue = [];
    for (let i = 0; i < batch.length; i++) {
      const dm = batch[i];
      const rows = batchRows[i];
      if (rows.length === 0) continue;

      // eslint-disable-next-line no-console
      console.info('[fno-client] listComponents BFS expand', {
        parent: dm.configurationName, round, rowCount: rows.length,
      });

      // Annotate children with this DataModel's GUID so downloads work.
      const children = flattenComponentsWithParent(
        rows, solutionName,
        dm.configurationGuid,
        dm.revisionGuid,
      );

      for (const c of children) {
        allExtra.push(c);
        // Queue any newly discovered DataModels for the next BFS round.
        if (
          c.componentType === 'DataModel' &&
          c.configurationName &&
          !probedNames.has(c.configurationName)
        ) {
          probedNames.add(c.configurationName);
          bfsQueue.push(c);
        }
      }
    }
  }

  if (allExtra.length === 0) return initialFlat;

  // Merge initial + BFS results; deduplicate by (configurationName, revisionGuid|configurationGuid).
  const dedupKey = (c: ErConfigSummary): string =>
    `${c.configurationName ?? ''}|${c.revisionGuid ?? c.configurationGuid ?? ''}`;
  const merged = new Map<string, ErConfigSummary>();
  for (const c of initialFlat) merged.set(dedupKey(c), c);
  for (const c of allExtra) {
    const k = dedupKey(c);
    if (!merged.has(k)) merged.set(k, c);
  }
  return Array.from(merged.values());
}

/**
 * Recursively flatten a `getFormatSolutionsSubHierarchy` response tree
 * into a flat list of components.
 *
 * As we descend we track the nearest DataModel's configurationGuid /
 * revisionGuid and stamp them onto every Format and ModelMapping node.
 * This means a deeply-derived format (e.g. model → base format →
 * derived format) arrives with the correct `parentDataModelGuid` even
 * though the listing service only reports its immediate children per
 * level. The UI `annotateWithParentDataModel` call is then a no-op
 * because `parentDataModelGuid` is already set.
 */
function flattenComponentsWithParent(
  rows: RawErComponentRow[],
  solutionName: string,
  nearestDmGuid?: string,
  nearestDmRev?: string,
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
    // Stamp the nearest DataModel onto non-DataModel nodes (only when
    // the field is not already set by mapComponentRow).
    const annotated: ErConfigSummary =
      c.componentType !== 'DataModel' && nextDmGuid && !c.parentDataModelGuid
        ? { ...c, parentDataModelGuid: nextDmGuid, parentDataModelRevisionGuid: nextDmRev }
        : c;
    out.push(annotated);
    // Recurse into derived solutions.
    if (Array.isArray(r.DerivedSolutions) && r.DerivedSolutions.length > 0) {
      out.push(
        ...flattenComponentsWithParent(
          r.DerivedSolutions as RawErComponentRow[],
          solutionName,
          nextDmGuid,
          nextDmRev,
        ),
      );
    }
  }
  return out;
}

/**
 * Build the ordered list of (operation, body) attempts to download XML
 * for a single component. The F&O ERConfigurationStorageService exposes
 * three typed getters (signatures confirmed against the X++ AOT source
 * in `ElectronicReporting/AxClass/ERConfigurationStorageService.xml`,
 * D365FO 2026-04):
 *
 *   - `getEffectiveFormatMappingByID(guid _formatMappingGuid)`
 *   - `getModelMappingByID(Guid _mappingGuid, guid _dataModelGuid,`
 *     `Name _dataContainerDescriptorName)`
 *   - `getDataModelByIDAndRevision(guid _dataModelGuid,`
 *     `ERRevisionNumber _revisionNumber)`
 *
 * The custom-service JSON deserializer requires every method parameter
 * to be present in the request body — missing keys yield HTTP 400
 * `Parameter '_X' is not found.` Empty/zero values are accepted for
 * parameters X++ ignores on the chosen code path.
 *
 * Exported for unit testing.
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
      // Confirmed on ac365lab-factory (2026-04): parameter is
      // `_formatMappingGuid`. Prefer configurationGuid; fall back to
      // revisionGuid. Kept legacy casings as last-resort fallbacks.
      for (const id of [cfgId, revId].filter(Boolean)) {
        attempts.push({ operation: op, body: { _formatMappingGuid: id } });
      }
    } else if (op === 'GetModelMappingByID') {
      // Confirmed against AOT source on D365FO VM (2026-04,
      // ElectronicReporting / ERConfigurationStorageService):
      //
      //   internal ERModelMappingConfigurationContents getModelMappingByID(
      //       Guid _mappingGuid,
      //       guid _dataModelGuid,
      //       Name _dataContainerDescriptorName)
      //
      // Logic: if `_mappingGuid` is non-empty, F&O calls
      // `ERModelMappingTable::findByGUID(_mappingGuid)` and ignores
      // the other two parameters. Otherwise it resolves the mapping
      // via `(_dataModelGuid, _dataContainerDescriptorName)`.
      //
      // The custom-service JSON deserializer requires **all three**
      // keys to be present in the request body, even when some are
      // unused — missing keys produce HTTP 400 "Parameter '_X' is not
      // found." We therefore always send the full triple and just
      // zero-out the parts X++ will ignore.
      for (const mid of [cfgId, revId].filter(Boolean)) {
        attempts.push({
          operation: op,
          body: {
            _mappingGuid: mid,
            _dataModelGuid: ZERO_GUID,
            _dataContainerDescriptorName: '',
          },
        });
      }
      // Fallback path: when the component-level GUIDs don't resolve
      // a ERModelMappingTable row directly, try the (_dataModelGuid +
      // _dataContainerDescriptorName) branch using the parent
      // DataModel GUID harvested from the hierarchy. The descriptor
      // name is not exposed by the listing service. Per X++ source
      // (ERConfigurationStorageService.getModelMappingByID),
      // `ERDataContainerDescriptorTable::findByName(dmRecId, '')`
      // returns RecId=0, which `ERModelMappingTableSelector::
      // constructByModel(dmTable, 0)` interprets as **the default
      // container** — that selector then returns the model's default
      // ModelMapping. So an empty descriptor is the strongest single
      // probe to "give me whatever default mapping you have for this
      // DataModel". We try it first, then fall back to plausible
      // human-readable names (configuration / solution / DataModel
      // name) for environments where the descriptor is named.
      const dmGuid = component.parentDataModelGuid ?? '';
      const dmRev = component.parentDataModelRevisionGuid ?? '';
      const descriptorCandidates = Array.from(
        new Set(
          [
            '', // ← primary: default container / default mapping
            // Caller-supplied real descriptor names (e.g. harvested
            // from the parsed `ERDataModel.containers[].name`). Tried
            // before the heuristic fall-backs because they actually
            // match real `ERDataContainerDescriptorTable` rows.
            ...(component.descriptorNameCandidates ?? []),
            component.configurationName,
            component.solutionName,
          ]
            .map(s => (s ?? '').trim()),
        ),
      );
      for (const dm of [dmGuid, dmRev].filter(Boolean)) {
        for (const descName of descriptorCandidates) {
          attempts.push({
            operation: op,
            body: {
              _mappingGuid: ZERO_GUID,
              _dataModelGuid: dm,
              _dataContainerDescriptorName: descName,
            },
          });
        }
      }
    } else if (op === 'GetDataModelByIDAndRevision') {
      // Confirmed on ac365lab-factory (2026-04) via 400 error bodies:
      // signature is `(_dataModelGuid, _revisionNumber)` where
      // `_revisionNumber` is a numeric integer (passing a GUID gives
      // "Input string was not in a correct format."). The legacy
      // `_revision` parameter does not exist on this service.
      //
      // F&O returns HTTP 200 with an empty body when the combination
      // is syntactically valid but the DataModel has no own XML
      // content (typical for derived/pure-inheritance models, or for
      // revisions that are pure pointers to an earlier revision's
      // content). Because of that we try **every** known revision
      // number (highest → lowest) rather than just the display one —
      // the actual XML is usually authored on rev 1 even when the
      // latest is rev 3.
      const dmGuids = [cfgId, revId].filter(Boolean);
      // Prefer the full list from `versionNumbers`, fall back to the
      // single display version, finally fall back to `0` which some
      // F&O builds treat as "latest".
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
          attempts.push({
            operation: op,
            body: { _dataModelGuid: dm, _revisionNumber: rev },
          });
        }
        // NOTE: we intentionally do NOT add a legacy single-param
        // `{ _dataModelGuid: dm }` variant here. On 2024+ F&O builds
        // the service rejects it with 400 ("parameter '_revisionNumber'
        // is not found"), which pollutes the attempt list and causes
        // the "all 200-empty" detection below to miss — turning a
        // legitimate "pure-inheritance, no own XML" case into a red
        // FnoSourceUnsupportedError instead of a silent skip.
      }
    } else {
      // Legacy/alternate ops: fall back to the old body shape.
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

/**
 * Download the XML content for a single configuration component.
 *
 * Dispatches to one of the three typed `ERConfigurationStorageService`
 * ops based on `component.componentType` and tries a small set of body
 * parameter-name variants. The service returns the XML either as a plain
 * string or as a base64-encoded string embedded in the JSON response.
 */
export async function downloadConfigXml(
  transport: FnoTransport,
  conn: FnoConnection,
  token: string,
  component: ErConfigSummary,
  signal?: AbortSignal,
): Promise<ErConfigDownload> {
  if (!component.revisionGuid && !component.configurationGuid) {
    // Special case: a ModelMapping row from
    // `getFormatSolutionsSubHierarchy` typically arrives without its
    // own GUID (the listing service only surfaces FormatMappingGUID
    // for Format leaves). The X++ AOT signature
    //   getModelMappingByID(_mappingGuid, _dataModelGuid,
    //                       _dataContainerDescriptorName)
    // however accepts a `(parent DataModel GUID, descriptor name)`
    // resolution path, which `buildDownloadAttempts` emits. Allow
    // the call to proceed if we have at least one of those parent
    // GUIDs — the attempt loop will surface a meaningful error if
    // the descriptor-name guess doesn't match.
    const canResolveMappingViaParent =
      component.componentType === 'ModelMapping' &&
      Boolean(component.parentDataModelGuid || component.parentDataModelRevisionGuid);
    if (!canResolveMappingViaParent) {
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
    throw new FnoSourceUnsupportedError(
      `Could not download XML for "${component.configurationName}" (componentType=${component.componentType}). ` +
        `Tried ${tried.length} attempt(s): ${summary || '(none executed)'}. ` +
        (lastErr ? `Last error: ${lastErr.message}.` : '') +
        ` Open DevTools → Network → filter "${ER_SERVICES.configurationStorage}" to inspect responses.`,
    );
  }

  const xml = extractedXml;
  // Diagnostic: always log the response shape + found XML root(s) so the
  // user can see in DevTools whether F&O returned both the format *and*
  // the format mapping for a Format component. If only ERTextFormat
  // comes back, bindings/expressions will be empty because the mapping
  // half is missing from the payload.
  try {
    const unwrapped = unwrapServiceValue(raw, operation);
    const keys = raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>) : [];
    const unwrappedKeys = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
      ? Object.keys(unwrapped as Record<string, unknown>)
      : Array.isArray(unwrapped) ? [`<array:${unwrapped.length}>`] : [typeof unwrapped];
    const fragments = collectXml(unwrapped);
    const rootNames = fragments.map(f => {
      const m = /<\s*([A-Za-z_][\w:-]*)[\s>/]/.exec(
        f.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^?]*\?>\s*/i, ''),
      );
      return m?.[1] ?? '<unknown>';
    });
    // eslint-disable-next-line no-console
    console.info('[fno-client] downloadConfigXml response shape', {
      operation,
      configurationName: component.configurationName,
      componentType: component.componentType,
      topLevelKeys: keys,
      unwrappedKeys,
      fragmentCount: fragments.length,
      fragmentRoots: rootNames,
      fragmentLengths: fragments.map(f => f.length),
      xmlExtracted: Boolean(xml),
    });
  } catch {
    // ignore logging failures
  }
  if (!xml) {
    // Log the raw shape so the caller can see what fields the service
    // actually returned (field names differ between F&O versions).
    try {
      const unwrapped = unwrapServiceValue(raw, operation);
      const keys = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
        ? Object.keys(unwrapped as Record<string, unknown>)
        : Array.isArray(unwrapped) ? ['<array>', String(unwrapped.length)] : [typeof unwrapped];
      // eslint-disable-next-line no-console
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
  const { guids: referencedDataModelGuids, revisions: referencedDataModelRevisions } =
    extractReferencedDataModelGuids(finalXml);
  if (referencedDataModelGuids.length > 0) {
    // eslint-disable-next-line no-console
    console.info('[fno-client] downloadConfigXml found model references', {
      configurationName: component.configurationName,
      referencedDataModelGuids,
      referencedDataModelRevisions,
    });
  }
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
 * Scan an ER configuration XML string for `Model="{guid}"` and
 * `ModelVersion="{guid},rev"` attribute references on the two
 * mapping-bearing elements (`ERFormatMapping` / `ERModelMapping`).
 * Returns the unique set of non-zero GUIDs plus the highest revision
 * observed per GUID.
 *
 * We stay at the string level (no XML re-parse) so this is cheap
 * enough to run on every download and doesn't require importing the
 * core parser into fno-client.
 */
function extractReferencedDataModelGuids(xml: string): {
  guids: string[];
  revisions: Record<string, number>;
} {
  const guids = new Set<string>();
  const revisions: Record<string, number> = {};
  const guidBody = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  // 1) Any attribute whose name contains "Model" or "DataModel" and whose
  //    value is a bare GUID. F&O ER XMLs use a variety of names:
  //    `Model`, `DataModelID`, `DataModelGuid`, `ModelID`, `ModelGuid`, …
  //    The broad match here costs us nothing — we filter zero-GUID and
  //    de-dupe. We deliberately exclude names containing "Mapping" so
  //    we don't conflate ModelMapping GUIDs with DataModel GUIDs.
  const attrGuidRe = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*"\\{?(${guidBody})\\}?"`,
    'gi',
  );
  // 2) Paired `…Version="{guid},N"` — extracts both the GUID and the
  //    integer revision number the format references.
  const attrVersionRe = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*Version)\\s*=\\s*"\\{?(${guidBody})\\}?,(\\d+)"`,
    'gi',
  );
  // 3) F&O variant seen on ac365lab-factory (2026-04):
  //    `<… ModelGuid="{guid}" RevisionNumber="N" …/>` — the two
  //    pieces of information live in separate attributes on the same
  //    element. Capture any `ModelGuid` / `DataModelGuid` /
  //    `DataModelID` immediately followed (within the same tag) by
  //    `RevisionNumber="N"`.
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
  // 4) F&O SolutionVersion envelope: <BaseSolution … Id="{guid}" />
  //    The direct parent configuration in ERSolutionTable. For a Format that
  //    is a direct child of a DataModel, this IS the DataModel GUID.
  //    For a Format derived from another Format, this is the parent Format
  //    GUID — safe false-positive: GetDataModelByIDAndRevision with a Format
  //    GUID returns 200-empty (silently skipped by the caller).
  //    Import formats often omit ERFormatMappingVersion.Model entirely;
  //    BaseSolution.Id is a reliable fallback when the full ERSolutionVersion
  //    wrapper is returned by GetEffectiveFormatMappingByID.
  const baseSolutionIdRe = new RegExp(
    `<BaseSolution[^>]*?\\bId\\s*=\\s*"\\{?(${guidBody})\\}?"`,
    'gi',
  );
  for (const m of xml.matchAll(baseSolutionIdRe)) {
    const guid = m[1].toLowerCase();
    if (guid !== ZERO_GUID) guids.add(guid);
  }
  return { guids: Array.from(guids), revisions };
}

// ─── Service-response parsing helpers ───

/**
 * F&O custom services wrap the return value in either:
 * - `{ "<operationName>Result": <value> }` (most common), or
 * - a bare `<value>` (no wrapper), or
 * - `{ "value": [...] }` (collection wrapper).
 *
 * This helper normalizes collection responses to a flat array.
 */
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
 * If the extracted XML payload is an `<ErFnoBundle>` wrapper, annotate
 * it with a `Name=` attribute so the parser in `@er-visualizer/core`
 * has a reliable fallback for the synthetic ERSolution name (and thus
 * the tab label / designer title in the UI). Non-bundle fragments get
 * wrapped so they carry the name hint too — `wrapBareContent` unwraps
 * the bundle before content detection, so this doesn't change parsing
 * semantics.
 *
 * The hint only fires when the name is non-empty and the payload
 * starts with a known bare-content root; otherwise we return the XML
 * unchanged to avoid corrupting already-wrapped ERSolutionVersion
 * envelopes from disk.
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

/**
 * Walk `value` recursively and collect every string that looks like XML
 * (starts with `<` after BOM/whitespace stripping) or decodes from
 * base64 into XML. Handles arrays, nested objects, and common wrapper
 * field names used by F&O custom services.
 *
 * Duplicates are suppressed. Depth is capped to avoid pathological
 * recursion.
 */
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

/**
 * Walk `value` recursively and return the first string that looks like
 * XML (starts with `<` after BOM/whitespace stripping) or decodes from
 * base64 into XML. Handles arrays, nested objects, and common wrapper
 * field names used by F&O custom services. Stops at the first hit.
 */
function scanForXml(value: unknown, depth = 0): string | null {
  if (depth > 6) return null; // safety
  if (value == null) return null;
  if (typeof value === 'string') {
    const normalized = normalizeXmlString(value);
    return normalized.trimStart().startsWith('<') ? normalized : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = scanForXml(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    // Prefer common content-bearing keys first.
    const obj = value as Record<string, unknown>;
    const preferred = ['Xml', 'xml', 'XmlContent', 'xmlContent', 'XMLContent',
                       'Content', 'content', 'Data', 'data', 'value', 'Value',
                       'Result', 'result', 'Body', 'body',
                       'FormatXml', 'ModelXml', 'MappingXml', 'ConfigurationXml',
                       'File', 'Payload'];
    for (const key of preferred) {
      if (key in obj) {
        const hit = scanForXml(obj[key], depth + 1);
        if (hit) return hit;
      }
    }
    // Then any remaining property.
    for (const [key, v] of Object.entries(obj)) {
      if (preferred.includes(key)) continue;
      const hit = scanForXml(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
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
 * Classify an ER tree node by name + FormatMappingGUID.
 *
 * Confirmed on ac365lab-factory (2026-04) — `getFormatSolutionsSubHierarchy`
 * returns a tree with fields: `Name`, `Description`, `FormatMappingGUID`,
 * `Versions: [{Status, VersionNumber}]`, `DerivedSolutions: []`. There is
 * **no** explicit ComponentType field. The heuristic:
 *
 * 1. `FormatMappingGUID` non-zero → **Format** (Format has a mapping GUID).
 * 2. Zero GUID + name contains `mapping` → **ModelMapping**.
 * 3. Zero GUID + name contains `model`   → **DataModel**.
 * 4. Otherwise → Unknown.
 *
 * Case-insensitive on the name test.
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

/**
 * Recursively walk a getFormatSolutionsSubHierarchy tree and collect
 * every node (including the root rows themselves) into a flat list.
 * Children live under `DerivedSolutions`.
 */
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
  Status?: number;
  VersionNumber?: number;
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
    if (typeof v?.VersionNumber === 'number' && v.VersionNumber > max) max = v.VersionNumber;
  }
  return Number.isFinite(max) ? String(max) : undefined;
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
  // Prefer explicit ComponentType hint if F&O surfaces it; otherwise
  // fall back to the name+GUID heuristic for the actual tree shape.
  const typeHint = readComponentTypeHint(r as Record<string, unknown>);
  const typeFromHint = mapComponentType(typeHint);
  let componentType: ErComponentType = typeFromHint !== 'Unknown'
    ? typeFromHint
    : classifyErNode(name, r.FormatMappingGUID);
  // If classification is still Unknown but the node has children
  // (DerivedSolutions), it is almost certainly a DataModel — Formats
  // and ModelMappings are always leaves in the ER hierarchy.
  if (
    componentType === 'Unknown' &&
    Array.isArray(r.DerivedSolutions) &&
    r.DerivedSolutions.length > 0
  ) {
    componentType = 'DataModel';
  }
  // If Base is explicitly an empty string the row is a ROOT configuration.
  // Root configs have no parent, so they can only be DataModels — Formats
  // and ModelMappings are always nested under a DataModel. Apply this
  // upgrade when the name heuristic alone yielded Unknown (e.g. names
  // like "EU Sales list", "Electronic messages", "Asset leasing").
  const baseField = typeof r.Base === 'string' ? r.Base : undefined;
  if (componentType === 'Unknown' && baseField === '') {
    componentType = 'DataModel';
  }
  return {
    solutionName: name,
    publisher: r.Publisher,
    version: pickDisplayVersion(r.Versions) ?? r.SolutionVersion ?? r.Version,
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
  ConfigurationRevisionGuid?: string;
  RevisionGuid?: string;
  ConfigurationGuid?: string;
  Guid?: string;
  Id?: string;
  ID?: string;
  // getFormatSolutionsSubHierarchy on ac365lab-factory returns these two
  // (observed 2026-04): one is the configuration identity, the other the
  // revision identity — both needed to call the *ByID storage operations.
  ConfigurationID?: string;
  ConfigurationId?: string;
  RevisionID?: string;
  RevisionId?: string;
  FormatID?: string;
  FormatId?: string;
  ModelID?: string;
  ModelId?: string;
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

function mapComponentRow(r: RawErComponentRow, solutionName: string): ErConfigSummary {
  const rec = r as Record<string, unknown>;
  const name = r.ConfigurationName ?? r.Name ?? '';
  // Classify using the same name+GUID heuristic as solutions, then fall
  // back to explicit hint if surfaced.
  const typeHint = readComponentTypeHint(rec);
  const typeFromHint = mapComponentType(typeHint);
  const componentType = typeFromHint !== 'Unknown'
    ? typeFromHint
    : classifyErNode(name, r.FormatMappingGUID);

  // For Format components the FormatMappingGUID is the download ID.
  // For Model/ModelMapping the zero-GUID means there's no ID in the
  // list response — downloads need a different service call.
  const formatMappingGuid = typeof r.FormatMappingGUID === 'string' && r.FormatMappingGUID !== ZERO_GUID
    ? r.FormatMappingGUID
    : undefined;

  const revisionGuid =
    r.ConfigurationRevisionGuid ??
    r.RevisionGuid ??
    r.RevisionID ??
    r.RevisionId ??
    findGuidByKeyHint(rec, 'revision');
  const configurationGuid =
    formatMappingGuid ??
    r.ConfigurationGuid ??
    r.Guid ??
    r.ConfigurationID ??
    r.ConfigurationId ??
    r.FormatID ??
    r.FormatId ??
    r.ModelID ??
    r.ModelId ??
    r.Id ??
    r.ID ??
    findGuidByKeyHint(rec, 'format') ??
    findGuidByKeyHint(rec, 'model') ??
    findGuidByKeyHint(rec, 'config') ??
    findAnyGuid(rec);

  const hasChildren = Array.isArray(r.DerivedSolutions) && r.DerivedSolutions.length > 0;

  // Collect every integer version number F&O reported for this
  // component. `GetDataModelByIDAndRevision` needs a *specific*
  // integer; the highest-version probe alone returns 200-empty when
  // the actual content was authored on an earlier revision.
  const versionNumbers = Array.isArray(r.Versions)
    ? r.Versions
        .map(v => (typeof v?.VersionNumber === 'number' ? v.VersionNumber : undefined))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .sort((a, b) => b - a)
    : undefined;

  return {
    solutionName: r.SolutionName ?? solutionName,
    configurationName: name,
    componentType,
    version: pickDisplayVersion(r.Versions) ?? r.ConfigurationVersion ?? r.Version,
    revisionGuid,
    configurationGuid,
    countryRegion: r.CountryRegion ?? r.CountryRegionCodes,
    hasContent: Boolean(revisionGuid || configurationGuid),
    hasChildren,
    versionNumbers: versionNumbers && versionNumbers.length > 0 ? versionNumbers : undefined,
  };
}

/**
 * Map an F&O component-type hint to our internal union. Accepts strings
 * (`"DataModel"`, `"ERSolutionComponentType::Format"`, etc.), the raw
 * X++ enum integer (exported from AxDB as `0 | 1 | 2`), and booleans
 * (`true`/`false` appear in some service responses).
 *
 * ⚠️ The X++ `ERSolutionComponentType` enum ordering on D365 F&O 10.0.x
 * is: `DataModel = 0`, `Mapping = 1`, `Format = 2`. This has been stable
 * for many releases; verify if a new version reshuffles it.
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

