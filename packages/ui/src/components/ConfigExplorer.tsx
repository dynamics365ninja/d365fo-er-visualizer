import React, { useCallback, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useAppStore, type TreeNode } from '../state/store';

function filterTreeNodes(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const visit = (node: TreeNode): TreeNode | null => {
    const children = node.children?.map(visit).filter((child): child is TreeNode => child != null) ?? [];
    const ownText = [node.name, node.type, node.data?.type, node.data?.elementType, node.data?.path]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (ownText.includes(needle) || children.length > 0) {
      return { ...node, children };
    }

    return null;
  };

  return nodes.map(visit).filter((node): node is TreeNode => node != null);
}

function collectAncestorIds(nodes: TreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();

  const visit = (node: TreeNode, trail: string[]): string[] | null => {
    if (node.id === targetId) return [...trail, node.id];
    for (const child of node.children ?? []) {
      const found = visit(child, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };

  for (const node of nodes) {
    const found = visit(node, []);
    if (found) return new Set(found);
  }

  return new Set();
}

export function ConfigExplorer() {
  const treeNodes = useAppStore(s => s.treeNodes);
  const selectedNodeId = useAppStore(s => s.selectedNodeId);
  const selectNode = useAppStore(s => s.selectNode);
  const openTab = useAppStore(s => s.openTab);
  const [expandMode, setExpandMode] = useState<'default' | 'all' | 'none'>('default');
  const [expandVersion, setExpandVersion] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const filteredTreeNodes = useMemo(() => filterTreeNodes(treeNodes, filterQuery), [treeNodes, filterQuery]);
  const selectedPathIds = useMemo(() => collectAncestorIds(treeNodes, selectedNodeId), [treeNodes, selectedNodeId]);

  if (treeNodes.length === 0) {
    return (
      <div className="explorer-empty-state">
        <p style={{ marginBottom: 8 }}>{t.noConfigurationsLoaded}</p>
        <p style={{ fontSize: 11 }}>{t.loadXmlHint}</p>
      </div>
    );
  }

  return (
    <div className="explorer-tree-shell">
      <div className="explorer-toolbar">
        <button
          className="fmt-action-btn"
          onClick={() => { setExpandMode('all'); setExpandVersion(version => version + 1); }}
          title={t.expand}
        >
          {t.expand}
        </button>
        <button
          className="fmt-action-btn"
          onClick={() => { setExpandMode('none'); setExpandVersion(version => version + 1); }}
          title={t.collapse}
        >
          {t.collapse}
        </button>
      </div>
      <div className="explorer-filter-row">
        <input
          type="text"
          value={filterQuery}
          onChange={event => setFilterQuery(event.target.value)}
          placeholder={t.explorerFilterPlaceholder}
          className="fmt-filter-input explorer-filter-input"
        />
        {filterQuery && (
          <button
            className="fmt-action-btn"
            onClick={() => setFilterQuery('')}
            title={t.clearFilter}
          >
            ✕
          </button>
        )}
      </div>
      {filteredTreeNodes.length === 0 ? (
        <div className="explorer-empty-state">
          <p>{t.noResults}</p>
        </div>
      ) : filteredTreeNodes.map(node => (
        <TreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedNodeId}
          selectedPathIds={selectedPathIds}
          onSelect={selectNode}
          expandMode={expandMode}
          expandVersion={expandVersion}
          onDoubleClick={(n) => {
            if (n.configIndex != null) {
              openTab(n.id, n.name, n.configIndex);
            }
          }}
        />
      ))}
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  selectedPathIds: Set<string>;
  onSelect: (id: string) => void;
  expandMode: 'default' | 'all' | 'none';
  expandVersion: number;
  onDoubleClick: (node: TreeNode) => void;
}

function TreeNodeRow({ node, depth, selectedId, selectedPathIds, onSelect, expandMode, expandVersion, onDoubleClick }: TreeNodeRowProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;

  React.useEffect(() => {
    if (expandMode === 'all') setExpanded(true);
    if (expandMode === 'none') setExpanded(false);
    if (expandMode === 'default') setExpanded(depth === 0);
  }, [expandMode, expandVersion, depth]);

  React.useEffect(() => {
    if (hasChildren && selectedPathIds.has(node.id)) {
      setExpanded(true);
    }
  }, [hasChildren, node.id, selectedPathIds]);

  const handleClick = useCallback(() => {
    onSelect(node.id);
    if (hasChildren) setExpanded(e => !e);
  }, [node.id, hasChildren, onSelect]);

  const handleDoubleClick = useCallback(() => {
    onDoubleClick(node);
  }, [node, onDoubleClick]);

  const isSelected = node.id === selectedId;
  const isAncestor = !isSelected && selectedPathIds.has(node.id);

  return (
    <>
      <div
        className={`tree-node tree-node-${node.type} ${isSelected ? 'selected' : ''} ${isAncestor ? 'ancestor' : ''}`}
        data-depth={depth}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {hasChildren ? (
          <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        ) : (
          <span className="icon" style={{ fontSize: 10 }}>·</span>
        )}
        <span className="icon">{node.icon}</span>
        <span className="tree-node-label">{node.name}</span>
        {node.type === 'datasource' && node.data?.type && (
          <span className={`badge badge-${node.data.type.toLowerCase()}`} style={{ marginLeft: 6 }}>
            {node.data.type}
          </span>
        )}
      </div>
      {expanded && hasChildren && node.children!.map(child => (
        <TreeNodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          selectedPathIds={selectedPathIds}
          onSelect={onSelect}
          expandMode={expandMode}
          expandVersion={expandVersion}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </>
  );
}
