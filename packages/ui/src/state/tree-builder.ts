/**
 * Explorer tree nodes for the loaded configurations, and lookups over them.
 * Pure: the store rebuilds the tree whenever the configuration set changes.
 */
import type {
  ERConfiguration,
  ERComponentKind,
  ERDataModelContent,
  ERModelMappingContent,
  ERFormatContent,
} from '@er-visualizer/core';
import { getFormatElementExcelRange } from '@er-visualizer/core';
import { locale } from '../i18n';
import { buildFormatBindingPresentation } from '../utils/format-binding-display';
import { countDeclaredDatasources } from '../utils/datasource-tree';
import { mappingDefinitionLabel } from '../utils/model-hierarchy';
import {
  getFormatDescriptorNames,
  getMappingDefinitions,
  orderMappingDefinitions,
  selectMappingDefinition,
} from './mapping-definitions';

// ─── Tree Node (unified for all component types) ───

export interface TreeNode {
  id: string;
  name: string;
  icon: string;
  type: 'file' | 'solution' | 'model' | 'container' | 'field' | 'mapping'
    | 'datasource' | 'binding' | 'validation' | 'format' | 'formatElement'
    | 'formatBinding' | 'enum' | 'enumValue' | 'transformation' | 'section';
  children?: TreeNode[];
  data?: any; // reference to the original typed object
  configIndex?: number; // index in configurations array
  /**
   * Mapping definition (`Name [DataContainerDescriptor]`) this node lives
   * under. A model-mapping solution carries one definition per model root
   * (SalesInvoice, TMSCommercialInvoice, …) that reuse the same datasource and
   * binding names, so search results have to say which one they came from.
   */
  mappingDefinition?: string;
}

/** The part of the store the tree lookups and the where-used scan read. */
export interface WorkspaceTrees {
  configurations: ERConfiguration[];
  treeNodes: TreeNode[];
}

export function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findNodeByMatch(node: TreeNode, predicate: (n: TreeNode) => boolean): TreeNode | null {
  if (predicate(node)) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByMatch(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

// ─── Tree Building ───

const kindIcons: Record<ERComponentKind, string> = {
  DataModel: '🧩',
  ModelMapping: '🗺️',
  Format: '🧾',
};

function getConfigurationIcon(config: ERConfiguration): string {
  if (config.kind !== 'Format' || config.content.kind !== 'Format') {
    return kindIcons[config.kind] ?? '🧾';
  }

  return config.content.direction === 'Import' ? '🧾↓' : '🧾↑';
}

const fieldTypeIcons: Record<number, string> = {
  1: '☑', // Boolean
  3: '#',  // Int64
  4: '#',  // Integer
  5: '🔢', // Real
  6: '📝', // String
  7: '📅', // Date
  9: '🔤', // Enum
  10: '📦', // Container
  11: '📋', // RecordList
  13: '💾', // Binary
};

const dsTypeIcons: Record<string, string> = {
  Table: '🗃️',
  Enum: '🔤',
  ModelEnum: '📋',
  FormatEnum: '🏷️',
  ImportFormat: '📥',
  Class: '⚙️',
  UserParameter: '👤',
  CalculatedField: '🧮',
  GroupBy: '📊',
  Container: '📦',
  DataModel: '🧬',
  Unknown: '❓',
};

const dsGroupOrder = ['DataModel', 'Table', 'CalculatedField', 'Class', 'Enum', 'ModelEnum', 'FormatEnum', 'ImportFormat', 'UserParameter', 'GroupBy', 'Container', 'Join', 'Object'];
function getDsGroupLabels(): Record<string, string> {
  return locale === 'cs'
    ? {
        DataModel: 'Datový model',
        Table: 'Tabulky',
        CalculatedField: 'Výpočtová pole',
        Class: 'Třídy',
        Enum: 'AX výčty',
        ModelEnum: 'Výčty datového modelu',
        FormatEnum: 'Výčty formátu',
        ImportFormat: 'Importní formáty',
        UserParameter: 'Uživatelské parametry',
        GroupBy: 'Seskupení',
        Container: 'Kontejnery',
        Join: 'Spojení',
        Object: 'Objekty',
      }
    : {
        DataModel: 'Data model',
        Table: 'Tables',
        CalculatedField: 'Calculated Fields',
        Class: 'Classes',
        Enum: 'Ax Enums',
        ModelEnum: 'Data model Enums',
        FormatEnum: 'Format enums',
        ImportFormat: 'Import formats',
        UserParameter: 'User Parameters',
        GroupBy: 'Group By',
        Container: 'Containers',
        Join: 'Joins',
        Object: 'Objects',
      };
}

function getDataModelSectionLabels(): { roots: string; enums: string; records: string } {
  return locale === 'cs'
    ? {
        roots: 'Definice modelu',
        enums: 'Výčtové typy',
        records: 'Záznamy',
      }
    : {
        roots: 'Model Definitions',
        enums: 'Enumerations',
        records: 'Records',
      };
}

function getMappingSectionLabels(): { title: string; dataSources: string; bindings: string; validations: string } {
  return locale === 'cs'
    ? {
        title: 'Mapování',
        dataSources: 'Datové zdroje',
        bindings: 'Vazby',
        validations: 'Validace',
      }
    : {
        title: 'Mapping',
        dataSources: 'Data Sources',
        bindings: 'Bindings',
        validations: 'Validations',
      };
}

function getFormatSectionLabels(): { outputStructure: string; modelMappings: string; enumerations: string; transformations: string; dataSources: string; bindings: string; noBindings: string } {
  return locale === 'cs'
    ? {
        outputStructure: 'Výstupní struktura',
        modelMappings: 'Mapování modelu',
        enumerations: 'Výčty',
        transformations: 'Transformace',
        dataSources: 'Datové zdroje',
        bindings: 'Vazby',
        noBindings: 'bez vazeb',
      }
    : {
        outputStructure: 'Output Structure',
        modelMappings: 'Model Mappings',
        enumerations: 'Enumerations',
        transformations: 'Transformations',
        dataSources: 'Data Sources',
        bindings: 'Bindings',
        noBindings: 'no bindings',
      };
}

function getGroupBySectionLabels(): { groupedBy: string; aggregated: string } {
  return locale === 'cs'
    ? {
        groupedBy: 'Seskupeno podle',
        aggregated: 'Agregace',
      }
    : {
        groupedBy: 'Grouped By',
        aggregated: 'Aggregated',
      };
}

function groupDatasourceNodes(dsNodes: TreeNode[], prefix: string): TreeNode[] {
  const dsGroupLabels = getDsGroupLabels();
  const groups = new Map<string, TreeNode[]>();
  for (const node of dsNodes) {
    const type = node.data?.type || 'Unknown';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(node);
  }
  const result: TreeNode[] = [];
  for (const key of dsGroupOrder) {
    const items = groups.get(key);
    if (items && items.length > 0) {
      result.push({
        id: `${prefix}-dsgrp-${key}`,
        name: `${dsGroupLabels[key] ?? key} (${items.length})`,
        icon: dsTypeIcons[key] ?? '❓',
        type: 'section',
        children: items,
      });
      groups.delete(key);
    }
  }
  for (const [key, items] of groups) {
    result.push({
      id: `${prefix}-dsgrp-${key}`,
      name: `${dsGroupLabels[key] ?? key} (${items.length})`,
      icon: dsTypeIcons[key] ?? '❓',
      type: 'section',
      children: items,
    });
  }
  return result;
}

const groupedFieldSectionAliases = new Set(['groupbyfields', 'grouped', 'groupedfields', 'groupby', 'groupfields']);
const aggregatedSectionAliases = new Set(['aggregated', 'aggregation', 'aggregations']);

function getGroupBySectionKind(name: string | undefined): 'groupedFields' | 'aggregations' | null {
  const normalizedName = (name ?? '').trim().toLowerCase().replace(/^[$#]/, '');
  if (groupedFieldSectionAliases.has(normalizedName)) return 'groupedFields';
  if (aggregatedSectionAliases.has(normalizedName)) return 'aggregations';
  return null;
}

function collectDatasourceDescendants(datasource: any): any[] {
  const result: any[] = [];

  for (const child of datasource.children ?? []) {
    result.push(child);
    result.push(...collectDatasourceDescendants(child));
  }

  return result;
}

function findDatasourceByNormalizedPath(datasource: any, path: string): any | null {
  const normalizedPath = path.trim().toLowerCase();
  const descendants = collectDatasourceDescendants(datasource);

  for (const child of descendants) {
    const childPath = [child.parentPath, child.name]
      .filter(Boolean)
      .join('/');
    const normalizedChildPath = childPath
      .split('/')
      .map((segment: string) => segment.trim())
      .filter(Boolean)
      .map((segment: string, index: number) => segment.replace(index === 0 ? /^#/ : /^\$/, ''))
      .join('/')
      .toLowerCase();

    if (normalizedChildPath === normalizedPath) {
      return child;
    }
  }

  return null;
}

function splitBindingPath(path: string | undefined): string[] {
  const normalized = (path ?? '').trim().replace(/^[$#]/, '');
  if (!normalized) return [];

  return normalized
    .split(/[./\\]/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

type BindingGroupNode = {
  children: Map<string, BindingGroupNode>;
  bindings: TreeNode[];
};

function createBindingGroupNode(): BindingGroupNode {
  return { children: new Map(), bindings: [] };
}

function countGroupedBindings(node: BindingGroupNode): number {
  let total = node.bindings.length;
  for (const child of node.children.values()) {
    total += countGroupedBindings(child);
  }
  return total;
}

function buildGroupedBindingSections(node: BindingGroupNode, prefix: string, level: number): TreeNode[] {
  // Keep insertion order (= order of appearance in the ER configuration)
  // instead of sorting alphabetically.
  const sections = Array.from(node.children.entries())
    .map(([segment, childNode], index) => {
      const total = countGroupedBindings(childNode);
      const childPrefix = `${prefix}-${level}-${index}`;

      return {
        id: `${childPrefix}-section`,
        name: `${segment} (${total})`,
        icon: '📂',
        type: 'section' as const,
        data: { sectionKind: 'bindingGroup', sectionKey: segment, sectionLevel: level },
        children: [
          ...buildGroupedBindingSections(childNode, childPrefix, level + 1),
          ...childNode.bindings,
        ],
      };
    });

  return sections;
}

function groupBindingNodes(bindingNodes: TreeNode[], prefix: string): TreeNode[] {
  if (bindingNodes.length <= 1) {
    return bindingNodes;
  }

  const fallbackLabel = locale === 'cs' ? 'Ostatní' : 'Other';
  const root = createBindingGroupNode();

  for (const bindingNode of bindingNodes) {
    const segments = splitBindingPath(bindingNode.data?.path ?? bindingNode.name);
    const pathSegments = segments.length > 0 ? segments : [fallbackLabel];

    let cursor = root;
    for (const segment of pathSegments) {
      if (!cursor.children.has(segment)) {
        cursor.children.set(segment, createBindingGroupNode());
      }
      cursor = cursor.children.get(segment)!;
    }

    cursor.bindings.push(bindingNode);
  }

  if (root.children.size <= 1) {
    return bindingNodes;
  }

  return buildGroupedBindingSections(root, `${prefix}-group`, 0);
}

/**
 * Tag a mapping subtree with the definition it belongs to, so a search hit can
 * name its definition however deep it sits. A model-mapping solution reuses
 * datasource and binding names across definitions, and the hoisted
 * single-definition tree has no mapping node to walk up to.
 */
function stampMappingDefinition(node: TreeNode, definition: string | undefined): TreeNode {
  if (!definition) return node;
  node.mappingDefinition = definition;
  for (const child of node.children ?? []) stampMappingDefinition(child, definition);
  return node;
}

function buildMappingTree(mapping: any, prefix: string, configIndex: number, versionNumber: number | undefined, allConfigurations: ERConfiguration[]): TreeNode {
  const mappingSectionLabels = getMappingSectionLabels();
  const dsNodes = mapping.datasources.map((ds: any, di: number) =>
    buildDatasourceTree(ds, `${prefix}-ds-${di}`, configIndex, allConfigurations),
  );

  const bindingNodes = mapping.bindings.map((binding: any, bi: number) => ({
    id: `${prefix}-binding-${bi}`,
    name: binding.path,
    icon: '↔️',
    type: 'binding' as const,
    data: binding,
    configIndex,
  }));
  const groupedBindingNodes = groupBindingNodes(bindingNodes, `${prefix}-binding`);

  const validationNodes = mapping.validations.map((validation: any, vi: number) => ({
    id: `${prefix}-val-${vi}`,
    name: validation.path,
    icon: '✅',
    type: 'validation' as const,
    data: validation,
    configIndex,
  }));

  const versionSuffix = versionNumber != null && versionNumber > 0 ? `  (v${versionNumber})` : '';
  const descriptor = (mapping.dataContainerDescriptor ?? '').trim();
  const descriptorSuffix = descriptor && descriptor !== mapping.name ? ` [${descriptor}]` : '';

  return stampMappingDefinition({
    id: prefix,
    // The row is already marked as a mapping by its icon and accent, so the
    // "Mapování: " prefix only pushed the definition name out of sight.
    name: `${mapping.name}${descriptorSuffix}${versionSuffix}`,
    icon: '🔗',
    type: 'mapping',
    configIndex,
    data: mapping,
    children: [
      { id: `${prefix}-ds-section`, name: `${mappingSectionLabels.dataSources} (${countDeclaredDatasources(mapping.datasources)})`, icon: '📂', type: 'section', children: groupDatasourceNodes(dsNodes, prefix) },
      { id: `${prefix}-bind-section`, name: `${mappingSectionLabels.bindings} (${bindingNodes.length})`, icon: '📂', type: 'section', children: groupedBindingNodes },
      { id: `${prefix}-val-section`, name: `${mappingSectionLabels.validations} (${validationNodes.length})`, icon: '📂', type: 'section', children: validationNodes },
    ],
  }, mappingDefinitionLabel(mapping));
}

export function buildTreeForConfig(config: ERConfiguration, index: number, allConfigurations: ERConfiguration[]): TreeNode {
  const dataModelSectionLabels = getDataModelSectionLabels();
  const formatSectionLabels = getFormatSectionLabels();
  const sol = config.solutionVersion.solution;
  const children: TreeNode[] = [];
  const prefix = `cfg-${index}`;

  if (config.content.kind === 'DataModel') {
    const dm = (config.content as ERDataModelContent).version;
    const containerNodes = dm.model.containers.map((c, ci) => ({
      id: `${prefix}-container-${ci}`,
      name: c.name,
      icon: c.isEnum ? '🔤' : c.isRoot ? '🏠' : '📦',
      type: 'container' as const,
      data: c,
      configIndex: index,
      children: c.items.map((item, fi) => ({
        id: `${prefix}-container-${ci}-field-${fi}`,
        name: item.name,
        icon: fieldTypeIcons[item.type] ?? '❓',
        type: 'field' as const,
        data: item,
        configIndex: index,
      })),
    }));

    children.push(
      {
        id: `${prefix}-model-roots`,
        name: dataModelSectionLabels.roots,
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => c.data.isRoot),
      },
      {
        id: `${prefix}-model-enums`,
        name: dataModelSectionLabels.enums,
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => c.data.isEnum),
      },
      {
        id: `${prefix}-model-records`,
        name: dataModelSectionLabels.records,
        icon: '📂',
        type: 'section',
        children: containerNodes.filter(c => !c.data.isRoot && !c.data.isEnum),
      },
    );
  }

  if (config.content.kind === 'ModelMapping') {
    const mm = (config.content as ERModelMappingContent).version;
    const definitions = getMappingDefinitions(mm);
    // One node per definition, always — the explorer lists a model mapping's
    // definitions and nothing below them, so hoisting a lone definition's
    // sections into the configuration row would leave that definition (and its
    // DataContainerDescriptor) unnamed. Mark the one the loaded format binds to
    // only when there is actually a choice.
    const usedDefinition = definitions.length > 1 ? selectMappingDefinition(mm, allConfigurations) : null;
    children.push(...definitions.map((definition, di) => {
      const node = buildMappingTree(definition, `${prefix}-mapping-${di}`, index, mm.number, allConfigurations);
      if (usedDefinition && definition === usedDefinition) {
        node.data = { ...(node.data ?? {}), isActiveMappingDefinition: true };
      }
      return node;
    }));
  }

  const displayName = sol.name;

  if (config.content.kind === 'Format') {
    const fc = config.content as ERFormatContent;
    const fmt = fc.formatVersion;
    const fmtMap = fc.formatMappingVersion;

    const formatTree = buildFormatElementTree(fmt.format.rootElement, `${prefix}-fmt`, index);

    const fmtBindingPresentation = buildFormatBindingPresentation(fmt.format.rootElement, fmtMap.formatMapping.bindings);

    const fmtBindingTypeGroups = new Map<string, typeof fmtBindingPresentation.groups>();
    for (const bindingGroup of fmtBindingPresentation.groups) {
      const existing = fmtBindingTypeGroups.get(bindingGroup.elementType) ?? [];
      existing.push(bindingGroup);
      fmtBindingTypeGroups.set(bindingGroup.elementType, existing);
    }

    const fmtBindNodes = Array.from(fmtBindingTypeGroups.entries())
      .sort(([leftType], [rightType]) => leftType.localeCompare(rightType))
      .map(([elementType, groups], typeIndex) => ({
        id: `${prefix}-fmtbind-type-${typeIndex}`,
        name: `${elementType} (${groups.length})`,
        icon: '📂',
        type: 'section' as const,
        // Lets the consultant view name the section without the raw type.
        data: { bindingElementType: elementType, count: groups.length },
        children: groups
          .sort((left, right) => left.elementName.localeCompare(right.elementName))
          .map((g, bi) => {
            const primaryDataExpr = g.dataBindings[0]?.expressionAsString ?? '';
            const nonDataCategories = g.categories.filter(category => category.key !== 'data');
            const label = primaryDataExpr
              ? `${g.elementName}  ←  ${primaryDataExpr.substring(0, 50)}`
              : `${g.elementName} (${nonDataCategories.map(category => `${category.label}: ${category.bindings.length}`).join(', ') || formatSectionLabels.noBindings})`;
            return {
              id: `${prefix}-fmtbind-${typeIndex}-${bi}`,
              name: label,
              icon: primaryDataExpr ? '↔️' : '⚙️',
              type: 'formatBinding' as const,
              data: { componentId: g.componentId, elementName: g.elementName, expressionAsString: primaryDataExpr, propBindings: g.bindings.filter(binding => binding.bindingCategory !== 'data') },
              configIndex: index,
              children: nonDataCategories.length > 0 ? nonDataCategories.map((category, ci) => ({
                id: `${prefix}-fmtbind-${typeIndex}-${bi}-cat-${ci}`,
                name: `${category.label} (${category.bindings.length})`,
                icon: '📂',
                type: 'section' as const,
                data: { bindingCategory: category.key, count: category.bindings.length },
                children: category.bindings.map((binding, pi) => ({
                  id: `${prefix}-fmtbind-${typeIndex}-${bi}-cat-${ci}-prop-${pi}`,
                  name: `${binding.bindingDisplayLabel}  ←  ${binding.expressionAsString.substring(0, 45)}`,
                  icon: category.key === 'visibility' ? '👁️' : '⚙️',
                  type: 'formatBinding' as const,
                  data: binding,
                  configIndex: index,
                })),
              })) : undefined,
            };
          }),
      }));

    const enumNodes = fmt.format.enumDefinitions.map((e, ei) => ({
      id: `${prefix}-enum-${ei}`,
      name: e.name,
      icon: '🔤',
      type: 'enum' as const,
      data: e,
      configIndex: index,
      children: e.values.map((v, vi) => ({
        id: `${prefix}-enum-${ei}-val-${vi}`,
        name: v.name,
        icon: '·',
        type: 'enumValue' as const,
        data: v,
        configIndex: index,
      })),
    }));

    const transNodes = fmt.format.transformations.map((t, ti) => ({
      id: `${prefix}-trans-${ti}`,
      name: t.name,
      icon: '🔄',
      type: 'transformation' as const,
      data: t,
      configIndex: index,
    }));

    const fmtDsNodes = fmtMap.formatMapping.datasources.map((ds, di) =>
      buildDatasourceTree(ds, `${prefix}-fmtds-${di}`, index, allConfigurations),
    );
    const embeddedMappingNodes = fc.embeddedModelMappingVersions.flatMap((version, embeddedIndex) => {
      const embeddedDefinitions = getMappingDefinitions(version);
      // Scope to this format's own `model` datasources — a sibling format in
      // the workspace must not decide which definition is starred here.
      const ownDescriptors = getFormatDescriptorNames(fc);
      const usedDefinition = embeddedDefinitions.length > 1
        ? orderMappingDefinitions(embeddedDefinitions, ownDescriptors)[0]
        : null;
      const usedSuffix = locale === 'cs' ? '  ✓ použito načteným formátem' : '  ✓ used by loaded format';
      return embeddedDefinitions.map((definition, di) => {
        const node = buildMappingTree(definition, `${prefix}-embedded-mapping-${embeddedIndex}-${di}`, index, version.number, allConfigurations);
        if (usedDefinition && definition === usedDefinition) {
          node.icon = '⭐';
          node.name += usedSuffix;
        }
        return node;
      });
    });

    children.push(
      { id: `${prefix}-fmt-structure`, name: formatSectionLabels.outputStructure, icon: '📂', type: 'section', children: [formatTree] },
      ...(embeddedMappingNodes.length > 0 ? [{ id: `${prefix}-fmt-embedded-mappings`, name: `${formatSectionLabels.modelMappings} (${embeddedMappingNodes.length})`, icon: '📂', type: 'section' as const, children: embeddedMappingNodes }] : []),
      { id: `${prefix}-fmt-enums`, name: `${formatSectionLabels.enumerations} (${enumNodes.length})`, icon: '📂', type: 'section', children: enumNodes },
      { id: `${prefix}-fmt-trans`, name: `${formatSectionLabels.transformations} (${transNodes.length})`, icon: '📂', type: 'section', children: transNodes },
      { id: `${prefix}-fmt-ds`, name: `${formatSectionLabels.dataSources} (${countDeclaredDatasources(fmtMap.formatMapping.datasources)})`, icon: '📂', type: 'section', children: groupDatasourceNodes(fmtDsNodes, `${prefix}-fmt`) },
      { id: `${prefix}-fmt-bindings`, name: `${formatSectionLabels.bindings} (${fmtBindNodes.length})`, icon: '📂', type: 'section', children: fmtBindNodes },
    );
  }

  return {
    id: prefix,
    name: displayName,
    icon: getConfigurationIcon(config),
    type: 'file',
    configIndex: index,
    data: config,
    children,
  };
}

function normalizeEnumLookupName(name: string | undefined): string {
  return (name ?? '').trim().replace(/[{}]/g, '').toLowerCase();
}

function collectEnumValuesFromConfigurations(enumName: string, configurations: ERConfiguration[]): string[] {
  const normalizedName = normalizeEnumLookupName(enumName);
  if (!normalizedName) return [];

  const values: string[] = [];
  const seen = new Set<string>();

  const pushValue = (value: string | undefined) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(trimmed);
  };

  for (const config of configurations) {
    if (config.content.kind === 'DataModel') {
      const dm = (config.content as ERDataModelContent).version;
      for (const container of dm.model.containers) {
        if (!container.isEnum) continue;
        if (normalizeEnumLookupName(container.name) !== normalizedName) continue;
        for (const item of container.items) {
          pushValue(item.name);
        }
      }
      continue;
    }

    if (config.content.kind === 'Format') {
      const fmt = (config.content as ERFormatContent).formatVersion.format;
      for (const definition of fmt.enumDefinitions) {
        if (normalizeEnumLookupName(definition.name) !== normalizedName) continue;
        for (const value of definition.values) {
          pushValue(value.name);
        }
      }
    }
  }

  return values;
}

function buildDatasourceTree(ds: any, prefix: string, configIndex: number, allConfigurations: ERConfiguration[]): TreeNode {
  const groupBySectionLabels = getGroupBySectionLabels();
  const regularChildren = (ds.children ?? []).filter((child: any) => {
    return getGroupBySectionKind(child.name) == null;
  });

  const groupedFieldNodes = (ds.groupByInfo?.groupedFields ?? [])
    .map((field: any, index: number) => {
      const matchedDatasource = findDatasourceByNormalizedPath(ds, field.path);
      return matchedDatasource
        ? buildDatasourceTree(matchedDatasource, `${prefix}-grouped-field-${index}`, configIndex, allConfigurations)
        : null;
    })
    .filter((node: TreeNode | null): node is TreeNode => node != null);

  const aggregatedFieldNodes = (ds.groupByInfo?.aggregations ?? [])
    .map((field: any, index: number) => {
      const matchedDatasource = findDatasourceByNormalizedPath(ds, field.path);
      return matchedDatasource
        ? buildDatasourceTree(matchedDatasource, `${prefix}-aggregated-field-${index}`, configIndex, allConfigurations)
        : null;
    })
    .filter((node: TreeNode | null): node is TreeNode => node != null);

  const children = ds.type === 'GroupBy'
    ? [
        ...(groupedFieldNodes.length > 0
          ? [{
              id: `${prefix}-groupby-fields`,
              name: `${groupBySectionLabels.groupedBy} (${groupedFieldNodes.length})`,
              icon: '📂',
              type: 'section' as const,
              children: groupedFieldNodes,
            }]
          : []),
        ...(aggregatedFieldNodes.length > 0
          ? [{
              id: `${prefix}-aggregated-fields`,
              name: `${groupBySectionLabels.aggregated} (${aggregatedFieldNodes.length})`,
              icon: '📂',
              type: 'section' as const,
              children: aggregatedFieldNodes,
            }]
          : []),
        ...regularChildren.map((child: any, i: number) =>
          buildDatasourceTree(child, `${prefix}-${i}`, configIndex, allConfigurations),
        ),
      ]
    : (ds.children ?? []).map((child: any, i: number) =>
        buildDatasourceTree(child, `${prefix}-${i}`, configIndex, allConfigurations),
      );

  const enumValueNodes = ds.enumInfo?.enumName
    ? collectEnumValuesFromConfigurations(ds.enumInfo.enumName, allConfigurations).map((valueName, valueIndex) => ({
        id: `${prefix}-enum-value-${valueIndex}`,
        name: valueName,
        icon: '·',
        type: 'enumValue' as const,
        data: { name: valueName, enumName: ds.enumInfo?.enumName },
        configIndex,
      }))
    : [];

  return {
    id: prefix,
    name: ds.name,
    icon: ds.implicit ? '🧩' : dsTypeIcons[ds.type] ?? '❓',
    type: 'datasource',
    data: ds,
    configIndex,
    children: enumValueNodes.length > 0 ? [...children, ...enumValueNodes] : children,
  };
}

function buildFormatElementTree(element: any, prefix: string, configIndex: number): TreeNode {
  const typeIcons: Record<string, string> = {
    File: '📁',
    XMLElement: '🏷️',
    XMLAttribute: '@',
    XMLSequence: '🔁',
    String: '📝',
    Base64: '💾',
    Unknown: '❓',
  };

  const baseName = element.name || element.elementType;
  const excelRange = getFormatElementExcelRange(element);
  // The parser already falls back to the named range when an Excel component
  // has no Name, so only append it when it adds information.
  const displayName = excelRange && excelRange !== baseName
    ? `${baseName}  [${excelRange}]`
    : baseName;

  return {
    id: prefix,
    name: displayName,
    icon: typeIcons[element.elementType] ?? '❓',
    type: 'formatElement',
    data: element,
    configIndex,
    children: element.children?.map((child: any, i: number) =>
      buildFormatElementTree(child, `${prefix}-${i}`, configIndex),
    ),
  };
}
