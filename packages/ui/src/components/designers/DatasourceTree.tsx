import { MathFormulaRegular, SearchRegular } from '@fluentui/react-icons';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualTree } from '../../utils/use-virtual-tree';
import { useAppStore } from '../../state/store';
import { dsPathToExpression } from '../../utils/ds-path';
import { ancestorPathKeys, buildDatasourceTree, collectDeclaredNodes, filterDatasources, keysWithDeclaredDescendants, type DatasourceModel, type DatasourceTree, type DatasourceTreeFilter, type DatasourceTreeNode } from '../../utils/datasource-tree';
import { collectEnumValueUses, definedEnumValues, mergeEnumValues } from '../../utils/enum-values';
import { useTabState } from '../../utils/tab-view-state';
import { DrillDownTrigger, ExpressionView, tokenizeERExpr } from '../DrillDownPanel';
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

/** The colour a kind of datasource carries on its chip and group header. */
function getDatasourceGroupColor(key: string): string {
  switch (key) {
    case 'DataModel': return 'var(--er-model)';
    case 'Table': return 'var(--er-info)';
    case 'CalculatedField': return 'var(--syn-calc)';
    case 'Class':
    case 'Object': return 'var(--er-mapping)';
    case 'Values':
    case 'Enum':
    case 'ModelEnum':
    case 'FormatEnum': return 'var(--er-format)';
    case 'UserParameter': return 'var(--er-warning)';
    case 'GroupBy':
    case 'Join': return 'var(--er-success)';
    default: return 'var(--er-text-muted)';
  }
}

/**
 * How the list is broken down:
 * - `kind`  every datasource the definition declares, at any depth, by kind —
 *           a calculated field under a table sits with the calculated fields,
 *           its path beside its name;
 * - `roots` the top-level datasources by kind, the rest nested under them;
 * - `tree`  the definition as it is nested, no grouping.
 */
export type DatasourceLayout = 'kind' | 'roots' | 'tree';

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
  layout: DatasourceLayout;
  /** The children a row opens to — in the `kind` layout, without the declared ones listed on their own. */
  visibleChildren: (node: DatasourceTreeNode) => DatasourceTreeNode[];
  isFormulaOpen: (key: string) => boolean;
  toggleFormula: (key: string) => void;
}

/** One value of an enum: its name, its label and how often the definition names it. */
function EnumValueRow({ node, ctx }: { node: DatasourceTreeNode; ctx: DatasourceListContext }) {
  const value = node.enumValue!;
  const label = ctx.labelFor?.(value.label);
  return (
    <div className="ds-row-wrap">
      <div className="ds-row ds-row-enum-value" title={node.path.join('/')}>
        <div className="ds-row-main">
          <span className="ds-row-expander-spacer" aria-hidden="true" />
          <span className="ds-enum-value-dot" aria-hidden="true" />
          <span className="ds-row-name">{value.name}</span>
          <span className="ds-row-meta">{label}</span>
          {value.uses > 0 && (
            <span className="ds-enum-value-uses" title={t.dsEnumValueUsesHint(value.uses)}>
              {t.dsEnumValueUses(value.uses)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DatasourceTreeRow({ node, ctx, depth }: {
  node: DatasourceTreeNode;
  ctx: DatasourceListContext;
  depth: number;
}) {
  if (node.enumValue) return <EnumValueRow node={node} ctx={ctx} />;
  return <DatasourceRow node={node} ctx={ctx} depth={depth} />;
}

function DatasourceRow({ node, ctx, depth }: {
  node: DatasourceTreeNode;
  ctx: DatasourceListContext;
  depth: number;
}) {
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const selectNode = useAppStore(s => s.selectNode);
  const ds: any = node.datasource;
  const field = node.field;
  const declared = Boolean(ds && !ds.implicit);
  const isDirectTarget = ctx.focusKey === node.key;
  const expandable = ctx.visibleChildren(node).length > 0;
  const expanded = expandable && ctx.isExpanded(node.key);
  const formula: string = declared ? (ds.calculatedField?.expressionAsString ?? '').trim() : '';
  const formulaOpen = Boolean(formula) && ctx.isFormulaOpen(node.key);
  // In the `kind` layout a nested datasource is listed on its own; where it
  // hangs goes before its name.
  const parentPath = ctx.layout === 'kind' && depth === 0 && node.path.length > 1
    ? node.path.slice(0, -1).join(' / ')
    : null;
  const enumValues = node.enumValues;

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
    // The formula is what a calculated field is: on the row in one line, in
    // full below it on demand (and then only there).
    targetLabel = formulaOpen ? null : formula || null;
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

  const rowKind = declared ? '' : ds ? ' ds-row-structural' : ' ds-row-field';

  return (
    <div className={`ds-row-wrap${isDirectTarget ? ' search-match' : ''}`}>
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
          {parentPath && <span className="ds-row-path" title={parentPath}>{parentPath} /</span>}
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
          {enumValues && (
            <span
              className={`ds-enum-count${enumValues.complete ? '' : ' ds-enum-count--partial'}`}
              title={enumValues.complete ? t.dsEnumValuesHint : t.dsEnumValuesPartialHint}
            >
              {enumValues.complete
                ? t.dsEnumValueCount(enumValues.values.length)
                : enumValues.values.length > 0 ? t.dsEnumValuesUsedCount(enumValues.values.length) : t.dsEnumValuesInFno}
            </span>
          )}
          {ctx.layout !== 'kind' && node.declaredCount > 0 && (
            <span className="ds-row-count" title={t.dsNestedCount(node.declaredCount)}>
              {node.declaredCount}
            </span>
          )}
          {formula && (
            <button
              type="button"
              className={`ds-row-fx${formulaOpen ? ' is-open' : ''}`}
              aria-expanded={formulaOpen}
              onClick={e => { e.stopPropagation(); ctx.toggleFormula(node.key); }}
              title={formulaOpen ? t.dsFormulaHide : t.dsFormulaShow}
              aria-label={`${formulaOpen ? t.dsFormulaHide : t.dsFormulaShow}: ${ds.name}`}
            >
              <MathFormulaRegular fontSize={14} aria-hidden />
            </button>
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
      {formulaOpen && (
        <div className="ds-row-formula-full" onClick={e => e.stopPropagation()}>
          <ExpressionView expr={formula} configIndex={ctx.configIndex} />
        </div>
      )}
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
    </div>
  );
}

/** One shown datasource row of a group: the node and how deep it sits. */
interface FlatDatasourceRow {
  id: string;
  node: DatasourceTreeNode;
  depth: number;
}

/**
 * A group's rows in display order — every open branch walked, with the same
 * filter rule the nested rows used: below a match everything shows, elsewhere
 * only matches and the paths to them.
 */
function flattenDatasourceRows(roots: DatasourceTreeNode[], ctx: DatasourceListContext): FlatDatasourceRow[] {
  const out: FlatDatasourceRow[] = [];
  const visit = (nodes: DatasourceTreeNode[], depth: number, insideMatch: boolean, parentId: string) => {
    nodes.forEach((node, i) => {
      // Definitions do repeat a datasource path; the index keeps both rows apart.
      const id = `${parentId}/${node.key}#${i}`;
      out.push({ id, node, depth });
      if (!ctx.isExpanded(node.key)) return;
      const children = ctx.visibleChildren(node);
      if (children.length === 0) return;
      const matched = Boolean(ctx.filter?.matched.has(node.key));
      const shown = children.filter(child =>
        !ctx.filter || insideMatch || matched || ctx.filter.matched.has(child.key) || ctx.filter.ancestors.has(child.key));
      visit(shown, depth + 1, insideMatch || matched, id);
    });
  };
  visit(roots, 0, false, '');
  return out;
}

const DATASOURCE_ROW_ESTIMATE = 34;

/**
 * One group's rows, virtualized: a format's datasources opened with "Expand
 * all" used to mount ~850 rows at once. The group header above stays in the
 * normal flow, so it still sticks while its rows scroll.
 */
function DatasourceGroupRows({ items, ctx, scrollRef }: {
  items: DatasourceTreeNode[];
  ctx: DatasourceListContext;
  scrollRef: React.RefObject<HTMLElement | null>;
}) {
  const rows = useMemo(() => flattenDatasourceRows(items, ctx), [items, ctx]);
  const focusIndex = useMemo(
    () => (ctx.focusKey ? rows.findIndex(row => row.node.key === ctx.focusKey) : -1),
    [rows, ctx.focusKey],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const { virtualizer, scrollMargin } = useVirtualTree({
    rows,
    scrollRef,
    containerRef,
    estimateSize: DATASOURCE_ROW_ESTIMATE,
    pinned: [focusIndex >= 0 ? focusIndex : null],
  });

  // The datasource the tab was opened for comes into view once it is shown.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx.focusKey) { scrolledToRef.current = null; return; }
    if (focusIndex < 0 || scrolledToRef.current === ctx.focusKey || !virtualizer.scrollElement) return;
    scrolledToRef.current = ctx.focusKey;
    virtualizer.scrollToIndex(focusIndex, { align: 'center' });
  }, [ctx.focusKey, focusIndex, virtualizer]);

  return (
    <div ref={containerRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="ds-flat-row"
            data-depth={row.depth}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%',
              transform: `translateY(${item.start - scrollMargin}px)`,
              ['--ds-depth' as string]: row.depth,
            }}
          >
            <DatasourceTreeRow node={row.node} ctx={ctx} depth={row.depth} />
          </div>
        );
      })}
    </div>
  );
}

/** The nearest ancestor that scrolls vertically — the pane the list lives in. */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let el = element?.parentElement ?? null; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

// ── Toolbar: breakdown, kinds, formulas ──

interface DatasourceKindChip {
  key: string;
  label: string;
  count: number;
}

function DatasourceListBar({ layout, onLayoutChange, kinds, hiddenKinds, onToggleKind, formulaCount, formulasOpen, onToggleFormulas, barRef }: {
  layout: DatasourceLayout;
  onLayoutChange: (layout: DatasourceLayout) => void;
  kinds: DatasourceKindChip[];
  hiddenKinds: readonly string[];
  onToggleKind: (key: string) => void;
  formulaCount: number;
  formulasOpen: boolean;
  onToggleFormulas: () => void;
  barRef: React.Ref<HTMLDivElement>;
}) {
  const layouts: Array<{ id: DatasourceLayout; label: string; title: string }> = [
    { id: 'kind', label: t.dsLayoutKind, title: t.dsLayoutKindHint },
    { id: 'roots', label: t.dsLayoutRoots, title: t.dsLayoutRootsHint },
    { id: 'tree', label: t.dsLayoutTree, title: t.dsLayoutTreeHint },
  ];
  return (
    <div ref={barRef} className="fmt-bind-intent-bar ds-list-bar" role="toolbar" aria-label={t.dsToolbarAria}>
      <div className="fmt-bind-layout" role="radiogroup" aria-label={t.dsLayoutAria}>
        {layouts.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={layout === option.id}
            className={layout === option.id ? 'active' : ''}
            title={option.title}
            onClick={() => onLayoutChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {layout !== 'tree' && kinds.length > 1 && (
        <>
          <span className="fmt-bind-bar-sep" aria-hidden="true" />
          {kinds.map(kind => {
            const isActive = !hiddenKinds.includes(kind.key);
            return (
              <button
                key={kind.key}
                type="button"
                className={`fmt-bind-intent-chip${isActive ? ' active' : ''}`}
                style={{ ['--intent-color' as string]: getDatasourceGroupColor(kind.key) }}
                aria-pressed={isActive}
                title={isActive ? t.dsKindHide(kind.label) : t.dsKindShow(kind.label)}
                onClick={() => onToggleKind(kind.key)}
              >
                <span className="fmt-bind-intent-dot" aria-hidden="true" />
                <span>{kind.label}</span>
                <span className="fmt-bind-intent-count">{kind.count}</span>
              </button>
            );
          })}
        </>
      )}
      {formulaCount > 0 && (
        <button
          type="button"
          className={`ds-list-bar__formulas${formulasOpen ? ' active' : ''}`}
          aria-pressed={formulasOpen}
          title={formulasOpen ? t.dsFormulasHideAll : t.dsFormulasShowAll}
          onClick={onToggleFormulas}
        >
          <MathFormulaRegular fontSize={14} aria-hidden />
          <span>{t.dsFormulas}</span>
          <span className="fmt-bind-intent-count">{formulaCount}</span>
        </button>
      )}
    </div>
  );
}

// ── Grouped Datasource List ──

// The data model leads: in a format, calculated fields hang off its records.
const dsGroupOrder = ['DataModel', 'Table', 'CalculatedField', 'Class', 'Object', 'Enum', 'ModelEnum', 'FormatEnum', 'Values', 'UserParameter', 'GroupBy', 'Container', 'Join', 'Other'];

const isDeclaredNode = (node: DatasourceTreeNode) => Boolean(node.datasource && !node.datasource.implicit);

const NO_KINDS: readonly string[] = [];

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
  /** Text filter — matches datasources at any depth, and enum values. */
  filter?: string;
  /** The loaded data model behind a `model` datasource, whose structure is shown under it. */
  resolveModel?: (datasource: ERDatasource) => DatasourceModel | null;
  labelFor?: (labelRef: string | undefined) => string | undefined;
  /** Off where the explorer does not list the datasources — the reveal menu would find nothing. */
  revealInExplorer?: boolean;
  /** The designer tab, which keeps the breakdown, the hidden kinds and the formula switch. */
  tabId?: string;
  /** The definition's other expressions (its bindings): where enum values are counted as used. */
  expressions?: readonly string[];
}>(function GroupedDatasourceList({ datasources, configIndex, navigateToTreeNode, focusKey, filter = '', resolveModel, labelFor, revealInExplorer = true, tabId, expressions }, ref) {
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);
  const [layout, setLayout] = useTabState<DatasourceLayout>(tabId, 'ds.layout', 'kind');
  const [hiddenKinds, setHiddenKinds] = useTabState<readonly string[]>(tabId, 'ds.hiddenKinds', NO_KINDS);
  const [formulasOpen, setFormulasOpen] = useTabState(tabId, 'ds.formulas', false);
  const [formulaToggles, setFormulaToggles] = useState<Set<string>>(new Set());

  // Enum values the definition names, from its calculated fields and bindings.
  const enumUses = useMemo(() => {
    const references: string[][] = [];
    const add = (expr: string | undefined) => {
      if (!expr) return;
      for (const token of tokenizeERExpr(expr)) if (token.kind === 'ds' && token.segments) references.push(token.segments);
    };
    const visit = (ds: ERDatasource) => {
      add(ds.calculatedField?.expressionAsString);
      for (const child of ds.children ?? []) visit(child);
    };
    datasources.forEach(visit);
    expressions?.forEach(add);
    return collectEnumValueUses(datasources, references);
  }, [datasources, expressions]);
  const resolveEnumValues = useCallback(
    (ds: ERDatasource, key: string) => mergeEnumValues(
      ds.enumInfo ? definedEnumValues(ds.enumInfo, configurations, configIndex) : null,
      enumUses.get(key),
    ),
    [configurations, configIndex, enumUses],
  );

  const tree = useMemo(
    () => buildDatasourceTree(datasources, resolveModel, resolveEnumValues),
    [datasources, resolveModel, resolveEnumValues],
  );
  const declaredNodes = useMemo(() => collectDeclaredNodes(tree), [tree]);

  // A filter also finds an enum by one of its values, and opens it there.
  const filterState = useMemo<DatasourceTreeFilter | null>(() => {
    const base = filterDatasources(datasources, filter);
    if (!base) return null;
    const needle = filter.trim().toLowerCase();
    const matched = new Set(base.matched);
    const ancestors = new Set(base.ancestors);
    for (const node of declaredNodes) {
      if (!node.enumValues?.values.some(value => value.name.toLowerCase().includes(needle))) continue;
      matched.add(node.key);
      ancestors.add(node.key);
      for (const key of ancestorPathKeys(node.key)) ancestors.add(key);
    }
    return { matched, ancestors };
  }, [datasources, filter, declaredNodes]);

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

  // In the `kind` layout a declared child is a row of its own, so a row opens
  // only to what is not listed elsewhere: model fields, enum values — and the
  // model records on the way to them.
  const visibleChildren = useMemo(() => {
    if (layout !== 'kind') return (node: DatasourceTreeNode) => tree.childrenOf(node);
    const cache = new Map<DatasourceTreeNode, DatasourceTreeNode[]>();
    return (node: DatasourceTreeNode) => {
      let children = cache.get(node);
      if (!children) {
        children = tree.childrenOf(node).filter(child => !isDeclaredNode(child) && !(child.datasource?.implicit && !child.container));
        cache.set(node, children);
      }
      return children;
    };
  }, [tree, layout]);

  /** Every group of the layout, hidden kinds included — the chips count them. */
  const allGroups = useMemo(() => {
    let nodes: DatasourceTreeNode[];
    if (layout === 'kind') {
      nodes = declaredNodes.filter(node => node.datasource?.type !== 'Container');
      if (filterState) {
        nodes = nodes.filter(node => filterState.matched.has(node.key)
          || ancestorPathKeys(node.key).some(key => filterState.matched.has(key)));
      }
    } else {
      nodes = tree.roots.filter(node => !filterState || filterState.matched.has(node.key) || filterState.ancestors.has(node.key));
    }
    if (layout === 'tree') return nodes.length > 0 ? [['all', nodes] as [string, DatasourceTreeNode[]]] : [];
    const map = new Map<string, DatasourceTreeNode[]>();
    for (const node of nodes) {
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
  }, [layout, declaredNodes, tree, filterState, groupKeyOf]);

  const groups = useMemo(
    () => (layout === 'tree' ? allGroups : allGroups.filter(([key]) => !hiddenKinds.includes(key))),
    [allGroups, hiddenKinds, layout],
  );

  const kindChips = useMemo<DatasourceKindChip[]>(
    () => (layout === 'tree' ? [] : allGroups.map(([key, items]) => ({ key, label: getDatasourceGroupLabel(key, showTechnicalDetails), count: items.length }))),
    [allGroups, layout, showTechnicalDetails],
  );

  const formulaCount = useMemo(
    () => declaredNodes.filter(node => node.datasource?.calculatedField?.expressionAsString?.trim()).length,
    [declaredNodes],
  );

  // Opening the tab for a datasource reveals it: its group and every node above it.
  useEffect(() => {
    if (!focusKey) return;
    setExpandedKeys(prev => new Set([...prev, ...ancestorPathKeys(focusKey)]));
    const node = layout === 'kind'
      ? declaredNodes.find(candidate => candidate.key === focusKey)
      : tree.roots.find(candidate => candidate.key === focusKey.split('/')[0]);
    if (!node) return;
    const group = groupKeyOf(node);
    setCollapsedGroups(prev => {
      if (!prev.has(group)) return prev;
      const next = new Set(prev);
      next.delete(group);
      return next;
    });
    setHiddenKinds(prev => (prev.includes(group) ? prev.filter(key => key !== group) : prev));
  }, [focusKey, tree, declaredNodes, layout, groupKeyOf, setHiddenKinds]);

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

  const toggleKind = useCallback((key: string) => {
    setHiddenKinds(prev => (prev.includes(key) ? prev.filter(other => other !== key) : [...prev, key]));
  }, [setHiddenKinds]);

  const isFormulaOpen = useCallback((key: string) => formulasOpen !== formulaToggles.has(key), [formulasOpen, formulaToggles]);
  const toggleFormula = useCallback((key: string) => {
    setFormulaToggles(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const toggleAllFormulas = useCallback(() => {
    setFormulasOpen(open => !open);
    setFormulaToggles(new Set());
  }, [setFormulasOpen]);

  const expandAll = useCallback(() => {
    setCollapsedGroups(new Set());
    // Every path down to a datasource the definition declares, and every
    // enum's values — not the whole data model, which would open thousands of fields.
    const keys = keysWithDeclaredDescendants(datasources);
    for (const node of declaredNodes) if (node.enumValues?.values.length) keys.add(node.key);
    setExpandedKeys(keys);
    setFilterToggles(new Set());
  }, [datasources, declaredNodes]);

  const collapseAll = useCallback(() => {
    setExpandedKeys(new Set());
    if (filterState) setFilterToggles(new Set(filterState.ancestors));
    else setCollapsedGroups(new Set(groups.map(([type]) => type)));
  }, [filterState, groups]);

  React.useImperativeHandle(ref, () => ({ expandAll, collapseAll }), [expandAll, collapseAll]);

  const ctx = useMemo<DatasourceListContext>(() => ({
    tree, filter: filterState, focusKey, isExpanded, toggle, configIndex, navigateToTreeNode, labelFor, revealInExplorer,
    layout, visibleChildren, isFormulaOpen, toggleFormula,
  }), [tree, filterState, focusKey, isExpanded, toggle, configIndex, navigateToTreeNode, labelFor, revealInExplorer, layout, visibleChildren, isFormulaOpen, toggleFormula]);

  const effectiveCollapsedGroups = filterState ? EMPTY_STRING_SET : collapsedGroups;

  // The rows are virtualized against the pane that scrolls them.
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { scrollRef.current = findScrollParent(rootRef.current); });

  // The group headers stick right below the bar, whose height follows its wrapping.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const apply = () => root.style.setProperty('--ds-bar-height', `${bar.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="ds-list">
      <DatasourceListBar
        barRef={barRef}
        layout={layout}
        onLayoutChange={setLayout}
        kinds={kindChips}
        hiddenKinds={hiddenKinds}
        onToggleKind={toggleKind}
        formulaCount={formulaCount}
        formulasOpen={formulasOpen}
        onToggleFormulas={toggleAllFormulas}
      />
      {groups.length === 0 && (
        <div style={{ color: 'var(--er-text-muted)', fontSize: 12, padding: 12 }}>{t.noResults}</div>
      )}
      {layout === 'tree'
        ? groups.map(([type, items]) => <DatasourceGroupRows key={type} items={items} ctx={ctx} scrollRef={scrollRef} />)
        : groups.map(([type, items]) => {
            const isCollapsed = effectiveCollapsedGroups.has(type);
            return (
              <div key={type}>
                <div
                  className="ds-group-header"
                  style={{ ['--ds-group-color' as string]: getDatasourceGroupColor(type) }}
                  onClick={() => toggleGroup(type)}
                >
                  <span className={`tree-chevron ${!isCollapsed ? 'open' : ''}`} />
                  <span className="ds-group-dot" aria-hidden="true" />
                  <span className="ds-group-label">{getDatasourceGroupLabel(type, showTechnicalDetails)}</span>
                  <span className="ds-group-count">{items.length}</span>
                </div>
                {!isCollapsed && <DatasourceGroupRows items={items} ctx={ctx} scrollRef={scrollRef} />}
              </div>
            );
          })}
    </div>
  );
});
