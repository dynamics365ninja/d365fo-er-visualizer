import type { ERConfiguration, GUIDEntry } from '@er-visualizer/core';
import { activeMappingDefinitionLabel } from '../state/store';
import type { TreeNode } from '../state/store';

/** The registry cross-ref fields the search panel resolves to a tree node. */
export type SearchResultEntry = {
  target: string;
  targetType: string;
  sourceConfigPath: string;
  sourceComponent: string;
  /** Mapping definition the hit was indexed in, when it came from a mapping. */
  sourceDefinition?: string;
  sourceContext: string;
};

/**
 * Lookup tables over one configuration's tree (its root excluded). Every list
 * is in pre-order, so the first entry is the node a depth-first walk would
 * have found first.
 */
interface ConfigNodeIndex {
  root: TreeNode;
  /** Pre-order position, to merge candidates from several lists. */
  order: Map<TreeNode, number>;
  parent: Map<TreeNode, TreeNode>;
  byType: Map<string, TreeNode[]>;
  byTypeAndName: Map<string, TreeNode[]>;
  byDataId: Map<string, TreeNode[]>;
  bindingsByPath: Map<string, TreeNode[]>;
  formatBindingsByComponent: Map<string, TreeNode[]>;
  formatBindingsByExpression: Map<string, TreeNode[]>;
  validationsByConditionId: Map<string, TreeNode[]>;
}

/**
 * Resolving a search hit used to walk the whole tree once per hit, which a
 * broad query turned into thousands of full walks. The index is built once
 * per tree (the panel memoises it on `treeNodes`) and each hit then resolves
 * with a few map lookups.
 */
export interface SearchNodeIndex {
  configs: Array<ConfigNodeIndex | undefined>;
  configIndexByPath: Map<string, number>;
}

function push(map: Map<string, TreeNode[]>, key: unknown, node: TreeNode): void {
  if (typeof key !== 'string') return;
  const list = map.get(key);
  if (list) list.push(node);
  else map.set(key, [node]);
}

const typeNameKey = (type: string, name: string) => `${type}\u0001${name}`;

function buildConfigIndex(root: TreeNode): ConfigNodeIndex {
  const index: ConfigNodeIndex = {
    root,
    order: new Map(),
    parent: new Map(),
    byType: new Map(),
    byTypeAndName: new Map(),
    byDataId: new Map(),
    bindingsByPath: new Map(),
    formatBindingsByComponent: new Map(),
    formatBindingsByExpression: new Map(),
    validationsByConditionId: new Map(),
  };

  const visit = (nodes: TreeNode[], parent: TreeNode | null) => {
    for (const node of nodes) {
      index.order.set(node, index.order.size);
      if (parent) index.parent.set(node, parent);
      push(index.byType, node.type, node);
      push(index.byTypeAndName, typeNameKey(node.type, node.name), node);
      push(index.byDataId, node.data?.id, node);
      if (node.type === 'binding') push(index.bindingsByPath, node.data?.path, node);
      if (node.type === 'formatBinding') {
        push(index.formatBindingsByComponent, node.data?.componentId, node);
        push(index.formatBindingsByExpression, node.data?.expressionAsString, node);
      }
      if (node.type === 'validation' && Array.isArray(node.data?.conditions)) {
        for (const condition of node.data.conditions as Array<{ id?: string }>) {
          push(index.validationsByConditionId, condition?.id, node);
        }
      }
      if (node.children) visit(node.children, node);
    }
  };
  visit(root.children ?? [], null);
  return index;
}

export function buildSearchNodeIndex(
  treeNodes: TreeNode[],
  configurations: Array<{ filePath: string }>,
): SearchNodeIndex {
  const configIndexByPath = new Map<string, number>();
  configurations.forEach((config, i) => {
    if (!configIndexByPath.has(config.filePath)) configIndexByPath.set(config.filePath, i);
  });
  return {
    configs: treeNodes.map(root => (root ? buildConfigIndex(root) : undefined)),
    configIndexByPath,
  };
}

/**
 * First candidate in tree order, preferring one inside `preferredDefinition`
 * (a mapping solution maps the same path in each of its definitions). Several
 * lists stand for an OR of predicates and are merged by tree position.
 */
function pick(
  index: ConfigNodeIndex,
  preferredDefinition: string | undefined,
  ...lists: Array<TreeNode[] | undefined>
): TreeNode | null {
  const present = lists.filter((list): list is TreeNode[] => !!list && list.length > 0);
  if (present.length === 0) return null;
  const candidates = present.length === 1
    ? present[0]
    : [...new Set(present.flat())].sort((a, b) => index.order.get(a)! - index.order.get(b)!);
  if (!preferredDefinition) return candidates[0];
  return candidates.find(node => node.mappingDefinition === preferredDefinition) ?? candidates[0];
}

function filterType(list: TreeNode[] | undefined, type: string): TreeNode[] | undefined {
  return list?.filter(node => node.type === type);
}

export function findNodeForSearchResult(
  result: SearchResultEntry,
  configurations: Array<{ filePath: string }>,
  nodeIndex: SearchNodeIndex,
  registry: { lookup: (guid: string) => GUIDEntry | undefined },
): TreeNode | null {
  const configIndex = nodeIndex.configIndexByPath.get(result.sourceConfigPath);
  if (configIndex == null) return null;

  const index = nodeIndex.configs[configIndex];
  if (!index) return null;
  const rootNode = index.root;

  const sourceExpr = extractExpressionFromContext(result.sourceContext);
  // The same binding path is mapped in every definition of a mapping solution;
  // resolve against the one the loaded format goes through.
  const preferred = result.sourceDefinition
    ?? activeMappingDefinitionLabel(configurations as ERConfiguration[], configIndex);
  const bindingAt = (path: string) => pick(index, preferred, index.bindingsByPath.get(path));

  if (result.sourceContext === 'TypeDescriptor reference in model field') {
    return findFieldNode(index, result.sourceComponent);
  }

  if (result.sourceContext === 'Model mapping references data model') {
    return pick(index, preferred, index.byType.get('mapping'))
      ?? (rootNode.data?.kind === 'ModelMapping' ? rootNode : null);
  }

  if (result.sourceContext === 'Format mapping references format definition') {
    return pick(index, preferred, index.byType.get('format'))
      ?? (rootNode.data?.kind === 'Format' ? rootNode : null);
  }

  if (result.sourceContext === 'Base model reference') {
    return rootNode;
  }

  if (result.sourceContext.startsWith('Binding:')) {
    return bindingAt(result.target);
  }

  if (result.sourceContext.startsWith('Binding for ')) {
    const bindingPath = result.sourceContext.slice('Binding for '.length).split(':')[0]?.trim();
    if (bindingPath) return bindingAt(bindingPath);
  }

  if (result.sourceContext.startsWith('Format binding to component:')) {
    return pick(
      index,
      preferred,
      filterType(index.byDataId.get(result.target), 'formatElement'),
      index.formatBindingsByComponent.get(result.target),
    );
  }

  if (result.sourceContext.startsWith('Format binding expression:') && sourceExpr) {
    const bindingNode = findFormatBindingNode(index, sourceExpr);
    if (bindingNode) return bindingNode;
  }

  if (result.targetType === 'GUID') {
    const guidNode = resolveGuidTargetNode(result.target, nodeIndex, registry)
      ?? pick(index, preferred, index.byDataId.get(result.target));
    if (guidNode) return guidNode;
  }

  if (result.targetType === 'ModelPath') {
    const bindingNode = bindingAt(result.target);
    if (bindingNode) return bindingNode;
  }

  if (result.targetType === 'Formula') {
    if (sourceExpr) {
      const formatBindingNode = findFormatBindingNode(index, sourceExpr);
      if (formatBindingNode) return formatBindingNode;
    }

    const bindingPath = result.sourceContext.startsWith('Binding for ')
      ? result.sourceContext.slice('Binding for '.length).split(':')[0]?.trim()
      : null;
    if (bindingPath) {
      const bindingNode = bindingAt(bindingPath);
      if (bindingNode) return bindingNode;
    }
  }

  return pick(index, preferred, index.byTypeAndName.get(typeNameKey('datasource', result.sourceComponent)));
}

/** A model field named `Container.Field`: the field node directly under that container. */
function findFieldNode(index: ConfigNodeIndex, sourceComponent: string): TreeNode | null {
  const [containerName, fieldName] = sourceComponent.split('.');
  if (fieldName == null) return null;
  const fields = index.byTypeAndName.get(typeNameKey('field', fieldName)) ?? [];
  return fields.find(node => {
    const parentContainer = index.parent.get(node);
    return parentContainer?.type === 'container' && parentContainer.name === containerName;
  }) ?? null;
}

function findFormatBindingNode(index: ConfigNodeIndex, expression: string): TreeNode | null {
  return pick(index, undefined, index.formatBindingsByExpression.get(expression));
}

function resolveGuidTargetNode(
  guid: string,
  nodeIndex: SearchNodeIndex,
  registry: { lookup: (guid: string) => GUIDEntry | undefined },
): TreeNode | null {
  const entry = registry.lookup(guid);
  if (!entry) return null;

  const configIndex = nodeIndex.configIndexByPath.get(entry.configFilePath);
  if (configIndex == null) return null;

  const index = nodeIndex.configs[configIndex];
  if (!index) return null;
  const rootNode = index.root;
  const withId = index.byDataId.get(guid);

  switch (entry.kind) {
    case 'Solution':
      return rootNode;
    case 'ModelVersion':
      return pick(index, undefined, index.byType.get('model'))
        ?? (rootNode.data?.kind === 'DataModel' ? rootNode : null);
    case 'MappingVersion':
      return pick(index, undefined, index.byType.get('mapping'))
        ?? (rootNode.data?.kind === 'ModelMapping' ? rootNode : null);
    case 'FormatVersion':
    case 'FormatMappingVersion':
      return pick(index, undefined, index.byType.get('format'))
        ?? (rootNode.data?.kind === 'Format' ? rootNode : null);
    case 'Container':
      return pick(index, undefined, filterType(withId, 'container'));
    case 'FormatElement':
      return pick(index, undefined, filterType(withId, 'formatElement'));
    case 'FormatEnum':
      return pick(index, undefined, filterType(withId, 'enum'));
    case 'Transformation':
      return pick(index, undefined, filterType(withId, 'transformation'));
    case 'ValidationRule':
      return pick(index, undefined, index.validationsByConditionId.get(guid));
    default:
      return pick(index, undefined, withId);
  }
}

function extractExpressionFromContext(sourceContext: string): string | null {
  const separatorIndex = sourceContext.indexOf(': ');
  if (separatorIndex === -1) return null;
  return sourceContext.slice(separatorIndex + 2).trim() || null;
}
