// XML Parser: Parses ER configuration XML files into typed objects
import { XMLParser } from 'fast-xml-parser';
import {
  ERComponentKind,
  ERDirection,
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
  processEntities: false, // handled in sanitizeAndDecode to also cover numeric refs and strip unsafe keys in one pass
  isArray: (name: string) => {
    // Elements that should always be arrays
    return arrayElements.has(name);
  },
};

// Keys that must never be copied from parsed data to prevent prototype pollution.
const UNSAFE_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

/**
 * Decode XML entities (named + numeric) that fast-xml-parser leaves unresolved
 * when processEntities:false. Kept off by default to avoid double-decoding
 * constructs inside ER expressions (e.g. `&quot;` inside a raw formula string).
 */
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

/**
 * Single-pass traversal that (a) decodes XML entities inside string values and
 * (b) strips any __proto__/constructor/prototype keys from parsed objects to
 * neutralise prototype-pollution attempts via crafted attribute names.
 */
function sanitizeAndDecode(obj: any): any {
  if (typeof obj === 'string') return decodeXmlEntities(obj);
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeAndDecode);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (UNSAFE_PROTO_KEYS.has(key)) continue;
    result[key] = sanitizeAndDecode(obj[key]);
  }
  return result;
}

// ─── Public API ───

/**
 * Names of ER content roots that F&O's custom-service XML endpoints
 * (`GetEffectiveFormatMappingByID`, `GetModelMappingByID`,
 * `GetDataModelByIDAndRevision`) may return **without** the enclosing
 * `<ERSolutionVersion>` envelope. When we detect one of these at the
 * top level we synthesize a minimal envelope so the existing parser
 * pipeline can proceed.
 *
 * Two tiers:
 *  - **Version-level** roots live directly under `Contents.` in the
 *    envelope (e.g. `ERFormatVersion`).
 *  - **Inner** roots live deeper (e.g. `ERTextFormat` lives under
 *    `ERFormatVersion > Format`). F&O `GetEffectiveFormatMappingByID`
 *    confirmed on EU sandbox returns a bare `ERTextFormat` root.
 */
const BARE_VERSION_ROOTS = new Set([
  'ERFormatMappingVersion',
  'ERFormatVersion',
  'ERModelMappingVersion',
  'ERDataModelVersion',
]);

/** Empty `ERFormatMappingVersion` used when only the format side was returned. */
function emptyFormatMappingVersion(): Record<string, unknown> {
  return {
    '@_DateTime': '',
    '@_Description': '',
    '@_Number': '0',
    '@_ID.': '00000000-0000-0000-0000-000000000000,0',
    Mapping: {
      ERFormatMapping: {
        '@_ID.': '',
        '@_Name': '',
        '@_Format': '',
        '@_FormatVersion': '',
        Binding: { ERFormatBinding: {} },
        Datasource: {},
      },
    },
  };
}

/**
 * Wrap a bare content node in a synthetic `ERSolutionVersion` envelope
 * so `parseSolutionVersion` + `detectComponentKind` can run unchanged.
 * Attribute names mirror F&O's exported XML.
 *
 * Returns null when nothing recognizable is at the top level.
 */
function wrapBareContent(doc: Record<string, unknown>): Record<string, unknown> | null {
  const contents: Record<string, unknown> = Object.create(null);

  // Tier 1 — Version-level roots: insert as-is.
  for (const [key, value] of Object.entries(doc)) {
    if (BARE_VERSION_ROOTS.has(key)) contents[key] = value;
  }

  // Tier 2 — Inner content roots. Each needs to be rewrapped in the
  // corresponding `*Version` node at the correct depth. `ERTextFormat`
  // additionally requires a stub `ERFormatMappingVersion` so the
  // "Format requires both halves" check in `detectComponentKind`
  // still passes — but only if the response doesn't also include a
  // real `ERFormatMapping` (F&O's `GetEffectiveFormatMappingByID`
  // returns both halves as separate fragments inside the same bundle;
  // stubbing first would shadow the real one and drop every binding).
  if (!contents['ERFormatVersion'] && doc['ERTextFormat']) {
    contents['ERFormatVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Format: { ERTextFormat: doc['ERTextFormat'] },
    };
  }
  if (!contents['ERFormatMappingVersion'] && doc['ERFormatMapping']) {
    contents['ERFormatMappingVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Mapping: { ERFormatMapping: doc['ERFormatMapping'] },
    };
  }
  // Only stub an empty mapping half when the response carried a
  // format grammar but no mapping fragment at all.
  if (contents['ERFormatVersion'] && !contents['ERFormatMappingVersion']) {
    contents['ERFormatMappingVersion'] = emptyFormatMappingVersion();
  }
  if (!contents['ERDataModelVersion'] && doc['ERModelDefinition']) {
    contents['ERDataModelVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Model: { ERDataModel: doc['ERModelDefinition'] },
    };
  }
  // F&O `GetDataModelByIDAndRevision` on ac365lab-factory (2026-04)
  // returns the data model under a bare `ERDataModel` root (rather
  // than `ERModelDefinition`). Treat them as equivalent.
  if (!contents['ERDataModelVersion'] && doc['ERDataModel']) {
    contents['ERDataModelVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Model: { ERDataModel: doc['ERDataModel'] },
    };
  }
  if (!contents['ERModelMappingVersion'] && doc['ERModelMapping']) {
    contents['ERModelMappingVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Mapping: { ERModelMapping: doc['ERModelMapping'] },
    };
  }

  if (Object.keys(contents).length === 0) return null;

  // Aggregate every ERClassList fragment in the bundle into a single
  // merged ERLabel array. F&O's `GetEffectiveFormatMappingByID` returns
  // the label dictionary as *separate* ERClassList documents (one per
  // language pack), and without them `resolveLabel` has no translations
  // to map `@GER_LABEL:Foo` references to human-readable text, so all
  // names in the visualizer come out empty.
  const aggregatedLabels: unknown[] = [];
  const classLists = (doc as Record<string, unknown>)['ERClassList'];
  for (const cl of Array.isArray(classLists) ? classLists : classLists ? [classLists] : []) {
    if (!cl || typeof cl !== 'object') continue;
    // Each ERClassList has either `Contents.` or `Contents` holding the
    // ERLabel array.
    const clContents =
      (cl as Record<string, unknown>)['Contents.'] ??
      (cl as Record<string, unknown>)['Contents'];
    if (!clContents || typeof clContents !== 'object') continue;
    const labels = (clContents as Record<string, unknown>)['ERLabel'];
    if (!labels) continue;
    for (const lbl of Array.isArray(labels) ? labels : [labels]) {
      aggregatedLabels.push(lbl);
    }
  }

  // Surface the component's *own* Name / Description onto the
  // synthetic `ERSolution` so the UI tab title and designer header
  // don't come out blank. F&O's custom services return only the
  // inner content (ERTextFormat / ERFormatMapping / ERModelDefinition
  // / ERModelMapping) without the enclosing solution envelope, so we
  // pick the name from whichever fragment is present.
  //
  // Order matters! When `GetModelMappingByID` returns **both**
  // `ERDataModel` and `ERModelMapping` in a single response,
  // `ERDataModel.@_Name` is the *DataModel* name (e.g.
  // "Tax declaration model") whereas `ERModelMapping.@_Name` is the
  // *mapping* name (e.g. "Tax declaration model mapping"). The user
  // expects to see the mapping name, so `ERModelMapping` must come
  // before `ERDataModel`.
  //
  // The transport-injected `@_Name` hint is last-resort only because
  // it can be a synthetic placeholder (e.g. "DataModel {guid}" for
  // GUID-resolved DataModels, or "X (default mapping)" for synth
  // mapping probes).
  const nameHintSources: (string | undefined)[] = [
    (doc['ERTextFormat'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERFormatMapping'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERModelDefinition'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERModelMapping'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERDataModel'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    // Last-resort: transport-injected hint from the ErFnoBundle wrapper.
    (doc['@_Name'] as string | undefined),
  ];
  const solutionName = nameHintSources.find(s => typeof s === 'string' && s.length > 0) ?? '';
  const descHintSources: (string | undefined)[] = [
    (doc['ERTextFormat'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERFormatMapping'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERModelDefinition'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERModelMapping'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERDataModel'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['@_Description'] as string | undefined),
  ];
  const solutionDesc = descHintSources.find(s => typeof s === 'string' && s.length > 0) ?? '';

  // Pick up an optional version hint from the F&O bundle wrapper
  // (`<ErFnoBundle Version="…">`) so the explorer's version pill and
  // the status-bar chip can show the F&O configuration version even
  // when the inner XML payload doesn't carry a real ERSolutionVersion
  // envelope.
  const versionHintSources: (string | undefined)[] = [
    (doc['@_Version'] as string | undefined),
    (doc['@_PublicVersionNumber'] as string | undefined),
  ];
  const publicVersionNumber = versionHintSources.find(
    s => typeof s === 'string' && s.length > 0,
  ) ?? '';

  // Minimal `ERSolutionVersion` envelope. Fields default to empty;
  // `parseSolutionVersion` tolerates missing attrs / ERSolution via its
  // `?? ''` / `?? '0'` fallbacks (except `Missing ERSolution element`,
  // so we inject a bare `ERSolution` too).
  return {
    ERSolutionVersion: {
      '@_DateTime': '',
      '@_Description': solutionDesc,
      '@_Number': '0',
      '@_PublicVersionNumber': publicVersionNumber,
      '@_VersionStatus': '0',
      Solution: {
        ERSolution: {
          '@_ID.': '',
          '@_Name': solutionName,
          '@_Description': solutionDesc,
          Contents: { 'Ref.': [] },
          Labels: {
            ERClassList: {
              Contents: { ERLabel: aggregatedLabels },
            },
          },
          Vendor: { ERVendor: { '@_Name': '', '@_Url': '' } },
        },
      },
      Contents: contents,
      Prerequisites: undefined,
    },
  };
}

export function parseERConfiguration(xml: string, filePath: string): ERConfiguration {
  const parser = createParser();
  const rawDoc = parser.parse(xml);
  const doc = sanitizeAndDecode(rawDoc);
  let root = (doc as Record<string, unknown>)['ERSolutionVersion'];
  if (!root) {
    // F&O custom-service downloads (GetEffectiveFormatMappingByID etc.)
    // can return a bare content node without the ERSolutionVersion
    // envelope. The `fno-client` transport wraps multi-fragment
    // responses in a synthetic `<ErFnoBundle>` wrapper, so unwrap that
    // first, then fall back to plain bare-content detection.
    const bundleNode = (doc as Record<string, unknown>)['ErFnoBundle'];
    const sourceDoc = (bundleNode && typeof bundleNode === 'object'
      ? (bundleNode as Record<string, unknown>)
      : (doc as Record<string, unknown>));
    const wrapped = wrapBareContent(sourceDoc);
    if (wrapped) {
      root = wrapped.ERSolutionVersion;
    }
  }
  if (!root) {
    // Surface the raw XML preview so the operator can see what shape
    // the backend actually returned (F&O custom services can return
    // odd envelopes). The warn is cheap and only fires on the error
    // path, so it's safe to ship.
    const topLevelKeys = Object.keys(doc as Record<string, unknown>);
    const preview = xml.slice(0, 600);
    // eslint-disable-next-line no-console
    console.warn('[er-parser] missing ERSolutionVersion root', {
      filePath,
      topLevelKeys,
      xmlLength: xml.length,
      preview,
    });
    throw new Error(
      `Invalid ER configuration XML: missing ERSolutionVersion root element. ` +
        `Got top-level elements [${topLevelKeys.join(', ') || '<none>'}] in a ${xml.length}-char payload. ` +
        `See DevTools Console "[er-parser]" for a 600-char preview.`,
    );
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

  // Check Format first: a Format export bundle can include a
  // datasource ERModelMappingVersion alongside its Format halves —
  // that's still a Format component, the embedded mapping is
  // metadata for the format's import datasources.
  if (contents['ERFormatVersion'] && contents['ERFormatMappingVersion']) return 'Format';
  if (contents['ERFormatVersion'] || contents['ERFormatMappingVersion']) {
    throw new Error(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  }
  // ModelMapping wins over DataModel when both are present: F&O's
  // `GetModelMappingByID` response bundles `parmModel` (the parent
  // DataModel) and `parmModelMapping` together, but the DataModel was
  // already fetched separately via `GetDataModelByIDAndRevision`. If
  // we returned 'DataModel' here the bundle would be parsed as a
  // duplicate model and the mapping payload would be dropped on the
  // floor.
  if (contents['ERModelMappingVersion']) return 'ModelMapping';
  if (contents['ERDataModelVersion']) return 'DataModel';

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

  return parseModelMappingVersionNode(vNode);
}

function parseModelMappingVersionNode(vNode: any): ERModelMappingVersion {
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

function parseInlineGroupByFields(groupByNode: any): Array<{ name: string; path: string }> {
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

function parseInlineGroupByAggregations(groupByNode: any): Array<{ name: string; path: string; function: string }> {
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

function selectReferencedVersionNodes(root: any, elementName: string): any[] {
  const contents = getContents(root);
  const nodes = asArray(contents?.[elementName]);

  if (nodes.length === 0) return [];

  const refIds = new Set(getSolutionContentRefIds(root));
  if (refIds.size === 0) return nodes;

  const referencedNodes = nodes.filter(node => {
    const versionId = getNodeVersionId(node);
    return versionId ? refIds.has(versionId) : false;
  });

  return referencedNodes.length > 0 ? referencedNodes : nodes;
}

function parseFormatVersions(root: any): { formatVersion: ERFormatVersion; formatMappingVersion: ERFormatMappingVersion; embeddedModelMappingVersions: ERModelMappingVersion[]; direction: ERDirection } {
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

function inferFormatDirection(formatVersionNode: any): ERDirection {
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
