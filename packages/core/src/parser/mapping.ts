import type {
  ERModelMappingVersion,
  ERModelMapping,
  ERBinding,
  ERValidation,
  ERValidationRule,
} from '../types/mapping.js';
import { asArray, getAttr, getContentsArray } from './xml-document.js';
import type { XmlNode } from './xml-document.js';
import { selectReferencedVersionNodes, selectVersionNode } from './envelope.js';
import { parseDatasources } from './datasources.js';
import { parseExpression } from './expressions.js';

// ─── Model Mapping ───

export function parseModelMappingVersion(root: XmlNode): ERModelMappingVersion {
  const nodes = selectReferencedVersionNodes(root, 'ERModelMappingVersion');
  if (nodes.length === 0) throw new Error('Missing ERModelMappingVersion element');

  const primaryNode = selectVersionNode(root, 'ERModelMappingVersion')!;
  const primary = parseModelMappingVersionNode(primaryNode);
  if (nodes.length === 1) return primary;

  // A solution may store each DataContainerDescriptor definition as its own
  // ERModelMappingVersion component (sibling version nodes). Merge the
  // definitions of every referenced component so consumers can pick the one
  // matching a format's descriptor instead of seeing only the first node.
  const seen = new Set<string>();
  const mappings: ERModelMapping[] = [];
  for (const node of nodes) {
    const version = node === primaryNode ? primary : parseModelMappingVersionNode(node);
    for (const mapping of version.mappings ?? [version.mapping]) {
      const key = mapping.id || `${mapping.name}::${mapping.dataContainerDescriptor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mappings.push(mapping);
    }
  }
  return { ...primary, mappings };
}

export function parseModelMappingVersionNode(vNode: XmlNode): ERModelMappingVersion {
  const idAttr = getAttr(vNode, 'ID.') ?? '';
  const id = idAttr.split(',')[0];

  // One version may carry several ERModelMapping definitions, each rooted in
  // a different DataContainerDescriptor. Parse them all.
  const mappingNodes = asArray(vNode['Mapping']?.['ERModelMapping']);
  if (mappingNodes.length === 0) throw new Error('Missing ERModelMapping element');
  const mappings = mappingNodes.map(parseModelMapping);

  return {
    id,
    dateTime: getAttr(vNode, 'DateTime') ?? '',
    description: getAttr(vNode, 'Description') ?? '',
    number: parseInt(getAttr(vNode, 'Number') ?? '0', 10),
    mapping: mappings[0],
    mappings,
  };
}

function parseModelMapping(node: XmlNode | undefined): ERModelMapping {
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

function parseBinding(node: XmlNode): ERBinding {
  return {
    path: getAttr(node, 'Path') ?? '',
    expressionAsString: getAttr(node, 'ExpressionAsString') ?? '',
    syntaxVersion: getAttr(node, 'SyntaxVersion')
      ? parseInt(getAttr(node, 'SyntaxVersion')!, 10)
      : undefined,
    expression: parseExpression(node['Expression']),
  };
}

function parseValidation(node: XmlNode): ERValidation {
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
      action:
        getAttr(c, 'Action')
        ?? getAttr(c, 'ValidationAction')
        ?? getAttr(c, 'Reaction')
        ?? undefined,
      severity:
        getAttr(c, 'Severity')
        ?? getAttr(c, 'ErrorLevel')
        ?? getAttr(c, 'MessageLevel')
        ?? undefined,
      stopProcessing:
        getAttr(c, 'StopProcessing') === '1'
        || getAttr(c, 'StopProcessing')?.toLowerCase() === 'true'
        || getAttr(c, 'StopExecution') === '1'
        || getAttr(c, 'StopExecution')?.toLowerCase() === 'true',
    }),
  );

  return {
    path: getAttr(node, 'Path') ?? '',
    conditions,
  };
}
