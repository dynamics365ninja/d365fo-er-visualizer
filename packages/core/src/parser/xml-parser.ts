// XML Parser: Parses ER configuration XML files into typed objects
import { XMLParser } from 'fast-xml-parser';
import {
  ERComponentKind,
} from '../types/common.js';
import type {
  ERSolutionVersion,
  ERSolution,
  ERLabel,
  ERPrerequisites,
  ERPrerequisiteGroup,
  ERPrerequisiteComponent,
  ERConfiguration,
  ERDataModelContent,
  ERModelMappingContent,
  ERFormatContent,
} from '../types/common.js';
import type {
  ERDataModelVersion,
  ERDataModel,
  ERDataContainerDescriptor,
  ERDataContainerItem,
} from '../types/model.js';
import type {
  ERModelMappingVersion,
  ERModelMapping,
  ERBinding,
  ERDatasource,
  ERDatasourceType,
  EREnumDatasource,
  ERValidation,
  ERValidationRule,
} from '../types/mapping.js';
import type {
  ERFormatVersion,
  ERFormat,
  ERFormatElement,
  ERFormatElementType,
  ERFormatEnumDefinition,
  ERFormatEnumValue,
  ERFormatTransformation,
  ERFormatMappingVersion,
  ERFormatMapping,
  ERFormatBinding,
} from '../types/format.js';
import type { ERExpression } from '../types/expressions.js';

// ─── XML Parser configuration ───

const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false, // keep as strings
  trimValues: true,
  processEntities: false,
  isArray: (name: string) => {
    // Elements that should always be arrays
    return arrayElements.has(name);
  },
};

const arrayElements = new Set([
  'ERLabel',
  'ERPrerequisiteGroup',
  'ERPrerequisiteComponent',
  'ERDataContainerDescriptor',
  'ERDataContainerDescriptorItem',
  'ERDataContainerPathBinding',
  'ERModelItemDefinition',
  'ERPathToCache',
  'ERSelectedTableItem',
  'ERFormatComponentPropertyBinding',
  'ERDataContainerPathValidationBinding',
  'ERExpressionValidationCondition',
  'EREnumDefinition',
  'EREnumValueDefinition',
  'ERNamedTextTransformation',
]);

function createParser() {
  return new XMLParser(xmlParserOptions);
}

// ─── Utility helpers ───

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function getAttr(node: any, name: string): string | undefined {
  return node?.[`@_${name}`] ?? undefined;
}

function getContents(node: any): any {
  return node?.['Contents.'] ?? node?.['Contents'] ?? undefined;
}

function getContentsArray(node: any, childName: string): any[] {
  const contents = getContents(node);
  if (!contents) return [];
  return asArray(contents[childName]);
}

/** Decode XML entities and numeric character references that processEntities:false leaves unresolved */
function decodeXmlEntities(val: string): string {
  return val
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Recursively decode XML entities in all string values of an object */
function decodeEntitiesDeep(obj: any): any {
  if (typeof obj === 'string') return decodeXmlEntities(obj);
  if (Array.isArray(obj)) return obj.map(decodeEntitiesDeep);
  if (obj != null && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = decodeEntitiesDeep(obj[key]);
    }
    return result;
  }
  return obj;
}

// ─── Public API ───

export function parseERConfiguration(xml: string, filePath: string): ERConfiguration {
  const parser = createParser();
  const rawDoc = parser.parse(xml);
  const doc = decodeEntitiesDeep(rawDoc);
  const root = doc['ERSolutionVersion'];
  if (!root) {
    throw new Error('Invalid ER configuration XML: missing ERSolutionVersion root element');
  }

  const solutionVersion = parseSolutionVersion(root);
  const kind = detectComponentKind(root);

  let content: ERDataModelContent | ERModelMappingContent | ERFormatContent;

  switch (kind) {
    case 'DataModel':
      content = {
        kind: ERComponentKind.DataModel,
        version: parseDataModelVersion(root),
      };
      break;
    case 'ModelMapping':
      content = {
        kind: ERComponentKind.ModelMapping,
        version: parseModelMappingVersion(root),
      };
      break;
    case 'Format':
      content = {
        kind: ERComponentKind.Format,
        ...parseFormatVersions(root),
      };
      break;
    default:
      throw new Error(`Unknown ER component kind`);
  }

  return { filePath, kind: kind as ERComponentKind, solutionVersion, content };
}

// ─── Component Kind Detection ───

function detectComponentKind(root: any): string {
  const contents = getContents(root);
  if (!contents) throw new Error('Missing Contents. in ERSolutionVersion');

  if (contents['ERDataModelVersion']) return 'DataModel';
  if (contents['ERFormatVersion'] && contents['ERFormatMappingVersion']) return 'Format';
  if (contents['ERFormatVersion'] || contents['ERFormatMappingVersion']) {
    throw new Error(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  }
  if (contents['ERModelMappingVersion']) return 'ModelMapping';

  throw new Error('Cannot detect ER component type from XML structure');
}

// ─── Solution Version (shared envelope) ───

function parseSolutionVersion(root: any): ERSolutionVersion {
  const solNode = root['Solution']?.['ERSolution'];

  return {
    dateTime: getAttr(root, 'DateTime') ?? '',
    description: getAttr(root, 'Description') ?? '',
    number: parseInt(getAttr(root, 'Number') ?? '0', 10),
    publicVersionNumber: getAttr(root, 'PublicVersionNumber') ?? '',
    versionStatus: parseInt(getAttr(root, 'VersionStatus') ?? '0', 10),
    prerequisites: parsePrerequisites(root['Prerequisites']),
    solution: parseSolution(solNode),
  };
}

function parseSolution(node: any): ERSolution {
  if (!node) throw new Error('Missing ERSolution element');

  const labelsNode = node['Labels']?.['ERClassList'];
  const labels: ERLabel[] = getContentsArray(labelsNode, 'ERLabel').map((l: any) => ({
    labelId: getAttr(l, 'LabelId') ?? '',
    labelValue: getAttr(l, 'LabelValue') ?? '',
    languageId: getAttr(l, 'LanguageId') ?? '',
  }));

  const vendorNode = node['Vendor']?.['ERVendor'];
  const contentRefNode = getContents(node);
  const refNode = asArray(contentRefNode?.['Ref.'])[0];

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    description: getAttr(node, 'Description'),
    baseSolutionId: parseBaseId(getAttr(node, 'Base')),
    baseVersion: parseBaseVersion(getAttr(node, 'Base')),
    baseName: getAttr(node, 'BaseName.o.'),
    labels,
    vendor: {
      name: getAttr(vendorNode, 'Name') ?? '',
      url: getAttr(vendorNode, 'Url') ?? '',
    },
    contentRefId: getAttr(refNode, 'ID.') ?? '',
  };
}

function parseBaseId(base: string | undefined): string | undefined {
  if (!base) return undefined;
  const match = base.match(/^\{[^}]+\}/);
  return match ? match[0] : undefined;
}

function parseBaseVersion(base: string | undefined): number | undefined {
  if (!base) return undefined;
  const match = base.match(/,(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}

function getNodeVersionId(node: any): string | undefined {
  const idAttr = getAttr(node, 'ID.');
  return idAttr?.split(',')[0];
}

function getSolutionContentRefIds(root: any): string[] {
  const solutionNode = root?.['Solution']?.['ERSolution'];
  const contentRefs = asArray(getContents(solutionNode)?.['Ref.']);
  return contentRefs
    .map(ref => getAttr(ref, 'ID.'))
    .filter((id): id is string => Boolean(id))
    .map(id => id.split(',')[0]);
}

function selectVersionNode(root: any, elementName: string): any {
  const contents = getContents(root);
  const nodes = asArray(contents?.[elementName]);

  if (nodes.length === 0) {
    return undefined;
  }

  const refIds = new Set(getSolutionContentRefIds(root));
  if (refIds.size > 0) {
    const referencedNode = nodes.find(node => {
      const versionId = getNodeVersionId(node);
      return versionId ? refIds.has(versionId) : false;
    });
    if (referencedNode) {
      return referencedNode;
    }
  }

  return nodes[nodes.length - 1];
}

function parsePrerequisites(node: any): ERPrerequisites | undefined {
  if (!node) return undefined;
  const erPrereq = node['ERPrerequisites'];
  if (!erPrereq) return undefined;

  const groups: ERPrerequisiteGroup[] = getContentsArray(erPrereq, 'ERPrerequisiteGroup').map(
    (g: any) => ({
      name: getAttr(g, 'Name') ?? '',
      type: getAttr(g, 'Type') ? parseInt(getAttr(g, 'Type')!, 10) : undefined,
      components: getContentsArray(g, 'ERPrerequisiteComponent').map((c: any) => ({
        id: getAttr(c, 'Id') ?? '',
        version: getAttr(c, 'Version'),
        isImplementation: getAttr(c, 'IsImplementation') === '1',
        type: getAttr(c, 'Type') ? parseInt(getAttr(c, 'Type')!, 10) : undefined,
      })),
    }),
  );

  return { groups };
}

// ─── Data Model ───

function parseDataModelVersion(root: any): ERDataModelVersion {
  const vNode = selectVersionNode(root, 'ERDataModelVersion');
  if (!vNode) throw new Error('Missing ERDataModelVersion element');

  const idAttr = getAttr(vNode, 'ID.') ?? '';
  const id = idAttr.split(',')[0];

  const modelNode = vNode['Model']?.['ERDataModel'];

  return {
    id,
    dateTime: getAttr(vNode, 'DateTime') ?? '',
    description: getAttr(vNode, 'Description') ?? '',
    number: parseInt(getAttr(vNode, 'Number') ?? '0', 10),
    model: parseDataModel(modelNode),
  };
}

function parseDataModel(node: any): ERDataModel {
  if (!node) throw new Error('Missing ERDataModel element');

  const containers = getContentsArray(node, 'ERDataContainerDescriptor').map(parseContainer);

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    containers,
  };
}

function parseContainer(node: any): ERDataContainerDescriptor {
  const items = getContentsArray(node, 'ERDataContainerDescriptorItem').map(
    (item: any): ERDataContainerItem => ({
      name: getAttr(item, 'Name') ?? '',
      type: parseInt(getAttr(item, 'Type') ?? '6', 10),
      typeDescriptor: getAttr(item, 'TypeDescriptor'),
      isTypeDescriptorHost: getAttr(item, 'IsTypeDescriptorHost') === '1',
      label: getAttr(item, 'Label'),
      description: getAttr(item, 'Description'),
    }),
  );

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    isRoot: getAttr(node, 'IsRoot') === '1',
    isEnum: getAttr(node, 'IsEnum') === '1',
    items,
  };
}

// ─── Model Mapping ───

function parseModelMappingVersion(root: any): ERModelMappingVersion {
  const vNode = selectVersionNode(root, 'ERModelMappingVersion');
  if (!vNode) throw new Error('Missing ERModelMappingVersion element');
  const idAttr = getAttr(vNode, 'ID.') ?? '';
  const id = idAttr.split(',')[0];

  const mappingNode = vNode['Mapping']?.['ERModelMapping'];

  return {
    id,
    dateTime: getAttr(vNode, 'DateTime') ?? '',
    description: getAttr(vNode, 'Description') ?? '',
    number: parseInt(getAttr(vNode, 'Number') ?? '0', 10),
    mapping: parseModelMapping(mappingNode),
  };
}

function parseModelMapping(node: any): ERModelMapping {
  if (!node) throw new Error('Missing ERModelMapping element');

  // Parse bindings
  const bindingNode = node['Binding']?.['ERDataContainerBinding'];
  const bindings = getContentsArray(bindingNode, 'ERDataContainerPathBinding').map(parseBinding);

  // Parse datasources
  const dsNode = node['Datasource']?.['ERModelDefinition'];
  const datasources = parseDatasources(dsNode);

  // Parse paths to cache
  const cacheNode = dsNode?.['PathsToCache']?.['ERPathsToCache'];
  const pathsToCache = getContentsArray(cacheNode, 'ERPathToCache').map(
    (c: any) => getAttr(c, 'Path') ?? '',
  );

  // Parse validations
  const valNode = node['Validations']?.['ERDataContainerBinding'];
  const validations = getContentsArray(valNode, 'ERDataContainerPathValidationBinding').map(
    parseValidation,
  );

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    dataContainerDescriptor: getAttr(node, 'DataContainerDescriptor') ?? '',
    modelId: getAttr(node, 'Model') ?? '',
    modelName: getAttr(node, 'ModelName') ?? '',
    modelVersion: getAttr(node, 'ModelVersion') ?? '',
    bindings,
    datasources,
    validations,
    pathsToCache,
  };
}

function parseBinding(node: any): ERBinding {
  return {
    path: getAttr(node, 'Path') ?? '',
    expressionAsString: getAttr(node, 'ExpressionAsString') ?? '',
    syntaxVersion: getAttr(node, 'SyntaxVersion')
      ? parseInt(getAttr(node, 'SyntaxVersion')!, 10)
      : undefined,
    expression: parseExpression(node['Expression']),
  };
}

function parseValidation(node: any): ERValidation {
  const condNodes = node['Expression']?.['ERExpressionValidationConditions'];
  const conditions = getContentsArray(condNodes, 'ERExpressionValidationCondition').map(
    (c: any): ERValidationRule => ({
      id: getAttr(c, 'ID.') ?? '',
      conditionExpressionAsString:
        getAttr(c['ConditionHost']?.['ERExpressionBooleanHost'], 'ExpressionAsString') ?? '',
      conditionExpression: parseExpression(
        c['ConditionHost']?.['ERExpressionBooleanHost']?.['Expression'],
      ),
      messageExpressionAsString:
        getAttr(c['MessageHost']?.['ERExpressionStringHost'], 'ExpressionAsString') ?? '',
      messageExpression: parseExpression(
        c['MessageHost']?.['ERExpressionStringHost']?.['Expression'],
      ),
    }),
  );

  return {
    path: getAttr(node, 'Path') ?? '',
    conditions,
  };
}

// ─── Datasources ───

function parseDatasources(defNode: any): ERDatasource[] {
  if (!defNode) return [];
  const items = getContentsArray(defNode, 'ERModelItemDefinition');
  const flat = items.map(parseDatasourceItem);

  // Build parent-child tree using normalized paths so XML ordering does not matter.
  const roots: ERDatasource[] = [];

  const pathMap = new Map<string, ERDatasource>();
  for (const ds of flat) {
    pathMap.set(buildDatasourcePath(ds.parentPath, ds.name), ds);
  }

  for (const ds of flat) {
    const parentKey = normalizeDatasourcePath(ds.parentPath);
    if (!parentKey) {
      roots.push(ds);
    } else {
      const parent = pathMap.get(parentKey);
      if (parent) {
        parent.children.push(ds);
      } else {
        roots.push(ds);
      }
    }
  }

  // Post-pass: any DS still Unknown but with children → Container
  function fixUnknownTypes(ds: ERDatasource) {
    if (ds.type === 'Unknown' && ds.children.length > 0) ds.type = 'Container';
    for (const child of ds.children) fixUnknownTypes(child);
  }
  for (const ds of roots) fixUnknownTypes(ds);

  return roots;
}

function normalizeDatasourcePath(path: string | undefined): string {
  if (!path) return '';
  return path
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map((segment, index) => segment.replace(index === 0 ? /^#/ : /^\$/, ''))
    .join('/');
}

function buildDatasourcePath(parentPath: string | undefined, name: string): string {
  const normalizedParent = normalizeDatasourcePath(parentPath);
  const normalizedName = name.replace(/^[$#]/, '');
  return normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
}

function parseDatasourceItem(node: any): ERDatasource {
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
  } else if (valueSource['ERModelEnumDataSourceHandler']) {
    const e = valueSource['ERModelEnumDataSourceHandler'];
    ds.type = 'ModelEnum';
    ds.enumInfo = {
      enumName: getAttr(e, 'ModelEnumName') ?? '',
      isModelEnum: true,
      sourceKind: 'DataModel',
      modelGuid: getAttr(e, 'ModelGuid'),
    };
  } else if (genericEnumDatasource) {
    ds.type = genericEnumDatasource.type;
    ds.enumInfo = genericEnumDatasource.enumInfo;
  } else if (valueSource['ERClassDataSourceHandler']) {
    const c = valueSource['ERClassDataSourceHandler'];
    ds.type = 'Class';
    ds.classInfo = { className: getAttr(c, 'ClassName') ?? '' };
  } else if (valueSource['ERObjectDataSourceHandler']) {
    const c = valueSource['ERObjectDataSourceHandler'];
    ds.type = 'Class';
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
      groupedFields: [],
      aggregations: [],
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
    // Fallback: derive a readable type from the first unrecognized ValueSource child key
    const keys = Object.keys(valueSource).filter(k => !k.startsWith('@_'));
    if (keys.length > 0) {
      // Strip 'ER' prefix and 'Handler'/'DataSource' suffix for a human-readable type
      const rawKey = keys[0];
      const readable = rawKey
        .replace(/^ER/, '')
        .replace(/DataSourceHandler$/, '')
        .replace(/DataSource$/, '')
        .replace(/Handler$/, '');
      // Use as type only if it looks like a known category, otherwise 'Container'
      ds.type = (readable === 'GroupByFunction' ? 'GroupBy' : 'Container') as any;
    }
  }

  return ds;
}

function parseGenericEnumDatasource(valueSource: any): { type: Extract<ERDatasourceType, 'Enum' | 'ModelEnum' | 'FormatEnum'>; enumInfo: EREnumDatasource } | null {
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

// ─── Format ───

function parseFormatVersions(root: any): { formatVersion: ERFormatVersion; formatMappingVersion: ERFormatMappingVersion } {
  const formatVersionNode = selectVersionNode(root, 'ERFormatVersion');
  const formatMappingVersionNode = selectVersionNode(root, 'ERFormatMappingVersion');

  if (!formatVersionNode || !formatMappingVersionNode) {
    throw new Error(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  }

  const formatVersion = parseFormatVersion(formatVersionNode);
  const formatMappingVersion = parseFormatMappingVersion(formatMappingVersionNode);
  const formatEnumNamesById = buildFormatEnumLookup(formatVersion.format.enumDefinitions);

  if (formatEnumNamesById.size > 0) {
    resolveFormatEnumDatasourceNames(formatMappingVersion.formatMapping.datasources, formatEnumNamesById);
  }

  return {
    formatVersion,
    formatMappingVersion,
  };
}

function normalizeFormatEnumRef(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/[{}]/g, '')
    .split(',')[0]
    .toLowerCase();
}

function buildFormatEnumLookup(enumDefinitions: ERFormatEnumDefinition[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const definition of enumDefinitions) {
    const normalizedId = normalizeFormatEnumRef(definition.id);
    if (normalizedId && definition.name) {
      lookup.set(normalizedId, definition.name);
    }
  }

  return lookup;
}

function resolveFormatEnumDatasourceNames(datasources: ERDatasource[], formatEnumNamesById: Map<string, string>): void {
  for (const datasource of datasources) {
    if (datasource.enumInfo?.sourceKind === 'Format') {
      const resolvedName = formatEnumNamesById.get(normalizeFormatEnumRef(datasource.enumInfo.enumName));
      if (resolvedName) {
        datasource.enumInfo.enumName = resolvedName;
      }
    }

    if (datasource.children.length > 0) {
      resolveFormatEnumDatasourceNames(datasource.children, formatEnumNamesById);
    }
  }
}

function parseFormatVersion(node: any): ERFormatVersion {
  const idAttr = getAttr(node, 'ID.') ?? '';
  const id = idAttr.split(',')[0];
  const formatNode = node['Format']?.['ERTextFormat'];

  return {
    id,
    dateTime: getAttr(node, 'DateTime') ?? '',
    description: getAttr(node, 'Description') ?? '',
    number: parseInt(getAttr(node, 'Number') ?? '0', 10),
    format: parseFormat(formatNode),
  };
}

function parseFormat(node: any): ERFormat {
  if (!node) throw new Error('Missing ERTextFormat element');

  // Parse enum definitions
  const enumListNode = node['EnumList']?.['EREnumDefinitionList'];
  const enumDefinitions = getContentsArray(enumListNode, 'EREnumDefinition').map(
    (e: any): ERFormatEnumDefinition => ({
      id: getAttr(e, 'ID.') ?? '',
      name: getAttr(e, 'Name') ?? '',
      values: getContentsArray(
        e['ValueDefinitionList']?.['EREnumValueDefinitionList'],
        'EREnumValueDefinition',
      ).map(
        (v: any): ERFormatEnumValue => ({
          id: getAttr(v, 'ID.') ?? '',
          name: getAttr(v, 'Name') ?? '',
        }),
      ),
    }),
  );

  // Parse transformations
  const transRepoNode = node['TransformationRepository']?.['ERNamedTransformationsRepository'];
  const transformations = getContentsArray(transRepoNode, 'ERNamedTextTransformation').map(
    (t: any): ERFormatTransformation => {
      const exprTrans = t['Transformation']?.['ERExpressionTransformation'];
      return {
        id: getAttr(t, 'ID.') ?? '',
        name: getAttr(t, 'Name') ?? '',
        expressionAsString: getAttr(exprTrans, 'ExpressionAsString') ?? '',
        parameterType: getAttr(exprTrans, 'ParameterType')
          ? parseInt(getAttr(exprTrans, 'ParameterType')!, 10)
          : undefined,
      };
    },
  );

  // Parse root format element by picking the first recognized format component under Root.
  const rootElement = parseRootFormatElement(node['Root']);

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    enumDefinitions,
    transformations,
    rootElement,
  };
}

function parseRootFormatElement(rootNode: any): ERFormatElement {
  if (!rootNode) {
    return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
  }

  for (const [key, value] of Object.entries(rootNode)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const elementType = formatElementTypeMap[key];
    if (!elementType) continue;

    const firstNode = asArray(value)[0];
    if (firstNode) {
      return parseFormatElement(firstNode, elementType);
    }
  }

  return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
}

function parseFormatElement(node: any, type: ERFormatElementType): ERFormatElement {
  if (!node) {
    return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
  }

  const children: ERFormatElement[] = [];
  const contentsNode = getContents(node);

  if (contentsNode) {
    // Parse child format elements
    for (const [key, val] of Object.entries(contentsNode)) {
      const elementType = formatElementTypeMap[key];
      if (elementType) {
        for (const child of asArray(val)) {
          children.push(parseFormatElement(child, elementType));
        }
      }
    }
  }

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? type,
    elementType: type,
    encoding: getAttr(node, 'Encoding'),
    maximalLength: getAttr(node, 'MaximalLength')
      ? parseInt(getAttr(node, 'MaximalLength')!, 10)
      : undefined,
    value: getAttr(node, 'Value'),
    transformation: getAttr(node, 'Transformation'),
    excludedFromDataSource: getAttr(node, 'ExcludedFromDataSource') === '1',
    children,
    attributes: extractAllAttributes(node),
  };
}

const formatElementTypeMap: Record<string, ERFormatElementType> = {
  ERTextFormatFolderComponent: 'File',
  ERTextFormatFileComponent: 'File',
  ERTextFormatXMLElement: 'XMLElement',
  ERTextFormatXMLAttribute: 'XMLAttribute',
  ERTextFormatXMLSequence: 'XMLSequence',
  ERTextFormatSequence: 'TextSequence',
  ERTextFormatLine: 'TextLine',
  ERTextFormatString: 'String',
  ERTextFormatNumeric: 'Numeric',
  ERTextFormatDate: 'DateTime',
  ERTextFormatDateTime: 'DateTime',
  ERTextFormatBase64Component: 'Base64',
};

function extractAllAttributes(node: any): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') && key !== '@_ID.' && key !== '@_Name') {
      attrs[key.slice(2)] = String(node[key]);
    }
  }
  return attrs;
}

// ─── Format Mapping ───

function parseFormatMappingVersion(node: any): ERFormatMappingVersion {
  const idAttr = getAttr(node, 'ID.') ?? '';
  const id = idAttr.split(',')[0];
  const mappingNode = node['Mapping']?.['ERFormatMapping'];

  return {
    id,
    dateTime: getAttr(node, 'DateTime') ?? '',
    description: getAttr(node, 'Description') ?? '',
    number: parseInt(getAttr(node, 'Number') ?? '0', 10),
    formatMapping: parseFormatMapping(mappingNode),
  };
}

function parseFormatMapping(node: any): ERFormatMapping {
  if (!node) throw new Error('Missing ERFormatMapping element');

  // Parse bindings — D365FO uses two XML element types:
  // ERFormatComponentBinding       → data bindings (no PropertyName)
  // ERFormatComponentPropertyBinding → property bindings (with PropertyName)
  const bindingNode = node['Binding']?.['ERFormatBinding'];

  const parseBinding = (b: any, propertyNameOverride?: string): ERFormatBinding => ({
    componentId: getAttr(b, 'Component') ?? '',
    expressionAsString: getAttr(b, 'ExpressionAsString') ?? '',
    propertyName: propertyNameOverride ?? getAttr(b, 'PropertyName'),
    syntaxVersion: getAttr(b, 'SyntaxVersion')
      ? parseInt(getAttr(b, 'SyntaxVersion')!, 10)
      : undefined,
    expression: parseExpression(b['Expression']),
  });

  const dataBindings = getContentsArray(bindingNode, 'ERFormatComponentBinding')
    .map((b: any) => parseBinding(b, undefined));  // no PropertyName → data binding

  const propBindings = getContentsArray(bindingNode, 'ERFormatComponentPropertyBinding')
    .map((b: any) => parseBinding(b));              // may or may not have PropertyName

  const bindings = [...dataBindings, ...propBindings];

  // Parse datasources
  const dsNode = node['Datasource']?.['ERModelDefinition'];
  const datasources = parseDatasources(dsNode);

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    formatId: getAttr(node, 'Format') ?? '',
    formatVersion: getAttr(node, 'FormatVersion') ?? '',
    bindings,
    datasources,
  };
}

// ─── Expression Parser ───

function parseExpression(exprContainer: any): ERExpression | undefined {
  if (!exprContainer) return undefined;

  // The Expression element wraps the actual expression node
  // Find the first child element that is an expression type
  for (const [key, val] of Object.entries(exprContainer)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const parsed = parseExpressionNode(key, val);
    if (parsed) return parsed;
  }

  return undefined;
}

function parseExpressionChildren(node: any): ERExpression[] {
  const children: ERExpression[] = [];
  const contentsNode = getContents(node);
  if (!contentsNode) return children;

  for (const [key, value] of Object.entries(contentsNode)) {
    if (key.startsWith('@_')) continue;
    for (const item of asArray(value)) {
      const parsed = parseExpressionNode(key, item);
      if (parsed) children.push(parsed);
    }
  }

  return children;
}

function defaultConstant(dataType: 'String' | 'Int' | 'Real' | 'Boolean' | 'DateNull' = 'String'): ERExpression {
  if (dataType === 'Boolean') return { kind: 'Constant', dataType, value: false };
  if (dataType === 'DateNull') return { kind: 'Constant', dataType, value: null };
  if (dataType === 'Real' || dataType === 'Int') return { kind: 'Constant', dataType, value: 0 };
  return { kind: 'Constant', dataType, value: '' };
}

function parseExpressionNode(elementName: string, node: any): ERExpression | undefined {
  if (!node) return undefined;

  // Item values
  if (elementName.match(/^ERExpression(String|Real|Int|Int64|Boolean|Enum|Date|DateTime|List|Container|DataContainer)ItemValue$/)) {
    const typeMatch = elementName.match(/ERExpression(\w+)ItemValue/);
    const dataTypeMap: Record<string, string> = {
      String: 'String', Real: 'Real', Int: 'Int', Boolean: 'Boolean',
      Int64: 'Int', Enum: 'Enum', Date: 'Date', DateTime: 'Date',
      List: 'List', Container: 'Container', DataContainer: 'Container',
    };
    return {
      kind: 'ItemValue',
      dataType: (dataTypeMap[typeMatch?.[1] ?? ''] ?? 'String') as any,
      itemPath: getAttr(node, 'ItemPath') ?? '',
    };
  }

  // Constants
  if (elementName === 'ERExpressionStringConstant') {
    return { kind: 'Constant', dataType: 'String', value: getAttr(node, 'Value') ?? '' };
  }
  if (elementName === 'ERExpressionIntConstant') {
    return { kind: 'Constant', dataType: 'Int', value: parseInt(getAttr(node, 'Value') ?? '0', 10) };
  }
  if (elementName === 'ERExpressionRealConstant') {
    return { kind: 'Constant', dataType: 'Real', value: parseFloat(getAttr(node, 'Value') ?? '0') };
  }
  if (elementName === 'ERExpressionBooleanConstant') {
    return { kind: 'Constant', dataType: 'Boolean', value: getAttr(node, 'Value') === '1' };
  }
  if (elementName === 'ERExpressionDateNull') {
    return { kind: 'Constant', dataType: 'DateNull', value: null };
  }

  // IF
  if (elementName === 'ERExpressionGenericIf') {
    return {
      kind: 'If',
      condition: parseExpression(node['Condition']) ?? { kind: 'Constant', dataType: 'Boolean', value: true },
      trueValue: parseExpression(node['TrueValue']) ?? { kind: 'Constant', dataType: 'String', value: '' },
      falseValue: parseExpression(node['FalseValue']) ?? { kind: 'Constant', dataType: 'String', value: '' },
    };
  }

  // CASE
  if (elementName === 'ERExpressionGenericCase') {
    const children = parseExpressionChildren(node);
    const expression = children[0] ?? defaultConstant();
    const remainder = children.slice(1);
    const hasDefault = remainder.length % 2 === 1;
    const caseValues = hasDefault ? remainder.slice(0, -1) : remainder;
    const cases: { when: ERExpression; then: ERExpression }[] = [];

    for (let i = 0; i < caseValues.length; i += 2) {
      const when = caseValues[i];
      const then = caseValues[i + 1];
      if (when && then) {
        cases.push({ when, then });
      }
    }

    return {
      kind: 'Case',
      expression,
      cases,
      defaultValue: hasDefault ? remainder[remainder.length - 1] : undefined,
    };
  }

  // Binary arithmetic
  if (elementName === 'ERExpressionNumericMultiply') {
    return {
      kind: 'BinaryOp', operator: 'Multiply',
      left: parseExpression(node['Multiplicand']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
      right: parseExpression(node['Multiplier']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
    };
  }
  if (elementName === 'ERExpressionNumericAdd') {
    return {
      kind: 'BinaryOp', operator: 'Add',
      left: parseExpression(node['FirstAddend']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
      right: parseExpression(node['SecondAddend']) ?? { kind: 'Constant', dataType: 'Int', value: 0 },
    };
  }
  if (elementName === 'ERExpressionNumericSubtract') {
    return {
      kind: 'BinaryOp', operator: 'Subtract',
      left: parseExpression(node['Minuend']) ?? defaultConstant('Int'),
      right: parseExpression(node['Subtraend']) ?? defaultConstant('Int'),
    };
  }
  if (elementName === 'ERExpressionNumericDivide') {
    return {
      kind: 'BinaryOp', operator: 'Divide',
      left: parseExpression(node['Dividend']) ?? defaultConstant('Int'),
      right: parseExpression(node['Divisor']) ?? defaultConstant('Int'),
    };
  }

  // Logical
  if (elementName === 'ERExpressionAnd') {
    const children = parseExpressionChildren(node);
    if (children.length === 0) return undefined;
    return children.reduce((acc, cur) => ({
      kind: 'BinaryOp', operator: 'And', left: acc, right: cur,
    }));
  }

  if (elementName === 'ERExpressionOr') {
    const children = parseExpressionChildren(node);
    if (children.length === 0) return undefined;
    return children.reduce((acc, cur) => ({
      kind: 'BinaryOp', operator: 'Or', left: acc, right: cur,
    }));
  }

  if (elementName === 'ERExpressionNot') {
    return {
      kind: 'UnaryOp', operator: 'Not',
      operand: parseExpression(node['Input']) ?? defaultConstant('Boolean'),
    };
  }

  if (elementName === 'ERExpressionRealAbs') {
    return {
      kind: 'UnaryOp', operator: 'Abs',
      operand: parseExpression(node['Input']) ?? defaultConstant('Real'),
    };
  }

  if (elementName === 'ERExpressionNumericUnarySubtract') {
    return {
      kind: 'UnaryOp', operator: 'Negate',
      operand: parseExpression(node['Expression']) ?? defaultConstant('Int'),
    };
  }

  // Comparisons
  const compMap: Record<string, { op: string; dt: string }> = {
    ERExpressionBooleanEquals: { op: 'Equals', dt: 'Boolean' },
    ERExpressionStringEquals: { op: 'Equals', dt: 'String' },
    ERExpressionStringNotEquals: { op: 'NotEquals', dt: 'String' },
    ERExpressionDateEquals: { op: 'Equals', dt: 'Date' },
    ERExpressionDateNotEquals: { op: 'NotEquals', dt: 'Date' },
    ERExpressionDateGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'Date' },
    ERExpressionDateLess: { op: 'LessThan', dt: 'Date' },
    ERExpressionDateLessrOrEqual: { op: 'LessOrEqual', dt: 'Date' },
    ERExpressionDateTimeGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'DateTime' },
    ERExpressionDateTimeLessOrEqual: { op: 'LessOrEqual', dt: 'DateTime' },
    ERExpressionEnumEquals: { op: 'Equals', dt: 'Enum' },
    ERExpressionEnumNotEquals: { op: 'NotEquals', dt: 'Enum' },
    ERExpressionNumericEquals: { op: 'Equals', dt: 'Numeric' },
    ERExpressionNumericNotEquals: { op: 'NotEquals', dt: 'Numeric' },
    ERExpressionNumericGreater: { op: 'GreaterThan', dt: 'Numeric' },
    ERExpressionNumericGreaterOrEqual: { op: 'GreaterOrEqual', dt: 'Numeric' },
    ERExpressionNumericLesser: { op: 'LessThan', dt: 'Numeric' },
    ERExpressionNumericLesserOrEqual: { op: 'LessOrEqual', dt: 'Numeric' },
  };
  if (compMap[elementName]) {
    const { op, dt } = compMap[elementName];
    return {
      kind: 'Comparison',
      operator: op as any,
      dataType: dt,
      left: parseExpression(node['FirstExpression']) ?? defaultConstant(),
      right: parseExpression(node['SecondExpression']) ?? defaultConstant(),
    };
  }

  // List operations
  if (elementName === 'ERExpressionListIsEmpty') {
    return {
      kind: 'ListOp', operator: 'IsEmpty',
      operand: parseExpression(node['Input']) ?? { kind: 'Constant', dataType: 'String', value: '' },
    };
  }
  if (elementName === 'ERExpressionListAllItems') {
    return {
      kind: 'ListOp', operator: 'AllItems',
      operand: parseExpression(node['Input']) ?? defaultConstant(),
    };
  }
  if (elementName === 'ERExpressionListWhere' || elementName === 'ERExpressionListFilter') {
    return {
      kind: 'ListOp', operator: elementName === 'ERExpressionListWhere' ? 'Where' : 'Filter',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
      arguments: [parseExpression(node['Condition']) ?? defaultConstant('Boolean')],
    };
  }
  if (elementName === 'ERExpressionListOrderBy') {
    return {
      kind: 'ListOp', operator: 'OrderBy',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
      arguments: parseExpressionChildren(node),
    };
  }
  if (elementName === 'ERExpressionListCount' || elementName === 'ERExpressionListCounter') {
    return {
      kind: 'ListOp', operator: 'Count',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
    };
  }
  if (elementName === 'ERExpressionListFirstOrNull' || elementName === 'ERExpressionListFirst') {
    return {
      kind: 'ListOp', operator: 'FirstOrNull',
      operand: parseExpression(node['List'] ?? node['Input']) ?? defaultConstant(),
    };
  }

  // String operations
  if (elementName === 'ERExpressionStringFormat') {
    const children = parseExpressionChildren(node);
    return {
      kind: 'Format',
      formatString: children[0] ?? defaultConstant(),
      arguments: children.slice(1),
    };
  }

  if (elementName === 'ERExpressionStringLabel') {
    return {
      kind: 'StringOp', operator: 'Label',
      arguments: [parseExpression(node['LabelId']) ?? { kind: 'Constant', dataType: 'String', value: '' }],
    };
  }
  if (elementName === 'ERExpressionStringMid') {
    return {
      kind: 'StringOp', operator: 'Mid',
      arguments: [
        parseExpression(node['Input']) ?? defaultConstant(),
        parseExpression(node['Start']) ?? defaultConstant('Int'),
        parseExpression(node['Length']) ?? defaultConstant('Int'),
      ],
    };
  }
  if (elementName === 'ERExpressionStringLen' || elementName === 'ERExpressionSTringLen') {
    return {
      kind: 'StringOp', operator: 'Len',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }
  if (elementName === 'ERExpressionStringReplace') {
    return {
      kind: 'StringOp', operator: 'Replace',
      arguments: [
        parseExpression(node['Input']) ?? defaultConstant(),
        parseExpression(node['Pattern'] ?? node['OldString']) ?? defaultConstant(),
        parseExpression(node['Replacement'] ?? node['NewString']) ?? defaultConstant(),
      ],
    };
  }
  if (elementName === 'ERExpressionStringConcatenate') {
    return {
      kind: 'StringOp', operator: 'Concatenate',
      arguments: parseExpressionChildren(node),
    };
  }
  if (elementName === 'ERExpressionStringTrim') {
    return {
      kind: 'StringOp', operator: 'Trim',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }

  // Date operations
  if (elementName === 'ERExpressionDateFormat') {
    return {
      kind: 'DateOp', operator: 'DateFormat',
      arguments: [
        parseExpression(node['Date']) ?? defaultConstant('DateNull'),
        parseExpression(node['Format']) ?? defaultConstant(),
      ],
    };
  }
  if (elementName === 'ERExpressionDateSessionToday') {
    return { kind: 'DateOp', operator: 'SessionToday', arguments: [] };
  }
  if (elementName === 'ERExpressionDateValue') {
    return {
      kind: 'DateOp', operator: 'DateValue',
      arguments: [parseExpression(node['Input']) ?? defaultConstant()],
    };
  }
  if (elementName === 'ERExpressionNow') {
    return { kind: 'DateOp', operator: 'Now', arguments: [] };
  }

  // Adapters (type wrappers)
  if (/^ERExpression(?:Boolean|Int|Int64|Real|String|Enum|List|DataContainer)Adapter$/.test(elementName)) {
    return parseExpression(node['Expression']);
  }

  // Generic call
  if (elementName === 'ERExpressionGenericCall') {
    return {
      kind: 'Call',
      functionName: getAttr(node, 'FunctionName') ?? getAttr(node, 'ItemPath') ?? elementName,
      arguments: parseExpressionChildren(node),
    };
  }

  if (/^ERExpression(Get[A-Za-z0-9]+|Transformation|RealRound|RealRoundAmount|RealToInt|RealToInt64|RealValueSeparatorsSet|ListStringJoin|ListJoin|ListSplitString|ListSplitStringByDelimiter|ListDistinct|ListReverse|ListOfFields|ListIndex|ListFirstList|ListEmpty|EmptyRecord|TableName2Id|DateToDateTime)$/.test(elementName)) {
    return {
      kind: 'Call',
      functionName: elementName.replace(/^ERExpression/, ''),
      arguments: parseExpressionChildren(node),
    };
  }

  // Validation conditions
  if (elementName === 'ERExpressionValidationConditions') {
    const conditions = getContentsArray(node, 'ERExpressionValidationCondition').map(
      (c: any): { id: string; condition: ERExpression; message: ERExpression } => ({
        id: getAttr(c, 'ID.') ?? '',
        condition: parseExpression(c['ConditionHost']?.['ERExpressionBooleanHost']?.['Expression']) ??
          { kind: 'Constant', dataType: 'Boolean', value: true },
        message: parseExpression(c['MessageHost']?.['ERExpressionStringHost']?.['Expression']) ??
          { kind: 'Constant', dataType: 'String', value: '' },
      }),
    );
    return { kind: 'ValidationConditions', conditions };
  }

  // Fallback: Generic expression node
  const attrs: Record<string, string> = {};
  const children: ERExpression[] = [];

  if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@_')) {
        attrs[k.slice(2)] = String(v);
      } else if (k !== '#text') {
        for (const item of asArray(v)) {
          const parsed = parseExpressionNode(k, item);
          if (parsed) children.push(parsed);
        }
      }
    }
  }

  return {
    kind: 'Generic',
    xmlElementName: elementName,
    expressionAsString: getAttr(node, 'ExpressionAsString') ?? '',
    children,
    attributes: attrs,
  };
}

export { asArray, getAttr, getContents, getContentsArray };
