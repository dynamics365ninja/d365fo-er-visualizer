import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import type { TreeNode } from '../state/store';
import type { WhereUsedEntry } from '../state/store';
import { ClickablePath } from './ClickablePath';
import { t } from '../i18n';
import { getFormatTypeThemeColor } from '../utils/theme-colors';

type Mode = 'search' | 'where-used';

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

  const [mode, setMode] = useState<Mode>('search');
  const [whereUsedQuery, setWhereUsedQuery] = useState('');
  const [whereUsedResults, setWhereUsedResults] = useState<WhereUsedEntry[]>([]);

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
      <div className="search-mode-bar">
        <button
          onClick={() => setMode('search')}
          className={`search-mode-btn${mode === 'search' ? ' active' : ''}`}
        >
          🔍 {t.search}
        </button>
        <button
          onClick={() => setMode('where-used')}
          className={`search-mode-btn${mode === 'where-used' ? ' active' : ''}`}
        >
          🗺️ {t.whereUsed}
        </button>
      </div>

      {/* Search mode */}
      {mode === 'search' && (
        <div className="search-pane">
          <div className="search-input-row">
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); }}
              onKeyDown={handleKeyDown}
              placeholder={t.searchPlaceholder}
              className="search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="search-clear-btn"
                title={t.clearSearch}
              >
                ✕
              </button>
            )}
            <button
              onClick={handleSearch}
              className="search-primary-btn"
            >
              🔍
            </button>
          </div>
          <div className="search-meta">
            Index: {registry.guidCount} GUIDs, {registry.crossRefCount} cross-refs
          </div>
          {searchResults.length > 0 && (
            <div>
              <div className="search-section-caption">
              {t.searchResultCount(searchResults.length)}
              </div>
              {searchResults.slice(0, 100).map((r: any, i: number) => (
                <div key={i} className="search-result-card">
                  <div className="search-result-header">
                    <span className={`badge badge-${r.targetType?.toLowerCase()}`}>{r.targetType}</span>
                    <span className="search-result-target">{r.target}</span>
                  </div>
                  <div className="search-result-secondary">{r.sourceContext}</div>
                  <div className="search-result-secondary">in: {r.sourceComponent} ({r.sourceConfigPath})</div>
                </div>
              ))}
            </div>
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
              <input
                type="text"
                value={whereUsedQuery}
                onChange={e => { setWhereUsedQuery(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') runWhereUsed(whereUsedQuery); }}
                placeholder={t.whereUsedPlaceholder}
                className="search-input"
              />
              {whereUsedQuery && (
                <button
                  onClick={() => { setWhereUsedQuery(''); setWhereUsedResults([]); }}
                  className="search-clear-btn"
                  title={t.clearWhereUsedSearch}
                >
                  ✕
                </button>
              )}
              <button
                onClick={() => runWhereUsed(whereUsedQuery)}
                className="search-primary-btn"
              >
                {t.find}
              </button>
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
                <div className="search-section-caption search-section-caption-spacious">
                  {t.found(whereUsedResults.length)}
                </div>
                {whereUsedResults.map((entry, i) => (
                  <WhereUsedCard
                    key={i}
                    entry={entry}
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
                  {['TaxTrans', 'CustTable', 'VendTable', 'TaxCodeGroupLookup'].map(ex => (
                    <span
                      key={ex}
                      className="search-example-link"
                      onClick={() => { setWhereUsedQuery(ex); runWhereUsed(ex); }}
                    >
                      {ex}
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

// ─── Where-Used Card ───

function WhereUsedCard({ entry, navigateToTreeNode, findDatasourceNode, treeNodes }: {
  entry: WhereUsedEntry;
  navigateToTreeNode: (nodeId: string) => void;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  treeNodes: TreeNode[];
}) {
  const [expanded, setExpanded] = useState(true);

  const entityBadgeColor = entry.entityType === 'Table' ? 'badge-table'
    : entry.entityType === 'Enum' ? 'badge-enum'
    : 'badge-class';

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

  return (
    <div className="wu-card">
      {/* Header */}
      <div className="wu-card-header" onClick={() => setExpanded(e => !e)}>
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <span className={`badge ${entityBadgeColor}`}>{entry.entityType}</span>
        <span className="wu-entity-name">{entry.entityName}</span>
        <span className="wu-arrow">→</span>
        <span className="wu-ds-name" onClick={e => { e.stopPropagation(); navigateToDs(); }} title="Přejít na datasource">
          🗃️ {entry.datasource.name}
        </span>
        <div className="wu-meta-end">
          <span className="wu-config-name">{entry.datasource.configName}</span>
          <button
            className="fmt-action-btn fmt-action-btn-compact wu-reveal-btn"
            onClick={e => { e.stopPropagation(); navigateToDs(); }}
            title={t.openInExplorerAction}
          >
            {t.openInExplorerAction}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="wu-card-body">
          {/* Model paths */}
          {entry.modelPaths.length > 0 && (
            <div className="wu-section">
              <div className="wu-section-title">📋 Model paths ({entry.modelPaths.length})</div>
              {entry.modelPaths.slice(0, 10).map((mp, i) => (
                <div key={i} className="wu-model-path">
                  <span className="wu-path-text">{mp.path}</span>
                  <span className="wu-path-sep">←</span>
                  <span className="wu-path-expr">
                    <ClickablePath expression={mp.expr} configIndex={mp.configIndex} mode="binding-expr" />
                  </span>
                </div>
              ))}
              {entry.modelPaths.length > 10 && (
                <div className="wu-more">
                  +{entry.modelPaths.length - 10} dalších…
                </div>
              )}
            </div>
          )}

          {/* Format usages */}
          {entry.formatUsages.length > 0 && (
            <div className="wu-section">
              <div className="wu-section-title">📄 Formátové elementy ({entry.formatUsages.length})</div>
              {entry.formatUsages.slice(0, 20).map((fu, i) => (
                <div key={i} className="wu-fmt-usage">
                  <span className="wu-fmt-type" style={{ color: getFormatTypeThemeColor(fu.elementType) }}>
                    {fu.elementType}
                  </span>
                  <span className="wu-fmt-name">{fu.elementName}</span>
                  <span className="wu-path-sep">←</span>
                  <span className="wu-path-expr wu-path-expr-grow">
                    <ClickablePath expression={fu.expression} configIndex={fu.configIndex} mode="binding-expr" />
                  </span>
                  <div className="wu-meta-end">
                    <span className="wu-config-name">{fu.configName}</span>
                    <button
                      className="fmt-action-btn fmt-action-btn-compact wu-reveal-btn"
                      onClick={() => navigateToFormatElement(fu.configIndex, fu.elementId)}
                      title={t.openInExplorerAction}
                    >
                      {t.openInExplorerAction}
                    </button>
                  </div>
                </div>
              ))}
              {entry.formatUsages.length > 20 && (
                <div className="wu-more">
                  +{entry.formatUsages.length - 20} dalších…
                </div>
              )}
            </div>
          )}

          {entry.modelPaths.length === 0 && entry.formatUsages.length === 0 && (
            <div className="wu-empty">Datasource nalezen, ale nebyla nalezena žádná vazba na formát.</div>
          )}
        </div>
      )}
    </div>
  );
}

