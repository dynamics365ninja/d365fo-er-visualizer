// GUID Registry: Maps GUIDs to their owning components for cross-reference lookup
import { ERComponentKind } from '../types/common.js';
import type { ERConfiguration } from '../types/common.js';
import type { ERDataContainerDescriptor } from '../types/model.js';
import type { ERDatasource, ERBinding, ERValidation } from '../types/mapping.js';
import type { ERFormatElement, ERFormatBinding } from '../types/format.js';

export interface GUIDEntry {
  guid: string;
  kind: 'Solution' | 'ModelVersion' | 'MappingVersion' | 'FormatVersion' | 'FormatMappingVersion'
    | 'Container' | 'FormatElement' | 'FormatEnum' | 'Transformation' | 'ValidationRule';
  name: string;
  configFilePath: string;
  componentKind: ERComponentKind;
}

/**
 * How one mapping definition is named across the app.
 *
 * A model-mapping solution carries one definition per model root
 * (SalesInvoice, TMSCommercialInvoice, …) and those definitions reuse the same
 * datasource and binding names, so the definition is what tells two otherwise
 * identical hits apart. The descriptor is appended only when it differs from
 * the definition name, matching the tree label.
 */
export function mappingDefinitionLabel(mapping: unknown): string | undefined {
  const m = mapping as { name?: string; dataContainerDescriptor?: string } | undefined;
  const name = (m?.name ?? '').trim();
  const descriptor = (m?.dataContainerDescriptor ?? '').trim();
  if (!name) return descriptor || undefined;
  return descriptor && descriptor !== name ? `${name} [${descriptor}]` : name;
}

export interface CrossRefEntry {
  /** What is being referenced (table name, field path, GUID, etc.) */
  target: string;
  targetType: 'Table' | 'Field' | 'GUID' | 'ModelPath' | 'Enum' | 'Class' | 'EDT' | 'Label' | 'Formula';
  /** Where the reference occurs */
  sourceConfigPath: string;
  sourceComponent: string;
  /**
   * Mapping definition the reference was found in — a model mapping solution
   * repeats the same bindings and datasource names in a definition per model
   * root (SalesInvoice, InvoiceCustomer, …), and a search started from one
   * format must be able to tell them apart.
   */
  sourceDefinition?: string;
  sourceContext: string; // human-readable description
}

/**
 * The all-zero id the parser gives a component whose download came without
 * the `ERSolutionVersion` envelope. Every such download shares it, so it
 * identifies nothing and is never registered.
 */
const PLACEHOLDER_GUID = /^\{?0{8}-0{4}-0{4}-0{4}-0{12}\}?(,\d+)?$/;

/**
 * Names an ER formula starts a data path with — `'Sales invoice'` in
 * `'Sales invoice'.Lines.Amount`, `model` in `model.X`. A name counts only
 * when a `.` follows it, and only the first segment of a dotted path is a
 * reference: the rest are fields of it. String literals ("file.xml") and
 * numbers (1.5) are skipped; quoted names keep their spaces and non-ASCII
 * letters.
 */
export function formulaReferenceRoots(expr: string): string[] {
  const roots: string[] = [];
  const identStart = /[\p{L}_$#@]/u;
  const identPart = /[\p{L}\p{N}_$#@]/u;
  let i = 0;
  let afterDot = false;

  // A quoted token with `''` / `""` doubling as the escape for the quote.
  const readQuoted = (quote: string): string => {
    let value = '';
    i++;
    while (i < expr.length) {
      if (expr[i] === quote) {
        if (expr[i + 1] === quote) { value += quote; i += 2; continue; }
        i++;
        break;
      }
      value += expr[i++];
    }
    return value;
  };

  while (i < expr.length) {
    const ch = expr[i];
    let name: string | undefined;
    if (ch === '"') {
      readQuoted('"');
      afterDot = false;
      continue;
    } else if (ch === "'") {
      name = readQuoted("'");
    } else if (/[0-9]/.test(ch)) {
      while (i < expr.length && /[0-9.eE]/.test(expr[i])) i++;
      afterDot = false;
      continue;
    } else if (identStart.test(ch)) {
      const start = i;
      while (i < expr.length && identPart.test(expr[i])) i++;
      name = expr.slice(start, i);
    } else {
      // Whitespace inside `a. b` keeps the path going; anything else ends it.
      if (!/\s/.test(ch)) afterDot = false;
      i++;
      continue;
    }

    let j = i;
    while (j < expr.length && /\s/.test(expr[j])) j++;
    const startsPath = expr[j] === '.';
    if (startsPath && !afterDot && name) roots.push(name);
    afterDot = startsPath;
    if (startsPath) i = j + 1;
  }
  return roots;
}

export class GUIDRegistry {
  /**
   * Every component registered under a GUID. A derived format reuses the
   * element ids of its base, so with both loaded one id belongs to two files.
   */
  private entries = new Map<string, GUIDEntry[]>();
  private crossRefs: CrossRefEntry[] = [];
  /** Secondary index: normalized target → cross-refs. Built lazily, invalidated on mutation. */
  private targetIndex: Map<string, CrossRefEntry[]> | null = null;
  /**
   * Mapping definition being indexed right now. Stamped onto every cross-ref
   * it produces, so hits keep the definition they belong to instead of being
   * indistinguishable from the copies in the sibling definitions.
   */
  private currentDefinition: string | undefined;

  clear(): void {
    this.entries.clear();
    this.crossRefs = [];
    this.targetIndex = null;
  }

  register(entry: GUIDEntry): void {
    if (!entry.guid || PLACEHOLDER_GUID.test(entry.guid)) return;
    const key = entry.guid.toLowerCase();
    const bucket = this.entries.get(key);
    if (!bucket) {
      this.entries.set(key, [entry]);
      return;
    }
    // Re-registering the same component (same file, same kind) replaces it.
    const existing = bucket.findIndex(e => e.configFilePath === entry.configFilePath && e.kind === entry.kind);
    if (existing >= 0) bucket[existing] = entry; else bucket.push(entry);
  }

  /**
   * The component registered under `guid`. When several files carry it (a
   * derived format and its base), the one in `preferredConfigPath` wins;
   * otherwise the most recently indexed one.
   */
  lookup(guid: string, preferredConfigPath?: string): GUIDEntry | undefined {
    const bucket = this.entries.get(guid.toLowerCase());
    if (!bucket) return undefined;
    return (preferredConfigPath !== undefined
      ? bucket.find(e => e.configFilePath === preferredConfigPath)
      : undefined) ?? bucket[bucket.length - 1];
  }

  /** Every component registered under `guid`, in indexing order. */
  lookupAll(guid: string): GUIDEntry[] {
    return this.entries.get(guid.toLowerCase())?.slice() ?? [];
  }

  getAllEntries(): GUIDEntry[] {
    return Array.from(this.entries.values()).flat();
  }

  addCrossRef(ref: CrossRefEntry): void {
    this.crossRefs.push(
      ref.sourceDefinition === undefined && this.currentDefinition !== undefined
        ? { ...ref, sourceDefinition: this.currentDefinition }
        : ref,
    );
    this.targetIndex = null; // invalidate
  }

  private ensureTargetIndex(): Map<string, CrossRefEntry[]> {
    if (this.targetIndex) return this.targetIndex;
    const index = new Map<string, CrossRefEntry[]>();
    for (const ref of this.crossRefs) {
      const key = ref.target.toLowerCase();
      const bucket = index.get(key);
      if (bucket) bucket.push(ref); else index.set(key, [ref]);
    }
    this.targetIndex = index;
    return index;
  }

  /** Find all cross-references pointing to a given target. O(1) average via secondary index. */
  findRefsTo(target: string, targetType?: CrossRefEntry['targetType']): CrossRefEntry[] {
    const bucket = this.ensureTargetIndex().get(target.toLowerCase());
    if (!bucket) return [];
    return targetType ? bucket.filter(r => r.targetType === targetType) : bucket.slice();
  }

  /** Find all cross-references from a given source config */
  findRefsFrom(sourceConfigPath: string): CrossRefEntry[] {
    return this.crossRefs.filter(r => r.sourceConfigPath === sourceConfigPath);
  }

  /** Search cross-references by any text match */
  search(query: string): CrossRefEntry[] {
    const lower = query.toLowerCase();
    return this.crossRefs.filter(r =>
      r.target.toLowerCase().includes(lower) ||
      r.sourceComponent.toLowerCase().includes(lower) ||
      r.sourceContext.toLowerCase().includes(lower)
    );
  }

  get crossRefCount(): number {
    return this.crossRefs.length;
  }

  get guidCount(): number {
    return this.entries.size;
  }

  /** Index a full configuration, registering all GUIDs and cross-references */
  indexConfiguration(config: ERConfiguration): void {
    const fp = config.filePath;
    const ck = config.kind;

    // Solution-level GUID
    this.register({
      guid: config.solutionVersion.solution.id,
      kind: 'Solution',
      name: config.solutionVersion.solution.name,
      configFilePath: fp,
      componentKind: ck,
    });

    // Base reference cross-ref
    if (config.solutionVersion.solution.baseSolutionId) {
      this.addCrossRef({
        target: config.solutionVersion.solution.baseSolutionId,
        targetType: 'GUID',
        sourceConfigPath: fp,
        sourceComponent: config.solutionVersion.solution.name,
        sourceContext: `Base model reference`,
      });
    }

    const c = config.content;

    if (c.kind === 'DataModel') {
      this.register({
        guid: c.version.id,
        kind: 'ModelVersion',
        name: c.version.model.name,
        configFilePath: fp,
        componentKind: ck,
      });
      for (const container of c.version.model.containers) {
        this.indexContainer(container, fp);
      }
    }

    if (c.kind === 'ModelMapping') {
      this.register({
        guid: c.version.id,
        kind: 'MappingVersion',
        name: c.version.mapping.name,
        configFilePath: fp,
        componentKind: ck,
      });

      for (const mapping of c.version.mappings ?? [c.version.mapping]) {
        this.currentDefinition = mappingDefinitionLabel(mapping);
        // Model reference
        this.addCrossRef({
          target: mapping.modelId,
          targetType: 'GUID',
          sourceConfigPath: fp,
          sourceComponent: mapping.name,
          sourceContext: 'Model mapping references data model',
        });

        this.indexDatasources(mapping.datasources, fp);
        this.indexBindings(mapping.bindings, fp, mapping.name);
        this.indexValidations(mapping.validations, fp);
        this.currentDefinition = undefined;
      }
    }

    if (c.kind === 'Format') {
      this.register({
        guid: c.formatVersion.id,
        kind: 'FormatVersion',
        name: c.formatVersion.format.name,
        configFilePath: fp,
        componentKind: ck,
      });
      this.register({
        guid: c.formatMappingVersion.id,
        kind: 'FormatMappingVersion',
        name: c.formatMappingVersion.formatMapping.name,
        configFilePath: fp,
        componentKind: ck,
      });

      // Format→Model reference
      this.addCrossRef({
        target: c.formatMappingVersion.formatMapping.formatId,
        targetType: 'GUID',
        sourceConfigPath: fp,
        sourceComponent: c.formatMappingVersion.formatMapping.name,
        sourceContext: 'Format mapping references format definition',
      });

      this.indexFormatElement(c.formatVersion.format.rootElement, fp, ck);
      this.indexFormatBindings(c.formatMappingVersion.formatMapping.bindings, fp, c.formatVersion.format.name);
      this.indexDatasources(c.formatMappingVersion.formatMapping.datasources, fp);

      for (const enumDef of c.formatVersion.format.enumDefinitions) {
        this.register({
          guid: enumDef.id,
          kind: 'FormatEnum',
          name: enumDef.name,
          configFilePath: fp,
          componentKind: ck,
        });
      }

      for (const trans of c.formatVersion.format.transformations) {
        this.register({
          guid: trans.id,
          kind: 'Transformation',
          name: trans.name,
          configFilePath: fp,
          componentKind: ck,
        });
      }
    }
  }

  private indexContainer(container: ERDataContainerDescriptor, fp: string): void {
    for (const item of container.items) {
      if (item.typeDescriptor) {
        this.addCrossRef({
          target: item.typeDescriptor,
          targetType: 'ModelPath',
          sourceConfigPath: fp,
          sourceComponent: `${container.name}.${item.name}`,
          sourceContext: `TypeDescriptor reference in model field`,
        });
      }
    }
  }

  private indexDatasources(datasources: ERDatasource[], fp: string): void {
    for (const ds of datasources) {
      if (ds.tableInfo) {
        this.addCrossRef({
          target: ds.tableInfo.tableName,
          targetType: 'Table',
          sourceConfigPath: fp,
          sourceComponent: ds.name,
          sourceContext: `Datasource "${ds.name}" uses table "${ds.tableInfo.tableName}"`,
        });
        for (const field of ds.tableInfo.selectedFields) {
          this.addCrossRef({
            target: `${ds.tableInfo.tableName}.${field}`,
            targetType: 'Field',
            sourceConfigPath: fp,
            sourceComponent: ds.name,
            sourceContext: `Selected field in datasource "${ds.name}"`,
          });
        }
      }
      if (ds.enumInfo) {
        this.addCrossRef({
          target: ds.enumInfo.enumName,
          targetType: 'Enum',
          sourceConfigPath: fp,
          sourceComponent: ds.name,
          sourceContext: `Datasource "${ds.name}" uses enum "${ds.enumInfo.enumName}"`,
        });
      }
      if (ds.classInfo) {
        this.addCrossRef({
          target: ds.classInfo.className,
          targetType: 'Class',
          sourceConfigPath: fp,
          sourceComponent: ds.name,
          sourceContext: `Datasource "${ds.name}" uses class "${ds.classInfo.className}"`,
        });
      }
      if (ds.userParamInfo?.extendedDataTypeName) {
        this.addCrossRef({
          target: ds.userParamInfo.extendedDataTypeName,
          targetType: 'EDT',
          sourceConfigPath: fp,
          sourceComponent: ds.name,
          sourceContext: `User parameter "${ds.name}" uses EDT "${ds.userParamInfo.extendedDataTypeName}"`,
        });
      }
      if (ds.calculatedField) {
        this.indexExpressionString(ds.calculatedField.expressionAsString, fp, ds.name, 'Calculated field expression');
      }
      if (ds.children.length > 0) {
        this.indexDatasources(ds.children, fp);
      }
    }
  }

  private indexBindings(bindings: ERBinding[], fp: string, parentName: string): void {
    for (const b of bindings) {
      this.addCrossRef({
        target: b.path,
        targetType: 'ModelPath',
        sourceConfigPath: fp,
        sourceComponent: parentName,
        sourceContext: `Binding: ${b.path} = ${b.expressionAsString}`,
      });
      this.indexExpressionString(b.expressionAsString, fp, parentName, `Binding for ${b.path}`);
    }
  }

  private indexFormatBindings(bindings: ERFormatBinding[], fp: string, parentName: string): void {
    for (const b of bindings) {
      const prop = (b.propertyName ?? '').trim();
      const propSuffix = prop ? ` [${prop}]` : '';
      this.addCrossRef({
        target: b.componentId,
        targetType: 'GUID',
        sourceConfigPath: fp,
        sourceComponent: parentName,
        sourceContext: `Format binding${propSuffix} to component: ${b.expressionAsString}`,
      });
      this.indexExpressionString(b.expressionAsString, fp, parentName, `Format binding${propSuffix} expression`);
    }
  }

  private indexValidations(validations: ERValidation[], fp: string): void {
    for (const v of validations) {
      for (const rule of v.conditions) {
        this.register({
          guid: rule.id,
          kind: 'ValidationRule',
          name: `Validation: ${v.path}`,
          configFilePath: fp,
          componentKind: ERComponentKind.ModelMapping,
        });
      }
    }
  }

  private indexFormatElement(
    element: ERFormatElement,
    fp: string,
    ck: ERComponentKind,
    parentName?: string,
  ): void {
    /*
     * Content nodes (`<ERTextFormatString ID.="…" MaximalLength="32" />` sitting
     * under an XML attribute) carry no `Name`, so the parser falls back to the
     * element type. A Value binding targets that node, which meant search hits
     * and tooltips for such bindings were labelled "String" — telling the user
     * nothing about which element they had found. Register them under the
     * element they belong to instead.
     */
    const hasOwnName = Boolean(element.name) && element.name !== element.elementType;
    const displayName = hasOwnName ? element.name : (parentName ?? element.name);

    if (element.id) {
      this.register({
        guid: element.id,
        kind: 'FormatElement',
        name: displayName,
        configFilePath: fp,
        componentKind: ck,
      });
    }
    for (const child of element.children) {
      this.indexFormatElement(child, fp, ck, hasOwnName ? element.name : parentName);
    }
  }

  private indexExpressionString(expr: string, fp: string, component: string, context: string): void {
    if (!expr) return;

    // Datasource references: the head of every 'Datasource'.Field.Path.
    for (const root of formulaReferenceRoots(expr)) {
      this.addCrossRef({
        target: root,
        targetType: 'Formula',
        sourceConfigPath: fp,
        sourceComponent: component,
        sourceContext: `${context}: ${expr.substring(0, 100)}`,
      });
    }
  }
}
