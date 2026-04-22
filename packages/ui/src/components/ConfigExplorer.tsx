import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { locale, t } from '../i18n';
import { useAppStore, type TreeNode } from '../state/store';
import { ERDirection } from '@er-visualizer/core';
import { loadBrowserFiles } from '../utils/file-loading';

function getFormatDirectionLabel(direction: ERDirection | undefined): string {
  if (direction === ERDirection.Import) return t.formatDirectionImport;
  if (direction === ERDirection.Export) return t.formatDirectionExport;
  return t.formatDirectionUnknown;
}

function getExplorerNodeAccentClass(node: TreeNode): string {
  const kind = node.type === 'file' ? node.data?.kind : undefined;

  if (kind === 'DataModel' || node.type === 'model') return 'tree-node-accent-model';
  if (kind === 'ModelMapping' || node.type === 'mapping') return 'tree-node-accent-mapping';
  if (kind === 'Format' || node.type === 'format') return 'tree-node-accent-format';

  return '';
}

function getExplorerKindLabel(node: TreeNode): string | null {
  const kind = getConfigurationKind(node);
  const labels = locale === 'cs'
    ? { DataModel: 'Model', ModelMapping: 'Mapování', Format: 'Formát', model: 'Model', mapping: 'Mapování', format: 'Formát' }
    : { DataModel: 'Model', ModelMapping: 'Mapping', Format: 'Format', model: 'Model', mapping: 'Mapping', format: 'Format' };

  if (kind === 'Format' && node.data?.content?.kind === 'Format') {
    return `${labels.Format} • ${getFormatDirectionLabel(node.data.content.direction)}`;
  }

  if (kind === 'DataModel' || node.type === 'model') return labels.DataModel;
  if (kind === 'ModelMapping' || node.type === 'mapping') return labels.ModelMapping;
  if (kind === 'Format' || node.type === 'format') return labels.Format;

  return null;
}

function getConfigurationKind(node: TreeNode): 'DataModel' | 'ModelMapping' | 'Format' | undefined {
  const kind = node.data?.kind ?? node.data?.content?.kind;
  if (kind === 'DataModel' || kind === 'ModelMapping' || kind === 'Format') {
    return kind;
  }
  return undefined;
}

function getExplorerGroupLabel(kind: 'DataModel' | 'ModelMapping' | 'Format'): string {
  if (locale === 'cs') {
    return kind === 'DataModel' ? 'Datové modely' : kind === 'ModelMapping' ? 'Mapování modelu' : 'Formáty';
  }

  return kind === 'DataModel' ? 'Data Models' : kind === 'ModelMapping' ? 'Model Mappings' : 'Formats';
}

function getExplorerGroupAccent(kind: 'DataModel' | 'ModelMapping' | 'Format'): string {
  return kind === 'DataModel'
    ? 'explorer-kind-group-model'
    : kind === 'ModelMapping'
      ? 'explorer-kind-group-mapping'
      : 'explorer-kind-group-format';
}

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
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const removeConfiguration = useAppStore(s => s.removeConfiguration);
  const selectNode = useAppStore(s => s.selectNode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const explorerExpandCommand = useAppStore(s => s.explorerExpandCommand);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const pushToast = useAppStore(s => s.pushToast);
  const [expandMode, setExpandMode] = useState<'default' | 'all' | 'none'>('default');
  const [expandVersion, setExpandVersion] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    // Only clear when leaving the container itself (not moving to a child)
    if (event.currentTarget === event.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setIsDragging(false);
    const { errors } = await loadBrowserFiles(event.dataTransfer.files, loadXmlFile);
    for (const err of errors) {
      pushToast({ kind: 'error', message: err });
    }
  }, [loadXmlFile, pushToast]);

  // React to broadcast expand/collapse commands from the panel header
  React.useEffect(() => {
    if (explorerExpandCommand.version === 0) return;
    setExpandMode(explorerExpandCommand.mode);
    setExpandVersion(version => version + 1);
  }, [explorerExpandCommand]);
  const filteredTreeNodes = useMemo(() => filterTreeNodes(treeNodes, filterQuery), [treeNodes, filterQuery]);
  const selectedPathIds = useMemo(() => collectAncestorIds(treeNodes, selectedNodeId), [treeNodes, selectedNodeId]);
  const groupedTreeNodes = useMemo(() => {
    const groups = new Map<'DataModel' | 'ModelMapping' | 'Format', TreeNode[]>();

    for (const node of filteredTreeNodes) {
      const kind = getConfigurationKind(node);
      if (!kind) continue;
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind)!.push(node);
    }

    return (['DataModel', 'ModelMapping', 'Format'] as const)
      .map(kind => ({ kind, nodes: groups.get(kind) ?? [] }))
      .filter(group => group.nodes.length > 0);
  }, [filteredTreeNodes]);

  if (treeNodes.length === 0) {
    return (
      <div
        className={`explorer-empty-state explorer-dropzone ${isDragging ? 'explorer-dropzone-dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p style={{ marginBottom: 8 }}>{t.noConfigurationsLoaded}</p>
        <p style={{ fontSize: 11 }}>{t.loadXmlHint}</p>
        {isDragging && <div className="explorer-dropzone-overlay">{t.landingDropRelease}</div>}
      </div>
    );
  }

  return (
    <div
      className={`explorer-tree-shell explorer-dropzone ${isDragging ? 'explorer-dropzone-dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && <div className="explorer-dropzone-overlay">{t.landingDropRelease}</div>}
      <div className="explorer-toolbar">
        <Button
          appearance="subtle"
          size="small"
          onClick={() => { setExpandMode('all'); setExpandVersion(version => version + 1); }}
          title={t.expand}
        >
          {t.expand}
        </Button>
        <Button
          appearance="subtle"
          size="small"
          onClick={() => { setExpandMode('none'); setExpandVersion(version => version + 1); }}
          title={t.collapse}
        >
          {t.collapse}
        </Button>
        <div className="panel-filter-row explorer-toolbar-filter">
          <Input
            size="small"
            value={filterQuery}
            onChange={(_, d) => setFilterQuery(d.value)}
            placeholder={t.explorerFilterPlaceholder}
            className="fmt-filter-input explorer-filter-input"
            contentAfter={filterQuery ? (
              <Button
                appearance="transparent"
                size="small"
                icon={<DismissRegular />}
                aria-label={t.clearFilter}
                onClick={() => setFilterQuery('')}
              />
            ) : undefined}
          />
        </div>
      </div>
      {filteredTreeNodes.length === 0 ? (
        <div className="explorer-empty-state">
          <p>{t.noResults}</p>
        </div>
      ) : groupedTreeNodes.length > 0 ? groupedTreeNodes.map(group => (
          <div key={group.kind} className={`explorer-kind-group ${getExplorerGroupAccent(group.kind)}`}>
            <div className="explorer-kind-group-header">
              <span>{getExplorerGroupLabel(group.kind)}</span>
              <span className="explorer-kind-group-count">{group.nodes.length}</span>
            </div>
            <div className="explorer-kind-group-body">
              {group.nodes.map(node => (
                <TreeNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedNodeId}
                  selectedPathIds={selectedPathIds}
                  showTechnicalDetails={showTechnicalDetails}
                  onSelect={selectNode}
                  onNavigate={navigateToTreeNode}
                  expandMode={expandMode}
                  expandVersion={expandVersion}
                  onDoubleClick={(n) => {
                    if (n.configIndex != null) {
                      navigateToTreeNode(n.id);
                    }
                  }}
                  onCloseConfiguration={(n) => {
                    if (n.configIndex != null) {
                      removeConfiguration(n.configIndex);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )) : filteredTreeNodes.map(node => (
          <TreeNodeRow
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedNodeId}
            selectedPathIds={selectedPathIds}
            showTechnicalDetails={showTechnicalDetails}
            onSelect={selectNode}
            onNavigate={navigateToTreeNode}
            expandMode={expandMode}
            expandVersion={expandVersion}
            onDoubleClick={(n) => {
              if (n.configIndex != null) {
                navigateToTreeNode(n.id);
              }
            }}
            onCloseConfiguration={(n) => {
              if (n.configIndex != null) {
                removeConfiguration(n.configIndex);
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
  showTechnicalDetails: boolean;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  expandMode: 'default' | 'all' | 'none';
  expandVersion: number;
  onDoubleClick: (node: TreeNode) => void;
  onCloseConfiguration: (node: TreeNode) => void;
}

function TreeNodeRow({ node, depth, selectedId, selectedPathIds, showTechnicalDetails, onSelect, onNavigate, expandMode, expandVersion, onDoubleClick, onCloseConfiguration }: TreeNodeRowProps) {
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
  const accentClass = getExplorerNodeAccentClass(node);
  const kindLabel = getExplorerKindLabel(node);
  const canCloseConfiguration = depth === 0 && node.configIndex != null && node.type === 'file';

  return (
    <>
      <div
        className={`tree-node tree-node-${node.type} ${accentClass} ${isSelected ? 'selected' : ''} ${isAncestor ? 'ancestor' : ''}`}
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
        {kindLabel && <span className="tree-node-kind-pill">{kindLabel}</span>}
        {canCloseConfiguration && (
          <button
            className="tree-node-close"
            title={t.closeConfiguration}
            aria-label={t.closeConfiguration}
            onClick={event => {
              event.stopPropagation();
              onCloseConfiguration(node);
            }}
          >
            ×
          </button>
        )}
        {showTechnicalDetails && node.type === 'datasource' && node.data?.type && (
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
          showTechnicalDetails={showTechnicalDetails}
          onSelect={onSelect}
          onNavigate={onNavigate}
          expandMode={expandMode}
          expandVersion={expandVersion}
          onDoubleClick={onDoubleClick}
          onCloseConfiguration={onCloseConfiguration}
        />
      ))}
    </>
  );
}
