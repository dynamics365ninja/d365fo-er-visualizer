import type { ERDataContainerDescriptor, ERDataContainerItem, ERDataModel, ERDatasource } from '@er-visualizer/core';
import { normGuid } from './model-hierarchy';

/**
 * The datasources of a mapping or format definition as one browsable tree.
 *
 * The parser nests every datasource under its ParentPath and stands in for
 * segments the definition never declares with implicit nodes. Below a `model`
 * datasource those segments are records of the data model, so once the model
 * is loaded this tree shows the model's own structure there: a calculated
 * field the format hangs under a record sits next to that record's fields.
 * Model children are produced on demand — a model reached through
 * `typeDescriptor` links is far too large to walk up front.
 */

/** ER field types whose `typeDescriptor` names a record with fields of its own. */
const FIELD_TYPE_RECORD = 10;
const FIELD_TYPE_RECORD_LIST = 11;

const stripDecoration = (segment: string) => segment.trim().replace(/^[$#]/, '');
const keySegment = (name: string) => stripDecoration(name).toLowerCase();

/**
 * Identity of a datasource path: lower-cased, with the `$` / `#` name
 * decorations stripped per segment — ER matches names that way.
 */
export function datasourcePathKey(parentPath: string | undefined, name: string): string {
  return [...(parentPath ?? '').split('/'), name].map(keySegment).filter(Boolean).join('/');
}

/** The keys of every node above `key`, outermost first. */
export function ancestorPathKeys(key: string): string[] {
  const segments = key.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}

export interface DatasourceTreeNode {
  /** See {@link datasourcePathKey}. */
  key: string;
  name: string;
  /** Segments as spelled, root first. */
  path: readonly string[];
  /** The datasource at this path — declared, or an implicit stand-in for a path segment. */
  datasource?: ERDatasource;
  /** The data model field at this path, when the tree runs through a loaded data model. */
  field?: ERDataContainerItem;
  /** The record whose fields are this node's model children. */
  container?: ERDataContainerDescriptor;
  /** Datasources the definition declares below this node. */
  declaredCount: number;
}

export interface DatasourceModel {
  model: ERDataModel;
  /** Root container the datasource enters the model through. */
  descriptor: string;
}

export interface DatasourceTree {
  roots: DatasourceTreeNode[];
  childrenOf(node: DatasourceTreeNode): DatasourceTreeNode[];
  hasChildren(node: DatasourceTreeNode): boolean;
}

type ContainerLookup = (ref: string | undefined) => ERDataContainerDescriptor | undefined;

/** Container lookup by id or name — `typeDescriptor` names a container by id, and ids and names coincide in practice. */
export function containerLookup(model: ERDataModel): ContainerLookup {
  const byId = new Map<string, ERDataContainerDescriptor>();
  const byName = new Map<string, ERDataContainerDescriptor>();
  for (const container of model.containers) {
    if (container.id && !byId.has(container.id.toLowerCase())) byId.set(container.id.toLowerCase(), container);
    if (container.name && !byName.has(container.name.toLowerCase())) byName.set(container.name.toLowerCase(), container);
  }
  return ref => (ref ? byId.get(ref.toLowerCase()) ?? byName.get(ref.toLowerCase()) : undefined);
}

/** The loaded data model holding `descriptor`, preferring the models in `preferredIds`. */
export function findModelForDescriptor(
  models: readonly ERDataModel[],
  descriptor: string,
  preferredIds: ReadonlySet<string> = new Set(),
): ERDataModel | undefined {
  const key = descriptor.trim().toLowerCase();
  if (!key) return undefined;
  const holds = (model: ERDataModel) =>
    model.containers.some(container => container.name.toLowerCase() === key || container.id.toLowerCase() === key);
  return models.find(model => preferredIds.has(normGuid(model.id)) && holds(model)) ?? models.find(holds);
}

/** Datasources a definition declares, at every depth — implicit path nodes are not counted. */
export function countDeclaredDatasources(datasources: readonly ERDatasource[]): number {
  return datasources.reduce(
    (sum, ds) => sum + (ds.implicit ? 0 : 1) + countDeclaredDatasources(ds.children ?? []),
    0,
  );
}

export function buildDatasourceTree(
  datasources: readonly ERDatasource[],
  resolveModel?: (datasource: ERDatasource) => DatasourceModel | null,
): DatasourceTree {
  const declaredCounts = new WeakMap<ERDatasource, number>();
  const declaredBelow = (ds: ERDatasource): number => {
    let count = declaredCounts.get(ds);
    if (count === undefined) {
      count = countDeclaredDatasources(ds.children ?? []);
      declaredCounts.set(ds, count);
    }
    return count;
  };

  const lookups = new WeakMap<DatasourceTreeNode, ContainerLookup>();
  const make = (
    parent: DatasourceTreeNode | null,
    name: string,
    datasource: ERDatasource | undefined,
    field: ERDataContainerItem | undefined,
    inheritedLookup: ContainerLookup | undefined,
  ): DatasourceTreeNode => {
    let lookup = inheritedLookup;
    let container: ERDataContainerDescriptor | undefined;
    if (datasource?.type === 'DataModel') {
      const resolved = resolveModel?.(datasource);
      if (resolved) {
        lookup = containerLookup(resolved.model);
        container = lookup(resolved.descriptor);
      }
    } else if (field && lookup && (field.type === FIELD_TYPE_RECORD || field.type === FIELD_TYPE_RECORD_LIST)) {
      container = lookup(field.typeDescriptor);
    }
    const node: DatasourceTreeNode = {
      key: parent ? `${parent.key}/${keySegment(name)}` : keySegment(name),
      name,
      path: parent ? [...parent.path, name] : [name],
      datasource,
      field,
      container,
      declaredCount: datasource ? declaredBelow(datasource) : 0,
    };
    if (lookup) lookups.set(node, lookup);
    return node;
  };

  const cache = new Map<DatasourceTreeNode, DatasourceTreeNode[]>();
  const childrenOf = (node: DatasourceTreeNode): DatasourceTreeNode[] => {
    const cached = cache.get(node);
    if (cached) return cached;

    const lookup = lookups.get(node);
    const items = node.container?.items ?? [];
    const itemsByName = new Map<string, ERDataContainerItem>();
    for (const item of items) {
      if (!itemsByName.has(item.name.toLowerCase())) itemsByName.set(item.name.toLowerCase(), item);
    }

    // What the definition adds comes first — in a record of a few hundred
    // fields, a calculated field listed among them would be lost. A declared
    // node that *is* a model field (an implicit record) takes that field's place.
    const own: DatasourceTreeNode[] = [];
    const atField = new Map<ERDataContainerItem, DatasourceTreeNode>();
    for (const child of node.datasource?.children ?? []) {
      const item = itemsByName.get(child.name.trim().toLowerCase());
      const childNode = make(node, child.name, child, item, lookup);
      if (item && !atField.has(item)) atField.set(item, childNode);
      else own.push(childNode);
    }
    const children = [
      ...own,
      ...items.map(item => atField.get(item) ?? make(node, item.name, undefined, item, lookup)),
    ];
    cache.set(node, children);
    return children;
  };

  return {
    roots: datasources.map(ds => make(null, ds.name, ds, undefined, undefined)),
    childrenOf,
    hasChildren: node => (node.datasource?.children?.length ?? 0) > 0 || (node.container?.items.length ?? 0) > 0,
  };
}

export interface DatasourceTreeFilter {
  /** Nodes that match the filter themselves. */
  matched: Set<string>;
  /** Nodes above a match — shown, and expanded, while the filter is applied. */
  ancestors: Set<string>;
}

/**
 * Datasources matching `text` by name, type or what they read (table, class,
 * enum), at any depth. Model fields are not searched: the model behind a
 * `model` datasource is unbounded, and the model layout view covers it.
 */
export function filterDatasources(datasources: readonly ERDatasource[], text: string): DatasourceTreeFilter | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;

  const matched = new Set<string>();
  const ancestors = new Set<string>();
  const visit = (ds: ERDatasource, parentKeys: string[]) => {
    const key = [...parentKeys.slice(-1), keySegment(ds.name)].join('/');
    const candidates = [ds.name, ds.implicit ? undefined : ds.type, ds.tableInfo?.tableName, ds.classInfo?.className, ds.enumInfo?.enumName];
    if (candidates.some(value => value?.toLowerCase().includes(needle))) {
      matched.add(key);
      for (const parentKey of parentKeys) ancestors.add(parentKey);
    }
    for (const child of ds.children ?? []) visit(child, [...parentKeys, key]);
  };
  for (const ds of datasources) visit(ds, []);
  return { matched, ancestors };
}

/** Keys of every node with declared datasources below it — what "expand all" opens. */
export function keysWithDeclaredDescendants(datasources: readonly ERDatasource[]): Set<string> {
  const keys = new Set<string>();
  const visit = (ds: ERDatasource, parentKey: string) => {
    const key = parentKey ? `${parentKey}/${keySegment(ds.name)}` : keySegment(ds.name);
    if (countDeclaredDatasources(ds.children ?? []) > 0) keys.add(key);
    for (const child of ds.children ?? []) visit(child, key);
  };
  for (const ds of datasources) visit(ds, '');
  return keys;
}
