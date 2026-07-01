import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, TabList, Tab, Tooltip } from '@fluentui/react-components';
import {
  SearchRegular,
  MapRegular,
  DocumentRegular,
  ArrowRightRegular,
  TextExpandRegular,
  TextCollapseRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import type { TreeNode } from '../state/store';
import type { WhereUsedEntry } from '../state/store';
import type { GUIDEntry } from '@er-visualizer/core';
import { locale, t, useLocale } from '../i18n';
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
  const currentLocale = useLocale();
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
  const [searchScope, setSearchScope] = useState<'all' | 'format' | 'mapping' | 'model'>('all');

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
  }, [currentLocale]);

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
  }, [currentLocale]);

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

  const whereUsedFileGroups = useMemo(() => {
    const refs: Reference[] = [];
    for (const entry of whereUsedResults) {
      const dsName = entry.datasource.name;
      for (const m of entry.modelPaths) {
        refs.push({
          area: 'mapping' as const,
          kind: 'binding' as const,
          configIndex: m.configIndex,
          configName: m.configName,
          location: entry.entityType === 'TextMatch'
            ? m.path.split(/[./]/).filter(Boolean)
            : [dsName, ...m.path.split('.').filter(Boolean)],
          kindLabel: m.kindLabel ?? 'binding',
          preview: m.expr,
          shortLocation: m.path,
          onOpen: () => {
            if (m.treeNodeId) { navigateToTreeNode(m.treeNodeId); return; }
            const root = treeNodes[m.configIndex];
            if (!root) return;
            const node = findTreeNodeByMatch(root.children ?? [], n => n.type === 'binding' && n.data?.path === m.path);
            if (node) navigateToTreeNode(node.id);
          },
        });
      }
      for (const f of entry.formatUsages) {
        const loc = f.elementPath?.length ? f.elementPath : [f.elementName];
        refs.push({
          area: 'format' as const,
          kind: 'formatElement' as const,
          configIndex: f.configIndex,
          configName: f.configName,
          location: loc,
          kindLabel: f.elementType,
          preview: f.expression,
          shortLocation: f.elementName,
          onOpen: () => {
            const node = findTreeNodeByMatch(treeNodes, n =>
              n.type === 'formatElement' && n.configIndex === f.configIndex && n.data?.id === f.elementId);
            if (node) navigateToTreeNode(node.id);
          },
          kindColor: getFormatTypeThemeColor(f.elementType),
        });
      }
    }
    const map = new Map<string, { configName: string; refs: Reference[] }>();
    for (const r of refs) {
      const key = `${r.configIndex}|${r.configName}`;
      const bucket = map.get(key);
      if (bucket) bucket.refs.push(r);
      else map.set(key, { configName: r.configName, refs: [r] });
    }
    return Array.from(map.entries());
  }, [whereUsedResults, treeNodes, navigateToTreeNode]);

  const currentQuery = mode === 'search' ? searchQuery : whereUsedQuery;
  const trimmedCurrentQuery = currentQuery.trim();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (mode === 'search') setSearchQuery(e.target.value);
    else setWhereUsedQuery(e.target.value);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (mode === 'search') handleSearch();
      else executeWhereUsed(whereUsedQuery);
    }
  };

  const handleClear = () => {
    if (mode === 'search') setSearchQuery('');
    else clearWhereUsed();
  };

  return (
    <div className="search-panel">
      <div className="search-panel__body">
        {/* ── Unified search input ── */}
        <div className="filter-field search-panel__field">
          <svg className="filter-field__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={currentQuery}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={mode === 'search' ? t.searchPlaceholder : t.whereUsedPlaceholder}
            className="filter-field__input"
            autoComplete="off"
            spellCheck={false}
          />
          {currentQuery && (
            <button
              onClick={handleClear}
              className="filter-field__clear"
              title={mode === 'search' ? t.clearSearch : t.clearWhereUsedSearch}
              aria-label={mode === 'search' ? t.clearSearch : t.clearWhereUsedSearch}
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── Search mode ── */}
        {mode === 'search' && (
          <>
            {!trimmedCurrentQuery && (
              <>
                <div className="search-panel__kpis">
                  <span className="search-panel__kpi">{registry.guidCount} GUID</span>
                  <span className="search-panel__kpi">{registry.crossRefCount} cross-ref</span>
                </div>
                <ExamplePalette
                  title={t.examples}
                  examples={searchExamples}
                  onApply={applySearchExample}
                />
              </>
            )}

            {searchResults.length > 0 && (
              <>
                {(() => {
                  // Deduplicate and filter to only navigable results (same logic as SearchResultGroup)
                  const seen = new Set<string>();
                  const navigableResults = (searchResults as SearchResultEntry[]).filter(r => {
                    const key = `${r.target}|${r.sourceComponent}|${r.sourceContext}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return findNodeForSearchResult(r, configurations, treeNodes, registry) !== null;
                  });
                  // Apply scope filter
                  const scopedResults = searchScope === 'all' ? navigableResults : navigableResults.filter(r => {
                    const kind = (configurations.find(c => c.filePath === r.sourceConfigPath) as any)?.kind ?? '';
                    if (searchScope === 'format') return kind === 'Format';
                    if (searchScope === 'mapping') return kind === 'ModelMapping';
                    if (searchScope === 'model') return kind === 'DataModel';
                    return true;
                  });
                  // Apply same per-group nesting to get accurate total count
                  const groupMap = new Map<string, SearchResultEntry[]>();
                  for (const r of scopedResults) {
                    const gk = `${r.sourceConfigPath}`;
                    const bucket = groupMap.get(gk) ?? [];
                    bucket.push(r);
                    groupMap.set(gk, bucket);
                  }
                  const totalNested = Array.from(groupMap.values()).reduce((sum, grp) => sum + nestBindingResults(grp).length, 0);
                  const capped = scopedResults.slice(0, 100);
                  return (
                    <>
                      <div className="search-panel__results-bar">
                        <span className="search-panel__results-count">{t.searchResultCount(totalNested)}</span>
                        <div className="search-scope-toggle" role="group" aria-label={locale === 'cs' ? 'Oblast výsledků' : 'Scope'}>
                          {(['all', 'format', 'mapping', 'model'] as const).map(s => (
                            <button key={s} type="button"
                              className={`search-scope-toggle__btn ${searchScope === s ? 'active' : ''}`}
                              onClick={() => setSearchScope(s)}
                            >
                              {s === 'all' ? (locale === 'cs' ? 'Vše' : 'All')
                                : s === 'format' ? (locale === 'cs' ? 'Formát' : 'Format')
                                : s === 'mapping' ? (locale === 'cs' ? 'Mapování' : 'Mappings')
                                : (locale === 'cs' ? 'Model' : 'Model')}
                            </button>
                          ))}
                        </div>
                        <div className="search-panel__results-actions">
                          <Tooltip content={t.expand} relationship="label" withArrow>
                            <Button appearance="subtle" size="small" icon={<TextExpandRegular />} aria-label={t.expand}
                              onClick={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: true }))} />
                          </Tooltip>
                          <Tooltip content={t.collapse} relationship="label" withArrow>
                            <Button appearance="subtle" size="small" icon={<TextCollapseRegular />} aria-label={t.collapse}
                              onClick={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: false }))} />
                          </Tooltip>
                        </div>
                      </div>
                      <div className="search-panel__results">
                        <SearchResultsGrouped
                          results={capped}
                          totalCount={totalNested}
                          query={searchQuery}
                          expandSignal={searchExpandSignal}
                          configurations={configurations}
                          treeNodes={treeNodes}
                          registry={registry}
                          navigateToTreeNode={navigateToTreeNode}
                        />
                      </div>
                    </>
                  );
                })()}
              </>
            )}

            {searchResults.length === 0 && trimmedCurrentQuery && (
              <div className="search-panel__empty">{t.noResults}</div>
            )}
          </>
        )}

        {/* ── Where-used mode ── */}
        {mode === 'where-used' && (
          <>
            {!trimmedCurrentQuery && (
              <>
                <p className="search-panel__hint">{t.whereUsedLabel}</p>
                <ExamplePalette
                  title={t.examples}
                  examples={whereUsedExamples}
                  onApply={applyWhereUsedExample}
                />
              </>
            )}

            {whereUsedFileGroups.length > 0 && (() => {
              const totalVisible = whereUsedFileGroups.reduce(
                (n, [, g]) => n + (whereUsedScope === 'all' ? g.refs.length : g.refs.filter(r => r.area === whereUsedScope).length), 0);
              return (
                <>
                  <div className="search-panel__results-bar">
                    <span className="search-panel__results-count">{t.found(totalVisible)}</span>
                    <div className="search-scope-toggle" role="group" aria-label={locale === 'cs' ? 'Oblast použití' : 'Scope'}>
                      {(['all', 'mapping', 'format'] as const).map(s => (
                        <button key={s} type="button"
                          className={`search-scope-toggle__btn ${whereUsedScope === s ? 'active' : ''}`}
                          onClick={() => setWhereUsedScope(s)}
                        >
                          {s === 'all' ? (locale === 'cs' ? 'Vše' : 'All')
                            : s === 'mapping' ? (locale === 'cs' ? 'Mapování' : 'Mappings')
                            : (locale === 'cs' ? 'Formát' : 'Format')}
                        </button>
                      ))}
                    </div>
                    <div className="search-panel__results-actions">
                      <Tooltip content={t.expand} relationship="label" withArrow>
                        <Button appearance="subtle" size="small" icon={<TextExpandRegular />} aria-label={t.expand}
                          onClick={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: true }))} />
                      </Tooltip>
                      <Tooltip content={t.collapse} relationship="label" withArrow>
                        <Button appearance="subtle" size="small" icon={<TextCollapseRegular />} aria-label={t.collapse}
                          onClick={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: false }))} />
                      </Tooltip>
                    </div>
                  </div>
                  <div className="search-panel__results">
                    <div className="search-results">
                      {whereUsedFileGroups.map(([key, { configName, refs }]) => (
                        <FileReferenceGroup
                          key={key}
                          configName={configName}
                          references={refs}
                          scope={whereUsedScope}
                          query={whereUsedQuery}
                          expandSignal={whereUsedExpandSignal}
                          activeRefKey={activeWhereUsedRefKey}
                          onReferenceOpen={setActiveWhereUsedRefKey}
                        />
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}

            {whereUsedFileGroups.length === 0 && trimmedCurrentQuery && (
              <div className="search-panel__empty">{t.noResultsFor(whereUsedQuery)}</div>
            )}
          </>
        )}
      </div>
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
    // Group by config file name + kind
    const map = new Map<string, { configPath: string; kind: string; items: SearchResultEntry[] }>();
    for (const r of results) {
      const configPath = r.sourceConfigPath || '—';
      const fileName = configPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, '') ?? configPath;
      const configDef = configurations.find(c => c.filePath === configPath);
      const kind = (configDef as any)?.kind ?? '';
      const key = `${fileName}__${kind}`;
      const existing = map.get(key);
      if (existing) existing.items.push(r);
      else map.set(key, { configPath, kind, items: [r] });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].items.length - a[1].items.length);
  }, [results, configurations]);

  return (
    <div className="search-results">
      {totalCount > results.length && (
        <div className="search-section-caption search-section-caption--cap">
          {locale === 'cs' ? `Zobrazeno prvních ${results.length} z ${totalCount}` : `Showing first ${results.length} of ${totalCount}`}
        </div>
      )}
      {groups.map(([key, { configPath, kind, items }]) => {
        const fileName = configPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, '') ?? configPath;
        return (
          <SearchResultGroup
            key={key}
            configPath={configPath}
            fileName={fileName}
            configKind={kind}
            items={items}
            query={query}
            expandSignal={expandSignal}
            configurations={configurations}
            treeNodes={treeNodes}
            registry={registry}
            navigateToTreeNode={navigateToTreeNode}
          />
        );
      })}
    </div>
  );
}

/** Maps a format binding propertyName to a human label + CSS kind key. */
function formatBindingLabel(prop: string, cs: boolean): { label: string; labelKind: string } {
  const p = prop.trim().toLowerCase();
  if (!p) return { label: cs ? 'Výraz formátu' : 'Fmt data', labelKind: 'formula' };
  if (['enabled', 'visible', 'disabled', 'printable', 'active'].includes(p))
    return { label: cs ? 'Viditelnost' : 'Visibility', labelKind: 'visibility' };
  if (['format', 'encoding', 'transformation', 'locale', 'separator', 'decimalseparator', 'groupseparator', 'mask'].includes(p))
    return { label: cs ? `Formátování` : `Formatting`, labelKind: 'formatting' };
  return { label: prop, labelKind: 'property' };
}

type ParsedHit = {
  /** Short tag label shown in the kind chip (e.g. "Tabulka", "Vazba", "Výraz") */
  label: string;
  /** CSS modifier for colour coding (reuses badge colour keys) */
  labelKind: string;
  /** Primary location text — the path/name of where the match lives */
  location: string;
  /** Optional secondary line — the expression or value that contains the query */
  expression: string;
  /** Designer tab where the user will land: 'structure' | 'bindings' | 'datasources' | null */
  tab: 'structure' | 'bindings' | 'datasources' | null;
};

function parseSearchHit(
  result: SearchResultEntry,
  registry: { lookup: (guid: string) => GUIDEntry | undefined },
): ParsedHit {
  const ctx = result.sourceContext ?? '';
  const comp = result.sourceComponent ?? '';
  const tgt  = result.target ?? '';
  const cs   = locale === 'cs';

  // ── Datasource usages ── show the matched *value* as primary, source as secondary
  if (/^Datasource ".+" uses table "/.test(ctx)) {
    return { label: cs ? 'Tabulka' : 'Table', labelKind: 'table', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^Datasource ".+" uses enum "/.test(ctx)) {
    return { label: cs ? 'Výčet' : 'Enum', labelKind: 'enum', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^Datasource ".+" uses class "/.test(ctx)) {
    return { label: cs ? 'Třída' : 'Class', labelKind: 'class', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^User parameter ".+" uses EDT "/.test(ctx)) {
    return { label: 'EDT', labelKind: 'edt', location: tgt, expression: cs ? `parametr: ${comp}` : `param: ${comp}`, tab: 'datasources' };
  }
  if (ctx.startsWith('Selected field in datasource "')) {
    return { label: cs ? 'Pole' : 'Field', labelKind: 'field', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }

  // ── Model binding: "Binding: path = expr" ─────────────────────────
  if (ctx.startsWith('Binding: ')) {
    const rest = ctx.slice('Binding: '.length);
    const eq   = rest.indexOf(' = ');
    const path = eq >= 0 ? rest.slice(0, eq) : rest;
    const expr = eq >= 0 ? rest.slice(eq + 3) : '';
    return { label: cs ? 'Vazba' : 'Binding', labelKind: 'binding', location: path, expression: expr, tab: 'bindings' as const };
  }

  // ── Formula inside binding: "Binding for path: expr" ──────────────
  if (ctx.startsWith('Binding for ')) {
    const rest = ctx.slice('Binding for '.length);
    const col  = rest.indexOf(':');
    const path = col >= 0 ? rest.slice(0, col).trim() : rest;
    const expr = col >= 0 ? rest.slice(col + 1).trim() : '';
    return { label: cs ? 'Výraz' : 'Expression', labelKind: 'formula', location: path, expression: expr, tab: 'bindings' as const };
  }

  // ── Format binding expression (optionally with [PropName]) ────────
  if (ctx.startsWith('Format binding') && ctx.includes('expression')) {
    const expr = ctx.slice(ctx.indexOf('expression') + 'expression'.length).replace(/^[\s:]+/, '').trim();
    // Extract optional property name from "Format binding [PropName] expression"
    const propMatch = ctx.match(/Format binding \[([^\]]+)\] expression/);
    const prop = propMatch?.[1] ?? '';
    const { label, labelKind } = formatBindingLabel(prop, cs);
    return { label, labelKind, location: comp, expression: expr, tab: 'bindings' as const };
  }

  // ── Format binding to GUID component (optionally with [PropName]) ─
  if (ctx.startsWith('Format binding') && ctx.includes('to component:')) {
    const expr     = ctx.slice(ctx.indexOf('to component:') + 'to component:'.length).trim();
    const resolved = registry.lookup(tgt);
    const propMatch = ctx.match(/Format binding \[([^\]]+)\] to component/);
    const prop = propMatch?.[1] ?? '';
    const { label, labelKind } = formatBindingLabel(prop, cs);
    return {
      label,
      labelKind,
      location: resolved?.name ?? comp,
      expression: expr,
      tab: 'bindings' as const,
    };
  }

  // ── Calculated field ──────────────────────────────────────────────
  if (ctx.startsWith('Calculated field expression:')) {
    const expr = ctx.slice('Calculated field expression:'.length).trim();
    return { label: cs ? 'Výpočet' : 'Calc. field', labelKind: 'formula', location: comp, expression: expr, tab: 'datasources' as const };
  }

  // ── TypeDescriptor ────────────────────────────────────────────────
  if (ctx === 'TypeDescriptor reference in model field') {
    return { label: cs ? 'Typ pole' : 'Field type', labelKind: 'field', location: comp, expression: tgt, tab: 'structure' as const };
  }

  // ── Structural references ─────────────────────────────────────────
  if (ctx === 'Model mapping references data model') {
    return { label: cs ? 'Model' : 'Model ref', labelKind: 'model', location: comp, expression: '', tab: null };
  }
  if (ctx === 'Base model reference') {
    return { label: cs ? 'Základ' : 'Base ref', labelKind: 'model', location: comp, expression: '', tab: null };
  }
  if (ctx === 'Format mapping references format definition') {
    return { label: cs ? 'Formát' : 'Format ref', labelKind: 'format', location: comp, expression: '', tab: null };
  }

  // ── Generic formula: "context label: expr" ────────────────────────
  if (result.targetType === 'Formula') {
    const col  = ctx.indexOf(':');
    const expr = col >= 0 ? ctx.slice(col + 1).trim() : ctx;
    return { label: cs ? 'Výraz' : 'Expression', labelKind: 'formula', location: comp, expression: expr, tab: 'datasources' as const };
  }

  // ── GUID fallback ─────────────────────────────────────────────────
  if (result.targetType === 'GUID') {
    const resolved = registry.lookup(tgt);
    return {
      label: resolved?.kind ?? 'GUID',
      labelKind: 'guid',
      location: resolved?.name ?? tgt,
      expression: '',
      tab: null,
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────
  return {
    label: result.targetType ?? '',
    labelKind: (result.targetType ?? '').toLowerCase(),
    location: comp || tgt,
    expression: ctx.length < 120 ? ctx : '',
    tab: null,
  };
}

function kindLabel(kind: string): string {
  if (kind === 'Format') return locale === 'cs' ? 'Formát' : 'Format';
  if (kind === 'ModelMapping') return locale === 'cs' ? 'Mapování' : 'Model Mapping';
  if (kind === 'DataModel') return locale === 'cs' ? 'Model' : 'Data Model';
  return kind;
}

function SearchResultGroup({
  configPath,
  fileName,
  configKind,
  items,
  query,
  expandSignal,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  configPath: string;
  fileName: string;
  configKind: string;
  items: SearchResultEntry[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Deduplicate and pre-filter to only navigable items
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    const navigable = items.filter(r => {
      const key = `${r.target}|${r.sourceComponent}|${r.sourceContext}`;
      if (seen.has(key)) return false;
      seen.add(key);
      // Only keep results that can be navigated to
      return findNodeForSearchResult(r, configurations, treeNodes, registry) !== null;
    });
    // Suppress "Binding for …" and "Format binding expression:" sub-hits that already
    // have a parent "Binding: …" / "Format binding to component:" entry in the same group.
    const nested = nestBindingResults(navigable);
    return nested.map(n => n.entry);
  }, [items, configurations, treeNodes, registry]);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  if (deduped.length === 0) return null;

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
        {configKind && (
          <span className={`badge badge-${configKind.toLowerCase()} badge-tiny`}>
            {kindLabel(configKind)}
          </span>
        )}
        <span className="search-result-group-count">{deduped.length}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {deduped.map((item, i) => (
            <SearchResultCard
              key={`${item.target}:${item.sourceComponent}:${i}`}
              result={item}
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
  query,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  result: SearchResultEntry;
  query: string;
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const targetNode = findNodeForSearchResult(result, configurations, treeNodes, registry);
  const hit = parseSearchHit(result, registry);
  const shortExpr = hit.expression.length > 100 ? `${hit.expression.slice(0, 100)}…` : hit.expression;
  const showExpr = shortExpr && shortExpr !== hit.location;

  if (!targetNode) return null;

  const cs = locale === 'cs';
  const tabLabel = hit.tab === 'structure' ? (cs ? 'Struktura' : 'Structure')
    : hit.tab === 'bindings' ? (cs ? 'Vazby' : 'Bindings')
    : hit.tab === 'datasources' ? (cs ? 'Datové zdroje' : 'Data Sources')
    : null;

  return (
    <button
      type="button"
      className="search-hit"
      onClick={() => navigateToTreeNode(targetNode.id)}
      title={result.sourceComponent || result.target}
    >
      <div className="search-hit__body">
        <div className="search-hit__row1">
          <span className={`search-hit__tag search-hit__tag--${hit.labelKind}`}>{hit.label}</span>
          <span className="search-hit__location">
            <Highlight text={hit.location} query={query} />
          </span>
          {tabLabel && <span className="search-hit__tab">{tabLabel}</span>}
          <ArrowRightRegular className="search-hit__arrow" />
        </div>
        {showExpr && (
          <div className="search-hit__expr">
            <Highlight text={shortExpr} query={query} />
          </div>
        )}
      </div>
    </button>
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

  const references: Reference[] = useMemo(() => {
    const dsName = entry.datasource.name;
    const mp: Reference[] = entry.modelPaths.map(m => ({
      area: 'mapping' as const,
      kind: 'binding' as const,
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

  // Group by configIndex + configName only (area shown per-row, not per-group)
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

  const visibleCount = scope === 'all'
    ? references.length
    : references.filter(r => r.area === scope).length;
  const isTextMatch = entry.entityType === 'TextMatch';

  return (
    <div className="search-result-group wu-entity-group">
      <button
        type="button"
        className="search-result-group-header wu-entity-header"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <span className={`badge ${entityBadgeColor} badge-tiny`}>
          {isTextMatch ? 'text' : entry.entityType}
        </span>
        <span className="search-result-group-name">
          {isTextMatch
            ? <>&quot;<Highlight text={entry.entityName} query={query} />&quot;</>
            : <Highlight text={entry.entityName} query={query} />}
        </span>
        {!isTextMatch && (
          <span
            className="wu-entity-ds-chip"
            onClick={e => { e.stopPropagation(); navigateToDs(); }}
            title={t.navigateToDatasource}
          >
            ← <Highlight text={entry.datasource.name} query={query} />
          </span>
        )}
        <span className="search-result-group-count">{visibleCount}</span>
      </button>

      {expanded && (
        <div className="search-result-group-body">
          {references.length === 0 ? (
            <div className="wu-empty" style={{ padding: '6px 16px' }}>
              <strong>{t.deadDatasource}:</strong> {t.deadDatasourceDesc}
            </div>
          ) : (
            fileGroups.map(([key, { configName, refs }]) => (
              <FileReferenceGroup
                key={key}
                configName={configName}
                references={refs}
                scope={scope}
                query={query}
                expandSignal={expandSignal}
                activeRefKey={activeRefKey}
                onReferenceOpen={onReferenceOpen}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FileReferenceGroup({
  configName,
  references,
  scope,
  query,
  expandSignal,
  activeRefKey,
  onReferenceOpen,
}: {
  configName: string;
  references: Reference[];
  scope: 'all' | 'mapping' | 'format';
  query: string;
  expandSignal: { version: number; expanded: boolean };
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  const visibleRefs = scope === 'all' ? references : references.filter(r => r.area === scope);
  if (visibleRefs.length === 0) return null;

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
        <span className="search-result-group-name" title={configName}>
          <Highlight text={configName} query={query} />
        </span>
        <span className="search-result-group-count">{visibleRefs.length}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {visibleRefs.map((ref, i) => (
            <ReferenceRow
              key={i}
              reference={ref}
              query={query}
              referenceKey={`${ref.area}:${configName}:${i}:${ref.shortLocation}`}
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

  const tagStyle = kindColor
    ? { background: `color-mix(in srgb, ${kindColor} 15%, var(--bg-primary))`, color: kindColor, borderColor: `color-mix(in srgb, ${kindColor} 40%, transparent)` }
    : undefined;
  const tagClass = reference.kind === 'binding' ? 'search-hit__tag--binding' : 'search-hit__tag--format';

  return (
    <button
      type="button"
      className={`search-hit ${isActive ? 'wu-ref-row--active' : ''}`}
      onClick={openReference}
      title={`${location.join(' / ')}${preview ? '\n' + preview : ''}`}
    >
      <div className="search-hit__body">
        <div className="search-hit__row1">
          <span
            className={`search-hit__tag ${tagClass}`}
            style={tagStyle}
          >
            {localizedKind}
          </span>
          <span className="search-hit__location">
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
            <span className="wu-ref-leaf">
              <Highlight text={leaf} query={query} />
            </span>
          </span>
          <ArrowRightRegular className="search-hit__arrow" />
        </div>
        {preview && (
          <div className="search-hit__expr">
            <Highlight text={preview.length > 120 ? `${preview.slice(0, 120)}…` : preview} query={query} />
          </div>
        )}
      </div>
    </button>
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

