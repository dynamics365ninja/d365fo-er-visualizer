import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentRegular,
  ArrowRightRegular,
  TextExpandRegular,
  FilterRegular,
  TextCollapseRegular,
} from '@fluentui/react-icons';
import { useAppStore, focusedTabId, relatedMappingDefinitionLabels, MIN_SEARCH_QUERY_LENGTH } from '../state/store';
import type { TreeNode } from '../state/store';
import { t, useLocale } from '../i18n';
import { getConsultantFormatTypeLabel } from '../utils/consultant-labels';
import { getFormatTypeThemeColor } from '../utils/theme-colors';
import { relatedConfigIndices, relatedContainerRules, hitPassesContainerRule } from '../utils/model-hierarchy';
import { referenceCategory, WHERE_USED_CATEGORY_ORDER, type ReferenceCategory } from '../utils/where-used-category';
import { ExpandCollapseSlider } from './ExpandCollapseSlider';
import { useSearchFocusTarget } from '../utils/search-focus';
import { WhereUsedView } from './WhereUsedView';

const SEARCH_PAGE_SIZE = 100;
import { buildSearchIndex, searchIndex, SEARCH_CATEGORY_ORDER, type SearchCategory, type SearchDoc } from '../utils/search-index';
import { SearchResultsView } from './SearchResultsView';


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

type ExamplePreset = {
  /** What gets typed into the box. */
  query: string;
  /** The question the query answers — this is what the chip leads with. */
  label: string;
  category: string;
};

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
  const inputRef = useRef<HTMLInputElement>(null);
  useSearchFocusTarget(inputRef);
  // Results are shown a page at a time; a new query or scope starts over.
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE);
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const mode = useAppStore(s => s.searchPanelMode);
  const setMode = useAppStore(s => s.setSearchPanelMode);
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
  const whereUsedTarget = useAppStore(s => s.whereUsedTarget);
  const [impactEmpty, setImpactEmpty] = useState(false);
  const consumeWhereUsedTrigger = useAppStore(s => s.consumeWhereUsedTrigger);
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(focusedTabId);

  const [searchExpandSignal, setSearchExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [whereUsedExpandSignal, setWhereUsedExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [searchCategory, setSearchCategory] = useState<'all' | SearchCategory>('all');
  // A workspace often holds several unrelated model trees, and an unscoped
  // search reports hits from all of them. Default to the open configuration's
  // own tree; the "All" chip opts back into the full sweep.
  const [searchRelatedOnly, setSearchRelatedOnly] = useState(true);
  // Where-used answers "what breaks if this changes" — across every loaded
  // configuration by default; the related-only reach is one click away.
  const [whereUsedRelatedOnly, setWhereUsedRelatedOnly] = useState(false);
  const relatedOnly = mode === 'search' ? searchRelatedOnly : whereUsedRelatedOnly;
  const setRelatedOnly = mode === 'search' ? setSearchRelatedOnly : setWhereUsedRelatedOnly;
  useEffect(() => { setResultLimit(SEARCH_PAGE_SIZE); }, [searchQuery, searchCategory, relatedOnly]);

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

    const allowsConfigIndex = (idx: number) => !narrowsConfigs || indices.has(idx);
    // Hits outside a mapping carry no definition and are never narrowed here.
    const allowsDefinition = (definition?: string) => !definition || !definitions || definitions.has(definition);
    return {
      allowsConfigIndex,
      allowsDefinition,
      allowsDoc: (doc: SearchDoc) =>
        allowsConfigIndex(doc.configIndex)
        && allowsDefinition(doc.definition)
        // Records of the model the active format does not reach are noise.
        && (doc.category !== 'model' || hitPassesContainerRule(rules.get(doc.configIndex), doc.path ?? doc.name)),
    };
  }, [configurations, activeConfigIndex]);

  // The presets are framed as questions a consultant actually arrives with,
  // not as a catalogue of what the box accepts; the query itself rides along
  // as a secondary line so the mapping stays learnable.
  const searchExamples = useMemo<ExamplePreset[]>(() => {
    const section = t.searchExampleSections;
    const label = t.searchExamplePresets;
    return [
      { query: 'model.', label: label.model, category: section.mapping },
      { query: 'CompanyInfo', label: label.companyInfo, category: section.mapping },
      { query: '@GER_LABEL', label: label.labels, category: section.mapping },
      { query: 'ROUND', label: label.round, category: section.calc },
      { query: 'IF(', label: label.conditional, category: section.calc },
      { query: 'CalculatedTotal', label: label.calculated, category: section.calc },
      { query: 'DATETIMEFORMAT', label: label.dateFormat, category: section.output },
      { query: 'NUMBERFORMAT', label: label.numberFormat, category: section.output },
      { query: 'CONCATENATE', label: label.concatenate, category: section.output },
    ];
    // `t` is swapped on a language switch; currentLocale is what tells the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocale]);

  const whereUsedExamples = useMemo<ExamplePreset[]>(() => {
    const section = t.whereUsedExampleSections;
    const label = t.whereUsedExamplePresets;
    return [
      { query: 'TaxTrans', label: label.table, category: section.impact },
      { query: 'NoYesEnum', label: label.enumType, category: section.impact },
      { query: 'TaxCodeGroupLookup', label: label.lookup, category: section.impact },
      { query: 'ReportingCurrency', label: label.parameter, category: section.trace },
      { query: 'ledgerAccount', label: label.ledgerAccount, category: section.trace },
      { query: 'CalculatedTotal', label: label.calculated, category: section.trace },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocale]);

  // The panel unmounts whenever the right pane shows Properties, so a trigger
  // is acknowledged in the store once run — remounting must not replay it.
  useEffect(() => {
    if (!whereUsedTrigger || whereUsedTrigger.consumed) return;
    consumeWhereUsedTrigger(whereUsedTrigger.version);
    setMode('where-used');
    executeWhereUsed(whereUsedTrigger.query, whereUsedTrigger.target ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whereUsedTrigger?.version]);

  const applySearchExample = useCallback((value: string) => {
    setMode('search');
    setSearchQuery(value);
  }, [setSearchQuery, setMode]);

  const applyWhereUsedExample = useCallback((value: string) => {
    setMode('where-used');
    executeWhereUsed(value);
  }, [executeWhereUsed, setMode]);

  useEffect(() => {
    if (mode !== 'where-used') return;
    const handle = window.setTimeout(() => {
      executeWhereUsed();
    }, 250);

    return () => window.clearTimeout(handle);
  }, [executeWhereUsed, mode, whereUsedQuery]);

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

  // The index is built once per configuration set; typing only filters it.
  const fullTextIndex = useMemo(() => buildSearchIndex(configurations), [configurations]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchActive = mode === 'search' && deferredSearchQuery.trim().length >= MIN_SEARCH_QUERY_LENGTH;
  const allMatches = useMemo(
    () => (searchActive ? searchIndex(fullTextIndex, deferredSearchQuery) : []),
    [searchActive, fullTextIndex, deferredSearchQuery],
  );
  const relatedMatches = useMemo(
    () => (relatedOnly && relatedFilter ? allMatches.filter(match => relatedFilter.allowsDoc(match.doc)) : allMatches),
    [allMatches, relatedOnly, relatedFilter],
  );
  const hiddenByRelated = allMatches.length - relatedMatches.length;
  const categoryCounts = useMemo(() => {
    const counts = new Map<SearchCategory, number>();
    for (const match of relatedMatches) counts.set(match.doc.category, (counts.get(match.doc.category) ?? 0) + 1);
    return counts;
  }, [relatedMatches]);
  const visibleMatches = useMemo(
    () => (searchCategory === 'all' ? relatedMatches : relatedMatches.filter(match => match.doc.category === searchCategory)),
    [relatedMatches, searchCategory],
  );

  const currentQuery = mode === 'search' ? searchQuery : whereUsedQuery;
  const trimmedCurrentQuery = currentQuery.trim();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (mode === 'search') setSearchQuery(e.target.value);
    else setWhereUsedQuery(e.target.value);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (mode === 'where-used') executeWhereUsed(whereUsedQuery);
    } else if (e.key === 'Escape') {
      // First Escape clears the query, the next one leaves the box.
      e.preventDefault();
      if (currentQuery) handleClear();
      else e.currentTarget.blur();
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
            ref={inputRef}
            type="text"
            data-search-input="true"
            aria-label={mode === 'search' ? t.searchPlaceholder : t.whereUsedPlaceholder}
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
                <p className="search-panel__hint">{t.searchIntro}</p>
                {showTechnicalDetails && (
                  <div className="search-panel__kpis">
                    <span className="search-panel__kpi">{fullTextIndex.docs.length} docs</span>
                  </div>
                )}
                <ExamplePalette
                  title={t.examples}
                  examples={searchExamples}
                  onApply={applySearchExample}
                />
              </>
            )}

            {trimmedCurrentQuery && trimmedCurrentQuery.length < MIN_SEARCH_QUERY_LENGTH && (
              <p className="search-panel__hint">{t.searchMinChars(MIN_SEARCH_QUERY_LENGTH)}</p>
            )}

            {searchActive && (
              <>
                {/* Count, kind facets, reach and the expand slider: what the
                    list holds, and the two ways to narrow it. */}
                <div className="search-panel__results-bar">
                  <span className="search-panel__results-count">
                    {visibleMatches.length > resultLimit
                      ? `${resultLimit} / ${visibleMatches.length}`
                      : t.searchResultCount(visibleMatches.length)}
                  </span>
                  <div className="search-panel__results-actions">
                    {relatedFilter && (
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
                <div className="search-facets" role="group" aria-label={t.searchFacetsAria}>
                  {(['all', ...SEARCH_CATEGORY_ORDER] as const).map(category => {
                    const count = category === 'all' ? relatedMatches.length : (categoryCounts.get(category) ?? 0);
                    if (category !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={category}
                        type="button"
                        className={`search-facet search-facet--${category} ${searchCategory === category ? 'active' : ''}`}
                        aria-pressed={searchCategory === category}
                        onClick={() => setSearchCategory(category)}
                      >
                        {t.searchCategoryShort[category]}
                        <span className="search-facet__count">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="search-panel__results">
                  {visibleMatches.length === 0 ? (
                    <div className="search-panel__empty">
                      {allMatches.length === 0 ? t.noResults : relatedMatches.length === 0 ? t.searchRelatedEmpty : t.searchNoResultsInScope}
                    </div>
                  ) : (
                    <>
                      <SearchResultsView
                        matches={visibleMatches.slice(0, resultLimit)}
                        query={deferredSearchQuery}
                        expandSignal={searchExpandSignal}
                        configurations={configurations}
                      />
                      {visibleMatches.length > resultLimit && (
                        <button
                          type="button"
                          className="search-panel__more"
                          onClick={() => setResultLimit(limit => limit + SEARCH_PAGE_SIZE)}
                        >
                          {t.searchShowMore(Math.min(visibleMatches.length - resultLimit, SEARCH_PAGE_SIZE), visibleMatches.length - resultLimit)}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Where-used mode ── */}
        {mode === 'where-used' && (
          <>
            {!trimmedCurrentQuery && !whereUsedTarget && (
              <>
                <p className="search-panel__hint">{t.impactIntro}</p>
                <ExamplePalette
                  title={t.examples}
                  examples={whereUsedExamples}
                  onApply={applyWhereUsedExample}
                />
              </>
            )}

            {(trimmedCurrentQuery || whereUsedTarget) && (
              <>
                <div className="search-panel__results-bar">
                  <div className="search-scope-toggle" role="group" aria-label={t.whereUsedScopeAria}>
                    {(['all', 'mapping', 'format'] as const).map(s => (
                      <button key={s} type="button"
                        className={`search-scope-toggle__btn ${whereUsedScope === s ? 'active' : ''}`}
                        onClick={() => setWhereUsedScope(s)}
                      >
                        {s === 'all' ? t.searchScopeAll
                          : s === 'mapping' ? t.searchScopeMapping
                          : t.searchScopeFormat}
                      </button>
                    ))}
                  </div>
                  {relatedFilter && (
                    <div className="search-scope-toggle" role="group" aria-label={t.searchReachAria}>
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
                  <WhereUsedView
                    query={whereUsedQuery}
                    target={whereUsedTarget}
                    scope={whereUsedScope}
                    filter={relatedOnly ? relatedFilter : null}
                    expandSignal={whereUsedExpandSignal}
                    onEmpty={setImpactEmpty}
                  />

                  {whereUsedFileGroups.length > 0 && (
                    <details className="impact-text" open={impactEmpty}>
                      <summary title={t.impactTextHint}>{t.impactTextSection(whereUsedFileGroups.reduce((n, [, g]) => n + g.refs.length, 0))}</summary>
                      <div className="search-results">
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
                    </details>
                  )}

                  {impactEmpty && whereUsedFileGroups.length === 0 && trimmedCurrentQuery && (
                    <div className="search-panel__empty">
                      {relatedOnly && relatedFilter && whereUsedTotalRefs > 0 ? t.searchRelatedEmpty : t.impactNoMatch(whereUsedQuery)}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
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
  return t.searchLocalizeBindingKind(label);
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
function toLocalizedRefKind(ref: Reference, showTechnicalDetails: boolean): string {
  if (ref.kind === 'formatElement') return showTechnicalDetails ? ref.kindLabel : getConsultantFormatTypeLabel(ref.kindLabel);
  const kindCode = ref.kindLabel.trim().toLowerCase();
  switch (kindCode) {
    case 'calc':
    case 'param':
    case 'agg':
    case 'validation':
    case 'message':
      return t.searchRefKindLabels[kindCode];
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
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const localizedKind = toLocalizedRefKind(reference, showTechnicalDetails);
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
