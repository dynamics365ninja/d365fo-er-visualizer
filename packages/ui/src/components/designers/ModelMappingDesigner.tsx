import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinkFilled, CheckmarkCircleRegular, TextBulletListTreeRegular } from '@fluentui/react-icons';
import { useAppStore } from '../../state/store';
import { countDeclaredDatasources } from '../../utils/datasource-tree';
import { ClickablePath } from '../ClickablePath';
import { DrillDownTrigger } from '../DrillDownPanel';
import { ExpandCollapseSlider } from '../ExpandCollapseSlider';
import { FilterField } from '../FilterField';
import { locale, t } from '../../i18n';
import { countTerms, suggestionsFromCounts, type FilterSuggestion } from '../../utils/filter-suggestions';
import { useTabState } from '../../utils/tab-view-state';
import { findTreeNodeByMatch, DesignerHint, SlidingTabs, datasourceFocusKey, collectDatasourceTerms, EMPTY_STRING_SET, RevealInExplorerMenu } from './shared';
import { type GroupedDatasourceListHandle, GroupedDatasourceList } from './DatasourceTree';

// ─── Mapping Designer ───

interface BindingTreeNode {
  /** Full binding path — also the collapse-state key. */
  key: string;
  /** Last path segment, i.e. what the F&O designer shows at this level. */
  name: string;
  children: BindingTreeNode[];
  binding?: any;
  /** Number of bindings in this subtree, including this node. */
  count: number;
}

/**
 * Turn the flat `parent/child/leaf` binding paths into the nested structure the
 * F&O model-mapping designer shows. Intermediate levels that carry no binding
 * of their own are still materialised so the hierarchy stays continuous.
 */
function buildBindingTree(bindings: any[]): BindingTreeNode[] {
  const roots: BindingTreeNode[] = [];
  const index = new Map<string, BindingTreeNode>();

  const ensure = (path: string): BindingTreeNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const node: BindingTreeNode = {
      key: path,
      name: slash >= 0 ? path.slice(slash + 1) : path,
      children: [],
      count: 0,
    };
    index.set(path, node);
    if (slash >= 0) ensure(path.slice(0, slash)).children.push(node);
    else roots.push(node);
    return node;
  };

  for (const b of bindings) ensure(b.path).binding = b;

  const tally = (node: BindingTreeNode): number => {
    // Children keep insertion order — i.e. the order in which the paths
    // appear in the ER configuration — instead of an alphabetical sort.
    node.count = (node.binding ? 1 : 0) + node.children.reduce((sum, c) => sum + tally(c), 0);
    return node.count;
  };
  for (const root of roots) tally(root);
  return roots;
}

/** Every ancestor path of `path`, outermost first. */
function bindingAncestorKeys(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}

export function MappingDesigner({ mapping, configIndex, focusNode, tabId }: { mapping: any; configIndex: number; focusNode: any | null; tabId?: string }) {

  const mm = mapping;
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const selectNode = useAppStore(s => s.selectNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [filter, setFilter] = useTabState(tabId, 'mapping.filter', '');
  const [view, setView] = useTabState<'bindings' | 'datasources' | 'validations'>(tabId, 'mapping.view', 'bindings');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const focusBindingPath: string | undefined = focusNode?.type === 'binding' ? focusNode.data?.path : undefined;
  const focusValidationPath: string | undefined = focusNode?.type === 'validation' ? focusNode.data?.path : undefined;
  const bindingScrollRef = useRef<HTMLDivElement | null>(null);
  const validationScrollRef = useRef<HTMLDivElement | null>(null);
  const dsListRef = useRef<GroupedDatasourceListHandle>(null);

  useEffect(() => {
    if (!focusNode) return;
    if (focusNode.type === 'binding') {
      setView('bindings');
      const focusPath = focusNode.data?.path as string | undefined;
      if (focusPath) {
        // Open every level on the way down to the focused binding.
        const ancestors = bindingAncestorKeys(focusPath);
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          for (const key of ancestors) next.delete(key);
          return next;
        });
      }
    }
    // A validation used to land on the binding tree, which never lists it —
    // the row the user came from simply was not there.
    if (focusNode.type === 'validation') setView('validations');
    if (focusNode.type === 'datasource') setView('datasources');
  }, [focusNode]);

  useEffect(() => {
    if (!focusValidationPath) return;
    const timer = setTimeout(() => validationScrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(timer);
  }, [focusValidationPath]);

  useEffect(() => {
    if (!focusBindingPath) return;
    const timer = setTimeout(() => bindingScrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(timer);
  }, [focusBindingPath]);

  // Briefly flash the navigated-to row (e.g. jumping in from Search/Where-Used)
  // on top of its normal highlight, then let it settle back to the plain state.
  const [flashBindingPath, setFlashBindingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!focusBindingPath) return;
    setFlashBindingPath(focusBindingPath);
    const timer = setTimeout(() => setFlashBindingPath(null), 1400);
    return () => clearTimeout(timer);
  }, [focusBindingPath]);

  // Trivial constant detector — same logic as Format bindings
  const isTrivialExpr = (expr: string) => /^(false|true|0|1|""|'')$/i.test(expr.trim());

  // Deduplicated, filtered bindings arranged as the designer's own hierarchy
  const bindingTree = useMemo(() => {
    // 1. Deduplicate by path
    const seen = new Set<string>();
    const deduped: typeof mm.bindings = [];
    for (const b of mm.bindings) {
      if (!seen.has(b.path)) {
        seen.add(b.path);
        deduped.push(b);
      }
    }

    // 2. Remove trivial constant expressions (e.g. Enabled = false)
    const meaningful = deduped.filter((b: any) => !isTrivialExpr(b.expressionAsString));

    // 3. Apply text filter
    const lower = filter.toLowerCase();
    const textFiltered = filter
      ? meaningful.filter((b: any) =>
          b.path.toLowerCase().includes(lower) ||
          b.expressionAsString.toLowerCase().includes(lower)
        )
      : meaningful;

    // 4. Nest by path segments
    return buildBindingTree(textFiltered);
  }, [mm.bindings, filter]);

  const toggleGroup = useCallback((g: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);

  const collapseAllKeys = useCallback((nodes: BindingTreeNode[]): string[] => {
    const keys: string[] = [];
    const walk = (list: BindingTreeNode[]) => {
      for (const n of list) {
        if (n.children.length > 0) { keys.push(n.key); walk(n.children); }
      }
    };
    walk(nodes);
    return keys;
  }, []);

  const expandAllBindings = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAllBindings = useCallback(() => {
    setCollapsedGroups(new Set(collapseAllKeys(bindingTree)));
  }, [bindingTree, collapseAllKeys]);

  const selectBindingByPath = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    if (!rootNode) return;
    const match = findTreeNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === path);
    // As in the format designer: selecting a row leaves the explorer alone;
    // the row's ⋮ menu reveals it there.
    if (match) selectNode(match.id, { revealInExplorer: false });
  }, [treeNodes, configIndex, selectNode]);

  const selectValidationByPath = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    if (!rootNode) return;
    const match = findTreeNodeByMatch(rootNode, n => n.type === 'validation' && n.data?.path === path);
    if (match) selectNode(match.id, { revealInExplorer: false });
  }, [treeNodes, configIndex, selectNode]);

  const revealBindingInExplorer = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    const match = rootNode ? findTreeNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === path) : null;
    if (match) navigateToTreeNode(match.id);
  }, [treeNodes, configIndex, navigateToTreeNode]);

  const revealValidationInExplorer = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    const match = rootNode ? findTreeNodeByMatch(rootNode, n => n.type === 'validation' && n.data?.path === path) : null;
    if (match) navigateToTreeNode(match.id);
  }, [treeNodes, configIndex, navigateToTreeNode]);

  // Every level starts closed, not just the roots — the tree opens as the user
  // clicks down through it. This runs once per mapping (not on every filter
  // keystroke, which used to re-collapse everything and hide filter matches)
  // and keeps the path to a focused binding open.
  const collapseInitForRef = useRef<unknown>(null);
  useEffect(() => {
    if (collapseInitForRef.current === mm) return;
    if (bindingTree.length === 0 || filter) return;
    collapseInitForRef.current = mm;
    const next = new Set(collapseAllKeys(bindingTree));
    if (focusBindingPath) for (const key of bindingAncestorKeys(focusBindingPath)) next.delete(key);
    setCollapsedGroups(next);
  }, [mm, bindingTree, filter, collapseAllKeys, focusBindingPath]);

  // While a text filter is active every match must be visible, so the
  // user's manual collapse state is suspended (and restored when cleared).
  const effectiveCollapsedGroups = filter ? EMPTY_STRING_SET : collapsedGroups;

  const totalShown = bindingTree.reduce((n, g) => n + g.count, 0);

  const validations: any[] = mm.validations ?? [];
  const filteredValidations = useMemo(() => {
    if (!filter) return validations;
    const lower = filter.toLowerCase();
    return validations.filter((validation: any) =>
      validation.path?.toLowerCase().includes(lower) ||
      (validation.conditions ?? []).some((rule: any) =>
        rule.conditionExpressionAsString?.toLowerCase().includes(lower) ||
        rule.messageExpressionAsString?.toLowerCase().includes(lower) ||
        rule.severity?.toLowerCase().includes(lower) ||
        rule.action?.toLowerCase().includes(lower)
      )
    );
  }, [validations, filter]);

  /* What the three tabs can be filtered by, with how many rows each term hits.
     The pool deliberately crosses tab boundaries: typing a datasource name
     while Bindings is open should still offer it and take you to it, which is
     what `view` on the suggestion is for. */
  const filterSuggestions = useMemo<FilterSuggestion[]>(() => [
    ...suggestionsFromCounts(
      countTerms((mm.bindings ?? []).flatMap((binding: any) => String(binding.path ?? '').split('/'))),
      t.bindings,
      'bindings',
    ),
    ...suggestionsFromCounts(countTerms(collectDatasourceTerms(mm.datasources)), t.dataSources, 'datasources'),
    ...suggestionsFromCounts(
      countTerms((mm.validations ?? []).flatMap((validation: any) => String(validation.path ?? '').split('/'))),
      t.propValidations,
      'validations',
    ),
  ], [mm.bindings, mm.datasources, mm.validations]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Identity only — the counts moved out of here because the view tabs
          right below already carry them, once each. */}
      <div className="fmt-header">
        <span className="fmt-header-title">
          <LinkFilled fontSize={15} />
          {locale === 'cs' ? 'Mapování modelu' : 'Model mapping'}
        </span>
        <div className="fmt-header-stats">
          {(mm.dataContainerDescriptor || mm.name) && (
            <span
              className="fmt-stat"
              title={showTechnicalDetails
                ? (locale === 'cs'
                  ? 'Definice mapování (DataContainerDescriptor — kořenový kontejner datového modelu)'
                  : 'Mapping definition (DataContainerDescriptor — root container of the data model)')
                : (locale === 'cs' ? 'Definice mapování' : 'Mapping definition')}
            >
              {locale === 'cs' ? 'Definice' : 'Definition'}: {
                // The descriptor is the model root's technical name; consultants
                // get the definition's own name.
                showTechnicalDetails && mm.name && mm.dataContainerDescriptor && mm.name !== mm.dataContainerDescriptor
                  ? `${mm.name} (${mm.dataContainerDescriptor})`
                  : (showTechnicalDetails ? (mm.dataContainerDescriptor || mm.name) : (mm.name || mm.dataContainerDescriptor))
              }
            </span>
          )}
        </div>
        <DesignerHint text={locale === 'cs'
          ? 'Klikni na řádek pro vlastnosti, na lupu pro rozpad výrazu'
          : 'Click a row for properties, the magnifier for the expression drill-down'}
        />
      </div>
      <div className="fmt-toolbar">
        <SlidingTabs
          tabs={[
            { id: 'bindings' as const, label: `${t.bindings} (${totalShown})` },
            { id: 'datasources' as const, label: `${t.dataSources} (${countDeclaredDatasources(mm.datasources)})` },
            { id: 'validations' as const, label: `${t.propValidations} (${filteredValidations.length})` },
          ]}
          activeId={view}
          onChange={setView}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          {view === 'bindings' && (
            <ExpandCollapseSlider
              size="compact"
              expandLabel={t.expand}
              collapseLabel={t.collapse}
              expandIcon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6 L8 2 L12 6" />
                  <path d="M4 10 L8 14 L12 10" />
                </svg>
              }
              collapseIcon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 3 L8 7 L12 3" />
                  <path d="M4 13 L8 9 L12 13" />
                </svg>
              }
              onExpand={expandAllBindings}
              onCollapse={collapseAllBindings}
            />
          )}
          {view === 'datasources' && (
            <ExpandCollapseSlider
              size="compact"
              expandLabel={t.expand}
              collapseLabel={t.collapse}
              expandIcon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6 L8 2 L12 6" />
                  <path d="M4 10 L8 14 L12 10" />
                </svg>
              }
              collapseIcon={
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 3 L8 7 L12 3" />
                  <path d="M4 13 L8 9 L12 13" />
                </svg>
              }
              onExpand={() => dsListRef.current?.expandAll()}
              onCollapse={() => dsListRef.current?.collapseAll()}
            />
          )}
          <FilterField
            value={filter}
            onChange={setFilter}
            placeholder={t.filter}
            suggestions={filterSuggestions}
            historyScope="mapping"
            onPick={suggestion => { if (suggestion.view) setView(suggestion.view as typeof view); }}
            style={{ width: 180 }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="designer-scroll-pane">
        {view === 'bindings' && (
          bindingTree.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>{t.noResults}</div>
            : <div className="mm-tree" role="tree">
                {bindingTree.map(node => (
                  <BindingTreeRows
                    key={node.key}
                    node={node}
                    depth={0}
                    collapsed={effectiveCollapsedGroups}
                    onToggle={toggleGroup}
                    configIndex={configIndex}
                    focusBindingPath={focusBindingPath}
                    flashBindingPath={flashBindingPath}
                    focusRef={bindingScrollRef}
                    onSelectBinding={selectBindingByPath}
                    onRevealBinding={revealBindingInExplorer}
                  />
                ))}
              </div>
        )}

        {view === 'datasources' && (
          <GroupedDatasourceList ref={dsListRef} datasources={mm.datasources} filter={filter} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusKey={datasourceFocusKey(focusNode)} revealInExplorer={false} />
        )}

        {view === 'validations' && (
          filteredValidations.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>
                {validations.length === 0 ? t.mappingNoValidations : t.noResults}
              </div>
            : <div className="mm-validation-list">
                {filteredValidations.map((validation: any, vi: number) => (
                  <ValidationRow
                    key={`${validation.path}-${vi}`}
                    validation={validation}
                    configIndex={configIndex}
                    focused={validation.path === focusValidationPath}
                    focusRef={validationScrollRef}
                    onSelect={selectValidationByPath}
                    onReveal={revealValidationInExplorer}
                  />
                ))}
              </div>
        )}
      </div>
    </div>
  );
}

/**
 * One validation of a model mapping: the model path it guards, plus a card per
 * rule with its condition and message expressions. Both expressions get the
 * same drill-down affordance as a binding — a validation message is usually
 * the more tangled of the two formulas.
 */
function ValidationRow({ validation, configIndex, focused, focusRef, onSelect, onReveal }: {
  validation: any;
  configIndex: number;
  focused: boolean;
  focusRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelect: (path: string) => void;
  onReveal?: (path: string) => void;
}) {
  const rules: any[] = validation.conditions ?? [];

  return (
    <div
      className={`mm-binding-row mm-validation-row ${focused ? 'search-match' : ''}`}
      ref={focused ? focusRef : null}
      onClick={() => onSelect(validation.path)}
    >
      <div className="mm-tree-head">
        <span className="mm-validation-icon" aria-hidden><CheckmarkCircleRegular fontSize={14} /></span>
        <span className="mm-binding-name" title={validation.path}>{validation.path}</span>
        {rules.length > 1 && (
          <span
            className="mm-group-count"
            title={locale === 'cs' ? `Počet pravidel: ${rules.length}` : `Number of rules: ${rules.length}`}
          >{rules.length}</span>
        )}
        {onReveal && <RevealInExplorerMenu onReveal={() => onReveal(validation.path)} />}
      </div>
      {rules.map((rule: any, ri: number) => (
        <div key={rule.id ?? ri} className="mm-validation-rule">
          <div className="mm-validation-rule-head">
            <span className="mm-validation-rule-title">{t.propRule(ri + 1)}</span>
            {/* The XML stores these as bare codes (Action="1"), so the badge
                says which attribute the value belongs to. */}
            {rule.severity && <span className="mm-validation-badge">{t.validationSeverityBadge(rule.severity)}</span>}
            {rule.action && <span className="mm-validation-badge">{t.validationActionBadge(rule.action)}</span>}
          </div>
          <ValidationExpression
            label={t.propCondition}
            expression={rule.conditionExpressionAsString}
            configIndex={configIndex}
            elementName={`${validation.path} — ${t.propCondition}`}
          />
          <ValidationExpression
            label={t.propMessage}
            expression={rule.messageExpressionAsString}
            configIndex={configIndex}
            elementName={`${validation.path} — ${t.propMessage}`}
          />
        </div>
      ))}
    </div>
  );
}

function ValidationExpression({ label, expression, configIndex, elementName }: {
  label: string;
  expression: string | undefined;
  configIndex: number;
  elementName: string;
}) {
  const expr = (expression ?? '').trim();
  if (!expr) return null;
  return (
    <div className="mm-validation-expr">
      <span className="mm-validation-expr-label">{label}</span>
      <div className="mm-binding-expr">
        <ClickablePath expression={expr} configIndex={configIndex} />
      </div>
      <DrillDownTrigger
        expression={expr}
        configIndex={configIndex}
        elementName={elementName}
        className="mm-binding-drill"
        label={t.drillCollapsibleLabel}
      >
        <TextBulletListTreeRegular fontSize={16} aria-hidden="true" />
      </DrillDownTrigger>
    </div>
  );
}

/**
 * One level of the model-mapping binding hierarchy. Container levels render as
 * collapsible branches, bound levels additionally render their expression and
 * the drill-down trigger, so a node that is both keeps a single row.
 */
function BindingTreeRows({
  node, depth, collapsed, onToggle, configIndex, focusBindingPath, flashBindingPath, focusRef, onSelectBinding, onRevealBinding,
}: {
  node: BindingTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  configIndex: number;
  focusBindingPath?: string;
  flashBindingPath: string | null;
  focusRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelectBinding: (path: string) => void;
  /** Shows the binding's node in the explorer — offered in each bound row's ⋮ menu. */
  onRevealBinding?: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.key);
  const binding = node.binding;
  const isFocused = !!binding && node.key === focusBindingPath;
  const navFlash = isFocused && flashBindingPath === node.key;

  const classes = [
    'mm-tree-row',
    binding ? 'mm-binding-row' : 'mm-tree-branch',
    hasChildren ? 'mm-tree-expandable' : '',
    isFocused ? 'search-match' : '',
    navFlash ? 'nav-flash' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="mm-tree-node" style={{ ['--mm-depth' as string]: depth }}>
      <div
        className={classes}
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        ref={isFocused ? focusRef : null}
        onClick={() => {
          if (binding) onSelectBinding(node.key);
          else if (hasChildren) onToggle(node.key);
        }}
      >
        <div className="mm-tree-head">
          {hasChildren ? (
            <button
              type="button"
              className={`mm-tree-toggle ${isCollapsed ? '' : 'open'}`}
              aria-label={node.name}
              onClick={e => { e.stopPropagation(); onToggle(node.key); }}
            >
              <span className={`tree-chevron ${isCollapsed ? '' : 'open'}`} />
            </button>
          ) : (
            <span className="mm-tree-toggle mm-tree-toggle--leaf" aria-hidden />
          )}
          <span className={binding ? 'mm-binding-name' : 'mm-tree-branch-name'}>{node.name}</span>
          {hasChildren && (
            <span
              className="mm-group-count"
              title={locale === 'cs' ? `Počet vazeb v této větvi: ${node.count}` : `Number of bindings in this branch: ${node.count}`}
            >{node.count}</span>
          )}
          {binding && (
            <DrillDownTrigger
              expression={binding.expressionAsString}
              configIndex={configIndex}
              elementName={node.name}
              className="mm-binding-drill"
              label={t.drillCollapsibleLabel}
            >
              <TextBulletListTreeRegular fontSize={16} aria-hidden="true" />
            </DrillDownTrigger>
          )}
          {binding && onRevealBinding && <RevealInExplorerMenu onReveal={() => onRevealBinding(node.key)} />}
        </div>
        {binding && (
          <div className="mm-binding-expr">
            <span className="mm-binding-arrow" aria-hidden>←</span>
            <ClickablePath expression={binding.expressionAsString} configIndex={configIndex} mode="binding-expr" />
          </div>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className="mm-tree-children" role="group">
          {node.children.map(child => (
            <BindingTreeRows
              key={child.key}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              configIndex={configIndex}
              focusBindingPath={focusBindingPath}
              flashBindingPath={flashBindingPath}
              focusRef={focusRef}
              onSelectBinding={onSelectBinding}
              onRevealBinding={onRevealBinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
