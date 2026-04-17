// GUID Registry: Maps GUIDs to their owning components for cross-reference lookup
import { ERComponentKind } from '../types/common.js';
import type { ERConfiguration } from '../types/common.js';
import type { ERDataContainerDescriptor, ERDataContainerItem } from '../types/model.js';
import type { ERDatasource, ERBinding, ERValidation } from '../types/mapping.js';
import type { ERFormatElement, ERFormatBinding, ERFormatEnumDefinition } from '../types/format.js';

export interface GUIDEntry {
  guid: string;
  kind: 'Solution' | 'ModelVersion' | 'MappingVersion' | 'FormatVersion' | 'FormatMappingVersion'
    | 'Container' | 'FormatElement' | 'FormatEnum' | 'Transformation' | 'ValidationRule';
  name: string;
  configFilePath: string;
  componentKind: ERComponentKind;
}

export interface CrossRefEntry {
  /** What is being referenced (table name, field path, GUID, etc.) */
  target: string;
  targetType: 'Table' | 'Field' | 'GUID' | 'ModelPath' | 'Enum' | 'Class' | 'EDT' | 'Label' | 'Formula';
  /** Where the reference occurs */
  sourceConfigPath: string;
  sourceComponent: string;
  sourceContext: string; // human-readable description
}

export class GUIDRegistry {
  private entries = new Map<string, GUIDEntry>();
  private crossRefs: CrossRefEntry[] = [];
  /** Secondary index: normalized target → cross-refs. Built lazily, invalidated on mutation. */
  private targetIndex: Map<string, CrossRefEntry[]> | null = null;

  clear(): void {
    this.entries.clear();
    this.crossRefs = [];
    this.targetIndex = null;
  }

  register(entry: GUIDEntry): void {
    if (entry.guid) {
      this.entries.set(entry.guid.toLowerCase(), entry);
    }
  }

  lookup(guid: string): GUIDEntry | undefined {
    return this.entries.get(guid.toLowerCase());
  }

  getAllEntries(): GUIDEntry[] {
    return Array.from(this.entries.values());
  }

  addCrossRef(ref: CrossRefEntry): void {
    this.crossRefs.push(ref);
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
        this.indexContainer(container, fp, ck);
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

      // Model reference
      this.addCrossRef({
        target: c.version.mapping.modelId,
        targetType: 'GUID',
        sourceConfigPath: fp,
        sourceComponent: c.version.mapping.name,
        sourceContext: 'Model mapping references data model',
      });

      this.indexDatasources(c.version.mapping.datasources, fp, ck, c.version.mapping.name);
      this.indexBindings(c.version.mapping.bindings, fp, c.version.mapping.name);
      this.indexValidations(c.version.mapping.validations, fp, c.version.mapping.name);
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
      this.indexDatasources(c.formatMappingVersion.formatMapping.datasources, fp, ck, c.formatVersion.format.name);

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

  private indexContainer(container: ERDataContainerDescriptor, fp: string, ck: ERComponentKind): void {
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

  private indexDatasources(datasources: ERDatasource[], fp: string, ck: ERComponentKind, parentName: string): void {
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
        this.indexDatasources(ds.children, fp, ck, ds.name);
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
      this.addCrossRef({
        target: b.componentId,
        targetType: 'GUID',
        sourceConfigPath: fp,
        sourceComponent: parentName,
        sourceContext: `Format binding to component: ${b.expressionAsString}`,
      });
      this.indexExpressionString(b.expressionAsString, fp, parentName, 'Format binding expression');
    }
  }

  private indexValidations(validations: ERValidation[], fp: string, parentName: string): void {
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

  private indexFormatElement(element: ERFormatElement, fp: string, ck: ERComponentKind): void {
    if (element.id) {
      this.register({
        guid: element.id,
        kind: 'FormatElement',
        name: element.name,
        configFilePath: fp,
        componentKind: ck,
      });
    }
    for (const child of element.children) {
      this.indexFormatElement(child, fp, ck);
    }
  }

  private indexExpressionString(expr: string, fp: string, component: string, context: string): void {
    if (!expr) return;

    // Extract table/datasource references from expressions
    // Pattern: 'DatasourceName'.FieldPath or DatasourceName.FieldPath
    const refPattern = /['"]?(\w+)['"]?\.\w+/g;
    let match;
    while ((match = refPattern.exec(expr)) !== null) {
      // Only add formula-level references
      this.addCrossRef({
        target: match[1],
        targetType: 'Formula',
        sourceConfigPath: fp,
        sourceComponent: component,
        sourceContext: `${context}: ${expr.substring(0, 100)}`,
      });
    }
  }
}
