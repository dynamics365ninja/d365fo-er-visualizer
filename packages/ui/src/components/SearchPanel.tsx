import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchBox, Button, TabList, Tab, Tooltip } from '@fluentui/react-components';
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
import { ClickablePath } from './ClickablePath';
import { t } from '../i18n';
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

export function SearchPanel() {
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const executeSearch = useAppStore(s => s.executeSearch);
  const searchResults = useAppStore(s => s.searchResults);
  const registry = useAppStore(s => s.registry);
  const whereUsed = useAppStore(s => s.whereUsed);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const configurations = useAppStore(s => s.configurations);

  const [mode, setMode] = useState<Mode>('search');
  const [whereUsedQuery, setWhereUsedQuery] = useState('');
  const [whereUsedResults, setWhereUsedResults] = useState<WhereUsedEntry[]>([]);
  const [searchExpandSignal, setSearchExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });
  const [whereUsedExpandSignal, setWhereUsedExpandSignal] = useState<{ version: number; expanded: boolean }>({ version: 0, expanded: true });

  const handleSearch = useCallback(() => {
    executeSearch();
  }, [executeSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  // Run where-used immediately on every state change
  const runWhereUsed = useCallback((query: string) => {
    const results = query.trim() ? whereUsed(query) : [];
    setWhereUsedResults(results);
  }, [whereUsed]);

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
      runWhereUsed(whereUsedQuery);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [mode, runWhereUsed, whereUsedQuery]);

  return (
    <div className="search-panel">
      {/* Mode selector */}
      <TabList
        selectedValue={mode}
        onTabSelect={(_, d) => setMode(d.value as Mode)}
        size="small"
      >
        <Tab value="search" icon={<SearchRegular />}>{t.search}</Tab>
        <Tab value="where-used" icon={<MapRegular />}>{t.whereUsed}</Tab>
      </TabList>

      {/* Search mode */}
      {mode === 'search' && (
        <div className="search-pane">
          <div className="search-input-row">
            <SearchBox
              value={searchQuery}
              onChange={(_, d) => setSearchQuery(d.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.searchPlaceholder}
              className="search-input"
            />
            <Button appearance="primary" icon={<SearchRegular />} onClick={handleSearch} aria-label={t.search} />
          </div>
          <div className="search-toolbar-row">
            <div className="search-meta">
              Index: {registry.guidCount} GUIDs, {registry.crossRefCount} cross-refs
            </div>
            {searchResults.length > 0 && (
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
            )}
          </div>
          {searchResults.length > 0 && (
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
          )}
          {searchResults.length === 0 && searchQuery && (
            <div className="search-empty">{t.noResults}</div>
          )}
        </div>
      )}

      {/* Where-used mode */}
      {mode === 'where-used' && (
        <div className="search-panel">
          <div className="search-pane search-pane-compact-top">
            <div className="search-meta search-meta-tight">
              {t.whereUsedLabel}
            </div>
            <div className="search-input-row">
              <SearchBox
                value={whereUsedQuery}
                onChange={(_, d) => setWhereUsedQuery(d.value)}
                onKeyDown={e => { if (e.key === 'Enter') runWhereUsed(whereUsedQuery); }}
                placeholder={t.whereUsedPlaceholder}
                className="search-input"
                dismiss={{
                  onClick: () => { setWhereUsedQuery(''); setWhereUsedResults([]); },
                }}
              />
              <Button appearance="primary" onClick={() => runWhereUsed(whereUsedQuery)}>
                {t.find}
              </Button>
            </div>
          </div>

          <div className="search-pane search-pane-scroll">
            {whereUsedResults.length === 0 && whereUsedQuery && (
              <div className="search-empty">
                {t.noResultsFor(whereUsedQuery)}
              </div>
            )}
            {whereUsedResults.length > 0 && (
              <div>
                <div className="search-toolbar-row search-toolbar-row-inline">
                  <div className="search-section-caption search-section-caption-spacious">
                    {t.found(whereUsedResults.length)}
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
                {whereUsedResults.map((entry, i) => (
                  <WhereUsedCard
                    key={i}
                    entry={entry}
                    query={whereUsedQuery}
                    expandSignal={whereUsedExpandSignal}
                    navigateToTreeNode={navigateToTreeNode}
                    findDatasourceNode={findDatasourceNode}
                    treeNodes={treeNodes}
                  />
                ))}
              </div>
            )}
            {whereUsedResults.length === 0 && !whereUsedQuery && (
              <div className="search-help">
                <div className="search-help-title">{t.examples}</div>
                <div className="search-example-list">
                  {([
                    { label: 'TaxTrans', hint: 'tabulka' },
                    { label: 'NoYesEnum', hint: 'enum' },
                    { label: 'TaxCodeGroupLookup', hint: 'lookup' },
                    { label: 'ReportingCurrency', hint: 'parametr' },
                    { label: 'CalculatedTotal', hint: 'calc. field' },
                    { label: 'ledgerAccount', hint: 'identifikátor' },
                    { label: 'DATETIMEFORMAT', hint: 'funkce' },
                    { label: 'ROUND', hint: 'funkce' },
                  ] as Array<{ label: string; hint: string }>).map(ex => (
                    <span
                      key={ex.label}
                      className="search-example-link"
                      title={ex.hint}
                      onClick={() => { setWhereUsedQuery(ex.label); runWhereUsed(ex.label); }}
                    >
                      {ex.label}
                      <span className="search-example-hint">{ex.hint}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
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
    return Array.from(map.entries());
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
        <span className="search-result-group-name" title={configPath}>{fileName}</span>
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
      <div className="search-result-context" title={result.sourceContext}>
        <Highlight text={resolveGuidsInText(result.sourceContext, g => registry.lookup(g))} query={query} />
      </div>
      <div className="search-result-source" title={result.sourceComponent}>
        <span className="search-result-source-label">in</span>
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
              {unique.length} {unique.length === 1 ? 'odkaz' : unique.length < 5 ? 'odkazy' : 'odkazů'} ve výrazu
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

type Reference = {
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

function WhereUsedCard({ entry, query, expandSignal, navigateToTreeNode, findDatasourceNode, treeNodes }: {
  entry: WhereUsedEntry;
  query: string;
  expandSignal: { version: number; expanded: boolean };
  navigateToTreeNode: (nodeId: string) => void;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  treeNodes: TreeNode[];
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

  // Flatten modelPaths + formatUsages into a single list of IDE-style references
  const references: Reference[] = useMemo(() => {
    const dsName = entry.datasource.name;
    const mp: Reference[] = entry.modelPaths.map(m => ({
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

  const summary = references.length === 1
    ? '1 výskyt'
    : `${references.length} výskyt${references.length < 5 ? 'y' : 'ů'} v ${fileGroups.length} ${fileGroups.length === 1 ? 'souboru' : fileGroups.length < 5 ? 'souborech' : 'souborech'}`;

  const isTextMatch = entry.entityType === 'TextMatch';

  return (
    <div className="wu-card">
      {/* Header: entity → datasource + summary */}
      <div className="wu-card-header" onClick={() => setExpanded(e => !e)}>
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
              title="Přejít na datasource"
            >
              🗃️ <Highlight text={entry.datasource.name} query={query} />
            </span>
          </>
        )}
        {isTextMatch && (
          <span className="wu-ds-name wu-ds-name-plain" title="Textové výskyty ve výrazech">
            ve výrazech
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
        <div className="wu-card-body">
          {references.length === 0 && (
            <div className="wu-empty">
              <strong>Mrtvý datasource:</strong> žádný binding ani formátový element na tento datasource neodkazuje.
            </div>
          )}
          {fileGroups.map(([key, { configName, refs }]) => (
            <FileReferenceGroup
              key={key}
              configName={configName}
              references={refs}
              query={query}
              expandSignal={expandSignal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileReferenceGroup({
  configName,
  references,
  query,
  expandSignal,
}: {
  configName: string;
  references: Reference[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
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
        <span className="wu-file-group-name" title={configName}>{configName}</span>
        <span className="wu-file-group-count">{references.length}</span>
      </button>
      {expanded && (
        <div className="wu-file-group-body">
          {references.map((ref, i) => (
            <ReferenceRow key={i} reference={ref} query={query} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceRow({ reference, query }: { reference: Reference; query: string }) {
  const { location, kindLabel, preview, kindColor, onOpen } = reference;
  const breadcrumb = location.slice(0, -1);
  const leaf = location[location.length - 1] ?? '';

  return (
    <button
      type="button"
      className="wu-ref-row wu-ref-row-multiline"
      onClick={onOpen}
      title={`${location.join(' / ')}\n${preview}`}
    >
      <div className="wu-ref-line wu-ref-line-location">
        <span
          className="wu-ref-kind"
          style={kindColor ? { color: kindColor, borderColor: kindColor } : undefined}
        >
          {kindLabel}
        </span>
        <span className="wu-ref-location">
          {breadcrumb.length > 0 && (
            <span className="wu-ref-breadcrumb">
              {breadcrumb.map((seg, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="wu-ref-bc-sep">/</span>}
                  <span className="wu-ref-bc-seg">{seg}</span>
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
        <span className="wu-ref-preview" title={preview}>
          <Highlight text={preview} query={query} />
        </span>
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

