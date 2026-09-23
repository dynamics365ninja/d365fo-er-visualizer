/**
 * Model-mapping definitions: a mapping solution carries one definition per
 * DataContainerDescriptor, and these helpers pick and order the one a loaded
 * format actually binds to.
 */
import type { ERConfiguration, ERFormatContent, ERModelMappingContent } from '@er-visualizer/core';
import { mappingDefinitionLabel } from '../utils/model-hierarchy';

export interface MappingSource {
  mapping: any;
  configIndex: number;
  configName: string;
}

export function getDatasourcePoolsForConfig(
  config: ERConfiguration,
  preferredDescriptors: ReadonlySet<string> = new Set(),
): any[][] {
  if (config.content.kind === 'ModelMapping') {
    const version = (config.content as ERModelMappingContent).version;
    const definitions = orderMappingDefinitions(getMappingDefinitions(version), preferredDescriptors);
    return definitions.map(mapping => mapping.datasources);
  }

  if (config.content.kind === 'Format') {
    const content = config.content as ERFormatContent;
    // The format's own `model` datasource wins over anything a sibling format wants.
    const ownDescriptors = getFormatDescriptorNames(content);
    return [
      ...content.embeddedModelMappingVersions.flatMap(version =>
        orderMappingDefinitions(getMappingDefinitions(version), ownDescriptors).map(
          mapping => mapping.datasources,
        ),
      ),
      content.formatMappingVersion.formatMapping.datasources,
    ].filter(pool => pool.length > 0);
  }

  return [];
}

/**
 * Which mapping definitions a lookup started from `fromConfigIndex` should
 * prefer. A model-mapping solution can carry one definition per
 * DataContainerDescriptor (SalesInvoice, TMSCommercialInvoice, …) that reuse
 * the same datasource names, so without this scope a lookup silently lands in
 * the definition of a different model root.
 */
export function getPreferredDescriptors(
  configurations: ERConfiguration[],
  fromConfigIndex: number,
  scopeConfigIndex?: number | null,
): ReadonlySet<string> {
  // `scopeConfigIndex` is the format a lookup is made on behalf of. A drill-down
  // that has followed a binding into a model mapping resolves the mapping's
  // datasources from there — without the format it started in, "any loaded
  // format" would pick the definition again.
  for (const index of [scopeConfigIndex, fromConfigIndex]) {
    const from = index != null ? configurations[index] : undefined;
    if (from?.content.kind !== 'Format') continue;
    const own = getFormatDescriptorNames(from.content as ERFormatContent);
    if (own.size > 0) return own;
  }
  return getAllFormatDescriptorNames(configurations);
}

/** All mapping definitions of a model-mapping version (older cached data may miss `mappings`). */
export function getMappingDefinitions(version: any): any[] {
  if (Array.isArray(version?.mappings) && version.mappings.length > 0) return version.mappings;
  return version?.mapping ? [version.mapping] : [];
}

/**
 * DataContainerDescriptor names referenced by the `model` datasources of a
 * format mapping — i.e. which mapping definition the format actually binds to.
 */
function collectModelDescriptorNames(datasources: any[], out: Set<string>): void {
  for (const ds of datasources ?? []) {
    const name = ds?.modelInfo?.dataContainerDescriptorName?.trim();
    if (name) out.add(name.toLowerCase());
    if (ds?.children?.length) collectModelDescriptorNames(ds.children, out);
  }
}

export function getFormatDescriptorNames(content: ERFormatContent): Set<string> {
  const out = new Set<string>();
  collectModelDescriptorNames(content.formatMappingVersion.formatMapping.datasources, out);
  return out;
}

/** Descriptor names referenced by every loaded format configuration. */
export function getAllFormatDescriptorNames(configurations: ERConfiguration[]): Set<string> {
  const out = new Set<string>();
  for (const config of configurations) {
    if (config.content.kind !== 'Format') continue;
    for (const name of getFormatDescriptorNames(config.content as ERFormatContent)) out.add(name);
  }
  return out;
}

/**
 * Order mapping definitions so the one whose `DataContainerDescriptor` matches
 * a format's `model` datasource comes first, instead of always taking the
 * first definition in the file.
 */
export function orderMappingDefinitions(definitions: any[], preferredDescriptors: ReadonlySet<string>): any[] {
  if (definitions.length <= 1 || preferredDescriptors.size === 0) return definitions;
  const matches = (m: any) => preferredDescriptors.has((m?.dataContainerDescriptor ?? '').trim().toLowerCase());
  return [...definitions].sort((left, right) => Number(matches(right)) - Number(matches(left)));
}

/**
 * Pick the mapping definition of a model-mapping version that matches one of
 * the loaded formats (falls back to the first definition). Exported for the
 * designer views.
 */
export function selectMappingDefinition(
  version: any,
  configurations: ERConfiguration[],
  fromConfigIndex?: number | null,
): any {
  const definitions = getMappingDefinitions(version);
  if (definitions.length <= 1) return definitions[0] ?? version?.mapping;
  // A format in scope decides; otherwise any loaded format's descriptor will do.
  const preferred = fromConfigIndex != null
    ? getPreferredDescriptors(configurations, fromConfigIndex)
    : getAllFormatDescriptorNames(configurations);
  return orderMappingDefinitions(definitions, preferred)[0];
}

/**
 * Label of the definition a configuration is actually used through — the one
 * whose `DataContainerDescriptor` a loaded format binds to. Hits that exist in
 * several definitions (the same binding path is mapped in each of them) have
 * to be reported against this one instead of whichever comes first in the file.
 */
export function activeMappingDefinitionLabel(
  configurations: ERConfiguration[],
  configIndex: number | null | undefined,
): string | undefined {
  if (configIndex == null) return undefined;
  return mappingDefinitionLabel(getScopedMappingDefinitions(configurations, configIndex)[0]);
}

/**
 * Definition labels that are in scope for a search started from
 * `activeConfigIndex` — i.e. the mapping definitions whose
 * `DataContainerDescriptor` the active format binds to.
 *
 * A mapping solution maps the same paths in each of its definitions, so a
 * search run from the Sales invoice format otherwise also reports the
 * InvoiceCustomer or InvoiceVendor copies of every hit. Returns `null` when
 * nothing narrows the scope (no active format, or the format names no
 * descriptor), meaning every definition stays visible.
 */
export function relatedMappingDefinitionLabels(
  configurations: ERConfiguration[],
  activeConfigIndex: number | null | undefined,
): Set<string> | null {
  if (activeConfigIndex == null) return null;
  const active = configurations[activeConfigIndex];
  if (active?.content.kind !== 'Format') return null;

  const descriptors = getFormatDescriptorNames(active.content as ERFormatContent);
  if (descriptors.size === 0) return null;

  const labels = new Set<string>();
  for (let i = 0; i < configurations.length; i++) {
    for (const definition of getScopedMappingDefinitions(configurations, i)) {
      const descriptor = (definition?.dataContainerDescriptor ?? '').trim().toLowerCase();
      if (!descriptor || !descriptors.has(descriptor)) continue;
      const label = mappingDefinitionLabel(definition);
      if (label) labels.add(label);
    }
  }

  return labels.size > 0 ? labels : null;
}

/**
 * Mapping definitions of one configuration, most relevant first — the
 * definition whose `DataContainerDescriptor` the loaded format binds to comes
 * before the definitions of the other model roots in the same solution.
 */
export function getScopedMappingDefinitions(
  configurations: ERConfiguration[],
  configIndex: number,
): any[] {
  const config = configurations[configIndex];
  if (!config) return [];

  if (config.content.kind === 'ModelMapping') {
    const version = (config.content as ERModelMappingContent).version;
    return orderMappingDefinitions(
      getMappingDefinitions(version),
      getPreferredDescriptors(configurations, configIndex),
    );
  }

  if (config.content.kind === 'Format') {
    const content = config.content as ERFormatContent;
    const ownDescriptors = getFormatDescriptorNames(content);
    return content.embeddedModelMappingVersions.flatMap(version =>
      orderMappingDefinitions(getMappingDefinitions(version), ownDescriptors),
    );
  }

  return [];
}

export function getMappingSourcesForConfig(
  config: ERConfiguration,
  configIndex: number,
  preferredDescriptors?: ReadonlySet<string>,
): MappingSource[] {
  if (config.content.kind === 'ModelMapping') {
    const version = (config.content as ERModelMappingContent).version;
    const definitions = orderMappingDefinitions(getMappingDefinitions(version), preferredDescriptors ?? new Set());
    return definitions.map(mapping => ({
      mapping,
      configIndex,
      configName: config.solutionVersion.solution.name,
    }));
  }

  if (config.content.kind === 'Format') {
    const content = config.content as ERFormatContent;
    // Prefer the definition the format's own `model` datasource points at.
    const ownDescriptors = getFormatDescriptorNames(content);
    return content.embeddedModelMappingVersions.flatMap(version =>
      orderMappingDefinitions(getMappingDefinitions(version), ownDescriptors).map(mapping => ({
        mapping,
        configIndex,
        configName: `${config.solutionVersion.solution.name} • ${mapping.name}`,
      })),
    );
  }

  return [];
}

export function getAllMappingSources(configurations: ERConfiguration[]): MappingSource[] {
  const preferredDescriptors = getAllFormatDescriptorNames(configurations);
  return configurations.flatMap((config, configIndex) =>
    getMappingSourcesForConfig(config, configIndex, preferredDescriptors),
  );
}

/**
 * Every mapping definition, the ones a lookup started from `fromConfigIndex`
 * binds to first. With two formats of the same mapping open, "every loaded
 * format" names both descriptors, so a drill-down from the second format used
 * to land in the definition of whichever format loaded first.
 */
export function getMappingSourcesInScope(
  configurations: ERConfiguration[],
  fromConfigIndex: number | null | undefined,
): MappingSource[] {
  if (fromConfigIndex == null) return getAllMappingSources(configurations);
  const preferred = getPreferredDescriptors(configurations, fromConfigIndex);
  const sources = configurations.flatMap((config, configIndex) =>
    getMappingSourcesForConfig(config, configIndex, preferred),
  );
  if (preferred.size === 0) return sources;
  const matches = (source: MappingSource) =>
    preferred.has((source.mapping?.dataContainerDescriptor ?? '').trim().toLowerCase());
  // Stable: config order is kept within the matching and the other definitions.
  return [...sources.filter(matches), ...sources.filter(source => !matches(source))];
}
