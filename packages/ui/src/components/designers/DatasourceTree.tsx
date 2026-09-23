import { SearchRegular } from '@fluentui/react-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { dsPathToExpression } from '../../utils/ds-path';
import { ancestorPathKeys, buildDatasourceTree, filterDatasources, keysWithDeclaredDescendants, type DatasourceModel, type DatasourceTree, type DatasourceTreeFilter, type DatasourceTreeNode } from '../../utils/datasource-tree';
import { DrillDownTrigger } from '../DrillDownPanel';
import { t } from '../../i18n';
import { getConsultantFieldTypeLabel } from '../../utils/consultant-labels';
import { type ERDatasource } from '@er-visualizer/core';
import { enumLabelFor, EMPTY_STRING_SET, RevealInExplorerMenu, fieldTypeLabel } from './shared';

function getDatasourceGroupLabel(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) {
    return t.dsGroupLabelsTechnical[type] ?? type;
  }

  return t.dsGroupLabelsConsultant[type] ?? t.groupOther;
}

/** Datasource types the consultant view names; the rest share one "Other" group. */
const CONSULTANT_DS_GROUP_TYPES = new Set(['Table', 'CalculatedField', 'Class', 'Object', 'ImportFormat', 'UserParameter', 'GroupBy', 'Container', 'Join', 'DataModel']);

function getDatasourceGroupKey(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) return type;
  // The three enum kinds share a key, and that key needs a label of its own —
  // without one the enums fell through to "Other", next to the real "Other".
  if (type === 'Enum' || type === 'ModelEnum' || type === 'FormatEnum') return 'Values';
  return CONSULTANT_DS_GROUP_TYPES.has(type) ? type : 'Other';
}

// Keep legacy helpers reachable for future migration work.
// Maps datasource type → an existing badge CSS class
function getDsBadgeClass(type: string): string {
  const map: Record<string, string> = {
    Table: 'badge-table',
    CalculatedField: 'badge-calc',
    Class: 'badge-class',
    Object: 'badge-class',
    Enum: 'badge-enum',
    ModelEnum: 'badge-enum',
    FormatEnum: 'badge-enum',
    ImportFormat: 'badge-import',
    UserParameter: 'badge-param',
    GroupBy: 'badge-table',
    Container: 'badge-export',
    Export: 'badge-export',
    Import: 'badge-import',
  };
  return map[type] ?? 'badge-xml';
}

function getAggregationFunctionBadgeClass(fn: string | undefined): string {
  const normalized = (fn ?? '').trim().toUpperCase();
  if (normalized === 'SUM') return 'ds-row-groupby-fn-sum';
  if (normalized === 'COUNT') return 'ds-row-groupby-fn-count';
  if (normalized === 'AVG' || normalized === 'AVERAGE') return 'ds-row-groupby-fn-avg';
  if (normalized === 'MIN') return 'ds-row-groupby-fn-min';
  if (normalized === 'MAX') return 'ds-row-groupby-fn-max';
  return 'ds-row-groupby-fn-generic';
}

// ── Datasource tree (Data Sources tab) ──

interface DatasourceListContext {
  tree: DatasourceTree;
  filter: DatasourceTreeFilter | null;
  focusKey?: string;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
  labelFor?: (labelRef: string | undefined) => string | undefined;
  /** Whether the explorer lists these datasources, so a row can offer to reveal itself there. */
  revealInExplorer: boolean;
}

function DatasourceTreeRow({ node, ctx, insideMatch }: {
  node: DatasourceTreeNode;
  ctx: DatasourceListContext;
  /** A match at or above this row — its children are shown unfiltered. */
  insideMatch: boolean;
}) {
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const selectNode = useAppStore(s => s.selectNode);
  const ds: any = node.datasource;
  const field = node.field;
  const declared = Boolean(ds && !ds.implicit);
  const isDirectTarget = ctx.focusKey === node.key;
  const matched = Boolean(ctx.filter?.matched.has(node.key));
  const expandable = ctx.tree.hasChildren(node);
  const expanded = expandable && ctx.isExpanded(node.key);
  const rowRef = React.useRef<HTMLDivElement>(null);

  // Scroll into view when this row IS the direct target
  useEffect(() => {
    if (isDirectTarget && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isDirectTarget]);
  const groupByFields = ds?.groupByInfo?.groupedFields ?? [];
  const aggregatedFields = ds?.groupByInfo?.aggregations ?? [];
  const [showGroupedFields, setShowGroupedFields] = useState(groupByFields.length > 0 && groupByFields.length <= 6);
  const [showAggregatedFields, setShowAggregatedFields] = useState(aggregatedFields.length > 0 && aggregatedFields.length <= 6);
  // Selecting a datasource — the row or one of its grouped fields — leaves the
  // explorer alone, as everywhere in the designers; the row's ⋮ menu reveals it.
  const navigateToDatasource = useCallback((name: string, parentPath?: string) => {
    const nodeId = findDatasourceNode(name, ctx.configIndex, parentPath);
    if (nodeId) selectNode(nodeId, { revealInExplorer: false });
  }, [findDatasourceNode, ctx.configIndex, selectNode]);
  const revealDatasourceInExplorer = useCallback(() => {
    if (!ds) return;
    const nodeId = findDatasourceNode(ds.name, ctx.configIndex, ds.parentPath);
    if (nodeId) ctx.navigateToTreeNode(nodeId);
  }, [findDatasourceNode, ctx, ds]);
  const getParentPathFromModelPath = useCallback((path: string) => {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(0, lastSlash) : undefined;
  }, []);

  useEffect(() => {
    setShowGroupedFields(groupByFields.length > 0 && groupByFields.length <= 6);
    setShowAggregatedFields(aggregatedFields.length > 0 && aggregatedFields.length <= 6);
  }, [ds?.name, groupByFields.length, aggregatedFields.length]);

  // Build human-readable target string
  let targetLabel: string | null = null;
  if (!declared) {
    // A model field — or the implicit record standing in for one: what it is,
    // in the model's own words.
    if (field) {
      targetLabel = [
        showTechnicalDetails ? null : getConsultantFieldTypeLabel(field.type),
        ctx.labelFor?.(field.label),
      ].filter(Boolean).join(' · ') || null;
    }
  } else if (ds.tableInfo) {
    targetLabel = ds.tableInfo.tableName;
    if (showTechnicalDetails && ds.tableInfo.isCrossCompany) targetLabel += ` (${t.dsCrossCompany})`;
    if (showTechnicalDetails && ds.tableInfo.selectedFields?.length) targetLabel += ` [${ds.tableInfo.selectedFields.join(', ')}]`;
  } else if (ds.enumInfo) {
    targetLabel = enumLabelFor(ds.enumInfo, showTechnicalDetails);
  } else if (ds.classInfo) {
    targetLabel = ds.classInfo.className;
  } else if (ds.calculatedField) {
    // The group header already says "calculated values"; the formula itself
    // belongs to the technical view and the drill-down — same as the inspector.
    targetLabel = showTechnicalDetails ? (ds.calculatedField.expressionAsString ?? '') : null;
  } else if (ds.importFormatInfo) {
    targetLabel = showTechnicalDetails
      ? ds.importFormatInfo.formatGuid
      : t.dsImportFormat;
  } else if (ds.groupByInfo) {
    targetLabel = ds.groupByInfo.listToGroup
      ? (showTechnicalDetails
          ? `list: ${ds.groupByInfo.listToGroup}`
          : `${t.dsGroupedBy}: ${ds.groupByInfo.listToGroup.split('/').pop()}`)
      : null;
  } else if (ds.modelInfo) {
    const descriptor = ds.modelInfo.dataContainerDescriptorName || null;
    targetLabel = node.container ? descriptor : [descriptor, `(${t.dsModelNotLoaded})`].filter(Boolean).join(' ');
  }

  const children = expanded
    ? ctx.tree.childrenOf(node).filter(child =>
        !ctx.filter || insideMatch || matched || ctx.filter.matched.has(child.key) || ctx.filter.ancestors.has(child.key))
    : [];
  const rowKind = declared ? '' : ds ? ' ds-row-structural' : ' ds-row-field';

  return (
    <div className={`ds-row-wrap${isDirectTarget ? ' search-match' : ''}`} ref={rowRef}>
      <div
        className={`ds-row${rowKind}`}
        title={declared ? node.path.join('/') : `${field ? t.dsModelField : t.dsImplicitType}: ${node.path.join('/')}`}
        onClick={() => {
          if (ds) navigateToDatasource(ds.name, ds.parentPath);
          // A path node carries nothing to inspect but what is below it.
          if (!declared && expandable) ctx.toggle(node.key);
        }}
      >
        {/* Line 1: expander + type badge + name + nested count */}
        <div className="ds-row-main">
          {expandable ? (
            <button
              type="button"
              className="ds-row-expander"
              aria-expanded={expanded}
              aria-label={expanded ? t.treeCollapseNode : t.treeExpandNode}
              onClick={e => { e.stopPropagation(); ctx.toggle(node.key); }}
            >
              <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
            </button>
          ) : (
            <span className="ds-row-expander-spacer" aria-hidden="true" />
          )}
          {showTechnicalDetails && declared && (
            <span className={`badge ${getDsBadgeClass(ds.type)}`} style={{ flexShrink: 0 }}>
              {ds.type}
            </span>
          )}
          {showTechnicalDetails && !declared && field && (
            <span className="badge badge-xml" style={{ flexShrink: 0 }}>
              {fieldTypeLabel(field.type)}
            </span>
          )}
          {declared ? (
            // The name opens the datasource's drill-down — its formula and
            // what it reads — addressed by its full path, so a `$Split_Note`
            // under one record never opens its namesake.
            <DrillDownTrigger
              expression={dsPathToExpression(ds.parentPath ? `${ds.parentPath}/${ds.name}` : ds.name)}
              configIndex={ctx.configIndex}
              elementName={ds.name}
              className="ds-row-name ds-row-name--drill"
            >
              {node.name}
            </DrillDownTrigger>
          ) : (
            <span className="ds-row-name">{node.name}</span>
          )}
          {/* What a row is, or what it reads, stays on the name line — one line
              per row keeps a record of a few hundred fields browsable. */}
          <span className="ds-row-meta" title={targetLabel ?? undefined}>
            {targetLabel && (!declared
              ? targetLabel
              : ds.calculatedField
                ? <span className="ds-row-formula">= {targetLabel}</span>
                : <>→ <strong>{targetLabel}</strong></>)}
          </span>
          {node.declaredCount > 0 && (
            <span className="ds-row-count" title={t.dsNestedCount(node.declaredCount)}>
              {node.declaredCount}
            </span>
          )}
          {declared && (
            <button
              type="button"
              className="ds-row-where-used"
              onClick={e => { e.stopPropagation(); triggerWhereUsed(ds.name); }}
              title={t.whereUsedAction}
              aria-label={`${t.whereUsedAction}: ${ds.name}`}
            >
              <SearchRegular fontSize={14} aria-hidden />
            </button>
          )}
          {ds && ctx.revealInExplorer && <RevealInExplorerMenu onReveal={revealDatasourceInExplorer} />}
        </div>
      </div>
      {ds?.groupByInfo && (groupByFields.length > 0 || aggregatedFields.length > 0) && (
        <div className="ds-row-groupby-meta">
          <div className="ds-row-groupby-grid">
            {groupByFields.length > 0 && (
              <div className="ds-row-groupby-column ds-row-groupby-column-grouped">
                <button
                  type="button"
                  className="ds-row-groupby-column-toggle"
                  onClick={event => {
                    event.stopPropagation();
                    setShowGroupedFields(value => !value);
                  }}
                >
                  <span className="fmt-ds-label">{t.dsGroupBy}</span>
                  <span className="ds-row-groupby-count">{groupByFields.length}</span>
                  <span className={`tree-chevron ${showGroupedFields ? 'open' : ''}`} />
                </button>
                {showGroupedFields && (
                  <div className="ds-row-groupby-list">
                    {groupByFields.map((groupedField: any) => (
                      <button
                        key={groupedField.path}
                        type="button"
                        className="ds-row-groupby-item"
                        onClick={event => {
                          event.stopPropagation();
                          navigateToDatasource(groupedField.name, getParentPathFromModelPath(groupedField.path));
                        }}
                      >
                        {groupedField.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {aggregatedFields.length > 0 && (
              <div className="ds-row-groupby-column ds-row-groupby-column-aggregated">
                <button
                  type="button"
                  className="ds-row-groupby-column-toggle"
                  onClick={event => {
                    event.stopPropagation();
                    setShowAggregatedFields(value => !value);
                  }}
                >
                  <span className="fmt-ds-label">{t.dsAggregated}</span>
                  <span className="ds-row-groupby-count">{aggregatedFields.length}</span>
                  <span className={`tree-chevron ${showAggregatedFields ? 'open' : ''}`} />
                </button>
                {showAggregatedFields && (
                  <div className="ds-row-groupby-list">
                    {aggregatedFields.map((aggregatedField: any) => (
                      <button
                        key={aggregatedField.path}
                        type="button"
                        className="ds-row-groupby-item"
                        onClick={event => {
                          event.stopPropagation();
                          navigateToDatasource(aggregatedField.name, getParentPathFromModelPath(aggregatedField.path));
                        }}
                      >
                        <span className="ds-row-groupby-item-text">{aggregatedField.name}</span>
                        {aggregatedField.function && (
                          <span className={`ds-row-groupby-fn-badge ${getAggregationFunctionBadgeClass(aggregatedField.function)}`}>
                            {aggregatedField.function}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Nested children (indented) */}
      {children.length > 0 && (
        <div className="ds-row-children">
          {children.map((child, i) => (
            // Definitions do repeat a datasource path; the index keeps both rows.
            <DatasourceTreeRow key={`${child.key}#${i}`} node={child} ctx={ctx} insideMatch={insideMatch || matched} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grouped Datasource List ──

// The data model leads: in a format, calculated fields hang off its records.
const dsGroupOrder = ['DataModel', 'Table', 'CalculatedField', 'Class', 'Object', 'Enum', 'ModelEnum', 'FormatEnum', 'Values', 'UserParameter', 'GroupBy', 'Container', 'Join', 'Other'];

export interface GroupedDatasourceListHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

export const GroupedDatasourceList = React.forwardRef<GroupedDatasourceListHandle, {
  datasources: any[];
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
  /** The datasource the tab was opened for, as a datasource path key. */
  focusKey?: string;
  /** Text filter — matches datasources at any depth. */
  filter?: string;
  /** The loaded data model behind a `model` datasource, whose structure is shown under it. */
  resolveModel?: (datasource: ERDatasource) => DatasourceModel | null;
  labelFor?: (labelRef: string | undefined) => string | undefined;
  /** Off where the explorer does not list the datasources — the reveal menu would find nothing. */
  revealInExplorer?: boolean;
}>(function GroupedDatasourceList({ datasources, configIndex, navigateToTreeNode, focusKey, filter = '', resolveModel, labelFor, revealInExplorer = true }, ref) {
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const tree = useMemo(() => buildDatasourceTree(datasources, resolveModel), [datasources, resolveModel]);
  const filterState = useMemo(() => filterDatasources(datasources, filter), [datasources, filter]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // While a filter is applied the paths to its matches open by themselves; a
  // click flips one of them for as long as that filter stands.
  const [filterToggles, setFilterToggles] = useState<Set<string>>(new Set());
  useEffect(() => { setFilterToggles(new Set()); }, [filter]);

  const groupKeyOf = useCallback(
    (node: DatasourceTreeNode) => getDatasourceGroupKey(node.datasource?.type || 'Unknown', showTechnicalDetails),
    [showTechnicalDetails],
  );

  const groups = useMemo(() => {
    const map = new Map<string, DatasourceTreeNode[]>();
    for (const node of tree.roots) {
      if (filterState && !filterState.matched.has(node.key) && !filterState.ancestors.has(node.key)) continue;
      const type = groupKeyOf(node);
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(node);
    }
    // Sort groups by predefined order, unknowns at the end
    const sorted: [string, DatasourceTreeNode[]][] = [];
    for (const key of dsGroupOrder) {
      if (map.has(key)) { sorted.push([key, map.get(key)!]); map.delete(key); }
    }
    for (const [key, val] of map) { sorted.push([key, val]); }
    return sorted;
  }, [tree, filterState, groupKeyOf]);

  // Opening the tab for a datasource reveals it: its group and every node above it.
  useEffect(() => {
    if (!focusKey) return;
    setExpandedKeys(prev => new Set([...prev, ...ancestorPathKeys(focusKey)]));
    const root = tree.roots.find(node => node.key === focusKey.split('/')[0]);
    if (!root) return;
    const group = groupKeyOf(root);
    setCollapsedGroups(prev => {
      if (!prev.has(group)) return prev;
      const next = new Set(prev);
      next.delete(group);
      return next;
    });
  }, [focusKey, tree, groupKeyOf]);

  const isExpanded = useCallback(
    (key: string) => (filterState ? filterState.ancestors.has(key) !== filterToggles.has(key) : expandedKeys.has(key)),
    [filterState, filterToggles, expandedKeys],
  );

  const toggle = useCallback((key: string) => {
    const flip = (prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    };
    if (filterState) setFilterToggles(flip); else setExpandedKeys(flip);
  }, [filterState]);

  const toggleGroup = useCallback((type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set());
    // Every path down to a datasource the definition declares — not the whole
    // data model, which would open thousands of fields.
    setExpandedKeys(keysWithDeclaredDescendants(datasources));
    setFilterToggles(new Set());
  }, [datasources]);

  const collapseAll = useCallback(() => {
    setExpandedKeys(new Set());
    if (filterState) setFilterToggles(new Set(filterState.ancestors));
    else setCollapsedGroups(new Set(groups.map(([type]) => type)));
  }, [filterState, groups]);

  React.useImperativeHandle(ref, () => ({ expandAll, collapseAll }), [expandAll, collapseAll]);

  const ctx = useMemo<DatasourceListContext>(() => ({
    tree, filter: filterState, focusKey, isExpanded, toggle, configIndex, navigateToTreeNode, labelFor, revealInExplorer,
  }), [tree, filterState, focusKey, isExpanded, toggle, configIndex, navigateToTreeNode, labelFor, revealInExplorer]);

  const effectiveCollapsedGroups = filterState ? EMPTY_STRING_SET : collapsedGroups;

  if (groups.length === 0) {
    return <div style={{ color: 'var(--er-text-muted)', fontSize: 12, padding: 12 }}>{t.noResults}</div>;
  }

  return (
    <div>
      {groups.map(([type, items]) => {
        const isCollapsed = effectiveCollapsedGroups.has(type);
        return (
          <div key={type}>
            <div
              className="ds-group-header"
              onClick={() => toggleGroup(type)}
            >
              <span className={`tree-chevron ${!isCollapsed ? 'open' : ''}`} />
              <span className="ds-group-label">{getDatasourceGroupLabel(type, showTechnicalDetails)}</span>
              <span className="ds-group-count">{items.length}</span>
            </div>
            {!isCollapsed && items.map((node, i) => (
              <DatasourceTreeRow key={`${node.key}#${i}`} node={node} ctx={ctx} insideMatch={false} />
            ))}
          </div>
        );
      })}
    </div>
  );
});
