import React, { useCallback, useEffect, useState } from 'react';
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
              {searchResults.slice(0, 100).map((result: SearchResultEntry, i: number) => (
                <SearchResultCard
                  key={`${result.sourceConfigPath}:${result.target}:${i}`}
                  result={result}
                  configurations={configurations}
                  treeNodes={treeNodes}
                  registry={registry}
                  navigateToTreeNode={navigateToTreeNode}
                />
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

function SearchResultCard({
  result,
  configurations,
  treeNodes,
  registry,
  navigateToTreeNode,
}: {
  result: SearchResultEntry;
  configurations: Array<{ filePath: string }>;
  treeNodes: TreeNode[];
  registry: { lookup: (guid: string) => GUIDEntry | undefined };
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const targetNode = findNodeForSearchResult(result, configurations, treeNodes, registry);
  const content = (
    <>
      <div className="search-result-header">
        <span className={`badge badge-${result.targetType?.toLowerCase()}`}>{result.targetType}</span>
        <span className="search-result-target">{result.target}</span>
      </div>
      <div className="search-result-secondary">{result.sourceContext}</div>
      <div className="search-result-footer">
        <div className="search-result-secondary">in: {result.sourceComponent} ({result.sourceConfigPath})</div>
        {targetNode && (
          <button
            type="button"
            className="search-result-open-btn"
            onClick={() => navigateToTreeNode(targetNode.id)}
            title={t.openInExplorerAction}
          >
            ↗ {t.explorerActionShort}
          </button>
        )}
      </div>
    </>
  );

  return <div className="search-result-card">{content}</div>;
}

// ─── Where-Used Card ───

function WhereUsedCard({ entry, navigateToTreeNode, findDatasourceNode, treeNodes }: {
  entry: WhereUsedEntry;
  navigateToTreeNode: (nodeId: string) => void;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  treeNodes: TreeNode[];
}) {
  const [expanded, setExpanded] = useState(true);

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
    return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'mapping');
  }

  if (result.sourceContext === 'Format mapping references format definition') {
    return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'format');
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
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'model');
    case 'MappingVersion':
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'mapping');
    case 'FormatVersion':
    case 'FormatMappingVersion':
      return findTreeNodeByMatch(rootNode.children ?? [], node => node.type === 'format');
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
    default:
      return 'badge-xml';
  }
}

