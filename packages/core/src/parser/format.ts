import { ERDirection } from '../types/common.js';
import type { ERDatasource, ERModelMappingVersion } from '../types/mapping.js';
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
import { getAttr, getContents, getContentsArray, orderedChildren } from './xml-document.js';
import type { XmlNode } from './xml-document.js';
import { selectReferencedVersionNodes, selectVersionNode } from './envelope.js';
import { parseModelMappingVersionNode } from './mapping.js';
import { parseDatasources } from './datasources.js';
import { parseExpression } from './expressions.js';
import { pushParseWarning } from './warnings.js';

// ─── Format ───

export function parseFormatVersions(root: XmlNode): { formatVersion: ERFormatVersion; formatMappingVersion: ERFormatMappingVersion; embeddedModelMappingVersions: ERModelMappingVersion[]; direction: ERDirection } {
  const formatVersionNode = selectVersionNode(root, 'ERFormatVersion');
  const formatMappingVersionNode = selectVersionNode(root, 'ERFormatMappingVersion');

  if (!formatVersionNode || !formatMappingVersionNode) {
    throw new Error(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  }

  const formatVersion = parseFormatVersion(formatVersionNode);
  const formatMappingVersion = parseFormatMappingVersion(formatMappingVersionNode);
  const embeddedModelMappingVersions = selectReferencedVersionNodes(root, 'ERModelMappingVersion')
    .map(parseModelMappingVersionNode);
  const formatEnumNamesById = buildFormatEnumLookup(formatVersion.format.enumDefinitions);

  if (formatEnumNamesById.size > 0) {
    resolveFormatEnumDatasourceNames(formatMappingVersion.formatMapping.datasources, formatEnumNamesById);
  }

  return {
    formatVersion,
    formatMappingVersion,
    embeddedModelMappingVersions,
    direction: inferFormatDirection(formatVersionNode),
  };
}

function inferFormatDirection(formatVersionNode: XmlNode | undefined): ERDirection {
  const formatNode = formatVersionNode?.['Format']?.['ERTextFormat'];
  return getAttr(formatNode, 'DataImportSupport') === '1'
    ? ERDirection.Import
    : ERDirection.Export;
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

function parseFormatVersion(node: XmlNode): ERFormatVersion {
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

function parseFormat(node: XmlNode | undefined): ERFormat {
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

  // Extract embedded Excel template (base64-encoded .xlsx)
  // Template can be at various levels: directly under Root, under the ExcelFileComponent,
  // or inside a Template sibling element of Root.
  // Search the entire ERTextFormat node (not just Root) so Template siblings are covered.
  const template = findExcelTemplate(node);

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    enumDefinitions,
    transformations,
    rootElement,
    template,
  };
}

/** Recursively search for ERTextFormatExcelTemplate in a node tree (max depth 8).
 * Returns a template descriptor with filename and optional base64 (embedded binary).
 * When the format only stores a filename reference (self-closing element), base64 is undefined.
 *
 * A format routinely carries *both* shapes: an attachment-level reference-only
 * node (`Filename="<descr/>Sales invoice (Excel)"`) and the real embedded
 * workbook further down. Taking the first hit in document order would drop the
 * binary, so every candidate is collected and the embedded one wins.
 */
function findExcelTemplate(node: XmlNode | undefined, depth = 0): { filename: string; base64?: string } | undefined {
  const candidates = collectExcelTemplates(node, depth);
  return candidates.find(c => c.base64) ?? candidates[0];
}

function collectExcelTemplates(node: XmlNode | undefined, depth = 0, out: Array<{ filename: string; base64?: string }> = []): Array<{ filename: string; base64?: string }> {
  // Every element and every `Contents.` wrapper is a level, so a template
  // under folder > file > sheet components easily sits deeper than 8.
  if (!node || typeof node !== 'object' || depth > 64) return out;
  // Two element names seen in the wild:
  // ERTextFormatExcelTemplate (reference-only or older embedded style)
  // ERTextFormatExcelFileComponentTemplate (newer embedded style inside ExcelFileComponent)
  for (const key of ['ERTextFormatExcelTemplate', 'ERTextFormatExcelFileComponentTemplate']) {
    const tplNode = node[key];
    if (!tplNode) continue;
    for (const tpl of Array.isArray(tplNode) ? tplNode : [tplNode]) {
      const filename = tpl?.['@_Filename'] ?? '';
      if (!filename) continue;
      const rawBase64 = tpl?.['Contents.'];
      const base64 = rawBase64 && typeof rawBase64 === 'string' ? rawBase64.trim() : undefined;
      out.push({ filename, base64 });
    }
  }
  // Search children. `Contents.` is an ordinary child key here, so it needs no
  // separate descent (that walked every subtree twice and collected duplicates).
  for (const [key, item] of orderedChildren(node)) {
    if (key === 'ERTextFormatExcelTemplate' || key === 'ERTextFormatExcelFileComponentTemplate') continue;
    collectExcelTemplates(item, depth + 1, out);
  }
  return out;
}

function parseRootFormatElement(rootNode: XmlNode | undefined): ERFormatElement {
  if (!rootNode) {
    return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
  }

  for (const [key, firstNode] of orderedChildren(rootNode)) {
    const elementType = formatElementTypeMap[key];
    if (!elementType) continue;
    if (firstNode) {
      return parseFormatElement(firstNode, elementType);
    }
  }

  return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
}

function parseFormatElement(node: XmlNode | undefined, type: ERFormatElementType): ERFormatElement {
  if (!node) {
    return { id: '', name: 'Unknown', elementType: 'Unknown', children: [], attributes: {} };
  }

  const children: ERFormatElement[] = [];
  const contentsNode = getContents(node);

  if (contentsNode) {
    // Parse child format elements
    const warned = new Set<string>();
    for (const [key, child] of orderedChildren(contentsNode)) {
      const elementType = formatElementTypeMap[key];
      if (!elementType && !warned.has(key)) {
        // Unknown component type: keep the node (name, attributes, children)
        // as `Unknown` instead of dropping the whole subtree silently.
        warned.add(key);
        pushParseWarning(`Unknown format element type '${key}' kept as 'Unknown'`);
      }
      if (child === null || typeof child !== 'object') continue;
      children.push(parseFormatElement(child, elementType ?? 'Unknown'));
    }
  }

  return {
    id: getAttr(node, 'ID.') ?? '',
    // Excel components carry no `Name`; the designer shows the named range /
    // sheet name instead, so fall back to those before the bare type label.
    // `||`, not `??`: an empty `Name=""` falls back too.
    name: getAttr(node, 'Name')
      || getAttr(node, 'ExcelRange')
      || getAttr(node, 'ExcelSheetName')
      || type,
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
  // Excel format elements
  ERTextFormatExcelFileComponent: 'ExcelFile',
  ERTextFormatExcelSheet: 'ExcelSheet',
  ERTextFormatExcelRange: 'ExcelRange',
  ERTextFormatExcelCell: 'ExcelCell',
  ERTextFormatExcelHeader: 'ExcelHeader',
  ERTextFormatExcelFooter: 'ExcelFooter',
  // Converter / office wrappers — without these the whole tree below a
  // PDF-converted Excel template parsed as `Unknown` and rendered empty.
  ERTextFormatPDFConverterComponent: 'PDFFile',
  ERTextFormatPdfConverterComponent: 'PDFFile',
  ERTextFormatPDFFileComponent: 'PDFFile',
  ERTextFormatWordFileComponent: 'WordFile',
  ERTextFormatWordDocumentComponent: 'WordFile',
};

function extractAllAttributes(node: XmlNode): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') && key !== '@_ID.' && key !== '@_Name') {
      attrs[key.slice(2)] = String(node[key]);
    }
  }
  return attrs;
}

// ─── Format Mapping ───

function parseFormatMappingVersion(node: XmlNode): ERFormatMappingVersion {
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

function parseFormatMapping(node: XmlNode | undefined): ERFormatMapping {
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
