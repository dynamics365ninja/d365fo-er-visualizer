import type { ERConfiguration, ERDataModelContent, ERDatasource, EREnumDatasource, ERFormatContent } from '@er-visualizer/core';
import { datasourcePathKey } from './datasource-tree';
import { normGuid } from './model-hierarchy';
import { getEnumSourceKind } from './enum-display';

/** One value of an enum, as the datasource list shows it. */
export interface EnumValueEntry {
  name: string;
  /** Label reference of a data model enum value. */
  label?: string;
  /** How many times the definition's expressions name this value. */
  uses: number;
}

export interface DatasourceEnumValues {
  values: EnumValueEntry[];
  /**
   * The values come from the enum's own definition (a data model or format
   * enum that is loaded). False for an AX enum or a model that is not loaded:
   * only the values the expressions name are known then.
   */
  complete: boolean;
}

const normalizeEnumName = (name: string | undefined) => (name ?? '').trim().replace(/[{}]/g, '').toLowerCase();
const keySegment = (segment: string) => segment.trim().replace(/^[$#]/, '').toLowerCase();

/**
 * The values an enum datasource declares, from the loaded configurations:
 * a data model enum from its data model (the one the datasource names first),
 * a format enum from its format (the format being viewed first). An AX enum
 * lives in D365FO only — null.
 */
export function definedEnumValues(
  enumInfo: EREnumDatasource,
  configurations: readonly ERConfiguration[],
  preferredConfigIndex?: number,
): Array<{ name: string; label?: string }> | null {
  const kind = getEnumSourceKind(enumInfo);
  if (kind === 'Ax') return null;
  const wanted = normalizeEnumName(enumInfo.enumName);
  if (!wanted) return null;

  const order = configurations.map((_, i) => i);
  if (preferredConfigIndex != null && configurations[preferredConfigIndex]) {
    order.splice(order.indexOf(preferredConfigIndex), 1);
    order.unshift(preferredConfigIndex);
  }

  if (kind === 'DataModel') {
    const modelGuid = normGuid(enumInfo.modelGuid);
    const models = order
      .map(i => configurations[i])
      .filter(cfg => cfg.content.kind === 'DataModel')
      .map(cfg => (cfg.content as ERDataModelContent).version.model);
    const ranked = modelGuid ? [...models.filter(m => normGuid(m.id) === modelGuid), ...models] : models;
    for (const model of ranked) {
      const container = model.containers.find(c => c.isEnum && normalizeEnumName(c.name) === wanted);
      if (container) return container.items.map(item => ({ name: item.name, label: item.label }));
    }
    return null;
  }

  for (const i of order) {
    const cfg = configurations[i];
    if (cfg.content.kind !== 'Format') continue;
    const definition = (cfg.content as ERFormatContent).formatVersion.format.enumDefinitions
      .find(d => normalizeEnumName(d.name) === wanted);
    if (definition) return definition.values.map(value => ({ name: value.name }));
  }
  return null;
}

/**
 * The enum values the expressions name, per enum datasource (by its path
 * key): `'$ReportFieldEnum'.Quarterly` or `Enums.NoYes.Yes` is the enum's
 * path followed by one value. `references` are the datasource paths of the
 * expressions, as segment lists.
 */
export function collectEnumValueUses(
  datasources: readonly ERDatasource[],
  references: Iterable<readonly string[]>,
): Map<string, Map<string, { name: string; uses: number }>> {
  const enumKeys = new Set<string>();
  const visit = (ds: ERDatasource) => {
    if (ds.enumInfo && !ds.implicit) enumKeys.add(datasourcePathKey(ds.parentPath, ds.name));
    for (const child of ds.children ?? []) visit(child);
  };
  datasources.forEach(visit);

  const out = new Map<string, Map<string, { name: string; uses: number }>>();
  if (enumKeys.size === 0) return out;
  for (const segments of references) {
    if (segments.length < 2) continue;
    const key = segments.slice(0, -1).map(keySegment).filter(Boolean).join('/');
    if (!enumKeys.has(key)) continue;
    const value = segments[segments.length - 1].trim();
    if (!value) continue;
    let values = out.get(key);
    if (!values) out.set(key, values = new Map());
    const entry = values.get(value.toLowerCase());
    if (entry) entry.uses++;
    else values.set(value.toLowerCase(), { name: value, uses: 1 });
  }
  return out;
}

/**
 * What an enum datasource lists below itself: its declared values, each with
 * how often the definition uses it — or, when the declaration is out of
 * reach, the values the definition uses.
 */
export function mergeEnumValues(
  defined: Array<{ name: string; label?: string }> | null,
  used: Map<string, { name: string; uses: number }> | undefined,
): DatasourceEnumValues {
  if (defined) {
    const seen = new Set<string>();
    const values = defined.map(value => {
      seen.add(value.name.toLowerCase());
      return { ...value, uses: used?.get(value.name.toLowerCase())?.uses ?? 0 };
    });
    // A value the expressions name but the enum does not declare stays
    // visible: an out-of-date model is exactly what the list should show.
    for (const [key, value] of used ?? []) if (!seen.has(key)) values.push({ name: value.name, uses: value.uses });
    return { values, complete: true };
  }
  return { values: [...(used?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)), complete: false };
}
