import React, { useCallback, useMemo, useState } from 'react';
import { SearchRegular } from '@fluentui/react-icons';
import type { ERDataContainerDescriptor, ERDataContainerItem } from '@er-visualizer/core';
import { useAppStore } from '../../state/store';
import { t, useLocale } from '../../i18n';
import { quotePathSegment } from '../../utils/ds-path';
import { getConsultantFieldTypeLabel } from '../../utils/consultant-labels';
import { buildLabelPool, labelDisplayText, labelLanguageTag } from '../../utils/label-resolver';
import { DrillDownTrigger } from '../DrillDownPanel';
import { FilterField } from '../FilterField';

/** How many matches a filter lists before asking for a narrower one. */
const MAX_FILTER_RESULTS = 300;

interface FieldPath {
  /** Field names from the root down, e.g. `['Tax declaration header', 'ToDate']`. */
  segments: string[];
  item: ERDataContainerItem;
  /** The record the field belongs to. */
  owner: ERDataContainerDescriptor;
}

/** `model.'Tax declaration header'.ToDate` — the expression a binding would use. */
export function modelExpression(segments: string[]): string {
  return ['model', ...segments.map(quotePathSegment)].join('.');
}

/**
 * Every field reachable from the root records, each by its shortest path
 * (record lists can point back up, so a record is walked once).
 */
export function collectFieldPaths(containers: ERDataContainerDescriptor[]): FieldPath[] {
  const byId = new Map(containers.map(c => [c.id, c]));
  const out: FieldPath[] = [];
  const seen = new Set<string>();
  const queue: Array<{ container: ERDataContainerDescriptor; prefix: string[] }> = containers
    .filter(c => c.isRoot && !c.isEnum)
    .map(container => ({ container, prefix: [] }));
  while (queue.length > 0) {
    const { container, prefix } = queue.shift()!;
    if (seen.has(container.id)) continue;
    seen.add(container.id);
    for (const item of container.items) {
      const segments = [...prefix, item.name];
      out.push({ segments, item, owner: container });
      const target = item.typeDescriptor ? byId.get(item.typeDescriptor) : undefined;
      if (target && !target.isEnum) queue.push({ container: target, prefix: segments });
    }
  }
  return out;
}

/**
 * The data model as a list: records and their fields as a tree, a filter over
 * every field, and from each field its drill-down (what fills it) and where
 * it is used. The graph stays for the overview; this is for finding things.
 */
export function DataModelList({ containers, configIndex }: { containers: ERDataContainerDescriptor[]; configIndex: number }) {
  const locale = useLocale();
  const configurations = useAppStore(s => s.configurations);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const labelOf = useCallback((ref: string | undefined) => {
    if (!ref) return undefined;
    const text = labelDisplayText(ref, labels, labelLanguageTag(locale));
    return text && text !== ref ? text : undefined;
  }, [labels, locale]);

  const byId = useMemo(() => new Map(containers.map(c => [c.id, c])), [containers]);
  // Enumerations are types of fields, not places to start from.
  const roots = useMemo(() => containers.filter(c => c.isRoot && !c.isEnum), [containers]);
  const allFields = useMemo(() => collectFieldPaths(containers), [containers]);

  const query = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return allFields.filter(f =>
      f.item.name.toLowerCase().includes(query)
      || (labelOf(f.item.label) ?? '').toLowerCase().includes(query));
  }, [allFields, query, labelOf]);

  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const renderField = (segments: string[], item: ERDataContainerItem, depth: number, path: string, showPath = false): React.ReactNode => {
    const target = item.typeDescriptor ? byId.get(item.typeDescriptor) : undefined;
    const expandable = Boolean(target && !target.isEnum && target.items.length > 0);
    const expanded = expandable && open.has(path);
    const label = labelOf(item.label);
    const typeLabel = getConsultantFieldTypeLabel(item.type);
    const expression = modelExpression(segments);
    return (
      <React.Fragment key={path}>
        <div
          className="ds-row dm-list-row"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={expandable ? expanded : undefined}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <div className="ds-row-main">
            {expandable ? (
              <button
                type="button"
                className="ds-row-expander"
                aria-label={expanded ? t.treeCollapseNode : t.treeExpandNode}
                onClick={() => toggle(path)}
              >
                <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
              </button>
            ) : (
              <span className="ds-row-expander-spacer" aria-hidden="true" />
            )}
            <DrillDownTrigger expression={expression} configIndex={configIndex} elementName={item.name} className="ds-row-name ds-row-name--drill">
              {showPath ? segments.join(' / ') : item.name}
            </DrillDownTrigger>
            <span className="ds-row-meta" title={label}>
              {[typeLabel, target?.isEnum ? target.name : undefined, label].filter(Boolean).join(' · ')}
            </span>
            <button
              type="button"
              className="ds-row-where-used"
              onClick={() => useAppStore.getState().triggerWhereUsed(item.name)}
              title={t.whereUsedAction}
              aria-label={`${t.whereUsedAction}: ${item.name}`}
            >
              <SearchRegular fontSize={14} aria-hidden />
            </button>
          </div>
        </div>
        {expanded && target!.items.map(child =>
          renderField([...segments, child.name], child, depth + 1, `${path}/${child.name}`))}
      </React.Fragment>
    );
  };

  return (
    <div className="dm-list">
      <div className="dm-list__filter">
        <FilterField
          value={filter}
          onChange={setFilter}
          placeholder={t.modelListFilterPlaceholder}
          ariaLabel={t.modelListFilterPlaceholder}
        />
      </div>
      <div className="dm-list__rows" role="tree" aria-label={t.modelListLabel}>
        {query ? (
          matches.length === 0 ? (
            <p className="dm-list__empty">{t.noResults}</p>
          ) : (
            <>
              {matches.slice(0, MAX_FILTER_RESULTS).map(f =>
                renderField(f.segments, f.item, 0, `match:${f.segments.join('/')}`, true))}
              {matches.length > MAX_FILTER_RESULTS && (
                <p className="dm-list__empty">{t.modelListMoreMatches(matches.length - MAX_FILTER_RESULTS)}</p>
              )}
            </>
          )
        ) : (
          roots.map(root => (
            <div key={root.id} role="group" className="dm-list__root">
              <div className="dm-list__root-head">
                <span className="dm-list__root-name">{root.name}</span>
                {labelOf(root.label) && <span className="dm-list__root-label">{labelOf(root.label)}</span>}
                <span className="ds-row-count">{root.items.length}</span>
              </div>
              {root.items.map(item => renderField([item.name], item, 0, `${root.id}/${item.name}`))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
