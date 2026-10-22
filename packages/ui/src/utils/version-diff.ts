/**
 * What changed between two versions of one configuration: format elements
 * with their bindings, data sources, model mapping bindings and validations,
 * data model records and fields, format enumerations, transformations and
 * label texts — each matched by its GUID where ER gives it one, otherwise by
 * its path. Pure: the compare view renders the result, the CSV export writes
 * it out.
 */
import {
  ERFieldType,
  ERVersionStatus,
  type ERConfiguration,
  type ERDataContainerDescriptor,
  type ERDataModelContent,
  type ERDatasource,
  type ERFormatContent,
  type ERFormatElement,
  type ERModelMapping,
  type ERModelMappingContent,
  type ERModelMappingVersion,
} from '@er-visualizer/core';
import { compareConfigVersions } from '../state/configuration-merge';
import { getMappingDefinitions } from '../state/mapping-definitions';
import { getBestVersion, mappingDefinitionLabel, normGuid } from './model-hierarchy';
import type { SearchLocator } from './search-index';

export type ChangeKind = 'added' | 'removed' | 'changed';

export type DiffItemKind =
  | 'element'
  | 'binding'
  | 'datasource'
  | 'validation'
  | 'definition'
  | 'record'
  | 'field'
  | 'formatEnum'
  | 'transformation'
  | 'label'
  | 'template'
  // Inside the template workbook:
  | 'sheet'
  | 'cell'
  | 'merge'
  | 'drawing'
  | 'layout'
  | 'namedRange';

/**
 * One property of an item, before and after. Keys are stable identifiers the
 * view translates (`name`, `binding`, `expression`, …); `@Name` is a raw
 * attribute of a format element, `binding:Enabled` the binding of one of its
 * properties.
 */
export interface PropertyChange {
  key: string;
  before?: string;
  after?: string;
}

export interface DiffEntry {
  id: string;
  change: ChangeKind;
  itemKind: DiffItemKind;
  /** Where the item sits — in the newer version, or in the older one for a removed item. */
  path: string;
  /** The older path of an item that was renamed or moved under another parent. */
  previousPath?: string;
  /** Element type, data source type, field type — whatever says what the item is. */
  typeLabel?: string;
  /** For `changed` the properties that differ; for `added` / `removed` every property the item has. */
  properties: PropertyChange[];
  /** Where the item is in the explorer tree of each side (as a search hit locates it). */
  locateOlder?: SearchLocator;
  locateNewer?: SearchLocator;
  /** An item of the template workbook: its sheet (a key of the workbook comparison) and cell on each side. */
  templateCell?: { sheet: string; olderRef?: string; newerRef?: string };
}

export type DiffSectionKind =
  | 'structure'
  | 'datasources'
  | 'bindings'
  | 'validations'
  | 'definitions'
  | 'records'
  | 'fields'
  | 'formatEnums'
  | 'transformations'
  | 'labels'
  | 'template'
  | 'templateNames';

export interface DiffSection {
  id: string;
  kind: DiffSectionKind;
  /** The mapping definition a section belongs to, when the configuration carries several. */
  scope?: string;
  /** Label of that definition on each side, to find its nodes in the explorer tree. */
  definitionOlder?: string;
  definitionNewer?: string;
  entries: DiffEntry[];
}

export interface VersionDiff {
  older: ERConfiguration;
  newer: ERConfiguration;
  /** Both sides are versions of the same configuration (same solution GUID and kind). */
  sameConfiguration: boolean;
  /** Version, date, description, status and base of both sides, whether they differ or not. */
  header: PropertyChange[];
  sections: DiffSection[];
  counts: Record<ChangeKind, number>;
}

// ─── Ordering the two sides ───

/**
 * Put two configurations in version order: the older one first. Versions that
 * compare equal fall back to the version date, then keep the given order.
 */
export function orderVersions(a: ERConfiguration, b: ERConfiguration): [older: ERConfiguration, newer: ERConfiguration] {
  const byVersion = compareConfigVersions(getBestVersion(a), getBestVersion(b));
  if (byVersion !== 0) return byVersion < 0 ? [a, b] : [b, a];
  const dateA = Date.parse(a.solutionVersion.dateTime ?? '');
  const dateB = Date.parse(b.solutionVersion.dateTime ?? '');
  if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateA < dateB ? [a, b] : [b, a];
  return [a, b];
}

// ─── Generic matching ───

interface Keyed<T> {
  key: string;
  /** Tried for whatever the key left unmatched — a path or a name when the GUID changed. */
  fallbackKey?: string;
  value: T;
}

interface Matched<T> {
  pairs: Array<[older: Keyed<T>, newer: Keyed<T>]>;
  removed: Keyed<T>[];
  added: Keyed<T>[];
}

/** Two items with the same key on one side keep apart as `key`, `key#2`, … */
function uniqueKeys<T>(items: Keyed<T>[]): Keyed<T>[] {
  const seen = new Map<string, number>();
  return items.map(item => {
    const count = (seen.get(item.key) ?? 0) + 1;
    seen.set(item.key, count);
    return count === 1 ? item : { ...item, key: `${item.key}#${count}` };
  });
}

function matchItems<T>(olderItems: Keyed<T>[], newerItems: Keyed<T>[]): Matched<T> {
  const older = uniqueKeys(olderItems);
  const newer = uniqueKeys(newerItems);
  const newerByKey = new Map(newer.map(item => [item.key, item]));
  const pairs: Matched<T>['pairs'] = [];
  const pairedNewer = new Set<Keyed<T>>();
  const unmatchedOlder: Keyed<T>[] = [];

  for (const item of older) {
    const twin = newerByKey.get(item.key);
    if (twin && !pairedNewer.has(twin)) {
      pairs.push([item, twin]);
      pairedNewer.add(twin);
    } else {
      unmatchedOlder.push(item);
    }
  }

  const newerByFallback = new Map<string, Keyed<T>>();
  for (const item of newer) {
    if (pairedNewer.has(item) || !item.fallbackKey || newerByFallback.has(item.fallbackKey)) continue;
    newerByFallback.set(item.fallbackKey, item);
  }
  const removed: Keyed<T>[] = [];
  for (const item of unmatchedOlder) {
    const twin = item.fallbackKey ? newerByFallback.get(item.fallbackKey) : undefined;
    if (twin && !pairedNewer.has(twin)) {
      pairs.push([item, twin]);
      pairedNewer.add(twin);
    } else {
      removed.push(item);
    }
  }

  return { pairs, removed, added: newer.filter(item => !pairedNewer.has(item)) };
}

type Props = Record<string, string | undefined>;

function clean(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return text.trim() === '' ? undefined : text;
}

/** The properties whose value differs; an empty and a missing value are the same. */
export function diffProperties(before: Props, after: Props): PropertyChange[] {
  const keys = [...Object.keys(before), ...Object.keys(after).filter(key => !(key in before))];
  const out: PropertyChange[] = [];
  for (const key of keys) {
    const b = clean(before[key]);
    const a = clean(after[key]);
    if (b !== a) out.push({ key, before: b, after: a });
  }
  return out;
}

function presentProperties(props: Props, side: 'before' | 'after'): PropertyChange[] {
  const out: PropertyChange[] = [];
  for (const [key, raw] of Object.entries(props)) {
    const value = clean(raw);
    if (value !== undefined) out.push(side === 'before' ? { key, before: value } : { key, after: value });
  }
  return out;
}

interface Item {
  key: string;
  fallbackKey?: string;
  path: string;
  typeLabel?: string;
  props: Props;
  locate?: SearchLocator;
}

/**
 * The entries for one list of items: matched pairs whose properties differ,
 * items only the newer side has, items only the older side has.
 * `extraProperties` adds what a pair's own properties cannot say — the parent
 * an element moved to, the position it took among its siblings.
 */
function diffItems<T extends Item>(
  sectionId: string,
  itemKind: DiffItemKind,
  olderItems: T[],
  newerItems: T[],
  extraProperties?: (older: T, newer: T) => PropertyChange[],
): DiffEntry[] {
  const toKeyed = (item: T): Keyed<T> => ({ key: item.key, fallbackKey: item.fallbackKey, value: item });
  const { pairs, removed, added } = matchItems(olderItems.map(toKeyed), newerItems.map(toKeyed));
  const entries: Array<DiffEntry & { order: number }> = [];
  const newerOrder = new Map(newerItems.map((item, index) => [item, index]));
  const olderOrder = new Map(olderItems.map((item, index) => [item, index]));

  for (const [b, a] of pairs) {
    const properties = [
      ...diffProperties(b.value.props, a.value.props),
      ...(extraProperties?.(b.value, a.value) ?? []),
    ];
    if (properties.length === 0) continue;
    const renamed = b.value.path !== a.value.path && properties.some(p => p.key === 'name');
    entries.push({
      id: `${sectionId}:${a.key}`,
      change: 'changed',
      itemKind,
      path: a.value.path,
      previousPath: renamed ? b.value.path : undefined,
      typeLabel: a.value.typeLabel,
      properties,
      locateOlder: b.value.locate,
      locateNewer: a.value.locate,
      order: newerOrder.get(a.value) ?? 0,
    });
  }
  for (const a of added) {
    entries.push({
      id: `${sectionId}:+${a.key}`,
      change: 'added',
      itemKind,
      path: a.value.path,
      typeLabel: a.value.typeLabel,
      properties: presentProperties(a.value.props, 'after'),
      locateNewer: a.value.locate,
      order: newerOrder.get(a.value) ?? 0,
    });
  }
  // A removed item is listed where it used to be: right after the newer twin
  // of its nearest older neighbour that is still there.
  const pairedOrder = new Map(pairs.map(([b, a]) => [b.value, newerOrder.get(a.value) ?? 0]));
  for (const b of removed) {
    const index = olderOrder.get(b.value) ?? 0;
    let anchor = -1;
    for (let i = index - 1; i >= 0; i--) {
      const found = pairedOrder.get(olderItems[i]);
      if (found != null) { anchor = found; break; }
    }
    entries.push({
      id: `${sectionId}:-${b.key}`,
      change: 'removed',
      itemKind,
      path: b.value.path,
      typeLabel: b.value.typeLabel,
      properties: presentProperties(b.value.props, 'before'),
      locateOlder: b.value.locate,
      order: anchor + 0.5 + index / 1e7,
    });
  }

  return entries
    .sort((x, y) => x.order - y.order)
    .map(({ order: _order, ...entry }) => entry);
}

/**
 * Indices (into `sequence`) of a longest strictly increasing subsequence.
 * The siblings outside it are the ones that moved — the fewest moves that
 * explain the new order.
 */
export function longestIncreasingRun(sequence: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = new Array(sequence.length).fill(-1);
  for (let i = 0; i < sequence.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sequence[tails[mid]] < sequence[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    keep.add(cursor);
    cursor = previous[cursor];
  }
  return keep;
}

// ─── Values shown for a property ───

function yesNo(value: boolean | undefined): string | undefined {
  return value ? '1' : undefined;
}

/** Properties whose value is a list — one item per line — compared item by item. */
export const LIST_KEYS: ReadonlySet<string> = new Set(['selectedFields', 'groupedFields', 'aggregations', 'pathsToCache', 'values', 'columnWidths', 'rowHeights']);

function list(values: Array<string | undefined>): string | undefined {
  const items = values.filter((v): v is string => Boolean(v && v.trim()));
  return items.length > 0 ? items.join('\n') : undefined;
}

export function listItems(value: string | undefined): string[] {
  return value ? value.split('\n').filter(item => item.trim() !== '') : [];
}

/** What identifies a list item across versions: the name before ` = `, or the whole item. */
export function listItemKey(item: string): string {
  const at = item.indexOf(' = ');
  return (at > 0 ? item.slice(0, at) : item).trim().toLowerCase();
}

export interface ListRow {
  kind: 'same' | 'changed' | 'added' | 'removed';
  before?: string;
  after?: string;
}

/**
 * Two lists item against item: the longest run of items that kept their
 * name and order pairs up (same, or changed when the rest differs); the
 * others were removed or added, listed where they stood.
 */
export function diffListItems(before: string | undefined, after: string | undefined): ListRow[] {
  const older = listItems(before);
  const newer = listItems(after);
  const olderKeys = older.map(listItemKey);
  const newerKeys = newer.map(listItemKey);
  const n = older.length;
  const m = newer.length;
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = olderKeys[i] === newerKeys[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const rows: ListRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && olderKeys[i] === newerKeys[j]) {
      rows.push({ kind: older[i] === newer[j] ? 'same' : 'changed', before: older[i], after: newer[j] });
      i++; j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      rows.push({ kind: 'removed', before: older[i++] });
    } else {
      rows.push({ kind: 'added', after: newer[j++] });
    }
  }
  return rows;
}

const FIELD_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(ERFieldType).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v as number, k]),
);

const VERSION_STATUS_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(ERVersionStatus).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v as number, k]),
);

/** A short fingerprint of a long value (an embedded template, a picture) and its size. */
export function fingerprint(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const kb = Math.max(1, Math.round((text.length * 3) / 4 / 1024));
  return `${(hash >>> 0).toString(16).padStart(8, '0')} · ${kb} kB`;
}

// ─── Data sources ───

function datasourceProps(ds: ERDatasource): Props {
  return {
    type: ds.type,
    label: ds.label,
    description: ds.description,
    table: ds.tableInfo?.tableName,
    crossCompany: yesNo(ds.tableInfo?.isCrossCompany),
    selectedFields: list(ds.tableInfo?.selectedFields ?? []),
    enum: ds.enumInfo?.enumName,
    enumSource: ds.enumInfo ? ds.enumInfo.sourceKind : undefined,
    class: ds.classInfo?.className,
    edt: ds.userParamInfo?.extendedDataTypeName,
    expression: ds.calculatedField?.expressionAsString ?? ds.userParamInfo?.expressionAsString,
    listToGroup: ds.groupByInfo?.listToGroup,
    groupedFields: list(ds.groupByInfo?.groupedFields.map(f => (f.path && f.path !== f.name ? `${f.name} = ${f.path}` : f.name)) ?? []),
    aggregations: list(ds.groupByInfo?.aggregations.map(a => `${a.name} = ${a.function}(${a.path})`) ?? []),
    descriptor: ds.modelInfo?.dataContainerDescriptorName,
    modelRevision: ds.modelInfo?.revisionNumber,
    importFormat: ds.importFormatInfo?.formatGuid,
  };
}

function datasourceItems(datasources: readonly ERDatasource[]): Item[] {
  const out: Item[] = [];
  const walk = (list: readonly ERDatasource[], parent: string) => {
    for (const ds of list ?? []) {
      const path = parent ? `${parent}/${ds.name}` : ds.name;
      // A stand-in for a ParentPath segment has no definition of its own.
      if (!ds.implicit) {
        out.push({
          key: path.toLowerCase(),
          path,
          typeLabel: ds.type,
          props: datasourceProps(ds),
          locate: { type: 'datasource', name: ds.name, parentPath: ds.parentPath },
        });
      }
      if (ds.children?.length) walk(ds.children, path);
    }
  };
  walk(datasources, '');
  return out;
}

// ─── Model mapping ───

function definitionLabel(mapping: ERModelMapping): string {
  return mapping.dataContainerDescriptor && mapping.name && mapping.name !== mapping.dataContainerDescriptor
    ? `${mapping.name} (${mapping.dataContainerDescriptor})`
    : (mapping.name || mapping.dataContainerDescriptor || mapping.id);
}

function bindingItems(mapping: ERModelMapping): Item[] {
  return (mapping.bindings ?? []).map(binding => ({
    key: binding.path.toLowerCase(),
    path: binding.path,
    props: { expression: binding.expressionAsString },
    locate: { type: 'binding', path: binding.path },
  }));
}

function validationItems(mapping: ERModelMapping): Item[] {
  const out: Item[] = [];
  for (const validation of mapping.validations ?? []) {
    validation.conditions.forEach((rule, index) => {
      out.push({
        key: `${validation.path.toLowerCase()}#${normGuid(rule.id) || index}`,
        fallbackKey: `${validation.path.toLowerCase()}#${rule.conditionExpressionAsString}`,
        path: validation.path,
        locate: { type: 'validation', path: validation.path },
        props: {
          condition: rule.conditionExpressionAsString,
          message: rule.messageExpressionAsString,
          action: rule.action,
          severity: rule.severity,
          stopProcessing: yesNo(rule.stopProcessing),
        },
      });
    });
  }
  return out;
}

function definitionProps(mapping: ERModelMapping): Props {
  return {
    name: mapping.name,
    descriptor: mapping.dataContainerDescriptor,
    model: mapping.modelName,
    modelVersion: mapping.modelVersion?.split(',')[1]?.trim() || mapping.modelVersion,
    pathsToCache: list(mapping.pathsToCache ?? []),
  };
}

function definitionsOf(versions: readonly ERModelMappingVersion[]): ERModelMapping[] {
  return versions.flatMap(version => getMappingDefinitions(version) as ERModelMapping[]);
}

/** Sections for every mapping definition of both sides, matched by GUID, then by descriptor. */
function diffMappingDefinitions(prefix: string, older: ERModelMapping[], newer: ERModelMapping[]): DiffSection[] {
  const keyed = (mapping: ERModelMapping): Keyed<ERModelMapping> => ({
    key: normGuid(mapping.id) || `descriptor:${(mapping.dataContainerDescriptor ?? '').toLowerCase()}`,
    fallbackKey: `descriptor:${(mapping.dataContainerDescriptor ?? '').toLowerCase()}|${(mapping.name ?? '').toLowerCase()}`,
    value: mapping,
  });
  const { pairs, removed, added } = matchItems(older.map(keyed), newer.map(keyed));
  const several = Math.max(older.length, newer.length) > 1;
  const sections: DiffSection[] = [];

  // Definitions themselves: added, removed, retargeted to another model version.
  const definitionSectionId = `${prefix}definitions`;
  const definitionEntries: DiffEntry[] = [];
  for (const [b, a] of pairs) {
    const properties = diffProperties(definitionProps(b.value), definitionProps(a.value));
    if (properties.length > 0) {
      definitionEntries.push({
        id: `${definitionSectionId}:${a.key}`, change: 'changed', itemKind: 'definition',
        path: definitionLabel(a.value), properties,
      });
    }
  }
  for (const a of added) {
    definitionEntries.push({
      id: `${definitionSectionId}:+${a.key}`, change: 'added', itemKind: 'definition',
      path: definitionLabel(a.value), properties: presentProperties(definitionProps(a.value), 'after'),
    });
  }
  for (const b of removed) {
    definitionEntries.push({
      id: `${definitionSectionId}:-${b.key}`, change: 'removed', itemKind: 'definition',
      path: definitionLabel(b.value), properties: presentProperties(definitionProps(b.value), 'before'),
    });
  }
  sections.push({ id: definitionSectionId, kind: 'definitions', entries: definitionEntries });

  const empty: ERModelMapping = {
    id: '', name: '', dataContainerDescriptor: '', modelId: '', modelName: '', modelVersion: '',
    bindings: [], datasources: [], validations: [], pathsToCache: [],
  };
  const sides: Array<[ERModelMapping, ERModelMapping, string]> = [
    ...pairs.map(([b, a]) => [b.value, a.value, a.key] as [ERModelMapping, ERModelMapping, string]),
    ...added.map(a => [empty, a.value, a.key] as [ERModelMapping, ERModelMapping, string]),
    ...removed.map(b => [b.value, empty, b.key] as [ERModelMapping, ERModelMapping, string]),
  ];
  for (const [before, after, key] of sides) {
    const scope = several ? definitionLabel(after.id ? after : before) : undefined;
    const id = `${prefix}${key}`;
    const definitions = {
      definitionOlder: before.id ? mappingDefinitionLabel(before) : undefined,
      definitionNewer: after.id ? mappingDefinitionLabel(after) : undefined,
    };
    sections.push(
      { id: `${id}:bindings`, kind: 'bindings', scope, ...definitions, entries: diffItems(`${id}:bindings`, 'binding', bindingItems(before), bindingItems(after)) },
      { id: `${id}:datasources`, kind: 'datasources', scope, ...definitions, entries: diffItems(`${id}:datasources`, 'datasource', datasourceItems(before.datasources), datasourceItems(after.datasources)) },
      { id: `${id}:validations`, kind: 'validations', scope, ...definitions, entries: diffItems(`${id}:validations`, 'validation', validationItems(before), validationItems(after)) },
    );
  }
  return sections;
}

// ─── Data model ───

function diffDataModel(older: ERDataModelContent, newer: ERDataModelContent): DiffSection[] {
  const containersOf = (content: ERDataModelContent) => content.version?.model?.containers ?? [];
  const nameById = (containers: ERDataContainerDescriptor[]) => new Map(containers.map(c => [c.id, c.name]));
  const olderNames = nameById(containersOf(older));
  const newerNames = nameById(containersOf(newer));

  const recordItems = (containers: ERDataContainerDescriptor[]): Item[] => containers.map(container => ({
    key: `id:${normGuid(container.id) || container.name.toLowerCase()}`,
    fallbackKey: `name:${container.name.toLowerCase()}`,
    path: container.name,
    locate: { type: 'container', name: container.name },
    props: {
      name: container.name,
      label: container.label,
      description: container.description,
      isRoot: yesNo(container.isRoot),
      isEnum: yesNo(container.isEnum),
    },
  }));

  // Fields are keyed by the record they live in, so a renamed record keeps
  // its fields matched; the record GUID is the anchor.
  const recordKeyOf = (container: ERDataContainerDescriptor) => normGuid(container.id) || container.name.toLowerCase();
  const fieldItems = (containers: ERDataContainerDescriptor[], names: Map<string, string>): Item[] => containers.flatMap(container =>
    (container.items ?? []).map(field => ({
      key: `${recordKeyOf(container)}/${field.name.toLowerCase()}`,
      fallbackKey: `${container.name.toLowerCase()}/${field.name.toLowerCase()}`,
      path: `${container.name}/${field.name}`,
      locate: { type: 'field', container: container.name, field: field.name },
      typeLabel: container.isEnum ? 'EnumValue' : FIELD_TYPE_NAMES[field.type],
      props: {
        type: container.isEnum ? undefined : (FIELD_TYPE_NAMES[field.type] ?? String(field.type)),
        typeDescriptor: field.typeDescriptor ? (names.get(field.typeDescriptor) ?? field.typeDescriptor) : undefined,
        label: field.label,
        description: field.description,
        typeHost: yesNo(field.isTypeDescriptorHost),
      },
    })),
  );

  return [
    { id: 'records', kind: 'records', entries: diffItems('records', 'record', recordItems(containersOf(older)), recordItems(containersOf(newer))) },
    { id: 'fields', kind: 'fields', entries: diffItems('fields', 'field', fieldItems(containersOf(older), olderNames), fieldItems(containersOf(newer), newerNames)) },
  ];
}

// ─── Format ───

interface ElementItem extends Item {
  element: ERFormatElement;
  parentKey: string;
  index: number;
}

function elementKey(element: ERFormatElement, path: string): string {
  return normGuid(element.id) || `path:${path.toLowerCase()}`;
}

function formatBindingsByElement(content: ERFormatContent): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const binding of content.formatMappingVersion?.formatMapping?.bindings ?? []) {
    const key = normGuid(binding.componentId);
    if (!key) continue;
    const forElement = out.get(key) ?? new Map<string, string>();
    forElement.set(binding.propertyName ? `binding:${binding.propertyName}` : 'binding', binding.expressionAsString);
    out.set(key, forElement);
  }
  return out;
}

function elementItems(content: ERFormatContent): ElementItem[] {
  const format = content.formatVersion?.format;
  const root = format?.rootElement;
  if (!root) return [];
  const bindings = formatBindingsByElement(content);
  const transformationNames = new Map((format.transformations ?? []).map(tr => [normGuid(tr.id), tr.name]));
  const out: ElementItem[] = [];

  const walk = (element: ERFormatElement, parentPath: string, parentKey: string, index: number) => {
    const path = parentPath ? `${parentPath}/${element.name}` : element.name;
    const key = elementKey(element, path);
    const props: Props = { name: element.name, type: element.elementType };
    for (const [attr, value] of Object.entries(element.attributes ?? {})) {
      props[`@${attr}`] = attr === 'Transformation'
        ? (transformationNames.get(normGuid(value)) ?? value)
        : value;
    }
    const own = bindings.get(normGuid(element.id));
    if (own) for (const [bindingKey, expression] of own) props[bindingKey] = expression;
    out.push({
      key,
      fallbackKey: `path:${path.toLowerCase()}|${element.elementType}`,
      path,
      typeLabel: element.elementType,
      props,
      locate: element.id ? { type: 'formatElement', id: element.id } : undefined,
      element,
      parentKey,
      index,
    });
    (element.children ?? []).forEach((child, childIndex) => walk(child, path, key, childIndex));
  };
  walk(root, '', '', 0);
  return out;
}

function diffFormatStructure(olderItems: ElementItem[], newerItems: ElementItem[]): DiffEntry[] {
  const toKeyed = (item: ElementItem): Keyed<ElementItem> => ({ key: item.key, fallbackKey: item.fallbackKey, value: item });
  const { pairs } = matchItems(olderItems.map(toKeyed), newerItems.map(toKeyed));

  // The older twin of every matched newer element, and which older key each
  // newer key stands for — parents compare across a GUID fallback that way.
  const pairByNewer = new Map(pairs.map(([b, a]) => [a.value, b.value]));
  const olderKeyOf = new Map(pairs.map(([b, a]) => [a.value.key, b.value.key]));
  const olderPathByKey = new Map(olderItems.map(item => [item.key, item.path]));
  const newerPathByKey = new Map(newerItems.map(item => [item.key, item.path]));
  const parentChanged = (before: ElementItem, after: ElementItem) =>
    after.parentKey !== '' && olderKeyOf.get(after.parentKey) !== before.parentKey;

  // Siblings that kept their parent but not their order: the ones outside the
  // longest run that kept its relative order moved. In a text or Excel format
  // the order of the fields is the layout of the file.
  const reordered = new Map<ElementItem, PropertyChange>();
  const byParent = new Map<string, ElementItem[]>();
  for (const item of newerItems) {
    const before = pairByNewer.get(item);
    if (!before || parentChanged(before, item) || item.parentKey === '') continue;
    const group = byParent.get(item.parentKey) ?? [];
    group.push(item);
    byParent.set(item.parentKey, group);
  }
  for (const group of byParent.values()) {
    const keep = longestIncreasingRun(group.map(item => pairByNewer.get(item)!.index));
    group.forEach((item, i) => {
      if (keep.has(i)) return;
      reordered.set(item, { key: 'position', before: String(pairByNewer.get(item)!.index + 1), after: String(item.index + 1) });
    });
  }

  return diffItems('structure', 'element', olderItems, newerItems, (before, after) => {
    const extra: PropertyChange[] = [];
    if (parentChanged(before, after)) {
      extra.push({ key: 'parent', before: olderPathByKey.get(before.parentKey), after: newerPathByKey.get(after.parentKey) });
    }
    const move = reordered.get(after);
    if (move) extra.push(move);
    return extra;
  });
}

/** Bindings whose element is not in that version's structure (left behind in the format mapping). */
function orphanBindingItems(content: ERFormatContent, elements: readonly ElementItem[]): Item[] {
  const known = new Set(elements.map(item => normGuid(item.element.id)).filter(Boolean));
  return (content.formatMappingVersion?.formatMapping?.bindings ?? [])
    .filter(binding => !known.has(normGuid(binding.componentId)))
    .map(binding => {
      const key = `${normGuid(binding.componentId)}|${binding.propertyName ?? ''}`;
      return {
        key,
        path: binding.propertyName ? `${binding.componentId} · ${binding.propertyName}` : binding.componentId,
        props: { expression: binding.expressionAsString },
      };
    });
}

function diffFormat(older: ERFormatContent, newer: ERFormatContent): DiffSection[] {
  const olderFormat = older.formatVersion?.format;
  const newerFormat = newer.formatVersion?.format;

  const enumItems = (content: ERFormatContent): Item[] => (content.formatVersion?.format?.enumDefinitions ?? []).map(def => ({
    key: normGuid(def.id) || def.name.toLowerCase(),
    fallbackKey: def.name.toLowerCase(),
    path: def.name,
    locate: { type: 'formatEnum', name: def.name },
    props: { name: def.name, values: list(def.values.map(v => v.name)) },
  }));
  const transformationItems = (content: ERFormatContent): Item[] => (content.formatVersion?.format?.transformations ?? []).map(tr => ({
    key: normGuid(tr.id) || tr.name.toLowerCase(),
    fallbackKey: tr.name.toLowerCase(),
    path: tr.name,
    locate: { type: 'transformation', name: tr.name },
    props: { name: tr.name, expression: tr.expressionAsString, parameterType: tr.parameterType != null ? String(tr.parameterType) : undefined },
  }));
  const templateItems = (format: typeof olderFormat): Item[] => (format?.template
    ? [{ key: 'template', path: format.template.filename || 'template', props: { file: format.template.filename, content: fingerprint(format.template.base64) } }]
    : []);

  const olderElements = elementItems(older);
  const newerElements = elementItems(newer);
  const structure = [
    ...diffItems('template', 'template', templateItems(olderFormat), templateItems(newerFormat)),
    ...diffFormatStructure(olderElements, newerElements),
  ];
  const orphans = diffItems(
    'orphanBindings',
    'binding',
    orphanBindingItems(older, olderElements),
    orphanBindingItems(newer, newerElements),
  );

  return [
    { id: 'structure', kind: 'structure', entries: structure },
    ...(orphans.length > 0 ? [{ id: 'orphanBindings', kind: 'bindings' as const, entries: orphans }] : []),
    {
      id: 'format-datasources',
      kind: 'datasources',
      entries: diffItems(
        'format-datasources',
        'datasource',
        datasourceItems(older.formatMappingVersion?.formatMapping?.datasources ?? []),
        datasourceItems(newer.formatMappingVersion?.formatMapping?.datasources ?? []),
      ),
    },
    { id: 'formatEnums', kind: 'formatEnums', entries: diffItems('formatEnums', 'formatEnum', enumItems(older), enumItems(newer)) },
    { id: 'transformations', kind: 'transformations', entries: diffItems('transformations', 'transformation', transformationItems(older), transformationItems(newer)) },
    // An import format carries its own model mapping.
    ...diffMappingDefinitions(
      'embedded:',
      definitionsOf(older.embeddedModelMappingVersions ?? []),
      definitionsOf(newer.embeddedModelMappingVersions ?? []),
    ),
  ];
}

// ─── Labels ───

/**
 * Label texts that changed. Added and removed labels are left out: a new label
 * shows up on the item that uses it, and the dictionary of a loaded
 * configuration also gathers labels inherited from its ancestors, which the
 * other side does not have.
 */
function diffLabels(older: ERConfiguration, newer: ERConfiguration): DiffEntry[] {
  const byKey = (cfg: ERConfiguration) => new Map(
    (cfg.solutionVersion.solution.labels ?? []).map(label => [`${label.labelId}|${label.languageId}`.toLowerCase(), label]),
  );
  const before = byKey(older);
  const entries: DiffEntry[] = [];
  for (const [key, label] of byKey(newer)) {
    const previous = before.get(key);
    if (!previous || previous.labelValue === label.labelValue) continue;
    entries.push({
      id: `labels:${key}`,
      change: 'changed',
      itemKind: 'label',
      path: `${label.labelId} (${label.languageId})`,
      properties: [{ key: 'text', before: previous.labelValue, after: label.labelValue }],
    });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

// ─── Header ───

function headerProps(cfg: ERConfiguration): Props {
  const sv = cfg.solutionVersion;
  const base = sv.solution.baseName || sv.solution.baseSolutionId
    ? `${sv.solution.baseName ?? sv.solution.baseSolutionId}${sv.solution.baseVersion ? ` · ${sv.solution.baseVersion}` : ''}`
    : undefined;
  return {
    version: getBestVersion(cfg),
    date: sv.dateTime,
    versionDescription: sv.description,
    status: sv.versionStatus ? (VERSION_STATUS_NAMES[sv.versionStatus] ?? String(sv.versionStatus)) : undefined,
    base,
    file: cfg.filePath.split(/[\\/]/).pop(),
  };
}

// ─── Entry point ───

/**
 * What changed from one configuration to the other. Two versions are put in
 * version order; `keepOrder` keeps `a` on the left as given — a base and the
 * configuration derived from it, whose version numbers say nothing about each other.
 */
export function diffConfigurations(a: ERConfiguration, b: ERConfiguration, options?: { keepOrder?: boolean }): VersionDiff {
  const [older, newer] = options?.keepOrder ? [a, b] : orderVersions(a, b);
  if (older.content.kind !== newer.content.kind) {
    throw new Error(`Cannot compare a ${older.content.kind} with a ${newer.content.kind}.`);
  }
  const sameConfiguration = normGuid(older.solutionVersion.solution.id) === normGuid(newer.solutionVersion.solution.id);

  const olderHeader = headerProps(older);
  const newerHeader = headerProps(newer);
  const header: PropertyChange[] = Object.keys({ ...olderHeader, ...newerHeader })
    .map(key => ({ key, before: clean(olderHeader[key]), after: clean(newerHeader[key]) }))
    .filter(change => change.before !== undefined || change.after !== undefined);

  let sections: DiffSection[];
  if (older.content.kind === 'Format') {
    sections = diffFormat(older.content as ERFormatContent, newer.content as ERFormatContent);
  } else if (older.content.kind === 'ModelMapping') {
    sections = diffMappingDefinitions(
      '',
      definitionsOf([(older.content as ERModelMappingContent).version]),
      definitionsOf([(newer.content as ERModelMappingContent).version]),
    );
  } else {
    sections = diffDataModel(older.content as ERDataModelContent, newer.content as ERDataModelContent);
  }
  sections.push({ id: 'labels', kind: 'labels', entries: diffLabels(older, newer) });
  sections = sections.filter(section => section.entries.length > 0);

  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };
  for (const section of sections) for (const entry of section.entries) counts[entry.change] += 1;

  return { older, newer, sameConfiguration, header, sections, counts };
}

// ─── Showing a change inside a long value ───

export interface InlineChange {
  prefix: string;
  before: string;
  after: string;
  suffix: string;
}

/**
 * Split two values into the part they share at the start, the part that
 * differs on each side and the part they share at the end — enough to point
 * at `ROUND(x, 2)` → `ROUND(x, 3)` without a full word diff.
 */
export function inlineChange(before: string, after: string): InlineChange {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < max - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end++;
  return {
    prefix: before.slice(0, start),
    before: before.slice(start, before.length - end),
    after: after.slice(start, after.length - end),
    suffix: before.slice(before.length - end),
  };
}

// ─── CSV ───

function csvCell(value: string | undefined): string {
  const text = value ?? '';
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface VersionDiffCsvLabels {
  headers: readonly string[];
  change: (change: ChangeKind) => string;
  section: (section: DiffSection) => string;
  property: (key: string) => string;
}

/** The change list as CSV: one row per changed property (semicolons and a BOM, as the field specification). */
export function buildVersionDiffCsv(diff: VersionDiff, labels: VersionDiffCsvLabels): string {
  const lines = [labels.headers.map(h => csvCell(h)).join(';')];
  for (const section of diff.sections) {
    const sectionName = labels.section(section);
    for (const entry of section.entries) {
      const rows = entry.properties.length > 0 ? entry.properties : [{ key: '', before: undefined, after: undefined }];
      for (const property of rows) {
        lines.push([
          sectionName,
          labels.change(entry.change),
          entry.path,
          entry.previousPath,
          entry.typeLabel,
          property.key ? labels.property(property.key) : '',
          property.before,
          property.after,
        ].map(cell => csvCell(cell)).join(';'));
      }
    }
  }
  // The byte order mark tells Excel the file is UTF-8.
  return String.fromCharCode(0xfeff) + `${lines.join('\r\n')}\r\n`;
}
