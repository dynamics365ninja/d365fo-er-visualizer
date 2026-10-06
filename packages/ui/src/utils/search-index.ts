/**
 * Full-text search over everything a configuration names: format elements,
 * data model records, fields and enums (with their labels in every language),
 * model mapping and format bindings, calculated fields, datasources of every
 * kind, validations, format enums and transformations — full expressions, not
 * cut-off excerpts.
 *
 * Each document says what it is and where it lives, so the panel can group,
 * rank and open it without parsing description strings.
 */
import type {
  ERConfiguration,
  ERDataModelContent,
  ERDatasource,
  ERFormatContent,
  ERFormatElement,
  ERModelMapping,
  ERModelMappingContent,
} from '@er-visualizer/core';
import { getMappingDefinitions } from '../state/mapping-definitions';
import { buildLabelPool, collectLabelTranslations } from './label-resolver';
import { isImplicitValueCarrier } from './format-lineage';
import { normalizeGuid } from './format-binding-display';
import { mappingDefinitionLabel } from './model-hierarchy';

export type SearchDocKind =
  | 'formatElement'
  | 'formatBinding'
  | 'modelRecord'
  | 'modelEnum'
  | 'modelField'
  | 'enumValue'
  | 'mappingBinding'
  | 'datasource'
  | 'calculatedField'
  | 'validation'
  | 'formatEnum'
  | 'transformation';

export type SearchCategory = 'structure' | 'model' | 'bindings' | 'expressions' | 'datasources';

export const SEARCH_CATEGORY_ORDER: SearchCategory[] = ['structure', 'model', 'bindings', 'expressions', 'datasources'];

export type SearchLocator =
  | { type: 'formatElement'; id: string }
  | { type: 'field'; container: string; field: string }
  | { type: 'container'; name: string }
  | { type: 'binding'; path: string }
  | { type: 'datasource'; name: string; parentPath?: string }
  | { type: 'validation'; path: string }
  | { type: 'formatEnum'; name: string }
  | { type: 'transformation'; name: string };

export interface SearchDoc {
  id: string;
  kind: SearchDocKind;
  category: SearchCategory;
  configIndex: number;
  /** Mapping definition label, for documents inside a model mapping. */
  definition?: string;
  name: string;
  /** Where it sits: a breadcrumb, a binding path, `Record.Field`. */
  path?: string;
  expression?: string;
  /** Label texts in every language the configuration carries. */
  labels?: Array<{ language: string; text: string }>;
  /** Table / enum / class name, element type, field type, property. */
  detail?: string;
  /** ER datasource type, ER element type, ER field type code. */
  subtype?: string;
  locate: SearchLocator;
}

export interface SearchIndex {
  docs: SearchDoc[];
  /** Normalized searchable text per document, in `docs` order. */
  norm: Array<{ name: string; path: string; expression: string; labels: string; detail: string }>;
}

/** Lower case without diacritics: `Číslo` and `cislo` find each other. */
export function normalizeSearchText(value: string | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const CATEGORY: Record<SearchDocKind, SearchCategory> = {
  formatElement: 'structure',
  formatBinding: 'bindings',
  modelRecord: 'model',
  modelEnum: 'model',
  modelField: 'model',
  enumValue: 'model',
  mappingBinding: 'bindings',
  datasource: 'datasources',
  calculatedField: 'expressions',
  validation: 'expressions',
  formatEnum: 'structure',
  transformation: 'expressions',
};

const cache = new WeakMap<readonly ERConfiguration[], SearchIndex>();

export function buildSearchIndex(configurations: readonly ERConfiguration[]): SearchIndex {
  const hit = cache.get(configurations);
  if (hit) return hit;
  const docs: SearchDoc[] = [];
  let seq = 0;
  const add = (doc: Omit<SearchDoc, 'id' | 'category'>) => {
    docs.push({ ...doc, id: `${doc.configIndex}:${seq++}`, category: CATEGORY[doc.kind] });
  };

  configurations.forEach((config, configIndex) => {
    const pool = buildLabelPool(configurations as ERConfiguration[], configIndex);
    const labelsOf = (ref: string | undefined) => {
      if (!ref) return undefined;
      const translations = collectLabelTranslations(ref, pool).map(tr => ({ language: tr.languageId, text: tr.value }));
      return translations.length > 0 ? translations : undefined;
    };

    if (config.content.kind === 'DataModel') {
      const model = (config.content as ERDataModelContent).version.model;
      for (const container of model.containers) {
        add({
          kind: container.isEnum ? 'modelEnum' : 'modelRecord',
          configIndex,
          name: container.name,
          labels: labelsOf(container.label),
          detail: container.isRoot ? 'root' : undefined,
          locate: { type: 'container', name: container.name },
        });
        for (const item of container.items) {
          add({
            kind: container.isEnum ? 'enumValue' : 'modelField',
            configIndex,
            name: item.name,
            path: `${container.name}.${item.name}`,
            labels: labelsOf(item.label),
            detail: item.typeDescriptor,
            subtype: String(item.type),
            locate: { type: 'field', container: container.name, field: item.name },
          });
        }
      }
    }

    const addDefinition = (definition: ERModelMapping) => {
      const label = mappingDefinitionLabel(definition) ?? definition.name;
      addDatasources(definition.datasources ?? [], configIndex, label, labelsOf, add);
      for (const binding of definition.bindings ?? []) {
        const segments = binding.path.split(/[\\/]/).filter(Boolean);
        add({
          kind: 'mappingBinding',
          configIndex,
          definition: label,
          name: segments[segments.length - 1] ?? binding.path,
          path: binding.path,
          expression: binding.expressionAsString,
          locate: { type: 'binding', path: binding.path },
        });
      }
      for (const validation of definition.validations ?? []) {
        for (const rule of validation.conditions ?? []) {
          const segments = validation.path.split(/[\\/]/).filter(Boolean);
          add({
            kind: 'validation',
            configIndex,
            definition: label,
            name: segments[segments.length - 1] ?? validation.path,
            path: validation.path,
            expression: [rule.conditionExpressionAsString, rule.messageExpressionAsString].filter(Boolean).join('  ·  '),
            locate: { type: 'validation', path: validation.path },
          });
        }
      }
    };

    if (config.content.kind === 'ModelMapping') {
      for (const definition of getMappingDefinitions((config.content as ERModelMappingContent).version)) addDefinition(definition);
    }

    if (config.content.kind === 'Format') {
      const content = config.content as ERFormatContent;
      const format = content.formatVersion.format;
      const ownerOf = new Map<string, { element: ERFormatElement; path: string[] }>();
      const visit = (element: ERFormatElement, parent: ERFormatElement | undefined, names: string[]) => {
        const here = [...names, element.name];
        const carrier = isImplicitValueCarrier(element, parent);
        const owner = carrier && parent ? ownerOf.get(normalizeGuid(parent.id))! : { element, path: here };
        ownerOf.set(normalizeGuid(element.id), owner);
        if (!carrier) {
          add({
            kind: 'formatElement',
            configIndex,
            name: element.name,
            path: names.slice(1).join(' / '),
            labels: labelsOf(element.attributes?.Label),
            detail: element.attributes?.ExcelRange ?? element.attributes?.ExcelSheetName,
            subtype: element.elementType,
            locate: { type: 'formatElement', id: element.id },
          });
        }
        for (const child of element.children) visit(child, element, here);
      };
      visit(format.rootElement, undefined, []);

      for (const binding of content.formatMappingVersion.formatMapping.bindings ?? []) {
        if (!binding.expressionAsString?.trim()) continue;
        const owner = ownerOf.get(normalizeGuid(binding.componentId));
        add({
          kind: 'formatBinding',
          configIndex,
          name: owner?.element.name ?? binding.componentId,
          path: owner ? owner.path.slice(1, -1).join(' / ') : undefined,
          expression: binding.expressionAsString,
          detail: binding.propertyName,
          subtype: owner?.element.elementType,
          locate: { type: 'formatElement', id: owner?.element.id ?? binding.componentId },
        });
      }
      addDatasources(content.formatMappingVersion.formatMapping.datasources ?? [], configIndex, undefined, labelsOf, add);
      for (const version of content.embeddedModelMappingVersions ?? []) {
        for (const definition of getMappingDefinitions(version)) addDefinition(definition);
      }
      for (const enumDef of format.enumDefinitions) {
        add({ kind: 'formatEnum', configIndex, name: enumDef.name, locate: { type: 'formatEnum', name: enumDef.name } });
        for (const value of enumDef.values) {
          add({ kind: 'enumValue', configIndex, name: value.name, path: `${enumDef.name}.${value.name}`, locate: { type: 'formatEnum', name: enumDef.name } });
        }
      }
      for (const transformation of format.transformations) {
        add({
          kind: 'transformation',
          configIndex,
          name: transformation.name,
          expression: transformation.expressionAsString,
          locate: { type: 'transformation', name: transformation.name },
        });
      }
    }
  });

  const norm = docs.map(doc => ({
    name: normalizeSearchText(doc.name),
    path: normalizeSearchText(doc.path),
    expression: normalizeSearchText(doc.expression),
    labels: normalizeSearchText(doc.labels?.map(l => l.text).join('\n')),
    detail: normalizeSearchText(doc.detail),
  }));
  const index = { docs, norm };
  cache.set(configurations, index);
  return index;
}

function addDatasources(
  datasources: readonly ERDatasource[],
  configIndex: number,
  definition: string | undefined,
  labelsOf: (ref: string | undefined) => SearchDoc['labels'],
  add: (doc: Omit<SearchDoc, 'id' | 'category'>) => void,
): void {
  const visit = (ds: ERDatasource) => {
    if (!ds.implicit) {
      const formula = ds.calculatedField?.expressionAsString || ds.userParamInfo?.expressionAsString || undefined;
      add({
        kind: ds.type === 'CalculatedField' && formula ? 'calculatedField' : 'datasource',
        configIndex,
        definition,
        name: ds.name,
        path: ds.parentPath,
        expression: formula ?? (ds.groupByInfo?.listToGroup || undefined),
        labels: labelsOf(ds.label),
        detail: ds.tableInfo?.tableName ?? ds.enumInfo?.enumName ?? ds.classInfo?.className ?? ds.userParamInfo?.extendedDataTypeName
          ?? ds.modelInfo?.dataContainerDescriptorName,
        subtype: ds.type,
        locate: { type: 'datasource', name: ds.name, parentPath: ds.parentPath },
      });
    }
    for (const child of ds.children ?? []) visit(child);
  };
  for (const ds of datasources) visit(ds);
}

// ─── Querying ───

export type SearchField = 'name' | 'labels' | 'detail' | 'path' | 'expression';

export interface SearchMatch {
  doc: SearchDoc;
  score: number;
  /** The field the best match was found in. */
  field: SearchField;
}

function wordStart(text: string, q: string): boolean {
  let from = 0;
  while (true) {
    const at = text.indexOf(q, from);
    if (at < 0) return false;
    if (at === 0 || /[^a-z0-9]/.test(text[at - 1])) return true;
    from = at + 1;
  }
}

/** Best match of `q` (normalized) in one document. */
function scoreDoc(norm: SearchIndex['norm'][number], doc: SearchDoc, q: string): { score: number; field: SearchField } | null {
  let score = 0;
  let field: SearchField = 'name';
  const consider = (candidate: number, at: SearchField) => {
    if (candidate > score) { score = candidate; field = at; }
  };
  const name = norm.name;
  if (name === q) consider(100, 'name');
  else if (name.startsWith(q)) consider(85, 'name');
  else if (wordStart(name, q)) consider(70, 'name');
  else if (name.includes(q)) consider(55, 'name');
  if (norm.labels) {
    if (norm.labels.split('\n').includes(q)) consider(62, 'labels');
    else if (norm.labels.includes(q)) consider(45, 'labels');
  }
  if (norm.detail) {
    if (norm.detail === q) consider(60, 'detail');
    else if (norm.detail.includes(q)) consider(28, 'detail');
  }
  if (norm.path && norm.path.includes(q)) consider(wordStart(norm.path, q) ? 34 : 26, 'path');
  if (norm.expression && norm.expression.includes(q)) consider(wordStart(norm.expression, q) ? 22 : 16, 'expression');
  if (score === 0) return null;
  // A binding is found by its element's name too, but ranks just below the
  // element or field itself.
  if (field === 'name' && (doc.kind === 'formatBinding' || doc.kind === 'mappingBinding')) score -= 8;
  return { score, field };
}

/**
 * Documents matching `query`, best first. A query of several words also
 * matches documents that contain every word somewhere, ranked below phrase
 * matches.
 */
export function searchIndex(index: SearchIndex, query: string, accept?: (doc: SearchDoc) => boolean): SearchMatch[] {
  const q = normalizeSearchText(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const out: SearchMatch[] = [];
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];
    if (accept && !accept(doc)) continue;
    const norm = index.norm[i];
    let match = scoreDoc(norm, doc, q);
    if (!match && words.length > 1) {
      const all = `${norm.name}\n${norm.labels}\n${norm.detail}\n${norm.path}\n${norm.expression}`;
      if (words.every(word => all.includes(word))) match = { score: 12, field: words.every(word => norm.name.includes(word)) ? 'name' : 'path' };
    }
    if (match) out.push({ doc, score: match.score, field: match.field });
  }
  out.sort((a, b) => b.score - a.score || a.doc.configIndex - b.doc.configIndex || a.doc.id.localeCompare(b.doc.id, undefined, { numeric: true }));
  return out;
}

/** A window of `text` around the first occurrence of `query`, for a one-line excerpt. */
export function excerptAround(text: string, query: string, radius = 60): string {
  const at = normalizeSearchText(text).indexOf(normalizeSearchText(query.trim()));
  if (at < 0 || text.length <= radius * 2) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.trim().length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
