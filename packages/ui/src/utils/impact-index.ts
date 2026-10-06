/**
 * Where-used as impact analysis: for every table, table field, enum, class,
 * user parameter, datasource and data model field of the workspace, which
 * model fields the mappings fill from it and which elements of which formats
 * end up reading it — through calculated fields, record lists and the model
 * mapping, not only where its name is spelled out.
 *
 * Built once per configuration set from the same lineage the field
 * specification shows, so both always agree.
 */
import type { ERConfiguration, ERDataModel, ERDataModelContent, ERFormatContent, ERModelMapping, ERModelMappingContent } from '@er-visualizer/core';
import { getMappingDefinitions } from '../state/mapping-definitions';
import type { SourceKind, SourceRef, SourceRole } from './datasource-lineage';
import { buildFormatLineage, buildMappingLineage, modelFieldResolver, specificationRows, type ModelFieldInfo } from './format-lineage';
import { normGuid } from './model-hierarchy';

export type ImpactKind = Exclude<SourceKind, 'importFormat'> | 'modelField';

export interface ImpactEntity {
  key: string;
  kind: ImpactKind;
  /** `CustInvoiceTrans`, `CustInvoiceTrans.ItemId`, `$Lines`, `InvoiceLine_1.ItemId`. */
  name: string;
  /** Datasource: the configuration and mapping definition that declare it. */
  configIndex?: number;
  definition?: string;
  dsType?: string;
  /** Model field: the record that declares it, the field and its label reference. */
  container?: string;
  field?: string;
  label?: string;
  /** Model field: every path a format or mapping reaches it by. */
  paths?: string[];
  /** Model field: the data model. */
  modelName?: string;
}

export type UsageRole = SourceRole | 'fills';

export interface MappingUsage {
  configIndex: number;
  definition: string;
  /** Model path the binding fills. */
  path: string;
  expression: string;
  role: UsageRole;
}

export interface FormatUsage {
  configIndex: number;
  elementId: string;
  elementPath: string[];
  displayName: string;
  elementType: string;
  /** Model path through which the element reaches the entity. */
  via?: string;
  expression?: string;
  role: UsageRole;
}

export interface ImpactIndex {
  entities: Map<string, ImpactEntity>;
  mappingUsages: Map<string, MappingUsage[]>;
  formatUsages: Map<string, FormatUsage[]>;
}

const lower = (value: string) => value.toLowerCase();

export function sourceEntityKey(source: Pick<SourceRef, 'kind' | 'name' | 'configIndex' | 'definition'>): string {
  if (source.kind === 'datasource') return `datasource|${source.configIndex}|${lower(source.definition ?? '')}|${lower(source.name)}`;
  return `${source.kind}|${lower(source.name)}`;
}

export function modelFieldKey(modelName: string, container: string, field: string): string {
  return `modelField|${lower(modelName)}|${lower(container)}.${lower(field)}`;
}

export function modelPathKey(descriptor: string, path: string): string {
  return `modelField|path|${lower(descriptor)}|${lower(path)}`;
}

const ROLE_RANK: Record<UsageRole, number> = { fills: 4, value: 3, condition: 2, context: 1 };

function pushUsage<T extends { role: UsageRole }>(map: Map<string, T[]>, key: string, usage: T, identity: (u: T) => string): void {
  const list = map.get(key);
  if (!list) { map.set(key, [usage]); return; }
  const id = identity(usage);
  const at = list.findIndex(existing => identity(existing) === id);
  if (at < 0) list.push(usage);
  else if (ROLE_RANK[usage.role] > ROLE_RANK[list[at].role]) list[at] = usage;
}

const indexCache = new WeakMap<readonly ERConfiguration[], ImpactIndex>();

export function buildImpactIndex(configurations: readonly ERConfiguration[]): ImpactIndex {
  const cached = indexCache.get(configurations);
  if (cached) return cached;

  const entities = new Map<string, ImpactEntity>();
  const mappingUsages = new Map<string, MappingUsage[]>();
  const formatUsages = new Map<string, FormatUsage[]>();

  const models = configurations
    .filter(cfg => cfg.content.kind === 'DataModel')
    .map(cfg => (cfg.content as ERDataModelContent).version.model);
  const modelFor = (modelId: string | undefined): ERDataModel | undefined => {
    const id = normGuid(modelId);
    return models.find(model => normGuid(model.id) === id) ?? (models.length === 1 ? models[0] : undefined);
  };

  const ensureSource = (source: SourceRef): string | null => {
    if (source.kind === 'importFormat') return null;
    const key = sourceEntityKey(source);
    if (!entities.has(key)) {
      entities.set(key, {
        key,
        kind: source.kind,
        name: source.name,
        ...(source.kind === 'datasource' ? { configIndex: source.configIndex, definition: source.definition, dsType: source.dsType } : {}),
      });
    }
    return key;
  };

  const ensureModelField = (descriptor: string, segments: readonly string[], info: ModelFieldInfo | undefined, modelName: string | undefined): string => {
    const path = segments.join('/');
    const key = info && modelName
      ? modelFieldKey(modelName, info.container.name, info.field.name)
      : modelPathKey(descriptor, path);
    const existing = entities.get(key);
    if (existing) {
      if (!existing.paths!.some(p => lower(p) === lower(path))) existing.paths!.push(path);
      return key;
    }
    entities.set(key, {
      key,
      kind: 'modelField',
      name: info ? `${info.container.name}.${info.field.name}` : path,
      container: info?.container.name,
      field: info?.field.name ?? segments[segments.length - 1],
      label: info?.field.label,
      paths: [path],
      modelName,
    });
    return key;
  };

  // ── Model mappings: what each binding fills and reads ──
  const definitions: Array<{ definition: ERModelMapping; configIndex: number }> = [];
  configurations.forEach((config, configIndex) => {
    if (config.content.kind === 'ModelMapping') {
      for (const definition of getMappingDefinitions((config.content as ERModelMappingContent).version)) {
        definitions.push({ definition, configIndex });
      }
    } else if (config.content.kind === 'Format') {
      for (const version of (config.content as ERFormatContent).embeddedModelMappingVersions ?? []) {
        for (const definition of getMappingDefinitions(version)) definitions.push({ definition, configIndex });
      }
    }
  });

  for (const { definition, configIndex } of definitions) {
    const lineage = buildMappingLineage(definition, configIndex);
    const model = modelFor(definition.modelId);
    const descriptor = definition.dataContainerDescriptor ?? '';
    const fieldAt = model && descriptor ? modelFieldResolver(model, descriptor) : null;
    for (const binding of definition.bindings ?? []) {
      const segments = binding.path.split(/[\\/.]/).filter(Boolean);
      const fill = lineage.resolve(segments);
      if (!fill) continue;
      const usageBase = { configIndex, definition: lineage.label, path: fill.path, expression: fill.expression };
      const identity = (u: MappingUsage) => `${u.configIndex}|${u.definition}|${lower(u.path)}`;
      const fieldKey = ensureModelField(descriptor, segments, fieldAt?.(segments), model?.name);
      pushUsage(mappingUsages, fieldKey, { ...usageBase, role: 'fills' }, identity);
      for (const source of fill.sources) {
        const key = ensureSource(source);
        if (key) pushUsage(mappingUsages, key, { ...usageBase, role: source.role }, identity);
      }
    }
  }

  // ── Formats: what each element reads, through the mapping ──
  configurations.forEach((config, configIndex) => {
    if (config.content.kind !== 'Format') return;
    const lineage = buildFormatLineage(configurations, configIndex);
    if (!lineage) return;
    const descriptor = lineage.context.descriptor;
    const model = lineage.context.dataModel?.model;
    const fieldAt = lineage.context.dataModel ? modelFieldResolver(lineage.context.dataModel.model, descriptor) : null;
    const identity = (u: FormatUsage) => `${u.configIndex}|${u.elementId}`;
    for (const row of specificationRows(lineage)) {
      if (!row.binding && row.conditions.length === 0) continue;
      const base = {
        configIndex,
        elementId: row.id,
        elementPath: row.path,
        displayName: row.displayName,
        elementType: row.element.elementType,
        expression: row.binding ?? row.conditions[0],
      };
      for (const link of row.modelLinks) {
        const key = ensureModelField(descriptor, link.segments, fieldAt?.(link.segments), model?.name);
        pushUsage(formatUsages, key, { ...base, via: link.path, role: link.role }, identity);
        for (const source of link.fill?.sources ?? []) {
          const sourceKey = ensureSource(source);
          const role: UsageRole = ROLE_RANK[link.role] < ROLE_RANK[source.role] ? link.role : source.role;
          if (sourceKey) pushUsage(formatUsages, sourceKey, { ...base, via: link.path, role }, identity);
        }
      }
      for (const source of row.formatSources) {
        const key = ensureSource(source);
        if (key) pushUsage(formatUsages, key, { ...base, role: source.role }, identity);
      }
    }
  });

  const index = { entities, mappingUsages, formatUsages };
  indexCache.set(configurations, index);
  return index;
}

// ─── Querying ───

export type WhereUsedTarget =
  | { kind: 'modelField'; container: string; field: string; modelName?: string }
  | { kind: 'datasource'; configIndex: number; name: string; parentPath?: string }
  | { kind: 'table' | 'enum' | 'class'; name: string };

export interface ImpactMatch {
  entity: ImpactEntity;
  /** 3 exact, 2 prefix, 1 contains; 4 for the entity a where-used was started from. */
  score: number;
  mappingCount: number;
  formatCount: number;
}

const KIND_ORDER: Record<ImpactKind, number> = { table: 0, field: 1, modelField: 2, datasource: 3, enum: 4, class: 5, parameter: 6 };

function nameScore(candidate: string | undefined, query: string): number {
  if (!candidate) return 0;
  const value = lower(candidate).replace(/^[$#]/, '');
  const q = query.replace(/^[$#]/, '');
  if (value === q) return 3;
  if (value.startsWith(q)) return 2;
  if (value.includes(q)) return 1;
  return 0;
}

/** Entities whose names match `query`, best first; `labelOf` lets model field labels match too. */
export function findImpactEntities(
  index: ImpactIndex,
  query: string,
  options: { target?: WhereUsedTarget | null; labelOf?: (labelRef: string | undefined) => string | undefined; limit?: number } = {},
): ImpactMatch[] {
  const q = lower(query.trim());
  const targetKeys = new Set(options.target ? targetEntityKeys(index, options.target) : []);
  if (!q && targetKeys.size === 0) return [];
  const out: ImpactMatch[] = [];
  for (const entity of index.entities.values()) {
    let score = targetKeys.has(entity.key) ? 4 : 0;
    if (!score && q) {
      const leaf = entity.name.split('.').pop();
      score = Math.max(
        nameScore(entity.name, q),
        nameScore(leaf, q),
        entity.field ? nameScore(entity.field, q) : 0,
        ...(entity.paths ?? []).map(path => Math.min(2, nameScore(path, q))),
        entity.label && options.labelOf ? Math.min(2, nameScore(options.labelOf(entity.label), q)) : 0,
      );
    }
    if (!score) continue;
    const mappingCount = index.mappingUsages.get(entity.key)?.length ?? 0;
    const formatCount = index.formatUsages.get(entity.key)?.length ?? 0;
    if (mappingCount + formatCount === 0) continue;
    out.push({ entity, score, mappingCount, formatCount });
  }
  out.sort((a, b) =>
    b.score - a.score
    || KIND_ORDER[a.entity.kind] - KIND_ORDER[b.entity.kind]
    || (b.formatCount + b.mappingCount) - (a.formatCount + a.mappingCount)
    || a.entity.name.localeCompare(b.entity.name));
  return options.limit ? out.slice(0, options.limit) : out;
}

function targetEntityKeys(index: ImpactIndex, target: WhereUsedTarget): string[] {
  const keys: string[] = [];
  for (const entity of index.entities.values()) {
    switch (target.kind) {
      case 'modelField':
        if (entity.kind === 'modelField'
          && lower(entity.field ?? '') === lower(target.field)
          && (!entity.container || lower(entity.container) === lower(target.container))
          && (!target.modelName || !entity.modelName || lower(entity.modelName) === lower(target.modelName))) keys.push(entity.key);
        break;
      case 'datasource': {
        if (entity.kind !== 'datasource' || entity.configIndex !== target.configIndex) break;
        const path = target.parentPath ? `${target.parentPath}/${target.name}` : target.name;
        if (lower(entity.name) === lower(path)) keys.push(entity.key);
        break;
      }
      default:
        if (entity.kind === target.kind && lower(entity.name) === lower(target.name)) keys.push(entity.key);
    }
  }
  return keys;
}
