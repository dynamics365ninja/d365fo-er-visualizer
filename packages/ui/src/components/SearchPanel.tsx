import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchBox, Button, TabList, Tab, Tooltip } from '@fluentui/react-components';
import {
  SearchRegular,
  MapRegular,
  DocumentRegular,
  ArrowRightRegular,
  DismissRegular,
  TextExpandRegular,
  TextCollapseRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import type { TreeNode } from '../state/store';
import type { WhereUsedEntry } from '../state/store';
import type { GUIDEntry } from '@er-visualizer/core';
import { locale, t } from '../i18n';
import { getFormatTypeThemeColor } from '../utils/theme-colors';

type Mode = 'search' | 'where-used';

type SearchResultEntry = {
  target: string;
  targetType: string;
  sourceConfigPath: string;
  sourceComponent: string;
  sourceContext: string;
};

function findTreeNodeByMatch(nodes: TreeNode[], predicate: (node: TreeNode) => boolean): TreeNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    if (node.children) {
      const found = findTreeNodeByMatch(node.children, predicate);
      if (found) return found;
    }
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function resolveGuidsInText(text: string, lookup: (guid: string) => GUIDEntry | undefined): string {
  if (!text) return text;
  return text.replace(GUID_REGEX, guid => {
    const entry = lookup(guid);
    if (entry?.name) return `${entry.name} (${guid.slice(0, 8)}…)`;
    return guid;
  });
}

type NestedResult = { entry: SearchResultEntry; children: SearchResultEntry[] };
type ExamplePreset = { label: string; hint: string; category: string };

/**
 * Nest "Binding for X: ..." and "Format binding expression: ..." sub-hits under
 * their parent binding entry when the parent is also present in the result set.
 * This avoids showing the same binding twice (once as parent, once per reference
 * inside its expression).
 */
function nestBindingResults(items: SearchResultEntry[]): NestedResult[] {
  // Index parents by a composite key matching what child sourceContexts carry
  const parentByKey = new Map<string, SearchResultEntry>();
  for (const r of items) {
    if (r.sourceContext?.startsWith('Binding: ')) {
      // "Binding: <path> = <expr>" — key on path
      const after = r.sourceContext.slice('Binding: '.length);
      const path = after.split(' = ')[0]?.trim();
      if (path) parentByKey.set(`bind|${r.sourceComponent}|${path}`, r);
    } else if (r.sourceContext?.startsWith('Format binding to component: ')) {
      const expr = r.sourceContext.slice('Format binding to component: '.length).trim();
      parentByKey.set(`fmt|${r.sourceComponent}|${expr}`, r);
    }
  }

  const nested: NestedResult[] = [];
  const seen = new Set<SearchResultEntry>();
  const childrenMap = new Map<SearchResultEntry, SearchResultEntry[]>();

  // Pass 1: assign each child to its parent if found
  for (const r of items) {
    const ctx = r.sourceContext ?? '';
    let parent: SearchResultEntry | undefined;
    if (ctx.startsWith('Binding for ')) {
      const path = ctx.slice('Binding for '.length).split(':')[0]?.trim();
      if (path) parent = parentByKey.get(`bind|${r.sourceComponent}|${path}`);
    } else if (ctx.startsWith('Format binding expression:')) {
      // Parent expression isn't in the child context directly, but child & parent share sourceComponent+original expression.
      // Fallback: attach to any "Format binding to component" with same sourceComponent (1:1 common case).
      for (const [key, p] of parentByKey.entries()) {
        if (key.startsWith(`fmt|${r.sourceComponent}|`)) { parent = p; break; }
      }
    }
    if (parent && parent !== r) {
      const bucket = childrenMap.get(parent) ?? [];
      bucket.push(r);
      childrenMap.set(parent, bucket);
      seen.add(r);
    }
  }

  // Pass 2: build ordered top-level list, attaching children to their parents
  for (const r of items) {
    if (seen.has(r)) continue;
    nested.push({ entry: r, children: childrenMap.get(r) ?? [] });
  }
  return nested;
}

function Highlight({ text, query }: { text: string | undefined | null; query: string }) {
  const safe = text ?? '';
  const q = query.trim();
  if (!q) return <>{safe}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = safe.split(re);
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
}

function buildMatchSnippet(text: string | undefined | null, query: string, radius = 28): { value: string; truncated: boolean } {
  const full = (text ?? '').trim();
  if (!full) return { value: '', truncated: false };

  const q = query.trim().toLowerCase();
  if (!q) {
    if (full.length <= 96) return { value: full, truncated: false };
    return { value: `${full.slice(0, 96)}…`, truncated: true };
  }

  const idx = full.toLowerCase().indexOf(q);
  if (idx < 0) {
    if (full.length <= 96) return { value: full, truncated: false };
    return { value: `${full.slice(0, 96)}…`, truncated: true };
  }

  const start = Math.max(0, idx - radius);
  const end = Math.min(full.length, idx + q.length + radius);
  const raw = full.slice(start, end);
  const value = `${start > 0 ? '…' : ''}${raw}${end < full.length ? '…' : ''}`;
  return { value, truncated: start > 0 || end < full.length };
}

function PreviewSnippet({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const snippet = useMemo(() => buildMatchSnippet(text, query), [text, query]);
  const shown = expanded || !snippet.truncated ? text : snippet.value;

  return (
    <div className={className}>
      <span className="search-preview-inline-text">
        <Highlight text={shown} query={query} />
      </span>
      {snippet.truncated && (
        <button
          type="button"
          className="search-preview-inline-toggle"
          onClick={event => {
            event.stopPropagation();
            setExpanded(v => !v);
          }}
        >
          {expanded
            ? (locale === 'cs' ? 'Zkrátit náhled výrazu' : 'Show shorter snippet')
            : (locale === 'cs' ? 'Zobrazit celý výraz' : 'Show full expression')}
        </button>
      )}
    </div>
  );
}

function ExamplePalette({
  title,
  examples,
  onApply,
}: {
  title: string;
  examples: ExamplePreset[];
  onApply: (value: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, ExamplePreset[]>();
    for (const ex of examples) {
      const list = map.get(ex.category);
      if (list) list.push(ex);
      else map.set(ex.category, [ex]);
    }
    return Array.from(map.entries());
  }, [examples]);

  return (
    <div className="search-example-board">
      <div className="search-example-board__title">{title}</div>
      {grouped.map(([category, items]) => (
        <div key={category} className="search-example-board__group">
          <div className="search-example-board__group-title">{category}</div>
          <div className="search-example-board__chips">
            {items.map(item => (
              <button
                key={`${category}:${item.label}`}
                type="button"
                className="search-example-chip"
                onClick={() => onApply(item.label)}
                title={item.hint}
              >
                <span className="search-example-chip__label">{item.label}</span>
                <span className="search-example-chip__hint">{item.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchPanel() {
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const executeSearch = useAppStore(s => s.executeSearch);
  const searchResults = useAppStore(s => s.searchResults);
  const mode = useAppStore(s => s.searchPanelMode);
  const setMode = useAppStore(s => s.setSearchPanelMode);
  const registry = useAppStore(s => s.registry);
  const whereUsedQuery = useAppStore(s => s.whereUsedQuery);
  const setWhereUsedQuery = useAppStore(s => s.setWhereUsedQuery);
  const whereUsedResults = useAppStore(s => s.whereUsedResults);
  const executeWhereUsed = useAppStore(s => s.executeWhereUsed);
  const clearWhereUsed = useAppStore(s => s.clearWhereUsed);
  const whereUsedScope = useAppStore(s => s.whereUsedScope);
  const setWhereUsedScope = useAppStore(s => s.setWhereUsedScope);
  const activeWhereUsedRefKey = useAppStore(s => s.activeWhereUsedRefKey);
  const setActiveWhereUsedRefKey = useAppStore(s => s.setActiveWhereUsedRefKey);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const configurations = useAppStore(s => s.configurations);
  const whereUsedTrigger = useAppStore(s => s.whereUsedTrigger);

  const [searchExpandSignal, setSearchExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [whereUsedExpandSignal, setWhereUsedExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });

  const searchExamples = useMemo<ExamplePreset[]>(() => {
    const section = locale === 'cs'
      ? { model: 'Model a binding', formula: 'Výrazy a funkce', guid: 'Technické reference' }
      : { model: 'Model and bindings', formula: 'Expressions and functions', guid: 'Technical references' };
    return [
      { label: 'model.Header', hint: t.exampleHintIdentifier, category: section.model },
      { label: 'CompanyInfo', hint: t.exampleHintTable, category: section.model },
      { label: 'CalculatedTotal', hint: t.exampleHintCalcField, category: section.model },
      { label: 'DATETIMEFORMAT', hint: t.exampleHintFunction, category: section.formula },
      { label: 'ROUND', hint: t.exampleHintFunction, category: section.formula },
      { label: 'IF(', hint: t.exampleHintFunction, category: section.formula },
      { label: '{', hint: locale === 'cs' ? 'Vyhledat GUID reference' : 'Search GUID references', category: section.guid },
    ];
  }, []);

  const whereUsedExamples = useMemo<ExamplePreset[]>(() => {
    const section = locale === 'cs'
      ? { entity: 'Datové entity', expression: 'Výrazy a proměnné' }
      : { entity: 'Data entities', expression: 'Expressions and variables' };
    return [
      { label: 'TaxTrans', hint: t.exampleHintTable, category: section.entity },
      { label: 'NoYesEnum', hint: t.exampleHintEnum, category: section.entity },
      { label: 'TaxCodeGroupLookup', hint: t.exampleHintLookup, category: section.entity },
      { label: 'ReportingCurrency', hint: t.exampleHintParam, category: section.expression },
      { label: 'ledgerAccount', hint: t.exampleHintIdentifier, category: section.expression },
      { label: 'CalculatedTotal', hint: t.exampleHintCalcField, category: section.expression },
    ];
  }, []);

  const handleSearch = useCallback(() => {
    executeSearch();
  }, [executeSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  useEffect(() => {
    if (!whereUsedTrigger) return;
    setMode('where-used');
    executeWhereUsed(whereUsedTrigger.query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereUsedTrigger?.version]);

  const applySearchExample = useCallback((value: string) => {
    setMode('search');
    setSearchQuery(value);
    executeSearch();
  }, [executeSearch, setSearchQuery]);

  const applyWhereUsedExample = useCallback((value: string) => {
    setMode('where-used');
    executeWhereUsed(value);
  }, [executeWhereUsed, setMode]);

  useEffect(() => {
    if (mode !== 'search') return;
    const handle = window.setTimeout(() => {
      executeSearch();
    }, 200);

    return () => window.clearTimeout(handle);
  }, [executeSearch, mode, searchQuery]);

  useEffect(() => {
    if (mode !== 'where-used') return;
    const handle = window.setTimeout(() => {
      executeWhereUsed();
    }, 250);

    return () => window.clearTimeout(handle);
  }, [executeWhereUsed, mode, whereUsedQuery]);

  const visibleWhereUsedResults = useMemo(() => {
    if (whereUsedScope === 'all') return whereUsedResults;

    return whereUsedResults
      .map(entry => {
        if (whereUsedScope === 'mapping') {
          return {
            ...entry,
            formatUsages: [],
          };
        }
        return {
          ...entry,
          modelPaths: [],
        };
      })
      .filter(entry => entry.modelPaths.length > 0 || entry.formatUsages.length > 0);
  }, [whereUsedResults, whereUsedScope]);

  const trimmedSearchQuery = searchQuery.trim();
  const trimmedWhereUsedQuery = whereUsedQuery.trim();

  return (
    <div className="search-panel search-hub">
      <TabList
        className="search-mode-tabs search-hub__tabs"
        selectedValue={mode}
        onTabSelect={(_, d) => setMode(d.value as Mode)}
        size="small"
      >
        <Tab value="search" icon={<SearchRegular />}>{t.search}</Tab>
        <Tab value="where-used" icon={<MapRegular />}>{t.whereUsed}</Tab>
      </TabList>

      {mode === 'search' && (
        <div className="search-mode-surface search-mode-surface--search search-hub__surface">
          <section className="search-pane search-hub__pane">
            <div className={`search-query-card ${trimmedSearchQuery ? 'search-query-card--compact' : ''}`}>
              <div className="search-query-card__top">
                {!trimmedSearchQuery && <div className="search-query-card__label">{t.search}</div>}
                {trimmedSearchQuery && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<DismissRegular />}
                    onClick={() => setSearchQuery('')}
                    aria-label={t.clearSearch}
                    title={t.clearSearch}
                  />
                )}
              </div>
              <div className="search-input-row search-input-row--card">
                <SearchBox
                  value={searchQuery}
                  onChange={(_, d) => setSearchQuery(d.value)}
                  onKeyDown={handleKeyDown}
                  placeholder=""
                  className="search-input"
                />
                <Button appearance="primary" icon={<SearchRegular />} onClick={handleSearch} aria-label={t.search}>
                  {t.search}
                </Button>
              </div>
              {!trimmedSearchQuery && (
                <div className="search-query-kpis">
                  <span className="search-kpi">{registry.guidCount} GUID</span>
                  <span className="search-kpi">{registry.crossRefCount} cross-ref</span>
                </div>
              )}
            </div>

            {!trimmedSearchQuery && (
              <ExamplePalette
                title={t.examples}
                examples={searchExamples}
                onApply={applySearchExample}
              />
            )}

            {searchResults.length > 0 && (
              <div className="search-results-shell search-results-shell--search">
                <div className="search-toolbar-row search-toolbar-row--results search-results-shell__toolbar">
                  <div className="search-meta">{t.searchResultCount(searchResults.length)}</div>
                  <div className="search-toolbar-actions">
                    <Tooltip content={t.expand} relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<TextExpandRegular />}
                        aria-label={t.expand}
                        onClick={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: true }))}
                      />
                    </Tooltip>
                    <Tooltip content={t.collapse} relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<TextCollapseRegular />}
                        aria-label={t.collapse}
                        onClick={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: false }))}
                      />
                    </Tooltip>
                  </div>
                </div>
                <div className="search-results-scroll">
                  <SearchResultsGrouped
                    results={searchResults.slice(0, 100) as SearchResultEntry[]}
                    totalCount={searchResults.length}
                    query={searchQuery}
                    expandSignal={searchExpandSignal}
                    configurations={configurations}
                    treeNodes={treeNodes}
                    registry={registry}
                    navigateToTreeNode={navigateToTreeNode}
                  />
                </div>
              </div>
            )}

            {searchResults.length === 0 && trimmedSearchQuery && (
              <div className="search-results-shell search-results-shell--search">
                <div className="search-results-scroll">
                  <div className="search-empty search-empty--card">{t.noResults}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {mode === 'where-used' && (
        <div className="search-mode-surface search-mode-surface--where-used search-hub__surface">
          <section className="search-pane search-hub__pane">
            <div className={`search-query-card ${trimmedWhereUsedQuery ? 'search-query-card--compact' : ''}`}>
              <div className="search-query-card__top">
                {!trimmedWhereUsedQuery && <div className="search-query-card__label">{t.whereUsed}</div>}
              </div>
              {!trimmedWhereUsedQuery && <div className="search-meta search-meta-tight">{t.whereUsedLabel}</div>}
              <div className="search-input-row search-input-row--card">
                <SearchBox
                  value={whereUsedQuery}
                  onChange={(_, d) => setWhereUsedQuery(d.value)}
                  onKeyDown={e => { if (e.key === 'Enter') executeWhereUsed(whereUsedQuery); }}
                  placeholder=""
                  className="search-input"
                />
                <Button appearance="primary" onClick={() => executeWhereUsed(whereUsedQuery)}>
                  {t.find}
                </Button>
                {trimmedWhereUsedQuery && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<DismissRegular />}
                    onClick={clearWhereUsed}
                    aria-label={t.clearWhereUsedSearch}
                    title={t.clearWhereUsedSearch}
                    className="search-input-row__clear"
                  />
                )}
              </div>
            </div>

            {!trimmedWhereUsedQuery && (
              <ExamplePalette
                title={t.examples}
                examples={whereUsedExamples}
                onApply={applyWhereUsedExample}
              />
            )}

            {visibleWhereUsedResults.length > 0 && (
              <div className="search-results-shell search-results-shell--where-used">
                <div className="search-toolbar-row search-toolbar-row--results search-results-shell__toolbar">
                  <div className="search-section-caption search-section-caption-spacious search-results-count-chip">
                    {t.found(visibleWhereUsedResults.length)}
                  </div>
                  <div className="search-scope-toggle" role="group" aria-label={locale === 'cs' ? 'Filtrovat oblast použití' : 'Filter usage scope'}>
                    <button
                      type="button"
                      className={`search-scope-toggle__btn ${whereUsedScope === 'all' ? 'active' : ''}`}
                      onClick={() => setWhereUsedScope('all')}
                    >
                      {locale === 'cs' ? 'Vše' : 'All'}
                    </button>
                    <button
                      type="button"
                      className={`search-scope-toggle__btn ${whereUsedScope === 'mapping' ? 'active' : ''}`}
                      onClick={() => setWhereUsedScope('mapping')}
                    >
                      {locale === 'cs' ? 'Mapování' : 'Mappings'}
                    </button>
                    <button
                      type="button"
                      className={`search-scope-toggle__btn ${whereUsedScope === 'format' ? 'active' : ''}`}
                      onClick={() => setWhereUsedScope('format')}
                    >
                      {locale === 'cs' ? 'Formát' : 'Format'}
                    </button>
                  </div>
                  <div className="search-toolbar-actions">
                    <Tooltip content={t.expand} relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<TextExpandRegular />}
                        aria-label={t.expand}
                        onClick={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: true }))}
                      />
                    </Tooltip>
                    <Tooltip content={t.collapse} relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<TextCollapseRegular />}
                        aria-label={t.collapse}
                        onClick={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: false }))}
                      />
                    </Tooltip>
                  </div>
                </div>
                <div className="search-results-scroll">
                  <div className="search-results-panel">
                    {visibleWhereUsedResults.map((entry, i) => (
                      <WhereUsedCard
                        key={i}
                        entry={entry}
                        query={whereUsedQuery}
                        scope={whereUsedScope}
                        expandSignal={whereUsedExpandSignal}
                        navigateToTreeNode={navigateToTreeNode}
                        findDatasourceNode={findDatasourceNode}
                        treeNodes={treeNodes}
                        activeRefKey={activeWhereUsedRefKey}
                        onReferenceOpen={setActiveWhereUsedRefKey}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {visibleWhereUsedResults.length === 0 && trimmedWhereUsedQuery && (
              <div className="search-results-shell search-results-shell--where-used">
                <div className="search-results-scroll">
                  <div className="search-empty search-empty--card">
                    {t.noResultsFor(whereUsedQuery)}
                  </div>
                </div>
              </div>
            )}

          </section>
        </div>
      )}
    </div>
  );
}

function SearchResultsGrouped({
  results,
  totalCount,
  query,
  expandSignal,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  results: SearchResultEntry[];
  totalCount: number;
  query: string;
  expandSignal: { version: number; expanded: boolean };
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, SearchResultEntry[]>();
    for (const r of results) {
      const key = r.sourceConfigPath || '—';
      const bucket = map.get(key);
      if (bucket) bucket.push(r);
      else map.set(key, [r]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [results]);

  return (
    <div className="search-results">
      <div className="search-section-caption">
        {t.searchResultCount(totalCount)}{results.length < totalCount ? ` · ${results.length}` : ''}
      </div>
      {groups.map(([configPath, items]) => (
        <SearchResultGroup
          key={configPath}
          configPath={configPath}
          items={items}
          query={query}
          expandSignal={expandSignal}
          configurations={configurations}
          treeNodes={treeNodes}
          registry={registry}
          navigateToTreeNode={navigateToTreeNode}
        />
      ))}
    </div>
  );
}

function SearchResultGroup({
  configPath,
  items,
  query,
  expandSignal,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  configPath: string;
  items: SearchResultEntry[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const fileName = configPath.split(/[\\/]/).pop() ?? configPath;
  const nested = useMemo(() => nestBindingResults(items), [items]);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  return (
    <div className="search-result-group">
      <button
        type="button"
        className="search-result-group-header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <DocumentRegular className="search-result-group-icon" />
        <span className="search-result-group-name" title={configPath}>
          <Highlight text={fileName} query={query} />
        </span>
        <span className="search-result-group-count">{items.length}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {nested.map((node, i) => (
            <SearchResultCard
              key={`${node.entry.sourceConfigPath}:${node.entry.target}:${i}`}
              result={node.entry}
              bindingChildren={node.children}
              query={query}
              configurations={configurations}
              treeNodes={treeNodes}
              registry={registry}
              navigateToTreeNode={navigateToTreeNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({
  result,
  bindingChildren = [],
  query,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  result: SearchResultEntry;
  bindingChildren?: SearchResultEntry[];
  query: string;
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const targetNode = findNodeForSearchResult(result, configurations, treeNodes, registry);
  const isGuidTarget = result.targetType === 'GUID' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.target ?? '');
  const resolvedEntry = isGuidTarget ? registry.lookup(result.target) : undefined;
  const displayName = resolvedEntry?.name ?? result.target;
  const showGuidSuffix = Boolean(resolvedEntry?.name && resolvedEntry.name !== result.target);
  const kindBadge = resolvedEntry?.kind ?? result.targetType;
  const resolvedContext = resolveGuidsInText(result.sourceContext, g => registry.lookup(g));

  return (
    <div className="search-result-card">
      <div className="search-result-header">
        <span className={`badge badge-${(kindBadge ?? '').toLowerCase()}`} title={result.targetType}>{kindBadge}</span>
        <span className="search-result-target" title={result.target}>
          <Highlight text={displayName} query={query} />
          {showGuidSuffix && (
            <span className="search-result-guid" title={result.target}>{result.target}</span>
          )}
        </span>
        {targetNode && (
          <button
            type="button"
            className="search-result-open-btn"
            onClick={() => navigateToTreeNode(targetNode.id)}
            title={t.openInExplorerAction}
            aria-label={t.openInExplorerAction}
          >
            <ArrowRightRegular />
            <span>{t.explorerActionShort}</span>
          </button>
        )}
      </div>
      <PreviewSnippet text={resolvedContext} query={query} className="search-result-context" />
      <div className="search-result-source" title={result.sourceComponent}>
        <span className="search-result-source-label">{t.searchInLabel}</span>
        <span className="search-result-source-component">
          <Highlight text={resolveGuidsInText(result.sourceComponent, g => registry.lookup(g))} query={query} />
        </span>
      </div>
      {bindingChildren.length > 0 && (() => {
        // Deduplicate: the indexer creates one child per regex match in the expression,
        // so identical (target, targetType) pairs would repeat the same context text.
        const seen = new Map<string, { child: SearchResultEntry; count: number }>();
        for (const c of bindingChildren) {
          const key = `${c.targetType}|${c.target}`;
          const hit = seen.get(key);
          if (hit) hit.count += 1;
          else seen.set(key, { child: c, count: 1 });
        }
        const unique = Array.from(seen.values());
        return (
          <div className="search-result-children" aria-label="Nested binding references">
            <div className="search-result-children-title">
              {t.searchRefCount(unique.length)}
            </div>
            <div className="search-result-child-chips">
              {unique.map(({ child, count }, i) => (
                <span
                  key={i}
                  className="search-result-child-chip"
                  title={`${child.targetType}: ${child.target}${count > 1 ? ` (${count}×)` : ''}`}
                >
                  <span className={`badge badge-${(child.targetType ?? '').toLowerCase()} badge-tiny`}>{child.targetType}</span>
                  <span className="search-result-child-target">
                    <Highlight text={child.target} query={query} />
                  </span>
                  {count > 1 && <span className="search-result-child-count">×{count}</span>}
                </span>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Where-Used Card (IDE-style "Find References" panel) ───

type ReferenceArea = 'mapping' | 'format';

type Reference = {
  area: ReferenceArea;
  kind: 'binding' | 'formatElement';
  configIndex: number;
  configName: string;
  /** Human-readable location path (e.g. breadcrumb for a format element, or datasource.path for a binding). */
  location: string[];
  /** Short kind label shown inline as a chip ("binding", "Sequence", "Group"…). */
  kindLabel: string;
  /** The line/expression preview text. */
  preview: string;
  /** The short location name (last breadcrumb or binding path) for column alignment. */
  shortLocation: string;
  /** Navigation action. */
  onOpen: () => void;
  /** Optional: format element type color for the kind chip. */
  kindColor?: string;
};

function toLocalizedBindingKind(label: string): string {
  if (locale !== 'cs') return label;
  const trimmed = label.trim().toLowerCase();
  if (trimmed === 'binding') return 'Vazba';
  if (trimmed.startsWith('binding ')) return `Vazba ${label.slice('binding'.length).trim()}`;
  return label;
}

function getAreaTitle(area: ReferenceArea): string {
  if (area === 'mapping') {
    return locale === 'cs' ? 'Mapování a vazby' : 'Mappings and bindings';
  }
  return locale === 'cs' ? 'Použití ve formátu' : 'Format usages';
}

function WhereUsedCard({ entry, query, scope, expandSignal, navigateToTreeNode, findDatasourceNode, treeNodes, activeRefKey, onReferenceOpen }: {
  entry: WhereUsedEntry;
  query: string;
  scope: 'all' | 'mapping' | 'format';
  expandSignal: { version: number; expanded: boolean };
  navigateToTreeNode: (nodeId: string) => void;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  treeNodes: TreeNode[];
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  const entityBadgeColor = getWhereUsedBadgeClass(entry.entityType);

  const navigateToDs = () => {
    const nodeId = findDatasourceNode(
      entry.datasource.name,
      entry.datasource.configIndex,
      entry.datasource.parentPath,
    );
    if (nodeId) navigateToTreeNode(nodeId);
  };

  const navigateToFormatElement = (configIndex: number, elementId: string) => {
    const node = findTreeNodeByMatch(
      treeNodes,
      candidate => candidate.type === 'formatElement'
        && candidate.configIndex === configIndex
        && candidate.data?.id === elementId,
    );
    if (node) navigateToTreeNode(node.id);
  };

  const navigateToBinding = (configIndex: number, path: string, treeNodeId?: string) => {
    if (treeNodeId) {
      navigateToTreeNode(treeNodeId);
      return;
    }
    const configRoot = treeNodes[configIndex];
    if (!configRoot) return;
    const node = findTreeNodeByMatch(
      configRoot.children ?? [],
      candidate => candidate.type === 'binding' && candidate.data?.path === path,
    );
    if (node) navigateToTreeNode(node.id);
  };

  // Flatten modelPaths + formatUsages into a single list, then split by usage area.
  const references: Reference[] = useMemo(() => {
    const dsName = entry.datasource.name;
    const mp: Reference[] = entry.modelPaths.map(m => ({
      area: 'mapping',
      kind: 'binding',
      configIndex: m.configIndex,
      configName: m.configName,
      location: entry.entityType === 'TextMatch'
        ? m.path.split(/[./]/).filter(Boolean)
        : [dsName, ...m.path.split('.').filter(Boolean)],
      kindLabel: m.kindLabel ?? 'binding',
      preview: m.expr,
      shortLocation: m.path,
      onOpen: () => navigateToBinding(m.configIndex, m.path, m.treeNodeId),
    }));
    const fu: Reference[] = entry.formatUsages.map(f => {
      const loc = f.elementPath && f.elementPath.length > 0 ? f.elementPath : [f.elementName];
      return {
        area: 'format' as const,
        kind: 'formatElement' as const,
        configIndex: f.configIndex,
        configName: f.configName,
        location: loc,
        kindLabel: f.elementType,
        preview: f.expression,
        shortLocation: f.elementName,
        onOpen: () => navigateToFormatElement(f.configIndex, f.elementId),
        kindColor: getFormatTypeThemeColor(f.elementType),
      };
    });
    return [...mp, ...fu];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, treeNodes]);

  const areaRefs = useMemo(() => {
    const mapping = references.filter(ref => ref.area === 'mapping');
    const format = references.filter(ref => ref.area === 'format');
    return { mapping, format };
  }, [references]);

  const fileGroups = useMemo(() => {
    const map = new Map<string, { configName: string; refs: Reference[] }>();
    for (const r of references) {
      const key = `${r.configIndex}|${r.configName}`;
      const bucket = map.get(key);
      if (bucket) bucket.refs.push(r);
      else map.set(key, { configName: r.configName, refs: [r] });
    }
    return Array.from(map.entries());
  }, [references]);

  const summary = t.whereUsedSummary(references.length, fileGroups.length);

  const isTextMatch = entry.entityType === 'TextMatch';

  return (
    <div className="wu-card wu-card--tool">
      <div className="wu-card-header wu-card-header--tool" onClick={() => setExpanded(e => !e)}>
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <span className={`badge ${entityBadgeColor}`}>
          {isTextMatch ? 'text' : entry.entityType}
        </span>
        <span className="wu-entity-name">
          {isTextMatch ? <>&quot;<Highlight text={entry.entityName} query={query} />&quot;</> : <Highlight text={entry.entityName} query={query} />}
        </span>
        {!isTextMatch && (
          <>
            <span className="wu-arrow">→</span>
            <span
              className="wu-ds-name"
              onClick={e => { e.stopPropagation(); navigateToDs(); }}
              title={t.navigateToDatasource}
            >
              {locale === 'cs' ? 'Datový zdroj:' : 'Datasource:'} <Highlight text={entry.datasource.name} query={query} />
            </span>
          </>
        )}
        {isTextMatch && (
          <span className="wu-ds-name wu-ds-name-plain" title={t.textOccurrences}>
            {t.inExpressions}
          </span>
        )}
        <div className="wu-meta-end">
          <span className="wu-ref-summary" title={summary}>{summary}</span>
          {!isTextMatch && (
            <button
              className="fmt-action-btn fmt-action-btn-compact wu-reveal-btn"
              onClick={e => { e.stopPropagation(); navigateToDs(); }}
              title={t.openInExplorerAction}
            >
              {t.openInExplorerAction}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="wu-card-body wu-card-body--tool">
          {!isTextMatch && (
            <button
              type="button"
              className="wu-ds-anchor"
              onClick={navigateToDs}
              title={t.openInExplorerAction}
            >
              <span className="wu-ds-anchor__title">
                {locale === 'cs' ? 'Přejít na datový zdroj v mapování' : 'Open datasource in mapping'}
              </span>
              <span className="wu-ds-anchor__name">
                <Highlight text={entry.datasource.name} query={query} />
              </span>
            </button>
          )}

          {references.length === 0 && (
            <div className="wu-empty">
              <strong>{t.deadDatasource}:</strong> {t.deadDatasourceDesc}
            </div>
          )}

          {references.length > 0 && (
            <div className="wu-areas">
              {(scope === 'all' || scope === 'mapping') && (
                <WhereUsedAreaPanel
                  area="mapping"
                  title={getAreaTitle('mapping')}
                  references={areaRefs.mapping}
                  query={query}
                  expandSignal={expandSignal}
                  activeRefKey={activeRefKey}
                  onReferenceOpen={onReferenceOpen}
                />
              )}
              {(scope === 'all' || scope === 'format') && (
                <WhereUsedAreaPanel
                  area="format"
                  title={getAreaTitle('format')}
                  references={areaRefs.format}
                  query={query}
                  expandSignal={expandSignal}
                  activeRefKey={activeRefKey}
                  onReferenceOpen={onReferenceOpen}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WhereUsedAreaPanel({
  area,
  title,
  references,
  query,
  expandSignal,
  activeRefKey,
  onReferenceOpen,
}: {
  area: ReferenceArea;
  title: string;
  references: Reference[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  const fileGroups = useMemo(() => {
    const map = new Map<string, { configName: string; refs: Reference[] }>();
    for (const r of references) {
      const key = `${r.configIndex}|${r.configName}`;
      const bucket = map.get(key);
      if (bucket) bucket.refs.push(r);
      else map.set(key, { configName: r.configName, refs: [r] });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].refs.length - a[1].refs.length);
  }, [references]);

  return (
    <section className={`wu-area wu-area--${area}`}>
      <button
        type="button"
        className="wu-area-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <span className="wu-area-title">{title}</span>
        <span className="wu-area-count">{references.length}</span>
      </button>
      {expanded && (
        <div className="wu-area-body">
          {references.length === 0 ? (
            <div className="wu-area-empty">
              {locale === 'cs'
                ? 'Žádná relevantní místa použití.'
                : 'No relevant usages in this area.'}
            </div>
          ) : (
            fileGroups.map(([key, { configName, refs }]) => (
              <FileReferenceGroup
                key={key}
                area={area}
                configName={configName}
                references={refs}
                query={query}
                expandSignal={expandSignal}
                activeRefKey={activeRefKey}
                onReferenceOpen={onReferenceOpen}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function FileReferenceGroup({
  area,
  configName,
  references,
  query,
  expandSignal,
  activeRefKey,
  onReferenceOpen,
}: {
  area: ReferenceArea;
  configName: string;
  references: Reference[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  return (
    <div className="wu-file-group">
      <button
        type="button"
        className="wu-file-group-header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <DocumentRegular className="wu-file-group-icon" />
        <span className="wu-file-group-name" title={configName}>
          <Highlight text={configName} query={query} />
        </span>
        <span className="wu-file-group-count">{references.length}</span>
      </button>
      {expanded && (
        <div className="wu-file-group-body">
          {references.map((ref, i) => (
            <ReferenceRow
              key={i}
              reference={ref}
              query={query}
              referenceKey={`${area}:${configName}:${i}:${ref.shortLocation}`}
              activeRefKey={activeRefKey}
              onReferenceOpen={onReferenceOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceRow({
  reference,
  query,
  referenceKey,
  activeRefKey,
  onReferenceOpen,
}: {
  reference: Reference;
  query: string;
  referenceKey: string;
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const { location, kindLabel, preview, kindColor, onOpen } = reference;
  const breadcrumb = location.slice(0, -1);
  const leaf = location[location.length - 1] ?? '';
  const localizedKind = reference.kind === 'binding' ? toLocalizedBindingKind(kindLabel) : kindLabel;
  const isActive = activeRefKey === referenceKey;

  const openReference = () => {
    onReferenceOpen(referenceKey);
    onOpen();
  };

  return (
    <div
      className={`wu-ref-row wu-ref-row-multiline ${isActive ? 'wu-ref-row--active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={openReference}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openReference();
        }
      }}
      title={`${location.join(' / ')}\n${preview}`}
    >
      <div className="wu-ref-line wu-ref-line-location">
        <span
          className="wu-ref-kind"
          style={kindColor ? { color: kindColor, borderColor: kindColor } : undefined}
        >
          {localizedKind}
        </span>
        <span className="wu-ref-location">
          {breadcrumb.length > 0 && (
            <span className="wu-ref-breadcrumb">
              {breadcrumb.map((seg, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="wu-ref-bc-sep">/</span>}
                  <span className="wu-ref-bc-seg"><Highlight text={seg} query={query} /></span>
                </React.Fragment>
              ))}
              <span className="wu-ref-bc-sep">/</span>
            </span>
          )}
          <span className="wu-ref-leaf" title={leaf}>
            <Highlight text={leaf} query={query} />
          </span>
        </span>
      </div>
      <div className="wu-ref-line wu-ref-line-preview">
        <PreviewSnippet text={preview} query={query} className="wu-ref-preview" />
      </div>
    </div>
  );
}

function findNodeForSearchResult(
  result: SearchResultEntry,
  configurations: Array<{ filePath: string }>,
  treeNodes: TreeNode[],
  registry: { lookup: (guid: string) => GUIDEntry | undefined },
): TreeNode | null {
  const configIndex = configurations.findIndex(config => config.filePath === result.sourceConfigPath);
  if (configIndex < 0) return null;

  const rootNode = treeNodes[configIndex];
  if (!rootNode) return null;

  const sourceExpr = extractExpressionFromContext(result.sourceContext);

  if (result.sourceContext === 'TypeDescriptor reference in model field') {
    return findFieldNode(rootNode, result.sourceComponent);
  }

  if (result.sourceContext === 'Model mapping references data model') {
    return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'mapping')
      ?? (rootNode.data?.kind === 'ModelMapping' ? rootNode : null);
  }

  if (result.sourceContext === 'Format mapping references format definition') {
    return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'format')
      ?? (rootNode.data?.kind === 'Format' ? rootNode : null);
  }

  if (result.sourceContext === 'Base model reference') {
    return rootNode;
  }

  if (result.sourceContext.startsWith('Binding:')) {
    return findTreeNodeByMatch(rootNode.children ?? [], node =>
      node.type === 'binding' && node.data?.path === result.target,
    );
  }

  if (result.sourceContext.startsWith('Binding for ')) {
    const bindingPath = result.sourceContext.slice('Binding for '.length).split(':')[0]?.trim();
    if (bindingPath) {
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'binding' && node.data?.path === bindingPath,
      );
    }
  }

  if (result.sourceContext.startsWith('Format binding to component:')) {
    return findTreeNodeByMatch(rootNode.children ?? [], node =>
      (node.type === 'formatElement' && node.data?.id === result.target)
      || (node.type === 'formatBinding' && node.data?.componentId === result.target),
    );
  }

  if (result.sourceContext.startsWith('Format binding expression:') && sourceExpr) {
    const bindingNode = findFormatBindingNode(rootNode, sourceExpr);
    if (bindingNode) return bindingNode;
  }

  if (result.targetType === 'GUID') {
    const guidNode = resolveGuidTargetNode(result.target, treeNodes, configurations, registry)
      ?? findTreeNodeByMatch(rootNode.children ?? [], node =>
        (node.type === 'formatElement' && node.data?.id === result.target)
        || node.data?.id === result.target,
      );
    if (guidNode) return guidNode;
  }

  if (result.targetType === 'ModelPath') {
    const bindingNode = findTreeNodeByMatch(rootNode.children ?? [], node =>
      node.type === 'binding' && node.data?.path === result.target,
    );
    if (bindingNode) return bindingNode;
  }

  if (result.targetType === 'Formula') {
    if (sourceExpr) {
      const formatBindingNode = findFormatBindingNode(rootNode, sourceExpr);
      if (formatBindingNode) return formatBindingNode;
    }

    const bindingPath = result.sourceContext.startsWith('Binding for ')
      ? result.sourceContext.slice('Binding for '.length).split(':')[0]?.trim()
      : null;
    if (bindingPath) {
      const bindingNode = findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'binding' && node.data?.path === bindingPath,
      );
      if (bindingNode) return bindingNode;
    }
  }

  return findTreeNodeByMatch(rootNode.children ?? [], node =>
    node.type === 'datasource' && node.name === result.sourceComponent,
  );
}

function findFieldNode(rootNode: TreeNode, sourceComponent: string): TreeNode | null {
  const [containerName, fieldName] = sourceComponent.split('.');
  return findTreeNodeWithAncestors(rootNode.children ?? [], [], (node, ancestors) => {
    if (node.type !== 'field' || node.name !== fieldName) return false;
    const parentContainer = ancestors[ancestors.length - 1];
    return parentContainer?.type === 'container' && parentContainer.name === containerName;
  });
}

function findFormatBindingNode(rootNode: TreeNode, expression: string): TreeNode | null {
  return findTreeNodeByMatch(rootNode.children ?? [], node =>
    node.type === 'formatBinding' && node.data?.expressionAsString === expression,
  );
}

function resolveGuidTargetNode(
  guid: string,
  treeNodes: TreeNode[],
  configurations: Array<{ filePath: string }>,
  registry: { lookup: (guid: string) => GUIDEntry | undefined },
): TreeNode | null {
  const entry = registry.lookup(guid);
  if (!entry) return null;

  const configIndex = configurations.findIndex(config => config.filePath === entry.configFilePath);
  if (configIndex < 0) return null;

  const rootNode = treeNodes[configIndex];
  if (!rootNode) return null;

  switch (entry.kind) {
    case 'Solution':
      return rootNode;
    case 'ModelVersion':
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'model')
        ?? (rootNode.data?.kind === 'DataModel' ? rootNode : null);
    case 'MappingVersion':
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'mapping')
        ?? (rootNode.data?.kind === 'ModelMapping' ? rootNode : null);
    case 'FormatVersion':
    case 'FormatMappingVersion':
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'format')
        ?? (rootNode.data?.kind === 'Format' ? rootNode : null);
    case 'Container':
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'container' && node.data?.id === guid,
      );
    case 'FormatElement':
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'formatElement' && node.data?.id === guid,
      );
    case 'FormatEnum':
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'enum' && node.data?.id === guid,
      );
    case 'Transformation':
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'transformation' && node.data?.id === guid,
      );
    case 'ValidationRule':
      return findTreeNodeByMatch(rootNode.children ?? [], node =>
        node.type === 'validation' && Array.isArray(node.data?.conditions)
          && node.data.conditions.some((condition: { id?: string }) => condition.id === guid),
      );
    default:
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.data?.id === guid);
  }
}

function findTreeNodeWithAncestors(
  nodes: TreeNode[],
  ancestors: TreeNode[],
  predicate: (node: TreeNode, ancestors: TreeNode[]) => boolean,
): TreeNode | null {
  for (const node of nodes) {
    if (predicate(node, ancestors)) return node;
    if (node.children) {
      const found = findTreeNodeWithAncestors(node.children, [...ancestors, node], predicate);
      if (found) return found;
    }
  }
  return null;
}

function extractExpressionFromContext(sourceContext: string): string | null {
  const separatorIndex = sourceContext.indexOf(': ');
  if (separatorIndex === -1) return null;
  return sourceContext.slice(separatorIndex + 2).trim() || null;
}

function getWhereUsedBadgeClass(entityType: WhereUsedEntry['entityType']): string {
  switch (entityType) {
    case 'Table':
      return 'badge-table';
    case 'Enum':
      return 'badge-enum';
    case 'Class':
      return 'badge-class';
    case 'CalculatedField':
      return 'badge-calc';
    case 'UserParameter':
      return 'badge-param';
    case 'GroupBy':
    case 'Join':
    case 'Container':
    case 'Object':
      return 'badge-success';
    case 'TextMatch':
      return 'badge-info';
    default:
      return 'badge-xml';
  }
}

