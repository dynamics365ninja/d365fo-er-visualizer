import type {
  ERDatasource,
  ERDatasourceType,
  EREnumDatasource,
} from '../types/mapping.js';
import { getAttr, getContentsArray } from './xml-document.js';
import type { XmlNode } from './xml-document.js';
import { parseExpression } from './expressions.js';
import { pushParseWarning } from './warnings.js';

// ─── Datasources ───

export function parseDatasources(defNode: XmlNode | undefined): ERDatasource[] {
  if (!defNode) return [];
  const items = getContentsArray(defNode, 'ERModelItemDefinition');
  const flat = items.map(parseDatasourceItem);

  // Build parent-child tree using normalized paths so XML ordering does not matter.
  const roots: ERDatasource[] = [];

  // ER names are case-insensitive, so the lookup key is too.
  const pathMap = new Map<string, ERDatasource>();
  for (const ds of flat) {
    pathMap.set(buildDatasourcePath(ds.parentPath, ds.name).toLowerCase(), ds);
  }

  // A ParentPath routinely runs through nodes the definition never declares:
  // the records of the data model (`model/InvoiceLines/LineBase`) or the
  // `Values` of a calculated record list. Each such segment gets an implicit
  // node. Lifting the datasource to the root instead loses its parent — the
  // only thing telling two same-named calculated fields apart.
  const ensureParent = (parentPath: string): ERDatasource => {
    const segments = parentPath.split('/').map(segment => segment.trim()).filter(Boolean);
    let parent: ERDatasource | null = null;
    for (let i = 0; i < segments.length; i++) {
      const key = normalizeDatasourcePath(segments.slice(0, i + 1).join('/')).toLowerCase();
      let node = pathMap.get(key);
      if (!node) {
        node = {
          name: segments[i],
          parentPath: i > 0 ? segments.slice(0, i).join('/') : undefined,
          type: 'Container',
          implicit: true,
          children: [],
        };
        pathMap.set(key, node);
        (parent ? parent.children : roots).push(node);
      }
      parent = node;
    }
    return parent!;
  };

  for (const ds of flat) {
    if (!normalizeDatasourcePath(ds.parentPath)) {
      roots.push(ds);
    } else {
      ensureParent(ds.parentPath!).children.push(ds);
    }
  }

  // Post-pass: any DS still Unknown but with children → Container
  function fixUnknownTypes(ds: ERDatasource) {
    if (ds.type === 'Unknown' && ds.children.length > 0) ds.type = 'Container';
    for (const child of ds.children) fixUnknownTypes(child);
  }
  for (const ds of roots) fixUnknownTypes(ds);

  function enrichGroupByInfo(ds: ERDatasource) {
    if (ds.groupByInfo) {
      const datasourcePath = buildDatasourcePath(ds.parentPath, ds.name).toLowerCase();
      const descendants = flattenDatasourceDescendants(ds);
      const groupedFields = descendants.filter(child =>
        isGroupByMember(child, datasourcePath, 'groupbyfields'),
      );
      const aggregatedFields = descendants.filter(child =>
        isGroupByMember(child, datasourcePath, 'aggregated'),
      );

      ds.groupByInfo.groupedFields = mergeGroupByFields(
        ds.groupByInfo.groupedFields,
        groupedFields.map(child => ({
          name: child.name,
          path: buildDatasourcePath(child.parentPath, child.name),
        })),
      );
      ds.groupByInfo.aggregations = mergeAggregations(
        ds.groupByInfo.aggregations,
        aggregatedFields.map(child => ({
          name: child.name,
          path: buildDatasourcePath(child.parentPath, child.name),
          function: inferAggregationFunction(child),
        })),
      );
    }

    for (const child of ds.children) enrichGroupByInfo(child);
  }
  for (const ds of roots) enrichGroupByInfo(ds);

  return roots;
}

function mergeGroupByFields(existing: Array<{ name: string; path: string }>, incoming: Array<{ name: string; path: string }>): Array<{ name: string; path: string }> {
  const merged = new Map<string, { name: string; path: string }>();

  for (const field of [...existing, ...incoming]) {
    if (!field.path) continue;
    merged.set(field.path.toLowerCase(), field);
  }

  return Array.from(merged.values());
}

function mergeAggregations(existing: Array<{ name: string; path: string; function: string }>, incoming: Array<{ name: string; path: string; function: string }>): Array<{ name: string; path: string; function: string }> {
  const merged = new Map<string, { name: string; path: string; function: string }>();

  for (const aggregation of [...existing, ...incoming]) {
    if (!aggregation.path) continue;
    const key = aggregation.path.toLowerCase();
    const current = merged.get(key);
    merged.set(key, current && current.function && !aggregation.function ? current : aggregation);
  }

  return Array.from(merged.values());
}

function flattenDatasourceDescendants(datasource: ERDatasource): ERDatasource[] {
  const result: ERDatasource[] = [];

  for (const child of datasource.children) {
    result.push(child);
    result.push(...flattenDatasourceDescendants(child));
  }

  return result;
}

const groupedFieldSectionAliases = new Set(['groupbyfields', 'grouped', 'groupedfields', 'groupby', 'groupfields']);
const aggregatedSectionAliases = new Set(['aggregated', 'aggregation', 'aggregations']);

function getGroupBySectionKind(pathSegment: string | undefined): 'groupedFields' | 'aggregations' | null {
  const normalizedSegment = (pathSegment ?? '').trim().toLowerCase().replace(/^[$#]/, '');
  if (groupedFieldSectionAliases.has(normalizedSegment)) return 'groupedFields';
  if (aggregatedSectionAliases.has(normalizedSegment)) return 'aggregations';
  return null;
}

function isGroupByMember(datasource: ERDatasource, groupByPath: string, sectionName: 'groupbyfields' | 'aggregated'): boolean {
  const fullPath = buildDatasourcePath(datasource.parentPath, datasource.name);
  const normalizedFullPath = fullPath.toLowerCase();
  const normalizedGroupByPath = groupByPath.toLowerCase();

  if (!normalizedFullPath.startsWith(`${normalizedGroupByPath}/`)) return false;

  const relativePath = normalizedFullPath.slice(normalizedGroupByPath.length + 1);
  const relativeSegments = relativePath.split('/').filter(Boolean);
  const relativeSection = getGroupBySectionKind(relativeSegments[0]);
  const expectedSection = sectionName === 'groupbyfields' ? 'groupedFields' : 'aggregations';

  if (relativeSection !== expectedSection) return false;
  if (relativeSegments.length <= 1) return false;
  if (datasource.type === 'Container' && datasource.children.length > 0) return false;

  return true;
}

function inferAggregationFunction(datasource: ERDatasource): string {
  const expression = datasource.calculatedField?.expressionAsString?.trim();
  if (!expression) return '';

  const functionMatch = expression.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(/);
  return functionMatch?.[1]?.toUpperCase() ?? '';
}

function getLeafNameFromPath(path: string | undefined): string {
  if (!path) return '';
  const segments = path.split('/').map(segment => segment.trim()).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1].replace(/^[$#]/, '') : '';
}

function parseInlineGroupByFields(groupByNode: XmlNode | undefined): Array<{ name: string; path: string }> {
  const groupedFieldRefs = getContentsArray(
    groupByNode?.['GroupedFields']?.['ERModelGroupByFieldReferences'],
    'ERModelGroupByFieldReference',
  );

  return groupedFieldRefs.map((fieldRef: any) => {
    const fieldPath = getAttr(fieldRef, 'FieldPath') ?? '';
    return {
      name: getLeafNameFromPath(fieldPath),
      path: fieldPath,
    };
  }).filter(field => field.name && field.path);
}

function parseGroupBySelectionField(selectionField: string | undefined): string {
  switch (selectionField) {
    case undefined:
      return 'AVG';
    case '1':
      return 'SUM';
    case '2':
      return 'MIN';
    case '3':
      return 'MAX';
    case '4':
      return 'COUNT';
    default:
      return '';
  }
}

function parseInlineGroupByAggregations(groupByNode: XmlNode | undefined): Array<{ name: string; path: string; function: string }> {
  const aggregationDefs = getContentsArray(
    groupByNode?.['Aggregations']?.['ERModelGroupByAggregations'],
    'ERModelGroupByAggregation',
  );

  return aggregationDefs.map((aggregation: any) => {
    const fieldPath = getAttr(aggregation, 'FieldPath') ?? '';
    return {
      name: getAttr(aggregation, 'Name') ?? getLeafNameFromPath(fieldPath),
      path: fieldPath,
      function: parseGroupBySelectionField(getAttr(aggregation, 'SelectionField')),
    };
  }).filter(field => field.name && field.path);
}

function normalizeDatasourcePath(path: string | undefined): string {
  if (!path) return '';
  return path
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    // `#` and `$` are ER name decorations, not path syntax — strip them on every
    // segment so a ParentPath ("Tables/#SourceJournalTables") matches the key
    // buildDatasourcePath() produces for that parent.
    .map(segment => segment.replace(/^[$#]/, ''))
    .join('/');
}

function buildDatasourcePath(parentPath: string | undefined, name: string): string {
  const normalizedParent = normalizeDatasourcePath(parentPath);
  const normalizedName = name.replace(/^[$#]/, '');
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

function parseDatasourceItem(node: XmlNode): ERDatasource {
  const valDef = node['ValueDefinition']?.['ERModelItemValueDefinition'];
  const name = getAttr(valDef, 'Name') ?? '';
  const label = getAttr(valDef, 'Label');
  const parentPath = getAttr(node, 'ParentPath');
  const valueSource = valDef?.['ValueSource'];

  const ds: ERDatasource = {
    name,
    parentPath,
    type: 'Unknown',
    label,
    children: [],
  };

  if (!valueSource) return ds;
  const genericEnumDatasource = parseGenericEnumDatasource(valueSource);

  // Detect datasource type from ValueSource child element
  if (valueSource['ERTableDataSource']) {
    const t = valueSource['ERTableDataSource'];
    ds.type = 'Table';
    ds.tableInfo = {
      tableName: getAttr(t, 'Table') ?? '',
      selectedFields: [],
    };
  } else if (valueSource['ERTableDataSourceHandler']) {
    const t = valueSource['ERTableDataSourceHandler'];
    const selectedItems = t['SelectedItems']?.['ERSelectedTableItems'];
    ds.type = 'Table';
    ds.tableInfo = {
      tableName: getAttr(t, 'Table') ?? '',
      isCrossCompany: getAttr(t, 'IsCrossCompany') === '1',
      selectedFields: getContentsArray(selectedItems, 'ERSelectedTableItem').map(
        (s: any) => getAttr(s, 'Path') ?? '',
      ),
    };
  } else if (valueSource['EREnumDataSourceHandler']) {
    const e = valueSource['EREnumDataSourceHandler'];
    ds.type = 'Enum';
    ds.enumInfo = {
      enumName: getAttr(e, 'EnumName') ?? '',
      isModelEnum: false,
      sourceKind: 'Ax',
    };
  } else if (valueSource['ERModelDataSourceHandler']) {
    const m = valueSource['ERModelDataSourceHandler'];
    ds.type = 'DataModel';
    ds.modelInfo = {
      dataContainerDescriptorName: getAttr(m, 'DataContainerDescriptorName') ?? '',
      modelGuid: getAttr(m, 'ModelGuid'),
      revisionNumber: getAttr(m, 'RevisionNumber'),
    };
  } else if (valueSource['ERModelEnumDataSourceHandler']) {
    const e = valueSource['ERModelEnumDataSourceHandler'];
    ds.type = 'ModelEnum';
    ds.enumInfo = {
      enumName: getAttr(e, 'ModelEnumName') ?? '',
      isModelEnum: true,
      sourceKind: 'DataModel',
      modelGuid: getAttr(e, 'ModelGuid'),
    };
  } else if (valueSource['ERImportFormatDatasource']) {
    const f = valueSource['ERImportFormatDatasource'];
    ds.type = 'ImportFormat';
    ds.importFormatInfo = {
      formatGuid: getAttr(f, 'FormatGUID') ?? getAttr(f, 'FormatGuid') ?? '',
    };
  } else if (genericEnumDatasource) {
    ds.type = genericEnumDatasource.type;
    ds.enumInfo = genericEnumDatasource.enumInfo;
  } else if (valueSource['ERClassDataSourceHandler']) {
    const c = valueSource['ERClassDataSourceHandler'];
    ds.type = 'Class';
    ds.classInfo = { className: getAttr(c, 'ClassName') ?? '' };
  } else if (valueSource['ERObjectDataSourceHandler']) {
    // D365 F&O designer distinguishes "Dynamics 365 for Operations\Object"
    // (an instance of an X++ class, wired by the caller) from "...\Class"
    // (static class members). Both carry `ClassName`; only the type differs.
    const c = valueSource['ERObjectDataSourceHandler'];
    ds.type = 'Object';
    ds.classInfo = { className: getAttr(c, 'ClassName') ?? '' };
  } else if (valueSource['ERUserParameterDataSourceHandler']) {
    const u = valueSource['ERUserParameterDataSourceHandler'];
    ds.type = 'UserParameter';
    ds.userParamInfo = {
      extendedDataTypeName: getAttr(u, 'ExtendedDataTypeName'),
      expressionAsString: getAttr(u, 'ExpressionAsString'),
    };
  } else if (valueSource['ERModelExpressionItem']) {
    const e = valueSource['ERModelExpressionItem'];
    ds.type = 'CalculatedField';
    ds.calculatedField = {
      expressionAsString: getAttr(e, 'ExpressionAsString') ?? '',
      expression: parseExpression(e['Expression']),
    };
  } else if (valueSource['ERModelGroupByFunction']) {
    const g = valueSource['ERModelGroupByFunction'];
    ds.type = 'GroupBy';
    ds.groupByInfo = {
      listToGroup: getAttr(g, 'ListToGroup') ?? '',
      groupedFields: parseInlineGroupByFields(g),
      aggregations: parseInlineGroupByAggregations(g),
    };
  } else if (valueSource['ERContainerDataSourceHandler']) {
    ds.type = 'Container';
  } else if (valueSource['ERJoinDataSourceHandler']) {
    ds.type = 'Join';
  } else if (valueSource['ERFilteredDataSourceHandler']) {
    // Filtered list — treat as container with a filter expression
    const f = valueSource['ERFilteredDataSourceHandler'];
    ds.type = 'Container';
    if (getAttr(f, 'ExpressionAsString')) {
      ds.calculatedField = {
        expressionAsString: getAttr(f, 'ExpressionAsString') ?? '',
      };
    }
  } else if (valueSource['ERLookupDataSourceHandler']) {
    ds.type = 'CalculatedField';
    const l = valueSource['ERLookupDataSourceHandler'];
    ds.calculatedField = { expressionAsString: getAttr(l, 'ExpressionAsString') ?? '' };
  } else {
    // Fallback: an unrecognised ValueSource handler. Treat it as a container so
    // the tree still renders, but record a warning so the gap is visible.
    const keys = Object.keys(valueSource).filter(k => !k.startsWith('@_'));
    if (keys.length > 0) {
      const rawKey = keys[0];
      ds.type = rawKey === 'ERModelGroupByFunction' ? 'GroupBy' : 'Container';
      pushParseWarning(
        `Unrecognised datasource handler '${rawKey}' on '${ds.name}' mapped to '${ds.type}'`,
      );
    }
  }

  return ds;
}

function parseGenericEnumDatasource(valueSource: XmlNode): { type: Extract<ERDatasourceType, 'Enum' | 'ModelEnum' | 'FormatEnum'>; enumInfo: EREnumDatasource } | null {
  const entries = Object.entries(valueSource).filter(([key]) => !key.startsWith('@_'));

  for (const [key, rawNode] of entries) {
    if (!/enum/i.test(key)) continue;

    const enumNode = Array.isArray(rawNode) ? rawNode[0] : rawNode;
    const keyLower = key.toLowerCase();
    const enumName =
      getAttr(enumNode, 'FormatEnumName') ??
      getAttr(enumNode, 'ModelEnumName') ??
      getAttr(enumNode, 'EnumName') ??
      getAttr(enumNode, 'FormatEnum') ??
      getAttr(enumNode, 'ModelEnum') ??
      getAttr(enumNode, 'Enum') ??
      getAttr(enumNode, 'Name') ??
      '';

    const isDataModelEnum = keyLower.includes('modelenum') || Boolean(getAttr(enumNode, 'ModelEnumName')) || Boolean(getAttr(enumNode, 'ModelGuid'));
    const isFormatEnum = keyLower.includes('formatenum') || Boolean(getAttr(enumNode, 'FormatEnumName'));

    const type: Extract<ERDatasourceType, 'Enum' | 'ModelEnum' | 'FormatEnum'> =
      isDataModelEnum ? 'ModelEnum' :
      isFormatEnum ? 'FormatEnum' :
      'Enum';

    const sourceKind = isDataModelEnum ? 'DataModel' : isFormatEnum ? 'Format' : 'Ax';

    return {
      type,
      enumInfo: {
        enumName,
        isModelEnum: isDataModelEnum,
        sourceKind,
        modelGuid: getAttr(enumNode, 'ModelGuid'),
      },
    };
  }

  return null;
}
