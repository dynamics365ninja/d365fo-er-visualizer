/**
 * Where-used search: which mappings and formats reference a table, enum,
 * class or datasource name, structurally or as text inside expressions.
 */
import type { ERFormatContent } from '@er-visualizer/core';
import { t } from '../i18n';
import { mappingDefinitionLabel } from '../utils/model-hierarchy';
import {
  getAllFormatDescriptorNames,
  getMappingSourcesForConfig,
  getScopedMappingDefinitions,
} from './mapping-definitions';
import {
  buildDatasourceLookupKey,
  extractExpressionReferences,
  normalizeIdentifier,
  parseDottedPath,
  toModelRootedPath,
} from './expression-resolution';
import { findNodeByMatch, type TreeNode, type WorkspaceTrees } from './tree-builder';

// ─── Where-Used types ───

export interface WhereUsedEntry {
  /** The matched entity name (table, enum, class) */
  entityName: string;
  entityType: 'Table' | 'Enum' | 'Class' | 'CalculatedField' | 'GroupBy' | 'Join' | 'Container' | 'Object' | 'UserParameter' | 'TextMatch' | 'Other';
  /** The datasource in a mapping or format that references the entity */
  datasource: {
    name: string;
    parentPath?: string;
    configIndex: number;
    configName: string;
    kind: 'ModelMapping' | 'Format';
  };
  /** Model binding paths that reach the datasource (from a ModelMapping config) */
  modelPaths: Array<{
    path: string;
    expr: string;
    configIndex: number;
    configName: string;
    /** Mapping definition (`Name [DataContainerDescriptor]`) the hit sits in. */
    definition?: string;
    /** Optional pre-resolved tree node id for direct click-through navigation. */
    treeNodeId?: string;
    /** Optional short label shown in place of the binding kind chip (e.g. "calc", "validation"). */
    kindLabel?: string;
  }>;
  /** Format elements (in Format configs) that use those model paths or the datasource directly */
  formatUsages: Array<{
    elementId: string;
    elementName: string;
    elementType: string;
    /** Full breadcrumb path of ancestor element names ending with the element itself */
    elementPath: string[];
    expression: string;
    configIndex: number;
    configName: string;
  }>;
}

interface EntityMatchResult {
  matched: boolean;
  entityType: WhereUsedEntry['entityType'];
  entityName: string;
  score: 0 | 1 | 2 | 3;
}

/**
 * Where-used: find all occurrences of a table / enum / class name across all loaded configs.
 * Returns a flat list of trace links from the entity → datasource → model binding → format element.
 */
export function findWhereUsed(state: WorkspaceTrees, entityName: string): WhereUsedEntry[] {
  if (!entityName.trim()) return [];
  const normalizedEntityName = normalizeIdentifier(entityName);
  const scoredResults: Array<{ score: number; entry: WhereUsedEntry }> = [];

  // Collect all flat datasources (including children) that match
  function collectMatchingDs(datasources: any[]): Array<{ ds: any; match: EntityMatchResult }> {
    const out: Array<{ ds: any; match: any }> = [];
    for (const ds of datasources) {
      // Implicit path nodes only hold the path; what they read is below them.
      const r = ds.implicit ? null : getEntityMatch(ds, normalizedEntityName);
      if (r?.matched) out.push({ ds, match: r });
      if (ds.children?.length) {
        out.push(...collectMatchingDs(ds.children));
      }
    }
    return out;
  }

  const preferredDescriptors = getAllFormatDescriptorNames(state.configurations);
  for (let ci = 0; ci < state.configurations.length; ci++) {
    const config = state.configurations[ci];
    const configName = config.solutionVersion.solution.name;

    for (const source of getMappingSourcesForConfig(config, ci, preferredDescriptors)) {
      const mm = source.mapping;
      const matchingDs = collectMatchingDs(mm.datasources);

      for (const { ds, match } of matchingDs) {
        const relatedBindings = mm.bindings.filter((b: any) =>
          expressionReferencesDatasource(b.expressionAsString, ds),
        );

        const modelPaths = relatedBindings.map((b: any) => ({
          path: b.path,
          expr: b.expressionAsString,
          configIndex: ci,
          configName: source.configName,
          definition: mappingDefinitionLabel(mm),
        }));

        const formatUsages: WhereUsedEntry['formatUsages'] = [];
        for (let fci = 0; fci < state.configurations.length; fci++) {
          const fc = state.configurations[fci];
          if (fc.content.kind !== 'Format') continue;
          const fc2 = fc.content as ERFormatContent;
          const fmtMap = fc2.formatMappingVersion.formatMapping;
          const fmtConfigName = fc.solutionVersion.solution.name;

          const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
          function indexElements(el: any, parentPath: string[]) {
            const here = [...parentPath, el.name];
            elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
            for (const child of el.children ?? []) indexElements(child, here);
          }
          indexElements(fc2.formatVersion.format.rootElement, []);

          for (const b of fmtMap.bindings) {
            const expr = b.expressionAsString ?? '';
            // The format's model datasource can be named anything (`Invoice`
            // in the PEPPOL formats), not only `model`.
            const rooted = toModelRootedPath(expr, state.configurations, fci);
            if (rooted) {
              const modelPath = normalizeModelPath(rooted.modelExpression.slice('model.'.length));
              const matchesPath = modelPaths.some((mp: { path: string }) =>
                isSameOrDescendantModelPath(modelPath, mp.path),
              );
              if (matchesPath) {
                const el = elementNames.get(b.componentId);
                formatUsages.push({
                  elementId: b.componentId,
                  elementName: el?.name ?? b.componentId.slice(1, 9),
                  elementType: el?.type ?? 'Unknown',
                  elementPath: el?.path ?? [],
                  expression: expr,
                  configIndex: fci,
                  configName: fmtConfigName,
                });
              }
            } else if (expressionReferencesDatasource(expr, ds)) {
              const el = elementNames.get(b.componentId);
              formatUsages.push({
                elementId: b.componentId,
                elementName: el?.name ?? b.componentId.slice(1, 9),
                elementType: el?.type ?? 'Unknown',
                elementPath: el?.path ?? [],
                expression: expr,
                configIndex: fci,
                configName: fmtConfigName,
              });
            }
          }
        }

        const seenFmt = new Set<string>();
        const uniqueFormatUsages = formatUsages.filter(u => {
          const k = `${u.elementId}:${u.expression}`;
          if (seenFmt.has(k)) return false;
          seenFmt.add(k);
          return true;
        });

        // Skip datasources that have no bindings or format usages — they would
        // render as an empty "Find References" card and only confuse the user.
        if (modelPaths.length === 0 && uniqueFormatUsages.length === 0) continue;

        scoredResults.push({
          score: match.score,
          entry: {
            entityName: match.entityName,
            entityType: match.entityType,
            datasource: {
              name: ds.name,
              parentPath: ds.parentPath,
              configIndex: ci,
              configName: source.configName,
              kind: 'ModelMapping',
            },
            modelPaths,
            formatUsages: uniqueFormatUsages,
          },
        });
      }
    }

    if (config.content.kind === 'Format') {
      const fc = config.content as ERFormatContent;
      const fmtMap = fc.formatMappingVersion.formatMapping;
      const matchingDs = collectMatchingDs(fmtMap.datasources);

      for (const { ds, match } of matchingDs) {
        // Build element name lookup
        const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
        function indexElsFmt(el: any, parentPath: string[]) {
          const here = [...parentPath, el.name];
          elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
          for (const child of el.children ?? []) indexElsFmt(child, here);
        }
        indexElsFmt(fc.formatVersion.format.rootElement, []);

        // Find format bindings that reference this datasource
        const formatUsages: WhereUsedEntry['formatUsages'] = [];
        for (const b of fmtMap.bindings) {
          const expr = b.expressionAsString ?? '';
          if (expressionReferencesDatasource(expr, ds)) {
            const el = elementNames.get(b.componentId);
            formatUsages.push({
              elementId: b.componentId,
              elementName: el?.name ?? b.componentId.slice(1, 9),
              elementType: el?.type ?? 'Unknown',
              elementPath: el?.path ?? [],
              expression: expr,
              configIndex: ci,
              configName: configName,
            });
          }
        }

        if (formatUsages.length > 0) {
          scoredResults.push({
            score: match.score,
            entry: {
              entityName: match.entityName,
              entityType: match.entityType,
              datasource: {
                name: ds.name,
                parentPath: ds.parentPath,
                configIndex: ci,
                configName,
                kind: 'Format',
              },
              modelPaths: [],
              formatUsages,
            },
          });
        }
      }
    }
  }

  // ── Text-reference fallback ──
  // Scan every binding/format expression for the raw query as a case-insensitive
  // identifier (word boundary). This catches table/field/variable names that are
  // used only inside expressions (WHERE(...), IF(...), relations, etc.) and do not
  // correspond to a structural datasource match.
  const textRefEntry = collectExpressionTextMatches(state, entityName);

  if (scoredResults.length === 0 && !textRefEntry) return [];

  const highestScore = scoredResults.length > 0
    ? Math.max(...scoredResults.map(result => result.score))
    : 0;
  const results = scoredResults
    .filter(result => result.score === highestScore)
    .map(result => result.entry);

  const seen = new Set<string>();
  const structural = results.filter(r => {
    const modelPathKey = r.modelPaths.map(mp => `${mp.configIndex}:${normalizeModelPath(mp.path)}`).sort().join('|');
    const formatKey = r.formatUsages.map(u => `${u.configIndex}:${u.elementId}:${u.expression}`).sort().join('|');
    const k = `${r.datasource.configIndex}:${buildDatasourceLookupKey(r.datasource.name, r.datasource.parentPath)}:${r.entityType}:${r.entityName}:${modelPathKey}:${formatKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((left, right) => {
    const byEntity = left.entityName.localeCompare(right.entityName, undefined, { sensitivity: 'base' });
    if (byEntity !== 0) return byEntity;
    return left.datasource.name.localeCompare(right.datasource.name, undefined, { sensitivity: 'base' });
  });

  if (textRefEntry) {
    // Dedupe text matches that are already surfaced by a structural match for
    // the same binding/element, to avoid showing the same reference twice.
    const structuralBindingKeys = new Set<string>();
    const structuralFormatKeys = new Set<string>();
    for (const r of structural) {
      for (const mp of r.modelPaths) {
        structuralBindingKeys.add(`${mp.configIndex}:${normalizeModelPath(mp.path)}:${mp.expr}`);
      }
      for (const u of r.formatUsages) {
        structuralFormatKeys.add(`${u.configIndex}:${u.elementId}:${u.expression}`);
      }
    }
    const dedupedModelPaths = textRefEntry.modelPaths.filter(mp =>
      !structuralBindingKeys.has(`${mp.configIndex}:${normalizeModelPath(mp.path)}:${mp.expr}`),
    );
    const dedupedFormatUsages = textRefEntry.formatUsages.filter(u =>
      !structuralFormatKeys.has(`${u.configIndex}:${u.elementId}:${u.expression}`),
    );
    if (dedupedModelPaths.length > 0 || dedupedFormatUsages.length > 0) {
      structural.push({
        ...textRefEntry,
        modelPaths: dedupedModelPaths,
        formatUsages: dedupedFormatUsages,
      });
    }
  }

  return structural;
}

// ─── Helper: scan every binding/format expression for a raw text occurrence of a query ───

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectExpressionTextMatches(state: WorkspaceTrees, query: string): WhereUsedEntry | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // Word-boundary, case-insensitive match. Works for identifiers like table/field names.
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i');

  const modelPaths: WhereUsedEntry['modelPaths'] = [];
  const formatUsages: WhereUsedEntry['formatUsages'] = [];

  for (let ci = 0; ci < state.configurations.length; ci++) {
    const config = state.configurations[ci];
    const configName = config.solutionVersion.solution.name;

    if (config.content.kind === 'ModelMapping') {
      // Active definition first: the same binding is usually mapped in every
      // definition of the solution, and the hit belongs to the one the loaded
      // format actually goes through — not to whichever comes first in the file.
      const perDefinition: WhereUsedEntry['modelPaths'] = [];
      for (const mm of getScopedMappingDefinitions(state.configurations, ci)) {
        const definition = mappingDefinitionLabel(mm);
        const firstPushed = perDefinition.length;
        for (const b of mm.bindings ?? []) {
          const expr = b.expressionAsString ?? '';
          if (expr && re.test(expr)) {
            perDefinition.push({
              path: b.path,
              expr,
              configIndex: ci,
              configName,
            });
          }
        }
        // Datasource-level expressions (calc fields, user params, groupBy aggregations)
        scanDatasourceExpressions(mm.datasources ?? [], re, ci, configName, state, perDefinition, definition);
        // Validations
        scanValidations(mm.validations ?? [], re, ci, configName, perDefinition);
        // Stamped in one pass so the scanners stay unaware of definitions.
        for (let i = firstPushed; i < perDefinition.length; i++) perDefinition[i].definition = definition;
      }
      modelPaths.push(...dedupeAcrossDefinitions(perDefinition));
    } else if (config.content.kind === 'Format') {
      const fc = config.content as ERFormatContent;
      const fmtMap = fc.formatMappingVersion.formatMapping;
      const elementNames = new Map<string, { name: string; type: string; path: string[] }>();
      function indexEls(el: any, parentPath: string[]) {
        const here = [...parentPath, el.name];
        elementNames.set(el.id, { name: el.name, type: el.elementType, path: here });
        for (const child of el.children ?? []) indexEls(child, here);
      }
      indexEls(fc.formatVersion.format.rootElement, []);
      for (const b of fmtMap.bindings ?? []) {
        const expr = b.expressionAsString ?? '';
        if (expr && re.test(expr)) {
          const el = elementNames.get(b.componentId);
          formatUsages.push({
            elementId: b.componentId,
            elementName: el?.name ?? b.componentId.slice(1, 9),
            elementType: el?.type ?? 'Unknown',
            elementPath: el?.path ?? [],
            expression: expr,
            configIndex: ci,
            configName,
          });
        }
      }
      // Format-level datasource expressions
      scanDatasourceExpressions(fmtMap.datasources ?? [], re, ci, configName, state, modelPaths);
      // Embedded model mappings inside format configs — same active-first rule.
      const perDefinition: WhereUsedEntry['modelPaths'] = [];
      for (const mapping of getScopedMappingDefinitions(state.configurations, ci)) {
        const definition = mappingDefinitionLabel(mapping);
        const firstPushed = perDefinition.length;
        for (const b of mapping.bindings ?? []) {
          const expr = b.expressionAsString ?? '';
          if (expr && re.test(expr)) {
            perDefinition.push({
              path: b.path,
              expr,
              configIndex: ci,
              configName,
            });
          }
        }
        scanDatasourceExpressions(mapping.datasources ?? [], re, ci, configName, state, perDefinition, definition);
        scanValidations(mapping.validations ?? [], re, ci, configName, perDefinition);
        for (let i = firstPushed; i < perDefinition.length; i++) perDefinition[i].definition = definition;
      }
      modelPaths.push(...dedupeAcrossDefinitions(perDefinition));
    }
  }

  if (modelPaths.length === 0 && formatUsages.length === 0) return null;

  return {
    entityName: trimmed,
    entityType: 'TextMatch',
    datasource: {
      name: t.whereUsedTextMatchName(trimmed),
      configIndex: 0,
      configName: '',
      kind: 'ModelMapping',
    },
    modelPaths,
    formatUsages,
  };
}

/**
 * Collapse hits that the definitions of one solution share.
 *
 * A model-mapping solution maps the same binding in every definition
 * (SalesInvoice, InvoiceCustomer, TMSCommercialInvoice, …), so an unfiltered
 * scan reports the same line six times. The input arrives with the active
 * definition first, so keeping the first occurrence reports the hit against
 * the definition the loaded format actually goes through; hits that only exist
 * in one definition are untouched.
 */
function dedupeAcrossDefinitions(hits: WhereUsedEntry['modelPaths']): WhereUsedEntry['modelPaths'] {
  const seen = new Set<string>();
  return hits.filter(hit => {
    const key = `${hit.path}|${hit.expr}|${hit.kindLabel ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Walk every datasource (recursively through children) and collect text matches
 * for calculated fields, user-parameter expressions, and groupBy aggregations.
 */
function scanDatasourceExpressions(
  datasources: any[],
  re: RegExp,
  configIndex: number,
  configName: string,
  state: WorkspaceTrees,
  out: WhereUsedEntry['modelPaths'],
  /** Mapping definition being scanned, so navigation lands in the right one. */
  definition?: string,
): void {
  const rootNode = state.treeNodes[configIndex];
  const locate = (dsName: string, parentPath?: string): string | undefined => {
    if (!rootNode) return undefined;
    const key = buildDatasourceLookupKey(dsName, parentPath);
    const matches = (n: TreeNode) => n.type === 'datasource'
      && buildDatasourceLookupKey(n.name, n.data?.parentPath) === key;
    // Definitions reuse datasource names, so the plain first match routinely
    // belongs to a different model root than the hit does.
    const node = (definition
      ? findNodeByMatch(rootNode, n => matches(n) && n.mappingDefinition === definition)
      : null) ?? findNodeByMatch(rootNode, matches);
    return node?.id;
  };

  function visit(ds: any) {
    // Calculated field expression
    const calcExpr = ds.calculatedField?.expressionAsString;
    if (calcExpr && re.test(calcExpr)) {
      out.push({
        path: ds.name,
        expr: calcExpr,
        configIndex,
        configName,
        treeNodeId: locate(ds.name, ds.parentPath),
        kindLabel: 'calc',
      });
    }
    // User-parameter expression
    const userExpr = ds.userParamInfo?.expressionAsString;
    if (userExpr && re.test(userExpr)) {
      out.push({
        path: ds.name,
        expr: userExpr,
        configIndex,
        configName,
        treeNodeId: locate(ds.name, ds.parentPath),
        kindLabel: 'param',
      });
    }
    // GroupBy aggregation functions (expression-like) — rarely but possible
    if (ds.groupByInfo) {
      for (const agg of ds.groupByInfo.aggregations ?? []) {
        const aggText = `${agg.function}(${agg.path})`;
        if (agg.path && re.test(agg.path)) {
          out.push({
            path: `${ds.name}/${agg.name}`,
            expr: aggText,
            configIndex,
            configName,
            treeNodeId: locate(ds.name, ds.parentPath),
            kindLabel: 'agg',
          });
        }
      }
    }
    for (const child of ds.children ?? []) visit(child);
  }

  for (const ds of datasources) visit(ds);
}

/** Scan mapping-level validation expressions for text matches. */
function scanValidations(
  validations: any[],
  re: RegExp,
  configIndex: number,
  configName: string,
  out: WhereUsedEntry['modelPaths'],
): void {
  for (const v of validations) {
    for (const rule of v.conditions ?? []) {
      const cond = rule.conditionExpressionAsString ?? '';
      const msg = rule.messageExpressionAsString ?? '';
      if (cond && re.test(cond)) {
        out.push({
          path: v.path || rule.id || 'validation',
          expr: cond,
          configIndex,
          configName,
          kindLabel: 'validation',
        });
      }
      if (msg && re.test(msg)) {
        out.push({
          path: v.path || rule.id || 'validation',
          expr: msg,
          configIndex,
          configName,
          kindLabel: 'message',
        });
      }
    }
  }
}

function normalizeModelPath(path: string): string {
  return path
    .replace(/^model[./\\]/i, '')
    .replace(/[./]/g, '\\')
    .replace(/\\+/g, '\\')
    .replace(/^\\|\\$/g, '')
    .toLowerCase();
}

function isSameOrDescendantModelPath(candidate: string, basePath: string): boolean {
  const normalizedCandidate = normalizeModelPath(candidate);
  const normalizedBase = normalizeModelPath(basePath);
  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}\\`);
}

function getEntityMatch(ds: any, normalizedQuery: string): EntityMatchResult {
  const candidates: Array<{ entityType: WhereUsedEntry['entityType']; entityName?: string }> = [
    { entityType: 'Table', entityName: ds.tableInfo?.tableName },
    { entityType: 'Enum', entityName: ds.enumInfo?.enumName },
    { entityType: 'Class', entityName: ds.classInfo?.className },
    { entityType: 'UserParameter', entityName: ds.userParamInfo?.extendedDataTypeName },
  ];

  if (ds.name) {
    const datasourceType = mapDatasourceTypeToWhereUsedType(ds.type);
    if (datasourceType) {
      candidates.push({ entityType: datasourceType, entityName: ds.name });
    }
  }

  let bestMatch: EntityMatchResult = {
    matched: false,
    entityType: 'Other',
    entityName: normalizedQuery,
    score: 0,
  };

  for (const candidate of candidates) {
    const entityName = candidate.entityName;
    if (!entityName) continue;

    const normalizedEntity = normalizeIdentifier(entityName);
    const score = getMatchScore(normalizedEntity, normalizedQuery);
    if (score > bestMatch.score) {
      bestMatch = {
        matched: score > 0,
        entityType: candidate.entityType,
        entityName,
        score,
      };
    }
  }

  return bestMatch;
}

function mapDatasourceTypeToWhereUsedType(dsType?: string): WhereUsedEntry['entityType'] | null {
  switch (dsType) {
    case 'CalculatedField':
      return 'CalculatedField';
    case 'GroupBy':
      return 'GroupBy';
    case 'Join':
      return 'Join';
    case 'Container':
      return 'Container';
    case 'Object':
      return 'Object';
    case 'UserParameter':
      return 'UserParameter';
    default:
      return null;
  }
}

function getMatchScore(candidate: string, query: string): 0 | 1 | 2 | 3 {
  if (!candidate || !query) return 0;
  if (candidate === query) return 3;
  if (candidate.startsWith(query)) return 2;
  if (candidate.includes(query)) return 1;
  return 0;
}

function expressionReferencesDatasource(expression: string, ds: any): boolean {
  if (!expression) return false;

  const datasourcePathSegments = buildDatasourcePathSegments(ds);
  const normalizedRootNames = new Set<string>([
    normalizeIdentifier(ds.name),
    normalizeIdentifier(ds.name.replace(/^[$#]/, '')),
  ]);

  for (const reference of extractExpressionReferences(expression)) {
    const segments = parseDottedPath(reference).map(segment => normalizeIdentifier(segment.replace(/^[$#]/, '')));
    const rootSegment = segments[0];
    if (!rootSegment) continue;

    if (matchesDatasourcePath(segments, datasourcePathSegments) || normalizedRootNames.has(rootSegment)) {
      return true;
    }
  }

  return false;
}

function buildDatasourcePathSegments(ds: any): string[] {
  const segments: string[] = [];
  if (typeof ds.parentPath === 'string' && ds.parentPath.trim()) {
    segments.push(
      ...ds.parentPath
        .split('/')
        .map((segment: string) => normalizeIdentifier(segment.replace(/^[$#]/, '')))
        .filter(Boolean),
    );
  }

  segments.push(normalizeIdentifier(String(ds.name ?? '').replace(/^[$#]/, '')));
  return segments.filter(Boolean);
}

function matchesDatasourcePath(referenceSegments: string[], datasourceSegments: string[]): boolean {
  if (referenceSegments.length < datasourceSegments.length || datasourceSegments.length === 0) {
    return false;
  }

  return datasourceSegments.every((segment, index) => referenceSegments[index] === segment);
}
