import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentRegular,
  ArrowRightRegular,
  TextExpandRegular,
  FilterRegular,
  TextCollapseRegular,
} from '@fluentui/react-icons';
import { useAppStore, activeMappingDefinitionLabel, relatedMappingDefinitionLabels } from '../state/store';
import type { TreeNode } from '../state/store';
import type { ERConfiguration, GUIDEntry } from '@er-visualizer/core';
import { locale, t, useLocale } from '../i18n';
import { getFormatTypeThemeColor } from '../utils/theme-colors';
import { relatedConfigIndices, relatedContainerRules, hitPassesContainerRule, type ScopeContainerRule } from '../utils/model-hierarchy';
import { referenceCategory, WHERE_USED_CATEGORY_ORDER, type ReferenceCategory } from '../utils/where-used-category';
import { ExpandCollapseSlider } from './ExpandCollapseSlider';

type SearchResultEntry = {
  target: string;
  targetType: string;
  sourceConfigPath: string;
  sourceComponent: string;
  /** Mapping definition the hit was indexed in, when it came from a mapping. */
  sourceDefinition?: string;
  sourceContext: string;
};

/**
 * First node matching `predicate`, preferring the one that sits in
 * `preferredDefinition`. A mapping solution maps the same binding path in each
 * of its definitions, so an unqualified walk lands in whichever definition
 * comes first in the file instead of the one the loaded format goes through.
 */
function findTreeNodeByMatch(
  nodes: TreeNode[],
  predicate: (node: TreeNode) => boolean,
  preferredDefinition?: string,
): TreeNode | null {
  let fallback: TreeNode | null = null;

  const walk = (list: TreeNode[]): TreeNode | null => {
    for (const node of list) {
      if (predicate(node)) {
        if (!preferredDefinition || node.mappingDefinition === preferredDefinition) return node;
        fallback ??= node;
      }
      if (node.children) {
        const found = walk(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  return walk(nodes) ?? fallback;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Stable identity for a search result row, used to collapse duplicates.
 *
 * Generic "Formula" hits (calculated fields, binding/format-binding expressions)
 * are produced by scanning an expression for every `Datasource.Field`-like
 * reference it contains — a single expression with two references yields two
 * cross-refs that differ only by `target`. Since the rendered row shows the
 * whole expression once (not the individual matched identifier), those must
 * collapse into a single visible entry; `target` is excluded from their key.
 */
function getSearchResultDedupeKey(r: SearchResultEntry): string {
  if (r.targetType === 'Formula') {
    return `formula|${r.sourceConfigPath}|${r.sourceComponent}|${r.sourceContext}`;
  }
  return `${r.sourceConfigPath}|${r.target}|${r.sourceComponent}|${r.sourceContext}`;
}

type NestedResult = { entry: SearchResultEntry; children: SearchResultEntry[] };
type ExamplePreset = {
  /** What gets typed into the box. */
  query: string;
  /** The question the query answers — this is what the chip leads with. */
  label: string;
  category: string;
};

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
                key={`${category}:${item.query}`}
                type="button"
                className="search-example-chip"
                onClick={() => onApply(item.query)}
                title={item.query}
              >
                <span className="search-example-chip__label">{item.label}</span>
                <span className="search-example-chip__query">{item.query}</span>
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
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);
  const whereUsedTrigger = useAppStore(s => s.whereUsedTrigger);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);

  const [searchExpandSignal, setSearchExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [whereUsedExpandSignal, setWhereUsedExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [searchScope, setSearchScope] = useState<'all' | 'format' | 'mapping' | 'model'>('all');
  // A workspace often holds several unrelated model trees, and an unscoped
  // registry search reports hits from all of them. Default to the open
  // configuration's own tree; the "All" chip opts back into the full sweep.
  const [relatedOnly, setRelatedOnly] = useState(true);

  const activeConfigIndex = useMemo(() => {
    const tab = openTabs.find(tb => tb.id === activeTabId);
    return tab ? tab.configIndex : null;
  }, [openTabs, activeTabId]);

  const relatedFilter = useMemo(() => {
    if (activeConfigIndex == null) return null;
    const indices = relatedConfigIndices(configurations, activeConfigIndex);
    const narrowsConfigs = indices.size < configurations.length;
    // Container rules narrow *within* a related model, so they matter even
    // when every loaded configuration belongs to the same tree.
    const rules = relatedContainerRules(configurations, activeConfigIndex);
    // A mapping solution repeats the same paths in every definition, so the
    // definitions of the other model roots are noise for the active format.
    const definitions = relatedMappingDefinitionLabels(configurations, activeConfigIndex);
    if (!narrowsConfigs && rules.size === 0 && !definitions) return null;

    const paths = new Set(
      Array.from(indices).map(i => configurations[i]?.filePath).filter(Boolean) as string[],
    );
    const ruleByPath = new Map<string, ScopeContainerRule>();
    rules.forEach((rule, idx) => {
      const path = configurations[idx]?.filePath;
      if (path) ruleByPath.set(path, rule);
    });

    return {
      allowsConfigIndex: (idx: number) => !narrowsConfigs || indices.has(idx),
      // Hits outside a mapping carry no definition and are never narrowed here.
      allowsDefinition: (definition?: string) => !definition || !definitions || definitions.has(definition),
      allows: (r: SearchResultEntry) =>
        (!narrowsConfigs || paths.has(r.sourceConfigPath))
        && hitPassesContainerRule(ruleByPath.get(r.sourceConfigPath), r.sourceComponent),
    };
  }, [configurations, activeConfigIndex]);

  // The presets are framed as questions a consultant actually arrives with,
  // not as a catalogue of what the box accepts; the query itself rides along
  // as a secondary line so the mapping stays learnable.
  const searchExamples = useMemo<ExamplePreset[]>(() => {
    const cs = locale === 'cs';
    const section = cs
      ? { mapping: 'Odkud se berou data', calc: 'Výpočty a podmínky', output: 'Podoba výstupu' }
      : { mapping: 'Where the data comes from', calc: 'Calculations and conditions', output: 'Shape of the output' };
    return [
      { query: 'model.', label: cs ? 'Co všechno čte z datového modelu' : 'Everything read from the data model', category: section.mapping },
      { query: 'CompanyInfo', label: cs ? 'Kde se používají údaje o firmě' : 'Where company details are used', category: section.mapping },
      { query: '@GER_LABEL', label: cs ? 'Odkud pocházejí popisky' : 'Where labels come from', category: section.mapping },
      { query: 'ROUND', label: cs ? 'Kde se zaokrouhlují částky' : 'Where amounts get rounded', category: section.calc },
      { query: 'IF(', label: cs ? 'Podmíněná logika ve výrazech' : 'Conditional logic in expressions', category: section.calc },
      { query: 'CalculatedTotal', label: cs ? 'Počítaná pole a mezisoučty' : 'Calculated fields and subtotals', category: section.calc },
      { query: 'DATETIMEFORMAT', label: cs ? 'Formátování data a času' : 'Date and time formatting', category: section.output },
      { query: 'NUMBERFORMAT', label: cs ? 'Formátování čísel' : 'Number formatting', category: section.output },
      { query: 'CONCATENATE', label: cs ? 'Skládání textových hodnot' : 'Text values being pieced together', category: section.output },
    ];
  }, [currentLocale]);

  const whereUsedExamples = useMemo<ExamplePreset[]>(() => {
    const cs = locale === 'cs';
    const section = cs
      ? { impact: 'Dopad změny', trace: 'Dohledání hodnoty' }
      : { impact: 'Impact of a change', trace: 'Tracing a value' };
    return [
      { query: 'TaxTrans', label: cs ? 'Co se rozbije při změně tabulky' : 'What breaks if a table changes', category: section.impact },
      { query: 'NoYesEnum', label: cs ? 'Kde se opírám o výčtový typ' : 'Where an enum is relied on', category: section.impact },
      { query: 'TaxCodeGroupLookup', label: cs ? 'Kde se používá lookup' : 'Where a lookup is used', category: section.impact },
      { query: 'ReportingCurrency', label: cs ? 'Kde se uplatní parametr' : 'Where a parameter takes effect', category: section.trace },
      { query: 'ledgerAccount', label: cs ? 'Odkud se plní účet' : 'What fills the ledger account', category: section.trace },
      { query: 'CalculatedTotal', label: cs ? 'Co stojí za počítaným polem' : 'What sits behind a calculated field', category: section.trace },
    ];
  }, [currentLocale]);

  const handleSearch = useCallback(() => {
    executeSearch();
  }, [executeSearch]);

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

  // Datasources the where-used scan found but nothing references — the old
  // per-datasource card surfaced these as "dead"; keep that signal inline.
  const deadDatasources = useMemo(
    () => whereUsedResults.filter(e => e.entityType !== 'TextMatch' && e.modelPaths.length === 0 && e.formatUsages.length === 0),
    [whereUsedResults],
  );

  const whereUsedGrouping = useMemo(() => {
    const refs: Reference[] = [];
    for (const entry of whereUsedResults) {
      const dsName = entry.datasource.name;
      for (const m of entry.modelPaths) {
        refs.push({
          area: 'mapping' as const,
          kind: 'binding' as const,
          configIndex: m.configIndex,
          configName: m.configName,
          definition: m.definition,
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
            const node = findTreeNodeByMatch(
              root.children ?? [],
              n => n.type === 'binding' && n.data?.path === m.path,
              m.definition,
            );
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
    // A mapping solution holds one definition per model root (SalesInvoice,
    // TMSCommercialInvoice, …) whose datasources and bindings share names, so
    // each definition gets its own group instead of being mixed into the file.
    const map = new Map<string, { configName: string; configIndex: number; definition?: string; refs: Reference[] }>();
    for (const r of refs) {
      if (relatedOnly && relatedFilter && !relatedFilter.allowsConfigIndex(r.configIndex)) continue;
      // "Related only" means the definition the active format goes through;
      // the sibling definitions map the same paths and only add noise.
      if (relatedOnly && relatedFilter && !relatedFilter.allowsDefinition(r.definition)) continue;
      const key = `${r.configIndex}|${r.configName}|${r.definition ?? ''}`;
      const bucket = map.get(key);
      if (bucket) bucket.refs.push(r);
      else map.set(key, { configName: r.configName, configIndex: r.configIndex, definition: r.definition, refs: [r] });
    }
    return { groups: Array.from(map.entries()), totalRefs: refs.length };
  }, [whereUsedResults, treeNodes, navigateToTreeNode, relatedOnly, relatedFilter]);

  const whereUsedFileGroups = whereUsedGrouping.groups;
  // Kept unfiltered so the reach toggle survives a related-only filter that
  // hides everything — otherwise the user is stranded on "nothing found".
  const whereUsedTotalRefs = whereUsedGrouping.totalRefs;

  // Resolving a hit to its tree node walks the whole tree, so do it exactly
  // once per result set here; the grouped list below reuses the map.
  const navigableSearch = useMemo(() => {
    const seen = new Set<string>();
    const nodeByResult = new Map<SearchResultEntry, TreeNode>();
    const results = (searchResults as SearchResultEntry[]).filter(r => {
      const key = getSearchResultDedupeKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      const node = findNodeForSearchResult(r, configurations, treeNodes, registry);
      if (!node) return false;
      nodeByResult.set(r, node);
      return true;
    });
    return { results, nodeByResult };
  }, [searchResults, configurations, treeNodes, registry]);

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
                {showTechnicalDetails && (
                  <div className="search-panel__kpis">
                    <span className="search-panel__kpi">{registry.guidCount} GUID</span>
                    <span className="search-panel__kpi">{registry.crossRefCount} cross-ref</span>
                  </div>
                )}
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
                  const navigableResults = navigableSearch.results;
                  const isRelatedResult = (r: SearchResultEntry) => !relatedFilter || (
                    relatedFilter.allows(r)
                    && relatedFilter.allowsDefinition(
                      r.sourceDefinition ?? navigableSearch.nodeByResult.get(r)?.mappingDefinition,
                    )
                  );
                  // Related-only runs first so the count on the "All" chip
                  // tells the user exactly what turning it off would add.
                  const relatedResults = relatedOnly && relatedFilter
                    ? navigableResults.filter(isRelatedResult)
                    : navigableResults;
                  const hiddenByRelated = navigableResults.length - relatedResults.length;
                  // Apply scope filter
                  const scopedResults = searchScope === 'all' ? relatedResults : relatedResults.filter(r => {
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
                  // The list is capped, and the definitions of the other model
                  // roots come first in file order — without this the active
                  // definition would drop off the end when "All" is turned on.
                  const ranked = relatedFilter && !relatedOnly
                    ? [...scopedResults].sort((a, b) =>
                      Number(isRelatedResult(b)) - Number(isRelatedResult(a)))
                    : scopedResults;
                  const capped = ranked.slice(0, 100);
                  return (
                    <>
                      {/* Count, scope, reach and the expand slider on one
                          line. They used to take three, which in a 300px panel
                          left the results themselves starting below the fold. */}
                      <div className="search-panel__results-bar">
                        <span
                          className="search-panel__results-count"
                          title={capped.length < totalNested
                            ? (locale === 'cs'
                              ? `Zobrazeno prvních ${capped.length} z ${totalNested}`
                              : `Showing first ${capped.length} of ${totalNested}`)
                            : undefined}
                        >
                          {capped.length < totalNested
                            ? `${capped.length} / ${totalNested}`
                            : t.searchResultCount(totalNested)}
                        </span>
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
                          {relatedFilter && (
                            /* Two labelled buttons for a two-state switch cost
                               more than the state is worth in this column; the
                               badge says how many hits the filter is holding
                               back, the tooltip says what it does. */
                            <button
                              type="button"
                              className={`search-reach-toggle ${relatedOnly ? 'active' : ''}`}
                              aria-pressed={relatedOnly}
                              onClick={() => setRelatedOnly(v => !v)}
                              title={relatedOnly
                                ? `${t.searchRelatedOnly} — ${t.searchAllConfigsHint}`
                                : `${t.searchAllConfigs} — ${t.searchRelatedOnlyHint}`}
                            >
                              <FilterRegular fontSize={14} />
                              {relatedOnly && hiddenByRelated > 0 && (
                                <span className="search-reach-toggle__badge">{hiddenByRelated}</span>
                              )}
                            </button>
                          )}
                          <ExpandCollapseSlider
                            size="compact"
                            expandLabel={t.expand}
                            collapseLabel={t.collapse}
                            expandIcon={<TextExpandRegular fontSize={16} />}
                            collapseIcon={<TextCollapseRegular fontSize={16} />}
                            onExpand={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: true }))}
                            onCollapse={() => setSearchExpandSignal(s => ({ version: s.version + 1, expanded: false }))}
                          />
                        </div>
                      </div>
                      <div className="search-panel__results">
                        {scopedResults.length === 0 ? (
                          <div className="search-panel__empty">
                            {navigableResults.length === 0 ? t.noResults : t.searchNoResultsInScope}
                          </div>
                        ) : (
                          <SearchResultsGrouped
                            results={capped}
                            nodeByResult={navigableSearch.nodeByResult}
                            totalCount={totalNested}
                            query={searchQuery}
                            expandSignal={searchExpandSignal}
                            configurations={configurations}
                            registry={registry}
                            navigateToTreeNode={navigateToTreeNode}
                          />
                        )}
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

            {(whereUsedFileGroups.length > 0 || whereUsedTotalRefs > 0) && (() => {
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
                  </div>
                  <div className="search-panel__reach">
                    {relatedFilter && (
                      <div className="search-scope-toggle" role="group" aria-label={locale === 'cs' ? 'Rozsah hledání' : 'Search reach'}>
                        <button
                          type="button"
                          className={`search-scope-toggle__btn ${relatedOnly ? 'active' : ''}`}
                          onClick={() => setRelatedOnly(true)}
                          title={t.searchRelatedOnlyHint}
                        >
                          {t.searchRelatedOnly}
                        </button>
                        <button
                          type="button"
                          className={`search-scope-toggle__btn ${relatedOnly ? '' : 'active'}`}
                          onClick={() => setRelatedOnly(false)}
                          title={t.searchAllConfigsHint}
                        >
                          {t.searchAllConfigs}
                        </button>
                      </div>
                    )}
                    <div className="search-panel__results-actions">
                      <ExpandCollapseSlider
                        size="compact"
                        expandLabel={t.expand}
                        collapseLabel={t.collapse}
                        expandIcon={<TextExpandRegular fontSize={16} />}
                        collapseIcon={<TextCollapseRegular fontSize={16} />}
                        onExpand={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: true }))}
                        onCollapse={() => setWhereUsedExpandSignal(s => ({ version: s.version + 1, expanded: false }))}
                      />
                    </div>
                  </div>
                  <div className="search-panel__results">
                    <div className="search-results">
                      {whereUsedFileGroups.length === 0 && (
                        // Everything was filtered out by "Related only"; the
                        // toggle above stays reachable so this is not a dead end.
                        <div className="search-panel__empty">{t.searchRelatedEmpty}</div>
                      )}
                      {whereUsedFileGroups.map(([key, { configName, definition, refs }]) => (
                        <FileReferenceGroup
                          key={key}
                          configName={configName}
                          definition={definition}
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

            {deadDatasources.length > 0 && trimmedCurrentQuery && (
              <div className="wu-empty search-panel__dead-datasources">
                {deadDatasources.map(e => (
                  <div key={`${e.datasource.configIndex}|${e.datasource.parentPath ?? ''}|${e.datasource.name}`}>
                    <strong>{t.deadDatasource}:</strong>{' '}
                    <Highlight text={e.datasource.name} query={whereUsedQuery} />
                    {' '}<span className="search-panel__dead-datasources-config">({e.datasource.configName})</span>
                    {' — '}{t.deadDatasourceDesc}
                  </div>
                ))}
              </div>
            )}

            {whereUsedFileGroups.length === 0 && whereUsedTotalRefs === 0 && deadDatasources.length === 0 && trimmedCurrentQuery && (
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
  nodeByResult,
  totalCount,
  query,
  expandSignal,
  configurations,
  registry,
  navigateToTreeNode,
}: {
  /** Already deduplicated and filtered to navigable hits. */
  results: SearchResultEntry[];
  /** Tree node for each result, resolved once by the panel. */
  nodeByResult: Map<SearchResultEntry, TreeNode>;
  totalCount: number;
  query: string;
  expandSignal: { version: number; expanded: boolean };
  configurations: ERConfiguration[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const groups = useMemo(() => {
    // Group by config file name + kind + mapping definition. A mapping
    // solution holds one definition per model root (SalesInvoice,
    // TMSCommercialInvoice, …) whose datasources and bindings share names, so
    // folding them into one group would make the hits unreadable.
    const map = new Map<string, { configPath: string; kind: string; definition?: string; items: SearchResultEntry[] }>();
    for (const r of results) {
      const configPath = r.sourceConfigPath || '—';
      const fileName = configPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, '') ?? configPath;
      const configDef = configurations.find(c => c.filePath === configPath);
      const kind = (configDef as any)?.kind ?? '';
      // The registry stamps the definition a mapping hit came from; fall back
      // to the resolved node for hits indexed without one.
      const definition = r.sourceDefinition ?? nodeByResult.get(r)?.mappingDefinition;
      const key = `${fileName}__${kind}__${definition ?? ''}`;
      const existing = map.get(key);
      if (existing) existing.items.push(r);
      else map.set(key, { configPath, kind, definition, items: [r] });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].items.length - a[1].items.length);
  }, [results, configurations, nodeByResult]);

  return (
    <div className="search-results">
      {groups.map(([key, { configPath, kind, definition, items }]) => {
        const fileName = configPath.split(/[\\/]/).pop()?.replace(/\.xml$/i, '') ?? configPath;
        return (
          <SearchResultGroup
            key={key}
            configPath={configPath}
            fileName={fileName}
            configKind={kind}
            definition={definition}
            items={items}
            nodeByResult={nodeByResult}
            query={query}
            expandSignal={expandSignal}
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

type HitCategory = 'structure' | 'bindings' | 'expressions' | 'datasources' | 'references';

type ParsedHit = {
  /** Short tag label shown in the kind chip (e.g. "Tabulka", "Vazba", "Výraz") */
  label: string;
  /** CSS modifier for colour coding (reuses badge colour keys) */
  labelKind: string;
  /** Which section the hit is filed under inside its configuration group. */
  category: HitCategory;
  /** Primary location text — the path/name of where the match lives */
  location: string;
  /** Optional secondary line — the expression or value that contains the query */
  expression: string;
  /** Designer tab where the user will land: 'structure' | 'bindings' | 'datasources' | null */
  tab: 'structure' | 'bindings' | 'datasources' | null;
};

const HIT_CATEGORY_ORDER: HitCategory[] = ['structure', 'bindings', 'expressions', 'datasources', 'references'];

function hitCategoryLabel(category: HitCategory): string {
  switch (category) {
    case 'structure': return t.searchCatStructure;
    case 'bindings': return t.searchCatBindings;
    case 'expressions': return t.searchCatExpressions;
    case 'datasources': return t.searchCatDatasources;
    default: return t.searchCatReferences;
  }
}

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
    return { label: cs ? 'Tabulka' : 'Table', labelKind: 'table', category: 'datasources', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^Datasource ".+" uses enum "/.test(ctx)) {
    return { label: cs ? 'Výčet' : 'Enum', labelKind: 'enum', category: 'datasources', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^Datasource ".+" uses class "/.test(ctx)) {
    return { label: cs ? 'Třída' : 'Class', labelKind: 'class', category: 'datasources', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }
  if (/^User parameter ".+" uses EDT "/.test(ctx)) {
    return { label: 'EDT', labelKind: 'edt', category: 'datasources', location: tgt, expression: cs ? `parametr: ${comp}` : `param: ${comp}`, tab: 'datasources' };
  }
  if (ctx.startsWith('Selected field in datasource "')) {
    return { label: cs ? 'Pole' : 'Field', labelKind: 'field', category: 'datasources', location: tgt, expression: cs ? `zdroj: ${comp}` : `source: ${comp}`, tab: 'datasources' };
  }

  // ── Model binding: "Binding: path = expr" ─────────────────────────
  if (ctx.startsWith('Binding: ')) {
    const rest = ctx.slice('Binding: '.length);
    const eq   = rest.indexOf(' = ');
    const path = eq >= 0 ? rest.slice(0, eq) : rest;
    const expr = eq >= 0 ? rest.slice(eq + 3) : '';
    return { label: cs ? 'Vazba' : 'Binding', labelKind: 'binding', category: 'bindings', location: path, expression: expr, tab: 'bindings' as const };
  }

  // ── Formula inside binding: "Binding for path: expr" ──────────────
  if (ctx.startsWith('Binding for ')) {
    const rest = ctx.slice('Binding for '.length);
    const col  = rest.indexOf(':');
    const path = col >= 0 ? rest.slice(0, col).trim() : rest;
    const expr = col >= 0 ? rest.slice(col + 1).trim() : '';
    return { label: cs ? 'Výraz' : 'Expression', labelKind: 'formula', category: 'expressions', location: path, expression: expr, tab: 'bindings' as const };
  }

  // ── Format binding expression (optionally with [PropName]) ────────
  if (ctx.startsWith('Format binding') && ctx.includes('expression')) {
    const expr = ctx.slice(ctx.indexOf('expression') + 'expression'.length).replace(/^[\s:]+/, '').trim();
    // Extract optional property name from "Format binding [PropName] expression"
    const propMatch = ctx.match(/Format binding \[([^\]]+)\] expression/);
    const prop = propMatch?.[1] ?? '';
    const { label, labelKind } = formatBindingLabel(prop, cs);
    return { label, labelKind, category: 'bindings' as const, location: comp, expression: expr, tab: 'bindings' as const };
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
      category: 'bindings' as const,
      location: resolved?.name ?? comp,
      expression: expr,
      tab: 'bindings' as const,
    };
  }

  // ── Calculated field ──────────────────────────────────────────────
  if (ctx.startsWith('Calculated field expression:')) {
    const expr = ctx.slice('Calculated field expression:'.length).trim();
    return { label: cs ? 'Výpočet' : 'Calc. field', labelKind: 'formula', category: 'expressions', location: comp, expression: expr, tab: 'datasources' as const };
  }

  // ── TypeDescriptor ────────────────────────────────────────────────
  if (ctx === 'TypeDescriptor reference in model field') {
    return { label: cs ? 'Typ pole' : 'Field type', labelKind: 'field', category: 'structure', location: comp, expression: tgt, tab: 'structure' as const };
  }

  // ── Structural references ─────────────────────────────────────────
  if (ctx === 'Model mapping references data model') {
    return { label: cs ? 'Model' : 'Model ref', labelKind: 'model', category: 'references', location: comp, expression: '', tab: null };
  }
  if (ctx === 'Base model reference') {
    return { label: cs ? 'Základ' : 'Base ref', labelKind: 'model', category: 'references', location: comp, expression: '', tab: null };
  }
  if (ctx === 'Format mapping references format definition') {
    return { label: cs ? 'Formát' : 'Format ref', labelKind: 'format', category: 'references', location: comp, expression: '', tab: null };
  }

  // ── Generic formula: "context label: expr" ────────────────────────
  if (result.targetType === 'Formula') {
    const col  = ctx.indexOf(':');
    const expr = col >= 0 ? ctx.slice(col + 1).trim() : ctx;
    return { label: cs ? 'Výraz' : 'Expression', labelKind: 'formula', category: 'expressions', location: comp, expression: expr, tab: 'datasources' as const };
  }

  // ── GUID fallback ─────────────────────────────────────────────────
  if (result.targetType === 'GUID') {
    const resolved = registry.lookup(tgt);
    return {
      label: resolved?.kind ?? 'GUID',
      labelKind: 'guid',
      category: 'references' as const,
      location: resolved?.name ?? tgt,
      expression: '',
      tab: null,
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────
  return {
    label: result.targetType ?? '',
    labelKind: (result.targetType ?? '').toLowerCase(),
    category: 'references' as const,
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

/** Names the mapping definition (model root) a group of hits belongs to. The
 *  definitions of one solution reuse datasource and binding names, so this is
 *  what tells two otherwise identical rows apart. */
function MappingDefinitionChip({ definition }: { definition?: string }) {
  if (!definition) return null;
  return (
    <span className="search-result-group-model" title={t.searchGroupDefinitionHint(definition)}>
      {t.searchGroupDefinition(definition)}
    </span>
  );
}

function SearchResultGroup({
  configPath,
  fileName,
  configKind,
  definition,
  items,
  nodeByResult,
  query,
  expandSignal,
  registry,
  navigateToTreeNode,
}: {
  configPath: string;
  fileName: string;
  configKind: string;
  /** Mapping definition these hits come from; absent outside mappings. */
  definition?: string;
  items: SearchResultEntry[];
  nodeByResult: Map<SearchResultEntry, TreeNode>;
  query: string;
  expandSignal: { version: number; expanded: boolean };
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Items arrive deduplicated and navigable; the node lookup was done once by
  // the panel so no row (or group) walks the tree again. Splitting them by hit
  // category turns one long mixed list into short, self-describing sections.
  const sections = useMemo(() => {
    const nested = nestBindingResults(items.filter(r => nodeByResult.has(r)));
    const byCategory = new Map<HitCategory, Array<{ entry: SearchResultEntry; node: TreeNode; hit: ParsedHit }>>();
    for (const n of nested) {
      const hit = parseSearchHit(n.entry, registry);
      const bucket = byCategory.get(hit.category) ?? [];
      bucket.push({ entry: n.entry, node: nodeByResult.get(n.entry)!, hit });
      byCategory.set(hit.category, bucket);
    }
    return HIT_CATEGORY_ORDER
      .filter(category => byCategory.has(category))
      .map(category => ({ category, rows: byCategory.get(category)! }));
  }, [items, nodeByResult, registry]);

  const totalRows = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections]);

  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  if (totalRows === 0) return null;

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
        <MappingDefinitionChip definition={definition} />
        <span className="search-result-group-count">{totalRows}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {sections.map(({ category, rows }) => (
            <div key={category} className={`search-cat search-cat--${category}`}>
              <div className="search-cat__header">
                <span className="search-cat__marker" aria-hidden="true" />
                <span className="search-cat__title">{hitCategoryLabel(category)}</span>
                <span className="search-cat__count">{rows.length}</span>
              </div>
              <div className="search-cat__rows">
                {rows.map(({ entry, node, hit }, i) => (
                  <SearchResultCard
                    key={`${entry.target}:${entry.sourceComponent}:${i}`}
                    hit={hit}
                    result={entry}
                    targetNode={node}
                    query={query}
                    navigateToTreeNode={navigateToTreeNode}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({
  hit,
  result,
  targetNode,
  query,
  navigateToTreeNode,
}: {
  /** Parsed once by the group so the section split and the row agree. */
  hit: ParsedHit;
  result: SearchResultEntry;
  /** Resolved by the group memo — do not re-walk the tree per row. */
  targetNode: TreeNode;
  query: string;
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const shortExpr = hit.expression.length > 100 ? `${hit.expression.slice(0, 100)}…` : hit.expression;
  // A few cross-ref shapes carry the match only in the component name, which
  // leaves the primary line blank; fall back so a row is never nameless.
  const location = hit.location || result.sourceComponent || result.target;
  const showExpr = shortExpr && shortExpr !== location;

  if (!targetNode) return null;

  const cs = locale === 'cs';
  // The destination tab is already implied by the section the row sits in, so
  // only spell it out when it says something the section header does not.
  const tabLabel = hit.tab === hit.category ? null
    : hit.tab === 'structure' ? (cs ? 'Struktura' : 'Structure')
    : hit.tab === 'bindings' ? (cs ? 'Vazby' : 'Bindings')
    : hit.tab === 'datasources' ? (cs ? 'Datové zdroje' : 'Data Sources')
    : null;

  // Structure, binding and expression rows carry a tag that restates their
  // section; the section header and the row tint already say it. Data source
  // and reference tags survive because they discriminate within their section
  // (table vs enum vs class, format vs model vs mapping).
  const showTag = hit.category === 'datasources' || hit.category === 'references';

  return (
    <button
      type="button"
      className={`search-hit search-hit--${hit.category}`}
      onClick={() => navigateToTreeNode(targetNode.id)}
      title={result.sourceComponent || result.target}
    >
      <div className="search-hit__body">
        <div className="search-hit__row1">
          <span className="search-hit__location">
            <Highlight text={location} query={query} />
          </span>
          {showTag && <span className={`search-hit__tag search-hit__tag--${hit.labelKind}`}>{hit.label}</span>}
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
  /** Mapping definition (`Name [DataContainerDescriptor]`) the reference sits in. */
  definition?: string;
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

/** Which section a where-used reference belongs to — see
 *  `utils/where-used-category`, which owns the rule so it can be tested
 *  without mounting the panel. */
function referenceCategoryLabel(category: ReferenceCategory): string {
  switch (category) {
    case 'bindings': return t.wuCatBindings;
    case 'expressions': return t.wuCatExpressions;
    default: return t.wuCatFormat;
  }
}

/** Expand the terse kind codes the where-used scan emits. They only ever show
 *  up inside the expressions section, where they are the one thing telling the
 *  rows apart. */
function toLocalizedRefKind(ref: Reference): string {
  if (ref.kind === 'formatElement') return ref.kindLabel;
  const cs = locale === 'cs';
  switch (ref.kindLabel.trim().toLowerCase()) {
    case 'calc': return cs ? 'Výpočet' : 'Calculated';
    case 'param': return cs ? 'Parametr' : 'Parameter';
    case 'agg': return cs ? 'Agregace' : 'Aggregation';
    case 'validation': return cs ? 'Validace' : 'Validation';
    case 'message': return cs ? 'Zpráva' : 'Message';
    default: return toLocalizedBindingKind(ref.kindLabel);
  }
}

function FileReferenceGroup({
  configName,
  definition,
  references,
  scope,
  query,
  expandSignal,
  activeRefKey,
  onReferenceOpen,
}: {
  configName: string;
  /** Mapping definition the group belongs to; absent for format-only groups. */
  definition?: string;
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

  const visibleRefs = useMemo(
    () => (scope === 'all' ? references : references.filter(r => r.area === scope)),
    [references, scope],
  );

  const sections = useMemo(() => {
    const byCategory = new Map<ReferenceCategory, Reference[]>();
    for (const ref of visibleRefs) {
      const category = referenceCategory(ref);
      const bucket = byCategory.get(category) ?? [];
      bucket.push(ref);
      byCategory.set(category, bucket);
    }
    return WHERE_USED_CATEGORY_ORDER
      .filter(category => byCategory.has(category))
      .map(category => ({ category, refs: byCategory.get(category)! }));
  }, [visibleRefs]);

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
        <MappingDefinitionChip definition={definition} />
        <span className="search-result-group-count">{visibleRefs.length}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {sections.map(({ category, refs }) => (
            <div key={category} className={`search-cat search-cat--${category}`}>
              <div className="search-cat__header">
                <span className="search-cat__marker" aria-hidden="true" />
                <span className="search-cat__title">{referenceCategoryLabel(category)}</span>
                <span className="search-cat__count">{refs.length}</span>
              </div>
              <div className="search-cat__rows">
                {refs.map((ref, i) => (
                  <ReferenceRow
                    key={`${category}:${i}`}
                    reference={ref}
                    category={category}
                    query={query}
                    referenceKey={`${ref.area}:${configName}:${category}:${i}:${ref.shortLocation}`}
                    activeRefKey={activeRefKey}
                    onReferenceOpen={onReferenceOpen}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceRow({
  reference,
  category,
  query,
  referenceKey,
  activeRefKey,
  onReferenceOpen,
}: {
  reference: Reference;
  category: ReferenceCategory;
  query: string;
  referenceKey: string;
  activeRefKey: string | null;
  onReferenceOpen: (key: string) => void;
}) {
  const { location, preview, kindColor, onOpen } = reference;
  const breadcrumb = location.slice(0, -1);
  const leaf = location[location.length - 1] ?? '';
  const localizedKind = toLocalizedRefKind(reference);
  const isActive = activeRefKey === referenceKey;

  const openReference = () => {
    onReferenceOpen(referenceKey);
    onOpen();
  };

  const tagStyle = kindColor
    ? { background: `color-mix(in srgb, ${kindColor} 15%, var(--bg-primary))`, color: kindColor, borderColor: `color-mix(in srgb, ${kindColor} 40%, transparent)` }
    : undefined;
  const tagClass = reference.kind === 'binding' ? 'search-hit__tag--binding' : 'search-hit__tag--format';
  // In the bindings section every row is a plain binding, so the chip would
  // only echo the section header and the row tint. Elsewhere it discriminates
  // (calc vs validation, Sequence vs Excel Cell) and stays.
  const showTag = category !== 'bindings';

  return (
    <button
      type="button"
      className={`search-hit search-hit--${category} ${isActive ? 'wu-ref-row--active' : ''}`}
      onClick={openReference}
      title={`${location.join(' / ')}${preview ? '\n' + preview : ''}`}
    >
      {/* Leaf first: in a narrow side panel the element you searched for has to
          survive truncation, so the ancestor path moves to its own muted line. */}
      <div className="search-hit__body">
        <div className="search-hit__row1">
          <span className="wu-ref-leaf">
            <Highlight text={leaf} query={query} />
          </span>
          {showTag && (
            <span
              className={`search-hit__tag ${tagClass}`}
              style={tagStyle}
            >
              {localizedKind}
            </span>
          )}
          <ArrowRightRegular className="search-hit__arrow" />
        </div>
        {breadcrumb.length > 0 && (
          <div className="wu-ref-breadcrumb">
            {breadcrumb.map((seg, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="wu-ref-bc-sep">/</span>}
                <span className="wu-ref-bc-seg"><Highlight text={seg} query={query} /></span>
              </React.Fragment>
            ))}
          </div>
        )}
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
  // The same binding path is mapped in every definition of a mapping solution;
  // resolve against the one the loaded format goes through.
  const preferred = result.sourceDefinition
    ?? activeMappingDefinitionLabel(configurations as ERConfiguration[], configIndex);
  const find = (predicate: (node: TreeNode) => boolean) =>
    findTreeNodeByMatch(rootNode.children ?? [], predicate, preferred);

  if (result.sourceContext === 'TypeDescriptor reference in model field') {
    return findFieldNode(rootNode, result.sourceComponent);
  }

  if (result.sourceContext === 'Model mapping references data model') {
    return find(node => node.type === 'mapping')
      ?? (rootNode.data?.kind === 'ModelMapping' ? rootNode : null);
  }

  if (result.sourceContext === 'Format mapping references format definition') {
    return find(node => node.type === 'format')
      ?? (rootNode.data?.kind === 'Format' ? rootNode : null);
  }

  if (result.sourceContext === 'Base model reference') {
    return rootNode;
  }

  if (result.sourceContext.startsWith('Binding:')) {
    return find(node => node.type === 'binding' && node.data?.path === result.target);
  }

  if (result.sourceContext.startsWith('Binding for ')) {
    const bindingPath = result.sourceContext.slice('Binding for '.length).split(':')[0]?.trim();
    if (bindingPath) {
      return find(node => node.type === 'binding' && node.data?.path === bindingPath);
    }
  }

  if (result.sourceContext.startsWith('Format binding to component:')) {
    return find(node =>
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
      ?? find(node =>
        (node.type === 'formatElement' && node.data?.id === result.target)
        || node.data?.id === result.target,
      );
    if (guidNode) return guidNode;
  }

  if (result.targetType === 'ModelPath') {
    const bindingNode = find(node => node.type === 'binding' && node.data?.path === result.target);
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
      const bindingNode = find(node => node.type === 'binding' && node.data?.path === bindingPath);
      if (bindingNode) return bindingNode;
    }
  }

  return find(node => node.type === 'datasource' && node.name === result.sourceComponent);
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

