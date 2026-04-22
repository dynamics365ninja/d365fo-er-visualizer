import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Tooltip,
} from '@fluentui/react-components';
import {
  DismissRegular,
  MoreVerticalRegular,
  ArrowSortRegular,
  OpenRegular,
  DeleteRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DataBarVerticalFilled,
  LinkFilled,
  DocumentFilled,
} from '@fluentui/react-icons';
import { locale, t } from '../i18n';
import { useAppStore, type TreeNode } from '../state/store';
import { ERDirection } from '@er-visualizer/core';
import { loadBrowserFiles } from '../utils/file-loading';

type ConfigKind = 'DataModel' | 'ModelMapping' | 'Format';
type SortMode = 'loadOrder' | 'nameAsc' | 'nameDesc';

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
  const configurations = useAppStore(s => s.configurations);
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
  const [kindFilter, setKindFilter] = useState<Set<ConfigKind>>(new Set(['DataModel', 'ModelMapping', 'Format']));
  const [sortMode, setSortMode] = useState<SortMode>('loadOrder');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ConfigKind>>(new Set());

  const toggleKind = useCallback((kind: ConfigKind) => {
    setKindFilter(prev => {
      const next = new Set(prev);
      if (next.has(kind)) {
        if (next.size === 1) {
          // Clicking the only active one -> reset to all visible
          return new Set(['DataModel', 'ModelMapping', 'Format']);
        }
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((kind: ConfigKind) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

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

  // Counts across the full unfiltered set so the chip badges stay stable.
  const kindCounts = useMemo(() => {
    const counts: Record<ConfigKind, number> = { DataModel: 0, ModelMapping: 0, Format: 0 };
    for (const node of treeNodes) {
      const kind = getConfigurationKind(node);
      if (kind) counts[kind] += 1;
    }
    return counts;
  }, [treeNodes]);

  const sortNodes = useCallback((nodes: TreeNode[]) => {
    if (sortMode === 'loadOrder') return nodes;
    const sorted = [...nodes];
    sorted.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      return sortMode === 'nameAsc' ? cmp : -cmp;
    });
    return sorted;
  }, [sortMode]);

  const groupedTreeNodes = useMemo(() => {
    const groups = new Map<ConfigKind, TreeNode[]>();

    for (const node of filteredTreeNodes) {
      const kind = getConfigurationKind(node);
      if (!kind) continue;
      if (!kindFilter.has(kind)) continue;
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind)!.push(node);
    }

    return (['DataModel', 'ModelMapping', 'Format'] as const)
      .map(kind => ({ kind, nodes: sortNodes(groups.get(kind) ?? []) }))
      .filter(group => group.nodes.length > 0);
  }, [filteredTreeNodes, kindFilter, sortNodes]);

  const totalVisible = useMemo(
    () => groupedTreeNodes.reduce((sum, g) => sum + g.nodes.length, 0),
    [groupedTreeNodes],
  );
  const totalAll = kindCounts.DataModel + kindCounts.ModelMapping + kindCounts.Format;
  const isFiltering = filterQuery.trim().length > 0 || kindFilter.size < 3;

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

        <div className="explorer-chip-row" role="toolbar" aria-label={t.explorerFilterByKind}>
          <ExplorerKindChip
            kind="DataModel"
            active={kindFilter.has('DataModel')}
            count={kindCounts.DataModel}
            onToggle={() => toggleKind('DataModel')}
            icon={<DataBarVerticalFilled />}
          />
          <ExplorerKindChip
            kind="ModelMapping"
            active={kindFilter.has('ModelMapping')}
            count={kindCounts.ModelMapping}
            onToggle={() => toggleKind('ModelMapping')}
            icon={<LinkFilled />}
          />
          <ExplorerKindChip
            kind="Format"
            active={kindFilter.has('Format')}
            count={kindCounts.Format}
            onToggle={() => toggleKind('Format')}
            icon={<DocumentFilled />}
          />
          <div className="explorer-chip-spacer" />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content={t.explorerSort} relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowSortRegular />}
                  aria-label={t.explorerSort}
                />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  onClick={() => setSortMode('loadOrder')}
                  disabled={sortMode === 'loadOrder'}
                >
                  {t.explorerSortLoadOrder}
                </MenuItem>
                <MenuItem
                  onClick={() => setSortMode('nameAsc')}
                  disabled={sortMode === 'nameAsc'}
                >
                  {t.explorerSortNameAsc}
                </MenuItem>
                <MenuItem
                  onClick={() => setSortMode('nameDesc')}
                  disabled={sortMode === 'nameDesc'}
                >
                  {t.explorerSortNameDesc}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Tooltip content={t.expand} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              onClick={() => { setExpandMode('all'); setExpandVersion(v => v + 1); }}
              aria-label={t.expand}
            >
              {t.expand}
            </Button>
          </Tooltip>
          <Tooltip content={t.collapse} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              onClick={() => { setExpandMode('none'); setExpandVersion(v => v + 1); }}
              aria-label={t.collapse}
            >
              {t.collapse}
            </Button>
          </Tooltip>
        </div>

        {isFiltering && (
          <div className="explorer-result-info">
            {t.explorerResultsCount(totalVisible, totalAll)}
          </div>
        )}
      </div>
      {filteredTreeNodes.length === 0 || totalVisible === 0 ? (
        <div className="explorer-empty-state">
          <p>{t.noResults}</p>
        </div>
      ) : groupedTreeNodes.length > 0 ? groupedTreeNodes.map(group => {
          const isCollapsed = collapsedGroups.has(group.kind);
          return (
            <div key={group.kind} className={`explorer-kind-group ${getExplorerGroupAccent(group.kind)} ${isCollapsed ? 'collapsed' : ''}`}>
              <button
                type="button"
                className="explorer-kind-group-header explorer-kind-group-header-btn"
                onClick={() => toggleGroup(group.kind)}
                aria-expanded={!isCollapsed}
              >
                <span className="explorer-kind-group-header-left">
                  <span className="explorer-kind-group-chevron" aria-hidden="true">
                    {isCollapsed ? <ChevronRightRegular /> : <ChevronDownRegular />}
                  </span>
                  {getExplorerGroupLabel(group.kind)}
                </span>
                <span className="explorer-kind-group-count">{group.nodes.length}</span>
              </button>
              {!isCollapsed && (
                <div className="explorer-kind-group-body">
                  {group.nodes.map(node => {
                    const cfg = node.configIndex != null ? configurations[node.configIndex] : undefined;
                    const version = cfg?.solutionVersion?.publicVersionNumber;
                    return (
                      <TreeNodeRow
                        key={node.id}
                        node={node}
                        depth={0}
                        selectedId={selectedNodeId}
                        selectedPathIds={selectedPathIds}
                        showTechnicalDetails={showTechnicalDetails}
                        version={version}
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
                    );
                  })}
                </div>
              )}
            </div>
          );
        }) : filteredTreeNodes.map(node => (
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
  version?: string | number;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  expandMode: 'default' | 'all' | 'none';
  expandVersion: number;
  onDoubleClick: (node: TreeNode) => void;
  onCloseConfiguration: (node: TreeNode) => void;
}

function TreeNodeRow({ node, depth, selectedId, selectedPathIds, showTechnicalDetails, version, onSelect, onNavigate, expandMode, expandVersion, onDoubleClick, onCloseConfiguration }: TreeNodeRowProps) {
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
        {version != null && depth === 0 && (
          <span className="tree-node-version-pill" title={`v${version}`}>v{version}</span>
        )}
        {kindLabel && <span className="tree-node-kind-pill">{kindLabel}</span>}
        {canCloseConfiguration && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <button
                type="button"
                className="tree-node-actions"
                title={t.explorerMoreActions}
                aria-label={t.explorerMoreActions}
                onClick={event => event.stopPropagation()}
              >
                <MoreVerticalRegular fontSize={14} />
              </button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<OpenRegular />}
                  onClick={() => onNavigate(node.id)}
                >
                  {t.explorerOpenInTab}
                </MenuItem>
                <MenuItem
                  icon={<DeleteRegular />}
                  onClick={() => onCloseConfiguration(node)}
                >
                  {t.closeConfiguration}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
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

// ─── Kind filter chip ───

function ExplorerKindChip({
  kind, active, count, onToggle, icon,
}: {
  kind: ConfigKind;
  active: boolean;
  count: number;
  onToggle: () => void;
  icon: React.ReactNode;
}) {
  const label = getExplorerGroupLabel(kind);
  const accent = kind === 'DataModel' ? 'model' : kind === 'ModelMapping' ? 'mapping' : 'format';
  return (
    <button
      type="button"
      className={`explorer-kind-chip explorer-kind-chip--${accent} ${active ? 'active' : ''}`}
      onClick={onToggle}
      aria-pressed={active}
      disabled={count === 0}
      title={label}
    >
      <span className="explorer-kind-chip-icon" aria-hidden="true">{icon}</span>
      <span className="explorer-kind-chip-label">{label}</span>
      <span className="explorer-kind-chip-count">{count}</span>
    </button>
  );
}
