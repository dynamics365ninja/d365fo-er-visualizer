/**
 * The model-mapping binding hierarchy, as the F&O model-mapping designer shows
 * it: either just the bound paths, or every field of the data model definition
 * with the bindings hung on it — the designer's Show all / Show mapped /
 * Show unmapped switch.
 */
import type { ERDataContainerDescriptor, ERDataModel } from '@er-visualizer/core';
import { containerLookup } from './datasource-tree';

export type MappingFieldScope = 'all' | 'mapped' | 'unmapped';

export interface BindingTreeNode {
  /** Full binding path — also the collapse-state key. */
  key: string;
  /** Last path segment, i.e. what the F&O designer shows at this level. */
  name: string;
  /** Label of the data model field at this path, when the model is loaded. */
  label?: string;
  children: BindingTreeNode[];
  binding?: any;
  /** Number of bindings in this subtree, including this node. */
  count: number;
  /** Fields of the data model in this subtree that nothing binds. */
  unmappedCount: number;
  /** The data model declares this field (false: only a binding names the path). */
  inModel: boolean;
  /** ER field type of the model field (`fieldTypeLabel` names it). */
  fieldType?: number;
}

/** Field type of a record list — the one kind of field a mapping binds as a whole and also below. */
const RECORD_LIST = 11;

/**
 * Upper bound on model fields materialised for one definition. Records are
 * shared and nest, so a large model expanded in full can reach far beyond what
 * anyone browses; past this the deepest levels are left out.
 */
const MAX_MODEL_FIELDS = 25_000;

const byName = (left: BindingTreeNode, right: BindingTreeNode) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });

function newNode(path: string, labelFor: (path: string) => string | undefined, inModel: boolean): BindingTreeNode {
  const slash = path.lastIndexOf('/');
  return {
    key: path,
    name: slash >= 0 ? path.slice(slash + 1) : path,
    label: labelFor(path),
    children: [],
    count: 0,
    unmappedCount: 0,
    inModel,
  };
}

/** A field nothing binds and nothing below it could: what "unmapped" lists. */
function isUnmappedField(node: BindingTreeNode): boolean {
  return node.inModel && !node.binding && (node.children.length === 0 || node.fieldType === RECORD_LIST);
}

function tally(node: BindingTreeNode): void {
  node.children.sort(byName);
  node.children.forEach(tally);
  node.count = (node.binding ? 1 : 0) + node.children.reduce((sum, c) => sum + c.count, 0);
  node.unmappedCount = (isUnmappedField(node) ? 1 : 0) + node.children.reduce((sum, c) => sum + c.unmappedCount, 0);
}

/**
 * Nest the flat `parent/child/leaf` binding paths, optionally on top of every
 * field of the data model below `root`. Levels that carry no binding of their
 * own are still materialised so the hierarchy stays continuous.
 */
export function buildFieldTree(
  bindings: readonly any[],
  labelFor: (path: string) => string | undefined = () => undefined,
  model?: { model: ERDataModel; descriptor: string },
): BindingTreeNode[] {
  const roots: BindingTreeNode[] = [];
  // Case-insensitive: binding paths and model field names differ in case at times.
  const index = new Map<string, BindingTreeNode>();
  const attach = (node: BindingTreeNode, parentPath: string | null) => {
    index.set(node.key.toLowerCase(), node);
    if (parentPath === null) roots.push(node);
    else index.get(parentPath.toLowerCase())!.children.push(node);
  };

  if (model) addModelFields(model.model, model.descriptor, labelFor, attach);

  const ensure = (path: string): BindingTreeNode => {
    const existing = index.get(path.toLowerCase());
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parentPath = slash >= 0 ? path.slice(0, slash) : null;
    if (parentPath !== null) ensure(parentPath);
    const node = newNode(path, labelFor, false);
    attach(node, parentPath);
    return node;
  };
  for (const b of bindings) ensure(b.path).binding = b;

  // Alphabetical by name at every level, as the F&O model-mapping designer
  // lists the model — the order paths happen to appear in the XML means nothing.
  roots.forEach(tally);
  return roots.sort(byName);
}

function addModelFields(
  model: ERDataModel,
  descriptor: string,
  labelFor: (path: string) => string | undefined,
  attach: (node: BindingTreeNode, parentPath: string | null) => void,
): void {
  const lookup = containerLookup(model);
  const root = lookup(descriptor);
  if (!root) return;
  let budget = MAX_MODEL_FIELDS;
  // A record that contains itself (directly or further down) stops at the
  // second visit on the same path, as nothing new lies below it.
  const walk = (container: ERDataContainerDescriptor, parentPath: string | null, onPath: Set<ERDataContainerDescriptor>) => {
    for (const item of container.items) {
      if (budget-- <= 0) return;
      const path = parentPath === null ? item.name : `${parentPath}/${item.name}`;
      const node = newNode(path, labelFor, true);
      node.fieldType = item.type;
      attach(node, parentPath);
      const child = item.typeDescriptor ? lookup(item.typeDescriptor) : undefined;
      // Enum values are not fields a mapping binds.
      if (child && !child.isEnum && !onPath.has(child)) {
        onPath.add(child);
        walk(child, path, onPath);
        onPath.delete(child);
      }
    }
  };
  walk(root, null, new Set([root]));
}

/**
 * The part of the tree a scope and a text filter leave: a node stays when it
 * qualifies itself or anything below it does. Returns new nodes, recounted.
 */
export function pruneFieldTree(
  roots: readonly BindingTreeNode[],
  scope: MappingFieldScope,
  matches: (node: BindingTreeNode) => boolean = () => true,
): BindingTreeNode[] {
  const qualifies = (node: BindingTreeNode) =>
    matches(node) && (scope === 'all' || (scope === 'mapped' ? Boolean(node.binding) : isUnmappedField(node)));
  const prune = (node: BindingTreeNode): BindingTreeNode | null => {
    const children = node.children.map(prune).filter((c): c is BindingTreeNode => c !== null);
    if (children.length === 0 && !qualifies(node)) return null;
    const copy: BindingTreeNode = { ...node, children };
    copy.count = (node.binding ? 1 : 0) + children.reduce((s, c) => s + c.count, 0);
    copy.unmappedCount = (isUnmappedField(node) && matches(node) ? 1 : 0) + children.reduce((s, c) => s + c.unmappedCount, 0);
    return copy;
  };
  return roots.map(prune).filter((n): n is BindingTreeNode => n !== null);
}
