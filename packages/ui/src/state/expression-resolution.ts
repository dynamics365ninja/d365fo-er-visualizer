/**
 * Resolving ER expressions and model paths to the datasources and bindings
 * behind them, across every loaded configuration.
 */
import { dsPathToExpression } from '../utils/ds-path';
import { mappingDefinitionLabel } from '@er-visualizer/core';
import {
  getDatasourcePoolsForConfig,
  getMappingSourcesForConfig,
  getMappingSourcesInScope,
  getPreferredDescriptors,
} from './mapping-definitions';
import { findNodeByMatch, type WorkspaceTrees } from './tree-builder';

// ─── Helper: find datasource by name (recursive through children) ───

function findDatasourceByName(datasources: any[], name: string): any | null {
  for (const ds of datasources) {
    // An implicit path node (`model/InvoiceLines`) is not something an
    // expression can name; only what hangs below it is.
    if (ds.name === name && !ds.implicit) return ds;
    if (ds.children) {
      const found = findDatasourceByName(ds.children, name);
      if (found) return found;
    }
  }
  return null;
}

export function normalizeIdentifier(value: string): string {
  return value.replace(/['"]/g, '').trim().toLowerCase();
}

export function buildDatasourceLookupKey(name: string, parentPath?: string): string {
  const normalizedName = name.replace(/^[$#]/, '').trim().toLowerCase();
  if (!parentPath) return normalizedName;
  const normalizedParent = parentPath
    .split('/')
    .map(segment => segment.trim().replace(/^[$#]/, ''))
    .filter(Boolean)
    .join('/')
    .toLowerCase();
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

// ─── Deep expression analysis: resolve nested DS paths and trace calculated field dependencies ───

export interface DeepDatasourceInfo {
  name: string;
  type: string;
  tableName?: string;
  enumName?: string;
  enumSourceKind?: 'Ax' | 'DataModel' | 'Format';
  className?: string;
  formula?: string;
  isModelEnum?: boolean;
}

export interface DeepResolutionResult {
  /** The root datasource (e.g. ReportFields) */
  rootDs: any | null;
  rootDsConfigIndex: number | null;
  /** The nested child datasource (e.g. $PurchaseVATDeductionAdjustStandardAmount) */
  nestedDs: any | null;
  /** Full path segments resolved */
  pathSegments: string[];
  /**
   * Trailing segments that are not datasources of their own — i.e. the field
   * addressed on `nestedDs`/`rootDs`. `model.InvoiceLines.ItemId` binds to a
   * table datasource plus the field `ItemId`, which is otherwise dropped.
   */
  fieldPath: string[];
  /** The calculated field formula (if the resolved DS is a calc field) */
  formula: string | null;
  /** All datasources involved (tables, enums, classes, etc.) found by tracing the formula recursively */
  involvedDatasources: DeepDatasourceInfo[];
  /** Chain of calculated fields traversed */
  calculatedFieldChain: { name: string; formula: string }[];
}

/**
 * Parse a dotted expression path handling quoted segments like ReportFields.'$Field'
 * Returns array of segment names (without quotes); a doubled quote inside a
 * quoted segment stands for one literal quote ('Customer''s name').
 */
export function parseDottedPath(expr: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      if (ch === quoteChar && expr[i + 1] === quoteChar) {
        // A doubled quote is an escaped one: 'Customer''s name'.
        current += ch;
        i++;
      } else if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === '.') {
      if (current) segments.push(current);
      current = '';
    } else if (ch === '(' || ch === ')' || ch === ' ') {
      // stop at function calls or spaces
      break;
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * An expression that reads the format's data model, rewritten to start at
 * `model`. The format's model datasource can be named anything — the PEPPOL
 * formats call it `Invoice` — so `Invoice.InvoiceBase.Id` is as much a model
 * path as `model.InvoiceBase.Id`. `root` is the root as written. Null when the
 * expression does not start at the data model.
 */
export function toModelRootedPath(
  expression: string,
  configurations: any[],
  configIndex: number,
): { modelExpression: string; root: string } | null {
  const match = /^('(?:[^']|'')+'|[^.\\\s('"]+)(?=[.\\])/.exec(expression);
  if (!match) return null;
  const root = match[0];
  const name = root.startsWith("'") ? root.slice(1, -1).replace(/''/g, "'") : root;
  const rest = expression.slice(root.length);
  if (name.toLowerCase() === 'model') return { modelExpression: `model${rest}`, root };

  const content = configurations[configIndex]?.content;
  if (content?.kind !== 'Format') return null;
  const datasources: any[] = content.formatMappingVersion?.formatMapping?.datasources ?? [];
  const isModelDs = datasources.some(ds =>
    ds.type === 'DataModel' && !ds.parentPath && ds.name?.toLowerCase() === name.toLowerCase());
  return isModelDs ? { modelExpression: `model${rest}`, root } : null;
}

/**
 * Extract all datasource identifiers referenced in an ER expression string.
 * Finds identifiers that appear at the start of dotted paths (e.g. "DS.field" → "DS").
 * Also extracts nested dot-path references like "ReportFields.'$Child'" as full paths.
 */
export function extractExpressionReferences(expr: string): string[] {
  if (!expr) return [];
  const refs: string[] = [];
  // Match identifier patterns: word optionally followed by .'quoted' or .word chains
  // This catches: SimpleDS, DS.field, DS.'$Field', ReportFields.'$Child'.value
  const pattern = /(?<![.'"\w])([A-Za-z_]\w*(?:\s*\.\s*(?:'[^']*'|"[^"]*"|[A-Za-z_]\w*))*)/g;
  let match;
  while ((match = pattern.exec(expr)) !== null) {
    const full = match[1].replace(/\s+/g, '');
    // Skip known ER functions and keywords
    if (/^(IF|AND|OR|NOT|ABS|ROUND|FORMAT|TEXT|CONCATENATE|LEFT|RIGHT|MID|LEN|TRIM|REPLACE|FIND|VALUE|INT64VALUE|INTVALUE|INT|NUMBERFORMAT|STRINGJOIN|ORDERBY|WHERE|FILTER|FIRSTORNULL|FIRST|COUNT|SUMIF|SUM|MIN|MAX|AVG|LISTJOIN|SPLIT|EMPTYLIST|ISEMPTY|ENUMERATE|ALLITEMS|ALLITEMSQUERY|REVERSE|VALUEIN|VALUEINLARGE|CONVERTCURRENCY|ROUNDAMOUNT|CH_BANK|FA_BALANCE|FA_SUM|CASE|NUMSEQVALUE|GETENUMVALUEBYNAME|GUIDVALUE|DATETIMEFORMAT|DATEFORMAT|ADDDAYS|SESSIONTODAY|SESSIONNOW|TODAY|NOW|DAYOFYEAR|NULLDATE|NULLDATETIME|DATETIMEVALUE|DATEVALUE|NULLCONTAINER|BASE64STRINGTOCONTAINER|true|false|null)$/i.test(full)) {
      continue;
    }
    refs.push(full);
  }
  return [...new Set(refs)];
}

/**
 * Datasources a calculated field / group-by / user parameter delegates to.
 * `Parameters.'$SourceJournal'` is a calculated field over
 * `Tables.'#SourceJournalTables'.'$CustInvoiceJour'`, so the fields addressed as
 * `Parameters.'$SourceJournal'.'$InvoiceDate'` live on the *referenced* datasource,
 * never on the calculated field itself.
 * Resolves references with plain navigation only — no delegate following — so this
 * cannot recurse into itself.
 */
function getDelegateDatasources(ds: any, pools: any[][]): any[] {
  const expressions: string[] = [];
  if (ds.calculatedField?.expressionAsString) expressions.push(ds.calculatedField.expressionAsString);
  if (ds.groupByInfo?.listToGroup) expressions.push(dsPathToExpression(ds.groupByInfo.listToGroup));
  if (ds.userParamInfo?.expressionAsString) expressions.push(ds.userParamInfo.expressionAsString);

  const delegates: any[] = [];
  for (const expression of expressions) {
    for (const ref of extractExpressionReferences(expression)) {
      const segments = parseDottedPath(ref);
      if (segments.length === 0) continue;
      const found = findDsAcrossPools(pools, segments);
      if (found && found !== ds && !delegates.includes(found)) delegates.push(found);
    }
  }
  return delegates;
}

const MAX_DELEGATE_HOPS = 4;

/** Find `segment` under `current`, following calculated-field references when needed. */
function findChildSegment(
  current: any,
  segment: string,
  pools: any[][],
  visited: Set<any>,
  depth: number,
): any | null {
  const children: any[] = current.children ?? [];
  // Exact match wins: a container can hold both `CustInvoiceJour` (the table) and
  // `$CustInvoiceJour` (a calculated field over it), and only the decorated name
  // carries the sub-fields the path continues into. An undecorated segment is only
  // ever matched exactly — otherwise a table field (`….InvoiceDate`) would be
  // mistaken for the calculated field named `$InvoiceDate` beside it.
  const decorated = /^[$#]/.test(segment);
  const direct = children.find((c: any) => c.name === segment)
    ?? (decorated
      ? children.find((c: any) => c.name === segment.slice(1))
      : undefined);
  if (direct) return direct;

  if (pools.length === 0 || depth >= MAX_DELEGATE_HOPS || visited.has(current)) return null;
  visited.add(current);

  for (const delegate of getDelegateDatasources(current, pools)) {
    if (visited.has(delegate)) continue;
    const found = findChildSegment(delegate, segment, pools, visited, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Navigate a datasource tree following a path of segment names.
 * E.g. ["ReportFields", "$PurchaseVATDeductionAdjustStandardAmount"] →
 *   find "ReportFields" root DS, then find "$PurchaseVATDeductionAdjustStandardAmount" child.
 *
 * Pass `pools` to resolve segments that hang off a calculated field's *target*
 * rather than off the calculated field itself.
 */
function navigateDatasourcePath(
  datasources: any[],
  segments: string[],
  pools: any[][] = [],
): { rootDs: any | null; leafDs: any | null; fieldPath: string[] } {
  if (segments.length === 0) return { rootDs: null, leafDs: null, fieldPath: [] };

  // Find root — strip leading $/# if present for matching
  const rootName = segments[0].replace(/^[$#]/, '');
  const rootDs = findDatasourceByName(datasources, segments[0]) ??
               findDatasourceByName(datasources, rootName);
  if (!rootDs) return { rootDs: null, leafDs: null, fieldPath: [] };

  let current = rootDs;
  let leafDs = rootDs;
  let consumed = 1;
  for (let i = 1; i < segments.length; i++) {
    const child = findChildSegment(current, segments[i], pools, new Set(), 0);
    if (!child) break;
    current = child;
    // An implicit record is part of the path, not a datasource: a path that
    // stops inside one addresses model fields of the last real datasource.
    if (!child.implicit) {
      leafDs = child;
      consumed = i + 1;
    }
  }

  // Whatever is left addresses fields on `leafDs`, not datasources.
  return { rootDs, leafDs, fieldPath: segments.slice(consumed) };
}

/**
 * Recursively trace all datasources involved in a calculated field's expression.
 * Handles nested calculated fields that reference other calculated fields.
 * Searches across all provided datasource pools (from multiple configs).
 */
function traceCalculatedFieldDeps(
  ds: any,
  allDatasourcePools: any[][],
  visited: Set<string>,
  involvedDatasources: DeepDatasourceInfo[],
  calcChain: { name: string; formula: string }[],
): void {
  const dsKey = ds.parentPath ? `${ds.parentPath}/${ds.name}` : ds.name;
  if (visited.has(dsKey)) return; // prevent circular refs
  visited.add(dsKey);

  // Record this DS info
  const info: DeepDatasourceInfo = { name: ds.name, type: ds.type };
  if (ds.tableInfo) info.tableName = ds.tableInfo.tableName;
  if (ds.enumInfo) {
    info.enumName = ds.enumInfo.enumName;
    info.isModelEnum = ds.enumInfo.isModelEnum;
    info.enumSourceKind = ds.enumInfo.sourceKind;
  }
  if (ds.classInfo) info.className = ds.classInfo.className;
  if (ds.calculatedField?.expressionAsString) info.formula = ds.calculatedField.expressionAsString;

  // Only add non-calculated-field datasources as "involved" (tables, enums, classes)
  // Always add if it has concrete type info
  if (ds.tableInfo || ds.enumInfo || ds.classInfo) {
    if (!involvedDatasources.some(d => d.name === ds.name && d.type === ds.type)) {
      involvedDatasources.push(info);
    }
  }

  // If it's a calculated field, trace its formula
  if (ds.calculatedField?.expressionAsString) {
    calcChain.push({ name: ds.name, formula: ds.calculatedField.expressionAsString });
    const refs = extractExpressionReferences(ds.calculatedField.expressionAsString);
    for (const ref of refs) {
      const refSegments = parseDottedPath(ref);
      const found = findDsAcrossPools(allDatasourcePools, refSegments, true);
      if (found) {
        traceCalculatedFieldDeps(found, allDatasourcePools, visited, involvedDatasources, calcChain);
      }
    }
  }

  // Also trace children that are used
  if (ds.groupByInfo) {
    // GroupBy references a list datasource
    const listRef = ds.groupByInfo.listToGroup;
    if (listRef) {
      const refSegments = parseDottedPath(dsPathToExpression(listRef));
      const found = findDsAcrossPools(allDatasourcePools, refSegments, true);
      if (found) {
        traceCalculatedFieldDeps(found, allDatasourcePools, visited, involvedDatasources, calcChain);
      }
    }
  }
}

/**
 * Try to find a datasource by navigating a dotted path across multiple datasource pools.
 * Falls back to simple name search if path navigation fails.
 */
function findDsAcrossPools(pools: any[][], segments: string[], followDelegates = false): any | null {
  for (const pool of pools) {
    const { leafDs } = navigateDatasourcePath(pool, segments, followDelegates ? pools : []);
    if (leafDs) return leafDs;
  }
  // Fallback: try simple name match for single-segment refs
  if (segments.length === 1) {
    for (const pool of pools) {
      const found = findDatasourceByName(pool, segments[0]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Main deep resolution function: resolve an expression path to its nested datasource
 * and trace all dependencies through calculated fields.
 */
export function resolveDeepExpression(
  expression: string,
  configurations: any[],
  fromConfigIndex: number,
  /** The format the lookup is made for, when it started in another configuration. */
  scopeConfigIndex?: number | null,
): DeepResolutionResult | null {
  const pathSegments = parseDottedPath(expression);
  if (pathSegments.length === 0) return null;

  // Collect all datasource pools from all configs for cross-config tracing
  const allDatasourcePools: any[][] = [];
  const configDatasources = new Map<number, any[][]>();
  const preferredDescriptors = getPreferredDescriptors(configurations, fromConfigIndex, scopeConfigIndex);
  const collectOrder = [
    fromConfigIndex,
    ...configurations.map((_: any, i: number) => i).filter((i: number) => i !== fromConfigIndex),
  ];
  for (const i of collectOrder) {
    const config = configurations[i];
    if (!config) continue;
    const pools = getDatasourcePoolsForConfig(config, preferredDescriptors);
    if (pools.length > 0) {
      configDatasources.set(i, pools);
      allDatasourcePools.push(...pools);
    }
  }

  // Search configs for the root DS, starting with fromConfigIndex
  const searchOrder = [fromConfigIndex, ...configurations.map((_: any, i: number) => i).filter((i: number) => i !== fromConfigIndex)];

  for (const ci of searchOrder) {
    const datasourcePools = configDatasources.get(ci);
    if (!datasourcePools) continue;

    let rootDs: any = null;
    let leafDs: any = null;
    let fieldPath: string[] = [];
    for (const datasources of datasourcePools) {
      const resolved = navigateDatasourcePath(datasources, pathSegments, allDatasourcePools);
      if (!resolved.rootDs) continue;
      // Several pools can expose the same root; keep the one that walks deepest,
      // otherwise a shallow hit hides the datasource the path really lands on.
      if (rootDs && resolved.fieldPath.length >= fieldPath.length) continue;
      rootDs = resolved.rootDs;
      leafDs = resolved.leafDs;
      fieldPath = resolved.fieldPath;
      if (fieldPath.length === 0) break;
    }
    if (!rootDs) continue;

    const result: DeepResolutionResult = {
      rootDs,
      rootDsConfigIndex: ci,
      nestedDs: leafDs !== rootDs ? leafDs : null,
      pathSegments,
      fieldPath,
      formula: leafDs?.calculatedField?.expressionAsString ?? null,
      involvedDatasources: [],
      calculatedFieldChain: [],
    };

    // Trace dependencies from the leaf DS across all configs' datasources
    if (leafDs) {
      traceCalculatedFieldDeps(leafDs, allDatasourcePools, new Set(), result.involvedDatasources, result.calculatedFieldChain);
    }

    // If we found something meaningful, return it
    if (result.rootDs) return result;
  }

  // Fallback: expression is a function call (FILTER, FIRSTORNULL, …) so parseDottedPath
  // stopped at the opening '(' and found nothing. Extract identifiers from inside the
  // expression and resolve the first one that maps to a datasource.
  const innerRefs = extractExpressionReferences(expression);
  for (const ref of innerRefs) {
    const refSegments = parseDottedPath(ref);
    if (refSegments.length === 0) continue;
    for (const ci of searchOrder) {
      const datasourcePools = configDatasources.get(ci);
      if (!datasourcePools) continue;
      for (const datasources of datasourcePools) {
        const resolved = navigateDatasourcePath(datasources, refSegments, allDatasourcePools);
        if (!resolved.rootDs) continue;
        const result: DeepResolutionResult = {
          rootDs: resolved.rootDs,
          rootDsConfigIndex: ci,
          nestedDs: resolved.leafDs !== resolved.rootDs ? resolved.leafDs : null,
          pathSegments: refSegments,
          fieldPath: resolved.fieldPath,
          formula: resolved.leafDs?.calculatedField?.expressionAsString ?? null,
          involvedDatasources: [],
          calculatedFieldChain: [],
        };
        if (resolved.leafDs) traceCalculatedFieldDeps(resolved.leafDs, allDatasourcePools, new Set(), result.involvedDatasources, result.calculatedFieldChain);
        return result;
      }
    }
  }

  return null;
}

// ─── Workspace lookups behind the store's resolve* / find* actions ───

export interface ResolvedDatasource {
  configIndex: number;
  datasourceName: string;
  treeNodeId: string | null;
  datasource: any;
}

export interface ResolvedBinding {
  configIndex: number;
  treeNodeId: string | null;
  binding: any;
}

export interface ResolvedModelPath {
  modelPath: string;
  binding: any;
  bindingConfigIndex: number;
  bindingTreeNodeId: string | null;
  datasource: any | null;
  datasourceConfigIndex: number | null;
  datasourceTreeNodeId: string | null;
  /** Label of the mapping definition the binding was found in. */
  definitionLabel?: string;
}

export interface ModelPathBinding {
  path: string;
  relativePath: string;
  expressionAsString: string;
  configIndex: number;
  /** Label of the mapping definition the binding belongs to. */
  definitionLabel?: string;
}

/** Tree node of datasource `dsName` (under `parentPath`, when given) in configuration `configIndex`. */
export function findDatasourceNode(
  state: Pick<WorkspaceTrees, 'treeNodes'>,
  dsName: string,
  configIndex: number,
  parentPath?: string,
): string | null {
  const rootNode = state.treeNodes[configIndex];
  if (!rootNode) return null;
  const normalizedLookupKey = buildDatasourceLookupKey(dsName, parentPath);
  const byPath = findNodeByMatch(
    rootNode,
    n => n.type === 'datasource'
      && buildDatasourceLookupKey(n.name, n.data?.parentPath) === normalizedLookupKey,
  );
  if (byPath || parentPath) return byPath?.id ?? null;
  // Callers that only know a name (the drill-down graph) still have to land
  // on a calculated field nested under a model record.
  return findNodeByMatch(
    rootNode,
    n => n.type === 'datasource' && !n.data?.implicit && buildDatasourceLookupKey(n.name) === normalizedLookupKey,
  )?.id ?? null;
}

/** Tree node of the binding for `modelPath` in configuration `configIndex`. */
export function findBindingNode(
  state: Pick<WorkspaceTrees, 'treeNodes'>,
  modelPath: string,
  configIndex: number,
): string | null {
  const rootNode = state.treeNodes[configIndex];
  if (!rootNode) return null;
  return findNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === modelPath)?.id ?? null;
}

/**
 * Resolve the datasource an expression names, searching `fromConfigIndex`
 * first and then every other loaded configuration.
 */
export function resolveDatasource(
  state: WorkspaceTrees,
  expressionOrName: string,
  fromConfigIndex: number,
  scopeConfigIndex?: number | null,
): ResolvedDatasource | null {
  // Walk the whole dotted path, not just its first segment: for
  // "Parameters.'$ReferenceNumber'" the interesting datasource is the user
  // parameter at the end, not the container it sits in. Callers that pass a
  // single name are unaffected — the walk simply has nothing to descend into.
  const segments = parseDottedPath(expressionOrName)
    .map(seg => seg.replace(/['"]/g, '').trim())
    .filter(Boolean);
  const dsName = segments[0];
  if (!dsName) return null;

  const searchOrder = [fromConfigIndex, ...state.configurations.map((_, i) => i).filter(i => i !== fromConfigIndex)];
  const preferredDescriptors = getPreferredDescriptors(state.configurations, fromConfigIndex, scopeConfigIndex);

  for (const ci of searchOrder) {
    const config = state.configurations[ci];
    if (!config) continue;

    for (const datasources of getDatasourcePoolsForConfig(config, preferredDescriptors)) {
      const root = findDatasourceByName(datasources, dsName);
      if (!root) continue;

      // Descend as far as the path actually matches; a partial match still
      // returns the deepest node reached, which beats returning nothing.
      let node = root;
      let current = root;
      for (let i = 1; i < segments.length; i++) {
        const want = segments[i].toLowerCase();
        const child = (current.children ?? []).find(
          (c: any) => typeof c?.name === 'string' && c.name.replace(/['"]/g, '').toLowerCase() === want,
        );
        if (!child) break;
        current = child;
        // `model.InvoiceLines.Amount` walks through the implicit record but
        // names a model field — the datasource is still `model`.
        if (!child.implicit) node = child;
      }

      const treeNodeId = findDatasourceNode(state, node.name, ci, node.parentPath);
      return { configIndex: ci, datasourceName: node.name, treeNodeId, datasource: node };
    }
  }

  return null;
}

/** The mapping binding for `modelPath`, searching `fromConfigIndex` first. */
export function resolveBinding(
  state: WorkspaceTrees,
  modelPath: string,
  fromConfigIndex: number,
): ResolvedBinding | null {
  const searchOrder = [fromConfigIndex, ...state.configurations.map((_, i) => i).filter(i => i !== fromConfigIndex)];
  const preferredDescriptors = getPreferredDescriptors(state.configurations, fromConfigIndex);

  for (const ci of searchOrder) {
    const config = state.configurations[ci];
    if (!config) continue;

    for (const source of getMappingSourcesForConfig(config, ci, preferredDescriptors)) {
      const binding = source.mapping.bindings.find((b: any) => b.path === modelPath);
      if (binding) {
        const treeNodeId = findBindingNode(state, modelPath, ci);
        return { configIndex: ci, treeNodeId, binding };
      }
    }
  }

  return null;
}

/**
 * Resolve a model path (e.g. "model.CompanyInformation.Name") through the
 * model mappings to its binding and the datasource that binding reads.
 */
export function resolveModelPath(
  state: WorkspaceTrees,
  modelDotPath: string,
  fromConfigIndex?: number | null,
): ResolvedModelPath | null {
  let path = modelDotPath;
  if (path.toLowerCase().startsWith('model.')) path = path.substring(6);
  else if (path.toLowerCase().startsWith('model\\')) path = path.substring(6);

  const normPath = path.replace(/\\/g, '.');
  const segments = parseDottedPath(normPath).filter(Boolean);
  const buildVariants = (segs: string[]) => [
    segs.join('\\'),
    segs.join('.'),
    segs.join('/'),
  ];

  const pathVariants: string[] = [];
  const segmentCandidates: string[][] = [];
  const seenSegmentCandidates = new Set<string>();

  // Primary candidate: full path from the first segment.
  // Fallback candidates: shifted paths without wrapper roots such as "Invoice.".
  for (let start = 0; start < segments.length; start++) {
    const candidate = segments.slice(start);
    if (candidate.length === 0) continue;
    const candidateKey = candidate.join('\u0001').toLowerCase();
    if (seenSegmentCandidates.has(candidateKey)) continue;
    seenSegmentCandidates.add(candidateKey);
    segmentCandidates.push(candidate);
  }

  for (const candidate of segmentCandidates) {
    for (let len = candidate.length; len >= 1; len--) {
      const segs = candidate.slice(0, len);
      for (const v of buildVariants(segs)) {
        if (!pathVariants.includes(v)) pathVariants.push(v);
      }
    }
  }

  for (const source of getMappingSourcesInScope(state.configurations, fromConfigIndex)) {
    const bindings = source.mapping.bindings as any[];

    const materializeBindingResolution = (binding: any) => {
      const bindingTreeNodeId = findBindingNode(state, binding.path, source.configIndex);
      const dsName = binding.expressionAsString.split(/[.(]/)[0].replace(/['"]/g, '').trim();
      let datasource: any = null;
      let datasourceConfigIndex: number | null = null;
      let datasourceTreeNodeId: string | null = null;
      if (dsName) {
        const dsResult = resolveDatasource(state, dsName, source.configIndex);
        if (dsResult) {
          datasource = dsResult.datasource;
          datasourceConfigIndex = dsResult.configIndex;
          datasourceTreeNodeId = dsResult.treeNodeId;
        }
      }

      // Do not auto-pick the "first resolvable" datasource from expression references.
      // If the binding root is not directly mapped to a datasource identifier,
      // keep datasource empty so unmapped nodes are surfaced correctly.

      return {
        modelPath: binding.path,
        binding,
        bindingConfigIndex: source.configIndex,
        bindingTreeNodeId,
        datasource,
        datasourceConfigIndex,
        datasourceTreeNodeId,
        definitionLabel: mappingDefinitionLabel(source.mapping),
      };
    };

    for (const tryPath of pathVariants) {
      const binding = bindings.find((b: any) =>
        b.path === tryPath || b.path.toLowerCase() === tryPath.toLowerCase()
      );
      if (binding) return materializeBindingResolution(binding);
    }
  }
  return null;
}

/**
 * Bindings that live *under* a model path — what fills a container that
 * carries no binding of its own.
 */
export function findModelPathBindings(
  state: Pick<WorkspaceTrees, 'configurations'>,
  modelDotPath: string,
  fromConfigIndex?: number | null,
): ModelPathBinding[] {
  let path = modelDotPath;
  if (path.toLowerCase().startsWith('model.') || path.toLowerCase().startsWith('model\\')) {
    path = path.substring(6);
  }
  const segments = parseDottedPath(path.replace(/\\/g, '.')).filter(Boolean);
  if (segments.length === 0) return [];

  // The same shifted-prefix fallback resolveModelPath uses: a format may
  // address the model through a wrapper root the mapping does not repeat.
  const prefixes: string[][] = [];
  for (let start = 0; start < segments.length; start++) {
    const candidate = segments.slice(start);
    if (candidate.length > 0) prefixes.push(candidate);
  }

  const out: ModelPathBinding[] = [];
  const seen = new Set<string>();

  for (const prefix of prefixes) {
    const needle = prefix.join('.').toLowerCase();
    for (const source of getMappingSourcesInScope(state.configurations, fromConfigIndex)) {
      for (const binding of source.mapping.bindings as any[]) {
        const normalized = String(binding.path ?? '').replace(/[\\/]/g, '.');
        const lower = normalized.toLowerCase();
        if (!lower.startsWith(`${needle}.`)) continue;
        const expression = String(binding.expressionAsString ?? '').trim();
        if (!expression) continue;
        const key = `${source.configIndex}::${lower}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          path: normalized,
          relativePath: normalized.slice(needle.length + 1),
          expressionAsString: expression,
          configIndex: source.configIndex,
          definitionLabel: mappingDefinitionLabel(source.mapping),
        });
      }
    }
    // The longest matching prefix wins — no need to try shorter roots.
    if (out.length > 0) break;
  }

  return out;
}
