import type { ERBinding, ERDataContainerDescriptor, ERDataContainerItem, ERDataModel, ERFormatElement } from '@er-visualizer/core';
import { normalizeGuid, type NormalizedFormatBinding, type NormalizedFormatBindingGroup } from './format-binding-display';
import { classifyBindingIntent, type BindingIntent } from './format-binding-sections';

/**
 * The Bindings tab seen from the data model: which model fields a format reads,
 * where it puts them, and what in the model mapping fills them. The format
 * view answers "what is in this file"; this one answers "what does this file
 * need from the model" — the question behind every change to a model or a
 * mapping.
 */

/** ER field type of a record (a container that is not a list). */
const FIELD_TYPE_CONTAINER = 10;

const IDENTIFIER = String.raw`(?:[A-Za-z_$#][\w$#]*|'(?:[^']|'')*')`;
const PATH_CHAIN = new RegExp(String.raw`(?<![\w$#.'])(@(?=\s*\.)|${IDENTIFIER})((?:\s*\.\s*${IDENTIFIER})*)`, 'g');
const SEGMENT = new RegExp(IDENTIFIER, 'g');
/** String literals and label references: `"a.b"`, `@"GER_LABEL:X"`, `@GER_LABEL:X`. */
const NON_PATH_TEXT = /@?"(?:[^"]|"")*"|@[A-Za-z_]\w*:[\w.\-]+/g;

const unquote = (segment: string) => (segment.startsWith("'") ? segment.slice(1, -1).replace(/''/g, "'") : segment);

/**
 * Every data model path an expression reads, as segments below the model root:
 * `IF(model.Invoice.Amount > 0, model.Invoice.Currency, "")` gives
 * `[Invoice, Amount]` and `[Invoice, Currency]`.
 *
 * `@.Field` is resolved against `context`, the path of the record list the
 * element iterates. A segment starting with `$` or `#` is a calculated field
 * the format hangs under a model node, not a model field — the path stops
 * before it.
 */
export function extractModelPaths(
  expression: string,
  modelNames: ReadonlySet<string>,
  context?: readonly string[],
): string[][] {
  const text = expression.replace(NON_PATH_TEXT, match => ' '.repeat(match.length));
  const seen = new Set<string>();
  const paths: string[][] = [];

  for (const match of text.matchAll(PATH_CHAIN)) {
    const [, root, tail] = match;
    const rest = Array.from(tail.matchAll(SEGMENT), m => unquote(m[0]));
    let segments: string[];
    if (root === '@') {
      if (!context) continue;
      segments = [...context, ...rest];
    } else {
      if (!modelNames.has(unquote(root).toLowerCase())) continue;
      segments = rest;
    }

    const calculated = segments.findIndex(segment => segment.startsWith('$') || segment.startsWith('#'));
    if (calculated >= 0) segments = segments.slice(0, calculated);
    if (segments.length === 0) continue;

    const key = segments.join('/').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(segments);
  }

  return paths;
}

export interface ModelPathUsage {
  group: NormalizedFormatBindingGroup;
  binding: NormalizedFormatBinding;
  intent: BindingIntent;
}

export interface ModelUsageNode {
  /** Lower-cased path — ER names are case-insensitive, so this is the identity. */
  key: string;
  /** Path as the format first spells it, `InvoiceBase/CompanyInfo/Name`. */
  path: string;
  name: string;
  children: ModelUsageNode[];
  /** Bindings that read exactly this path. */
  usages: ModelPathUsage[];
  /** The model field, when the data model is loaded and has it. */
  field?: ERDataContainerItem;
  /** The model mapping binding that fills this path. */
  mapping?: ERBinding;
  /** Whether a model mapping was available to look the path up in. */
  mappingLoaded: boolean;
  /** Read by the format, not a record, and nothing in the mapping fills it. */
  unmapped: boolean;
  usageCount: number;
  /** Paths in this subtree the format reads directly. */
  fieldCount: number;
  unmappedCount: number;
}

export interface ModelUsageInput {
  rootElement: ERFormatElement;
  groups: readonly NormalizedFormatBindingGroup[];
  /** Lower-cased names of the format's data model datasources, normally just `model`. */
  modelNames: ReadonlySet<string>;
  /** Bindings of the mapping definition the format runs on; `null` when none is loaded. */
  mappingBindings: readonly ERBinding[] | null;
  dataModel?: { model: ERDataModel; descriptor: string } | null;
}

/**
 * The model paths a format reads, as a tree in the order the format first
 * reaches them. The element tree is walked so `@.` paths resolve against the
 * record list of the nearest enclosing element bound to one.
 */
export function buildModelUsageTree(input: ModelUsageInput): ModelUsageNode[] {
  const { rootElement, groups, modelNames, mappingBindings, dataModel } = input;

  const mappingByPath = mappingBindings ? new Map<string, ERBinding>() : null;
  for (const binding of mappingBindings ?? []) {
    const key = binding.path.toLowerCase();
    if (!mappingByPath!.has(key)) mappingByPath!.set(key, binding);
  }
  const fieldAt = dataModel ? indexDataModel(dataModel.model, dataModel.descriptor) : () => undefined;

  const roots: ModelUsageNode[] = [];
  const index = new Map<string, ModelUsageNode>();
  const ensure = (segments: string[]): ModelUsageNode => {
    const key = segments.join('/').toLowerCase();
    const existing = index.get(key);
    if (existing) return existing;
    const parent = segments.length > 1 ? ensure(segments.slice(0, -1)) : null;
    const node: ModelUsageNode = {
      key,
      path: segments.join('/'),
      name: segments[segments.length - 1],
      children: [],
      usages: [],
      field: fieldAt(segments),
      mapping: mappingByPath?.get(key),
      mappingLoaded: mappingByPath !== null,
      unmapped: false,
      usageCount: 0,
      fieldCount: 0,
      unmappedCount: 0,
    };
    index.set(key, node);
    (parent ? parent.children : roots).push(node);
    return node;
  };

  const record = (group: NormalizedFormatBindingGroup, context: readonly string[] | undefined) => {
    for (const binding of group.bindings) {
      const intent = classifyBindingIntent(binding);
      for (const segments of extractModelPaths(binding.expressionAsString ?? '', modelNames, context)) {
        ensure(segments).usages.push({ group, binding, intent });
      }
    }
  };

  const pending = new Map<string, NormalizedFormatBindingGroup>();
  for (const group of groups) pending.set(normalizeGuid(group.componentId), group);

  const visit = (element: ERFormatElement, context: readonly string[] | undefined) => {
    let childContext = context;
    const id = normalizeGuid(element.id);
    const group = pending.get(id);
    if (group) {
      pending.delete(id);
      record(group, context);
      // An element bound to a bare path is what `@` means for its children.
      const data = group.dataBindings[0];
      if (data && classifyBindingIntent(data) === 'direct') {
        const [path] = extractModelPaths(data.expressionAsString ?? '', modelNames, context);
        if (path) childContext = path;
      }
    }
    for (const child of element.children ?? []) visit(child, childContext);
  };
  visit(rootElement, undefined);
  for (const group of pending.values()) record(group, undefined);

  return filterModelUsageTree(roots, {});
}

export interface ModelUsageFilter {
  /** Usages to keep — the intent chips. */
  keepUsage?: (usage: ModelPathUsage) => boolean;
  /** A matching node keeps its whole subtree, as a text filter does. */
  matchNode?: (node: ModelUsageNode) => boolean;
  /** Keep only paths without a mapping binding (and the branches leading to them). */
  onlyUnmapped?: boolean;
}

/**
 * A narrowed copy of the tree with every count recomputed. A branch left with
 * nothing below it disappears; a node that stays only because of its children
 * loses its own usages.
 */
export function filterModelUsageTree(nodes: readonly ModelUsageNode[], filter: ModelUsageFilter): ModelUsageNode[] {
  const walk = (node: ModelUsageNode, ancestorMatched: boolean): ModelUsageNode | null => {
    const matched = !filter.matchNode || ancestorMatched || filter.matchNode(node);
    const children = node.children
      .map(child => walk(child, matched && Boolean(filter.matchNode)))
      .filter((child): child is ModelUsageNode => child !== null);

    const usages = filter.keepUsage ? node.usages.filter(filter.keepUsage) : node.usages;
    // Without the data model, a path that has paths below it is taken for a record.
    const isRecord = node.field ? node.field.type === FIELD_TYPE_CONTAINER : node.children.length > 0;
    const unmapped = node.mappingLoaded && !node.mapping && !isRecord && usages.length > 0;
    const keepSelf = matched && usages.length > 0 && (!filter.onlyUnmapped || unmapped);
    if (!keepSelf && children.length === 0) return null;

    const own = keepSelf ? usages : [];
    return {
      ...node,
      children,
      usages: own,
      unmapped: keepSelf && unmapped,
      usageCount: own.length + children.reduce((sum, child) => sum + child.usageCount, 0),
      fieldCount: (own.length > 0 ? 1 : 0) + children.reduce((sum, child) => sum + child.fieldCount, 0),
      unmappedCount: (keepSelf && unmapped ? 1 : 0) + children.reduce((sum, child) => sum + child.unmappedCount, 0),
    };
  };

  return nodes.map(node => walk(node, false)).filter((node): node is ModelUsageNode => node !== null);
}

/** Bindings per intent in the tree — each binding once, however many paths it reads. */
export function countModelUsageIntents(nodes: readonly ModelUsageNode[]): Record<BindingIntent, number> {
  const seen: Record<BindingIntent, Set<NormalizedFormatBinding>> = {
    direct: new Set(), calculated: new Set(), condition: new Set(), text: new Set(), property: new Set(),
  };
  const walk = (node: ModelUsageNode) => {
    for (const usage of node.usages) seen[usage.intent].add(usage.binding);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return {
    direct: seen.direct.size,
    calculated: seen.calculated.size,
    condition: seen.condition.size,
    text: seen.text.size,
    property: seen.property.size,
  };
}

/** Field lookup by path below the descriptor's root container. */
function indexDataModel(model: ERDataModel, descriptor: string): (segments: readonly string[]) => ERDataContainerItem | undefined {
  const byId = new Map<string, ERDataContainerDescriptor>();
  const byName = new Map<string, ERDataContainerDescriptor>();
  for (const container of model.containers) {
    byId.set(container.id.toLowerCase(), container);
    if (!byName.has(container.name.toLowerCase())) byName.set(container.name.toLowerCase(), container);
  }
  // `typeDescriptor` names a container by id; ids and names coincide in practice.
  const lookup = (ref: string) => byId.get(ref.toLowerCase()) ?? byName.get(ref.toLowerCase());
  const root = lookup(descriptor);

  return segments => {
    let container = root;
    let field: ERDataContainerItem | undefined;
    for (const segment of segments) {
      field = container?.items.find(item => item.name.toLowerCase() === segment.toLowerCase());
      if (!field) return undefined;
      container = field.typeDescriptor ? lookup(field.typeDescriptor) : undefined;
    }
    return field;
  };
}
