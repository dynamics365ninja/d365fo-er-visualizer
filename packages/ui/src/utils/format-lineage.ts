/**
 * How every element of a format is filled.
 *
 * For each element: what its binding is (a constant, a data model field, a
 * calculation, nothing), whether it repeats or only appears on a condition,
 * which length and format rules it carries, and — through the model mapping
 * the format runs on — which D365FO tables, fields, enums and classes the
 * value finally comes from. `@` paths are resolved against the record list of
 * the enclosing element, the way ER evaluates them.
 *
 * The same lineage feeds the field specification, the preview, the inspector
 * and the where-used index, so all of them tell one story.
 */
import {
  getFormatElementDataType,
  type ERConfiguration,
  type ERDataContainerDescriptor,
  type ERDataContainerItem,
  type ERDataModel,
  type ERDataModelContent,
  type ERFormatBinding,
  type ERFormatContent,
  type ERFormatElement,
  type ERModelMapping,
} from '@er-visualizer/core';
import { getScopedMappingDefinitions } from '../state/mapping-definitions';
import { containerLookup, findModelForDescriptor } from './datasource-tree';
import {
  isListExpression,
  sortSources,
  SourceCollector,
  traceExpression,
  type CurrentRecord,
  type SourceRef,
  type SourceRole,
  type TraceScope,
} from './datasource-lineage';
import { constantValue, extractReferences, isBarePath, substituteCurrent } from './er-references';
import { classifyFormatBindingCategory, normalizeGuid } from './format-binding-display';
import { formatReferencedModelIds, mappingDefinitionLabel, normGuid } from './model-hierarchy';

// ─── Data model lookups ───

/** ER field types. */
export const MODEL_TYPE_RECORD = 10;
export const MODEL_TYPE_LIST = 11;

export interface ModelFieldInfo {
  field: ERDataContainerItem;
  /** The record (container) that declares the field. */
  container: ERDataContainerDescriptor;
}

/** Field lookup by path below the descriptor's root container, with the declaring record. */
export function modelFieldResolver(model: ERDataModel, descriptor: string): (segments: readonly string[]) => ModelFieldInfo | undefined {
  const lookup = containerLookup(model);
  const root = lookup(descriptor);
  const cache = new Map<string, ModelFieldInfo | undefined>();
  return segments => {
    const key = segments.join('/').toLowerCase();
    if (cache.has(key)) return cache.get(key);
    let container: ERDataContainerDescriptor | undefined = root;
    let found: ModelFieldInfo | undefined;
    for (const segment of segments) {
      const field = container?.items.find(item => item.name.toLowerCase() === segment.toLowerCase());
      if (!field || !container) { found = undefined; break; }
      found = { field, container };
      container = field.typeDescriptor ? lookup(field.typeDescriptor) : undefined;
    }
    cache.set(key, found);
    return found;
  };
}

// ─── Format → model mapping context ───

export interface FormatMappingChoice {
  definition: ERModelMapping;
  configIndex: number;
  label: string;
}

export interface FormatModelContext {
  /** Lower-cased names of the format's data model datasources (normally `model`). */
  modelNames: Set<string>;
  /** Root descriptor the format enters the model through. */
  descriptor: string;
  /** The mapping definition the format runs on: embedded first, then any loaded one on the same model. */
  mapping: FormatMappingChoice | null;
  dataModel: { model: ERDataModel; descriptor: string } | null;
}

export function resolveFormatModelContext(configurations: readonly ERConfiguration[], configIndex: number): FormatModelContext {
  const config = configurations[configIndex];
  const content = config?.content as ERFormatContent | undefined;
  const datasources = content?.formatMappingVersion.formatMapping.datasources ?? [];
  const modelDatasources = datasources.filter(ds => ds.type === 'DataModel');
  const modelNames = new Set((modelDatasources.length > 0 ? modelDatasources.map(ds => ds.name) : ['model']).map(name => name.toLowerCase()));
  const descriptor = modelDatasources.map(ds => ds.modelInfo?.dataContainerDescriptorName?.trim()).find(Boolean) ?? '';
  if (!content || content.kind !== 'Format') return { modelNames, descriptor, mapping: null, dataModel: null };

  const descriptorKey = descriptor.toLowerCase();
  const modelIds = new Set(formatReferencedModelIds(content).map(normGuid));
  const candidates: FormatMappingChoice[] = [];
  if (descriptorKey) {
    const order = [configIndex, ...configurations.map((_, index) => index).filter(index => index !== configIndex)];
    for (const i of order) {
      const kind = configurations[i]?.content.kind;
      if (kind !== 'ModelMapping' && i !== configIndex) continue;
      for (const definition of getScopedMappingDefinitions(configurations as ERConfiguration[], i) as ERModelMapping[]) {
        if ((definition?.dataContainerDescriptor ?? '').trim().toLowerCase() === descriptorKey) {
          candidates.push({ definition, configIndex: i, label: mappingDefinitionLabel(definition) ?? definition.name });
        }
      }
    }
  }
  const mapping = candidates.find(candidate => modelIds.has(normGuid(candidate.definition.modelId))) ?? candidates[0] ?? null;
  const models = configurations
    .filter(cfg => cfg.content.kind === 'DataModel')
    .map(cfg => (cfg.content as ERDataModelContent).version.model);
  const model = findModelForDescriptor(models, descriptor, modelIds);
  return { modelNames, descriptor, mapping, dataModel: model ? { model, descriptor } : null };
}

// ─── Model mapping lineage ───

export interface ModelPathFill {
  /** Binding path as the mapping spells it. */
  path: string;
  expression: string;
  sources: SourceRef[];
}

export interface MappingLineage {
  definition: ERModelMapping;
  configIndex: number;
  label: string;
  /** What fills the model field at `segments`; `null` when nothing binds it. */
  resolve(segments: readonly string[]): ModelPathFill | null;
}

const pathKey = (segments: readonly string[]) => segments.join('/').toLowerCase();
const splitBindingPath = (path: string) => path.split(/[\\/.]/).map(s => s.trim()).filter(Boolean);

const mappingLineageCache = new WeakMap<ERModelMapping, Map<number, MappingLineage>>();

export function buildMappingLineage(definition: ERModelMapping, configIndex: number): MappingLineage {
  let perConfig = mappingLineageCache.get(definition);
  const cached = perConfig?.get(configIndex);
  if (cached) return cached;

  const label = mappingDefinitionLabel(definition) ?? definition.name;
  const byPath = new Map<string, { segments: string[]; binding: { path: string; expressionAsString: string } }>();
  for (const binding of definition.bindings ?? []) {
    const segments = splitBindingPath(binding.path);
    const key = pathKey(segments);
    if (!byPath.has(key)) byPath.set(key, { segments, binding });
  }

  const scopeCache = new Map<string, TraceScope>();
  const scopeFor = (segments: readonly string[]): TraceScope => {
    const key = pathKey(segments);
    const hit = scopeCache.get(key);
    if (hit) return hit;
    let current: CurrentRecord | null = null;
    for (let len = segments.length - 1; len > 0; len--) {
      const ancestor = byPath.get(pathKey(segments.slice(0, len)));
      if (ancestor?.binding.expressionAsString?.trim()) {
        current = { expression: ancestor.binding.expressionAsString, scope: scopeFor(segments.slice(0, len)) };
        break;
      }
    }
    const scope: TraceScope = { pool: definition.datasources ?? [], configIndex, definition: label, current };
    scopeCache.set(key, scope);
    return scope;
  };

  const fills = new Map<string, ModelPathFill | null>();
  const lineage: MappingLineage = {
    definition,
    configIndex,
    label,
    resolve(segments) {
      const key = pathKey(segments);
      if (fills.has(key)) return fills.get(key)!;
      const entry = byPath.get(key);
      const expression = entry?.binding.expressionAsString?.trim() ?? '';
      const fill = entry && expression
        ? { path: entry.binding.path, expression, sources: sortSources(traceExpression(expression, scopeFor(entry.segments)).sources) }
        : null;
      fills.set(key, fill);
      return fill;
    },
  };
  if (!perConfig) { perConfig = new Map(); mappingLineageCache.set(definition, perConfig); }
  perConfig.set(configIndex, lineage);
  return lineage;
}

/** Every bound model path of a mapping definition with what fills it. */
export function listMappingFills(lineage: MappingLineage): ModelPathFill[] {
  const out: ModelPathFill[] = [];
  for (const binding of lineage.definition.bindings ?? []) {
    const fill = lineage.resolve(splitBindingPath(binding.path));
    if (fill) out.push(fill);
  }
  return out;
}

// ─── Format element lineage ───

export type FillKind = 'constant' | 'model' | 'datasource' | 'calculated' | 'unbound' | 'structure';

export interface ModelLink {
  /** `InvoiceBase/Lines/ItemId`, below the descriptor's root. */
  path: string;
  segments: string[];
  role: SourceRole;
  field?: ERDataContainerItem;
  /** Record that declares the field. */
  container?: string;
  /** The mapping binding that fills the field. */
  fill: ModelPathFill | null;
}

export interface ElementConstraints {
  maxLength?: number;
  minLength?: number;
  format?: string;
  padding?: string;
  alignment?: string;
  encoding?: string;
  transformation?: string;
  delimiter?: string;
  lineEnd?: string;
  excelRange?: string;
  replication?: string;
  multiplicity?: string;
  excluded?: boolean;
}

export interface ElementFill {
  id: string;
  element: ERFormatElement;
  /** Names from the root down to this element. */
  path: string[];
  /** Depth among the rows a specification shows (absorbed value carriers do not count). */
  depth: number;
  parentId?: string;
  /** Name to show: the element's own, or its parent's for an unnamed value node. */
  displayName: string;
  /** An unnamed value node whose parent element (the XML element/attribute) stands for it. */
  absorbedInto?: string;
  /** The unnamed value node this element stands for. */
  carrierId?: string;
  /** `String`, `Real`, `DateTime`, … — of the value node when there is one. */
  dataType: string;
  /** Element type of the value node when there is one. */
  valueElementType: string;
  /** The data (value) binding, own or of the absorbed value node. */
  binding?: string;
  /** `binding` with `@` spelled out as the path of the enclosing list, when that path is a bare one. */
  resolvedBinding?: string;
  fill: FillKind;
  constant?: string;
  /** Data model paths the binding reads. */
  modelLinks: ModelLink[];
  /** Datasources of the format itself the binding reads. */
  formatSources: SourceRef[];
  /** Everything the value comes from, mapping included, value sources first. */
  sources: SourceRef[];
  /** Enabled / visibility conditions. */
  conditions: string[];
  /** Other property bindings (`FileName`, …). */
  otherBindings: Array<{ property: string; expression: string }>;
  /** The element repeats once per record of `repeatSource`. */
  repeating: boolean;
  /** Repetition guessed without the data model (a container bound to a bare path). */
  repeatInferred?: boolean;
  /** Zero-or-one multiplicity. */
  optional: boolean;
  constraints: ElementConstraints;
  /** Leaf that carries a value (after absorbing value nodes). */
  isField: boolean;
  /** `@` of this element's children, when it binds one. */
  childContext?: string;
  /** Bare path of the list `@` stands for at this element, when there is one. */
  contextPath?: string;
}

export interface FormatLineageStats {
  elements: number;
  fields: number;
  constant: number;
  model: number;
  calculated: number;
  datasource: number;
  unbound: number;
  repeating: number;
  conditional: number;
}

export interface FormatLineage {
  configIndex: number;
  elements: ElementFill[];
  byId: Map<string, ElementFill>;
  context: FormatModelContext;
  mapping: MappingLineage | null;
  stats: FormatLineageStats;
}

const VALUE_TYPES = new Set(['String', 'Numeric', 'DateTime', 'Base64']);

/**
 * A value node that only carries its parent's value: the `<ERTextFormatString/>`
 * under an XML element or attribute (whatever it is called), or an unnamed one
 * that is the single child of anything else.
 */
export function isImplicitValueCarrier(child: ERFormatElement, parent: ERFormatElement | undefined): boolean {
  if (!parent || !VALUE_TYPES.has(child.elementType) || child.children.length > 0) return false;
  if (parent.elementType === 'XMLAttribute') return parent.children.length === 1;
  if (parent.elementType === 'XMLElement') {
    return parent.children.filter(sibling => sibling.elementType !== 'XMLAttribute').length === 1;
  }
  return parent.children.length === 1 && (!child.name || child.name === child.elementType);
}

const FORMAT_KEYS = ['NumberFormat', 'FormatString', 'DateTimeFormat', 'DateFormat', 'Format', 'Mask'];
const LINE_ENDS: Record<string, string> = { CRLF: 'CR LF', LF: 'LF', CR: 'CR', '1': 'CR LF', '2': 'LF', '3': 'CR' };

function readConstraints(element: ERFormatElement, carrier: ERFormatElement | undefined, transformations: Map<string, string>): ElementConstraints {
  const attrs = { ...element.attributes, ...(carrier?.attributes ?? {}) };
  const num = (value: string | undefined) => {
    const parsed = value != null ? parseInt(value, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const transformation = carrier?.transformation ?? element.transformation;
  const constraints: ElementConstraints = {
    maxLength: carrier?.maximalLength ?? element.maximalLength ?? num(attrs.MaximalLength),
    minLength: num(attrs.MinimalLength),
    format: FORMAT_KEYS.map(key => attrs[key]).find(Boolean),
    padding: attrs.PaddingChar ?? attrs.Padding,
    alignment: attrs.Alignment,
    encoding: element.encoding,
    transformation: transformation ? (transformations.get(normalizeGuid(transformation)) ?? transformation) : undefined,
    delimiter: attrs.Delimiter,
    lineEnd: attrs.SpecialCharacters ? (LINE_ENDS[attrs.SpecialCharacters] ?? attrs.SpecialCharacters) : undefined,
    excelRange: attrs.ExcelRange ?? attrs.ExcelSheetName,
    replication: attrs.ReplicationDirection,
    multiplicity: attrs.Multiplicity,
    excluded: (carrier?.excludedFromDataSource ?? element.excludedFromDataSource) || undefined,
  };
  for (const key of Object.keys(constraints) as Array<keyof ElementConstraints>) {
    if (constraints[key] === undefined || constraints[key] === '') delete constraints[key];
  }
  return constraints;
}

/** A bare path that starts at the data model (or at the current record of one). */
function readsModelDirectly(expression: string, modelNames: ReadonlySet<string>): boolean {
  const [ref] = extractReferences(expression);
  if (!ref) return false;
  const root = ref.segments[0]?.toLowerCase() ?? '';
  if (ref.current) return !ref.segments.slice(1).some(segment => /^[$#]/.test(segment));
  return modelNames.has(root) && !ref.segments.slice(1).some(segment => /^[$#]/.test(segment));
}

const lineageCache = new WeakMap<ERFormatContent, { configurations: readonly ERConfiguration[]; lineage: FormatLineage }>();

/** The lineage of the format at `configIndex`; cached per configuration set. */
export function buildFormatLineage(configurations: readonly ERConfiguration[], configIndex: number): FormatLineage | null {
  const config = configurations[configIndex];
  if (!config || config.content.kind !== 'Format') return null;
  const content = config.content as ERFormatContent;
  const cached = lineageCache.get(content);
  if (cached && cached.configurations === configurations && cached.lineage.configIndex === configIndex) return cached.lineage;

  const context = resolveFormatModelContext(configurations, configIndex);
  const mapping = context.mapping ? buildMappingLineage(context.mapping.definition, context.mapping.configIndex) : null;
  const fieldAt = context.dataModel ? modelFieldResolver(context.dataModel.model, context.dataModel.descriptor) : null;
  const format = content.formatVersion.format;
  const formatMapping = content.formatMappingVersion.formatMapping;
  const pool = formatMapping.datasources ?? [];

  const bindingsById = new Map<string, ERFormatBinding[]>();
  for (const binding of formatMapping.bindings ?? []) {
    const key = normalizeGuid(binding.componentId);
    const list = bindingsById.get(key);
    if (list) list.push(binding); else bindingsById.set(key, [binding]);
  }
  const transformations = new Map(format.transformations.map(tr => [normalizeGuid(tr.id), tr.name]));

  const isModelList = (segments: string[]): boolean | undefined => {
    if (!fieldAt) return undefined;
    const info = fieldAt(segments);
    if (!info) return undefined;
    return info.field.type === MODEL_TYPE_LIST;
  };

  const elements: ElementFill[] = [];
  const byId = new Map<string, ElementFill>();
  const stats: FormatLineageStats = { elements: 0, fields: 0, constant: 0, model: 0, calculated: 0, datasource: 0, unbound: 0, repeating: 0, conditional: 0 };

  const walk = (element: ERFormatElement, parent: ERFormatElement | undefined, names: string[], depth: number, current: CurrentRecord | null, currentPath: string | null, parentFill: ElementFill | undefined) => {
    stats.elements++;
    const own = bindingsById.get(normalizeGuid(element.id)) ?? [];
    const absorbedInto = parentFill && isImplicitValueCarrier(element, parent) ? parentFill.id : undefined;
    const carrier = element.children.find(child => isImplicitValueCarrier(child, element));
    const carrierBindings = carrier ? bindingsById.get(normalizeGuid(carrier.id)) ?? [] : [];

    const dataBinding = own.find(b => classifyFormatBindingCategory(b) === 'data' && b.expressionAsString?.trim())
      ?? carrierBindings.find(b => classifyFormatBindingCategory(b) === 'data' && b.expressionAsString?.trim());
    const allBindings = [...own, ...carrierBindings];
    const conditions = allBindings
      .filter(b => classifyFormatBindingCategory(b) === 'visibility' && b.expressionAsString?.trim())
      .map(b => b.expressionAsString.trim());
    const otherBindings = allBindings
      .filter(b => {
        const category = classifyFormatBindingCategory(b);
        return category !== 'data' && category !== 'visibility' && b.expressionAsString?.trim();
      })
      .map(b => ({ property: b.propertyName ?? '', expression: b.expressionAsString.trim() }));

    const modelLinksByKey = new Map<string, { segments: string[]; role: SourceRole }>();
    const sink = (segments: string[], role: SourceRole) => {
      if (segments.length === 0) return;
      const key = `${pathKey(segments)}`;
      const existing = modelLinksByKey.get(key);
      const rank = { value: 3, condition: 2, context: 1 } as const;
      if (!existing || rank[role] > rank[existing.role]) modelLinksByKey.set(key, { segments, role });
    };
    const scope: TraceScope = { pool, configIndex, current, onModelPath: sink };
    const formatCollector = new SourceCollector();
    const expression = dataBinding?.expressionAsString?.trim();
    if (expression) traceExpression(expression, scope, 'value', formatCollector);
    for (const condition of conditions) traceExpression(condition, scope, 'condition', formatCollector);

    const modelLinks: ModelLink[] = Array.from(modelLinksByKey.values()).map(({ segments, role }) => {
      const info = fieldAt?.(segments);
      return {
        path: segments.join('/'),
        segments,
        role,
        field: info?.field,
        container: info?.container.name,
        fill: mapping?.resolve(segments) ?? null,
      };
    });
    const formatSources = sortSources(formatCollector.sources);
    const all = new SourceCollector();
    all.addAll(formatSources);
    for (const link of modelLinks) if (link.fill) all.addAll(link.fill.sources, link.role);

    const hasChildren = element.children.length > (carrier ? 1 : 0);
    const hasValue = Boolean(carrier) || element.children.length === 0;
    const constant = expression != null ? constantValue(expression) : null;
    let fill: FillKind;
    if (!expression) fill = hasValue ? 'unbound' : 'structure';
    else if (constant != null) fill = 'constant';
    else if (isBarePath(expression)) fill = readsModelDirectly(expression, context.modelNames) ? 'model' : 'datasource';
    else fill = 'calculated';

    const constraints = readConstraints(element, carrier, transformations);
    let repeating = false;
    let repeatInferred: boolean | undefined;
    if (constraints.multiplicity === '20' || constraints.multiplicity === '200') repeating = true;
    if (expression && (hasChildren || element.elementType === 'ExcelRange')) {
      const list = isListExpression(expression, scope, isModelList);
      if (list === true) repeating = true;
      else if (list === undefined && !repeating && hasChildren && isBarePath(expression) && !fieldAt) {
        repeating = true;
        repeatInferred = true;
      }
    }
    const optional = constraints.multiplicity === '10';
    const resolvedBinding = expression && currentPath && expression.includes('@') ? substituteCurrent(expression, currentPath) : expression;
    const isField = hasValue && !absorbedInto;

    const entry: ElementFill = {
      id: element.id,
      element,
      path: [...names, element.name],
      depth,
      parentId: parent?.id,
      displayName: absorbedInto && parent ? parent.name : element.name,
      absorbedInto,
      carrierId: carrier?.id,
      dataType: getFormatElementDataType(carrier ?? element),
      valueElementType: (carrier ?? element).elementType,
      binding: expression,
      resolvedBinding,
      fill,
      constant: constant ?? undefined,
      modelLinks,
      formatSources,
      sources: sortSources(all.sources),
      conditions,
      otherBindings,
      repeating,
      repeatInferred,
      optional,
      constraints,
      isField,
      childContext: hasChildren && expression ? expression : undefined,
      contextPath: currentPath ?? undefined,
    };
    elements.push(entry);
    byId.set(normalizeGuid(element.id), entry);

    if (!absorbedInto) {
      if (isField) {
        stats.fields++;
        if (fill === 'constant') stats.constant++;
        else if (fill === 'model') stats.model++;
        else if (fill === 'calculated') stats.calculated++;
        else if (fill === 'datasource') stats.datasource++;
        else if (fill === 'unbound') stats.unbound++;
      }
      if (repeating) stats.repeating++;
      if (conditions.length > 0) stats.conditional++;
    }

    const childCurrent: CurrentRecord | null = hasChildren && expression ? { expression, scope } : current;
    const childPath = hasChildren && expression
      ? (resolvedBinding && isBarePath(resolvedBinding) ? resolvedBinding : null)
      : currentPath;
    for (const child of element.children) {
      walk(child, element, entry.path, absorbedInto ? depth : depth + 1, childCurrent, childPath, entry);
    }
  };
  walk(format.rootElement, undefined, [], 0, null, null, undefined);

  const lineage: FormatLineage = { configIndex, elements, byId, context, mapping, stats };
  lineageCache.set(content, { configurations, lineage });
  return lineage;
}

/** The fill of the element with `elementId` (braces and case do not matter). */
export function elementFill(lineage: FormatLineage | null, elementId: string | undefined): ElementFill | undefined {
  if (!lineage || !elementId) return undefined;
  return lineage.byId.get(normalizeGuid(elementId));
}

/**
 * `expression` as it reads at the element: `@` spelled out as the list the
 * element iterates, so a drill-down started on `@.ItemId` can resolve it.
 */
export function expressionAtElement(fill: Pick<ElementFill, 'contextPath'> | undefined, expression: string): string {
  if (!fill?.contextPath || !expression.includes('@')) return expression;
  return substituteCurrent(expression, fill.contextPath);
}

/** Rows of a field specification: every element except absorbed value nodes. */
export function specificationRows(lineage: FormatLineage): ElementFill[] {
  return lineage.elements.filter(entry => !entry.absorbedInto);
}

/** The most telling value sources: table fields, else tables, else enums / classes / parameters. */
export function primaryValueSources(entry: Pick<ElementFill, 'sources'>): SourceRef[] {
  const value = entry.sources.filter(src => src.role === 'value');
  const fields = value.filter(src => src.kind === 'field');
  if (fields.length > 0) return fields;
  const concrete = value.filter(src => src.kind === 'table' || src.kind === 'enum' || src.kind === 'class' || src.kind === 'parameter');
  return concrete;
}
