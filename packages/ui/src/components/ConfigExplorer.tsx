import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
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
  TextExpandRegular,
  TextCollapseRegular,
  TextBulletListTreeRegular,
  ListRegular,
  DismissSquareMultipleRegular,
  FolderRegular,
  AppsListDetailRegular,
  AddRegular,
} from '@fluentui/react-icons';
import { locale, t } from '../i18n';
import { useAppStore, type TreeNode } from '../state/store';
import { ERDirection } from '@er-visualizer/core';
import type { ERConfiguration } from '@er-visualizer/core';
import { buildExplorerModelGroups, getBestVersion, type ExplorerModelGroup } from '../utils/model-hierarchy';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { buildLabelPool, labelDisplayText, looksLikeLabelRef } from '../utils/label-resolver';
import { WorkspaceManager } from './WorkspaceManager';
import { FnoIngestPanel } from './FnoIngestPanel';
import {
  ArrowSyncRegular,
  CheckmarkCircleRegular,
} from '@fluentui/react-icons';

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

/**
 * Pill text for rows that already sit under a kind group header — repeating
 * "Model" under "Data models" is noise. Formats still carry their direction,
 * which the group header does not say.
 */
function getExplorerKindPillInGroup(node: TreeNode): string | null {
  if (getConfigurationKind(node) === 'Format' && node.data?.content?.kind === 'Format') {
    return getFormatDirectionLabel(node.data.content.direction);
  }
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

function getExplorerNodeIcon(node: TreeNode): React.ReactNode {
  const kind = getConfigurationKind(node);

  if (kind === 'DataModel') {
    return <DataBarVerticalFilled fontSize={14} />;
  }

  if (kind === 'ModelMapping') {
    return <LinkFilled fontSize={14} />;
  }

  if (kind === 'Format') {
    return <DocumentFilled fontSize={14} />;
  }

  if (node.type === 'mapping' || node.type === 'binding' || node.type === 'formatBinding') {
    return <LinkFilled fontSize={14} />;
  }

  if (node.type === 'validation') {
    return <CheckmarkCircleRegular fontSize={14} />;
  }

  if (node.type === 'transformation') {
    return <ArrowSyncRegular fontSize={14} />;
  }

  if (
    node.type === 'datasource'
    || node.type === 'field'
    || node.type === 'container'
    || node.type === 'enum'
    || node.type === 'enumValue'
    || node.type === 'model'
  ) {
    return <DataBarVerticalFilled fontSize={14} />;
  }

  return <DocumentFilled fontSize={14} />;
}

function filterTreeNodes(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const visit = (node: TreeNode): TreeNode | null => {
    const ownText = [node.name, node.type, node.data?.type, node.data?.elementType, node.data?.path]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // If this node itself matches, keep it with all its original descendants intact
    if (ownText.includes(needle)) {
      return node;
    }

    // Otherwise propagate down — include this node only if some descendant matches
    const children = node.children?.map(visit).filter((child): child is TreeNode => child != null) ?? [];
    if (children.length > 0) {
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

/**
 * A hierarchy group is visible when the model itself, one of its direct
 * children, or anything nested under a sub-model passes the kind + text filter.
 * Shared by the top-level empty-state check and `ModelGroupSection` so the two
 * never disagree.
 */
function groupHasVisibleContent(
  group: ExplorerModelGroup,
  configurations: ERConfiguration[],
  treeNodes: TreeNode[],
  filteredNodeIds: Set<string>,
  kindFilter: Set<ConfigKind>,
): boolean {
  const modelNode = treeNodes[group.configIdx];
  if (modelNode && kindFilter.has('DataModel') && filteredNodeIds.has(modelNode.id)) return true;
  const childVisible = group.children.some(idx => {
    const cfg = configurations[idx];
    return !!cfg
      && kindFilter.has(cfg.content.kind as ConfigKind)
      && filteredNodeIds.has(treeNodes[idx]?.id ?? '');
  });
  if (childVisible) return true;
  return group.subModels.some(sub => groupHasVisibleContent(sub, configurations, treeNodes, filteredNodeIds, kindFilter));
}

/** Apply the explorer sort mode to a model hierarchy (groups and their children alike). */
function sortExplorerGroups(
  groups: ExplorerModelGroup[],
  treeNodes: TreeNode[],
  sortNodes: (nodes: TreeNode[]) => TreeNode[],
): ExplorerModelGroup[] {
  const sortIndices = (indices: number[]): number[] => {
    const nodes = indices.map(idx => treeNodes[idx]).filter((n): n is TreeNode => !!n);
    const order = new Map(sortNodes(nodes).map((n, i) => [n.id, i]));
    return [...indices].sort((a, b) =>
      (order.get(treeNodes[a]?.id ?? '') ?? Number.MAX_SAFE_INTEGER) - (order.get(treeNodes[b]?.id ?? '') ?? Number.MAX_SAFE_INTEGER));
  };
  const sortGroups = (list: ExplorerModelGroup[]): ExplorerModelGroup[] => {
    const byIdx = new Map(list.map(g => [g.configIdx, g]));
    return sortIndices(list.map(g => g.configIdx))
      .map(idx => byIdx.get(idx)!)
      .map(g => ({ ...g, children: sortIndices(g.children), subModels: sortGroups(g.subModels) }));
  };
  return sortGroups(groups);
}

export function ConfigExplorer() {
  const treeNodes = useAppStore(s => s.treeNodes);
  const configurations = useAppStore(s => s.configurations);
  const selectedNodeId = useAppStore(s => s.selectedNodeId);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const removeConfiguration = useAppStore(s => s.closeConfigurationWithUndo);
  const removeAllConfigurations = useAppStore(s => s.removeAllConfigurations);
  const requestLanding = useAppStore(s => s.requestLanding);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const selectNode = useAppStore(s => s.selectNode);
  const openTab = useAppStore(s => s.openTab);
  const openDrillDownTab = useAppStore(s => s.openDrillDownTab);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const explorerExpandCommand = useAppStore(s => s.explorerExpandCommand);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const loadXmlFileRef = React.useRef(loadXmlFile);
  loadXmlFileRef.current = loadXmlFile;
  const pushToast = useAppStore(s => s.pushToast);
  const openAddFiles = useCallback(() => {
    void openFilesWithSystemDialog(loadXmlFileRef.current).then(result => {
      // `null` means no Electron bridge — fall back to the browser file input.
      if (result === null) {
        fileInputRef.current?.click();
        return;
      }
      for (const err of result.errors) {
        pushToast({ kind: 'error', message: err });
      }
    });
  }, [pushToast]);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const [expandMode, setExpandMode] = useState<'default' | 'all' | 'none'>('default');
  const [expandVersion, setExpandVersion] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [kindFilter, setKindFilter] = useState<Set<ConfigKind>>(new Set(['DataModel', 'ModelMapping', 'Format']));
  const [sortMode, setSortMode] = useState<SortMode>('loadOrder');
  // Everything that is loaded should be visible at first level on open — the
  // explorer starts with every kind group expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ConfigKind>>(
    () => new Set<ConfigKind>(),
  );
  const [hierarchyView, setHierarchyView] = useState(false);

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

  // dragenter/dragleave fire for every child the cursor crosses (including the
  // overlay we render while dragging), so track depth instead of comparing targets.
  const dragDepthRef = React.useRef(0);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current = 0;
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

  const openNodeInConfigTab = useCallback((node: TreeNode) => {
    if (node.configIndex == null) return;
    const cfg = configurations[node.configIndex];
    if (!cfg) return;
    openTab(`cfg-${node.configIndex}`, cfg.solutionVersion.solution.name, node.configIndex);
    selectNode(node.id);
  }, [configurations, openTab, selectNode]);

  const resolveNodeDrillExpression = useCallback((node: TreeNode): string | undefined => {
    if (node.type === 'binding' || node.type === 'formatBinding' || node.type === 'transformation') {
      return node.data?.expressionAsString?.trim() || undefined;
    }
    if (node.type === 'datasource') {
      return node.data?.calculatedField?.expressionAsString?.trim()
        || node.data?.userParamInfo?.expressionAsString?.trim()
        || undefined;
    }
    if (node.type === 'validation') {
      return node.data?.conditions?.[0]?.conditionExpressionAsString?.trim()
        || node.data?.conditions?.[0]?.messageExpressionAsString?.trim()
        || undefined;
    }
    return undefined;
  }, []);

  const handleExplorerDoubleClick = useCallback((node: TreeNode) => {
    if (node.type === 'file') {
      navigateToTreeNode(node.id);
      return;
    }

    const expression = resolveNodeDrillExpression(node);
    if (expression && node.configIndex != null) {
      openDrillDownTab(expression, node.configIndex, node.name);
      selectNode(node.id);
      return;
    }

    if (node.configIndex != null) {
      openNodeInConfigTab(node);
    }
  }, [navigateToTreeNode, openDrillDownTab, openNodeInConfigTab, resolveNodeDrillExpression, selectNode]);

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
      .filter(kind => kindFilter.has(kind))
      .map(kind => ({ kind, nodes: sortNodes(groups.get(kind) ?? []) }));
  }, [filteredTreeNodes, kindFilter, sortNodes]);
  // Fast lookup: which top-level node IDs pass the search filter.
  const filteredNodeIds = useMemo(
    () => new Set(filteredTreeNodes.map(n => n.id)),
    [filteredTreeNodes],
  );
  // Model-centric hierarchy, sorted with the same mode as the flat view.
  const hierarchy = useMemo(() => {
    if (!hierarchyView) return null;
    const { roots, orphans } = buildExplorerModelGroups(configurations);
    const orphanNodes = orphans.map(idx => treeNodes[idx]).filter((n): n is TreeNode => !!n);
    const orphanOrder = new Map(sortNodes(orphanNodes).map((n, i) => [n.id, i]));
    return {
      roots: sortExplorerGroups(roots, treeNodes, sortNodes),
      orphans: [...orphans].sort((a, b) =>
        (orphanOrder.get(treeNodes[a]?.id ?? '') ?? 0) - (orphanOrder.get(treeNodes[b]?.id ?? '') ?? 0)),
    };
  }, [hierarchyView, configurations, treeNodes, sortNodes]);

  const totalVisible = useMemo(
    () => configurations.filter((cfg, idx) => {
      if (!kindFilter.has(cfg.content.kind as ConfigKind)) return false;
      return treeNodes[idx] ? filteredNodeIds.has(treeNodes[idx].id) : false;
    }).length,
    [configurations, treeNodes, filteredNodeIds, kindFilter],
  );
  const totalAll = kindCounts.DataModel + kindCounts.ModelMapping + kindCounts.Format;
  const isFiltering = filterQuery.trim().length > 0 || kindFilter.size < 3;

  if (treeNodes.length === 0) {
    return (
      <div
        className={`explorer-empty-state explorer-dropzone ${isDragging ? 'explorer-dropzone-dragging' : ''}`}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {fnoIngestStatus ? (
          <FnoIngestPanel variant="card" />
        ) : (
          <>
            <p style={{ marginBottom: 8 }}>{t.noConfigurationsLoaded}</p>
            <p style={{ fontSize: 11 }}>{t.loadXmlHint}</p>
            <div className="explorer-empty-actions">
              <Button appearance="primary" size="small" icon={<AddRegular />} onClick={openAddFiles}>{t.workspaceAddFiles}</Button>
              <Button appearance="secondary" size="small" icon={<AppsListDetailRegular />} onClick={() => setWorkspaceOpen(true)}>{t.workspaceManager}</Button>
            </div>
            <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} onRequestFno={() => requestLanding('remote')} />
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              multiple
              style={{ display: 'none' }}
              onChange={e => {
                void loadBrowserFiles(e.target.files, loadXmlFile).then(({ errors }) => {
                  for (const err of errors) pushToast({ kind: 'error', message: err });
                });
                e.target.value = '';
              }}
            />
          </>
        )}
        {isDragging && <div className="explorer-dropzone-overlay">{t.landingDropRelease}</div>}
      </div>
    );
  }

  return (
    <div
      className={`explorer-tree-shell explorer-dropzone ${isDragging ? 'explorer-dropzone-dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && <div className="explorer-dropzone-overlay">{t.landingDropRelease}</div>}

      {fnoIngestStatus && (
        <div className="fno-ingest-banner">
          <ArrowSyncRegular
            className="fno-ingest-banner-icon"
            fontSize={14}
            style={{ animation: 'spin 1.2s linear infinite' }}
          />
          <div className="fno-ingest-banner-text">
            <div className="fno-ingest-banner-label">{t.explorerLoading}</div>
            <div className="fno-ingest-banner-status">{fnoIngestStatus}</div>
          </div>
          <div className="fno-ingest-progress-track" style={{ width: 48, flexShrink: 0 }}>
            <div className="fno-ingest-progress-bar" />
          </div>
        </div>
      )}

      <div className="explorer-panel-header">
        <span className="explorer-panel-title">
          <FolderRegular fontSize={15} />
          {t.explorer}
        </span>
        <span className="explorer-panel-count">{treeNodes.length}</span>
        <span className="explorer-panel-spacer" />
        <Button
          appearance="subtle"
          size="small"
          icon={<AddRegular />}
          aria-label={t.explorerAddConfigurations}
          title={t.explorerAddConfigurations}
          onClick={openAddFiles}
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<AppsListDetailRegular />}
          aria-label={t.workspaceManager}
          title={t.workspaceManager}
          onClick={() => setWorkspaceOpen(true)}
        />
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button
              appearance="subtle"
              size="small"
              icon={<MoreVerticalRegular />}
              aria-label={t.explorerMoreActions}
              title={t.explorerMoreActions}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                icon={hierarchyView ? <ListRegular /> : <TextBulletListTreeRegular />}
                onClick={() => setHierarchyView(v => !v)}
              >
                {hierarchyView ? t.explorerViewFlat : t.explorerViewHierarchy}
              </MenuItem>
              <MenuItem icon={<TextExpandRegular />} onClick={() => { setExpandMode('all'); setExpandVersion(v => v + 1); }}>
                {t.cmdExpandAll}
              </MenuItem>
              <MenuItem icon={<TextCollapseRegular />} onClick={() => { setExpandMode('none'); setExpandVersion(v => v + 1); }}>
                {t.cmdCollapseAll}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<ArrowSortRegular />} onClick={() => setSortMode('loadOrder')} disabled={sortMode === 'loadOrder'}>
                {t.explorerSortLoadOrder}
              </MenuItem>
              <MenuItem icon={<ArrowSortRegular />} onClick={() => setSortMode('nameAsc')} disabled={sortMode === 'nameAsc'}>
                {t.explorerSortNameAsc}
              </MenuItem>
              <MenuItem icon={<ArrowSortRegular />} onClick={() => setSortMode('nameDesc')} disabled={sortMode === 'nameDesc'}>
                {t.explorerSortNameDesc}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<AppsListDetailRegular />} onClick={() => setWorkspaceOpen(true)}>
                {t.workspaceManager}
              </MenuItem>
              <MenuItem icon={<DismissSquareMultipleRegular />} onClick={removeAllConfigurations}>
                {t.closeAllConfigurations}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} onRequestFno={() => requestLanding('remote')} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          void loadBrowserFiles(e.target.files, loadXmlFile).then(({ errors }) => {
            for (const err of errors) pushToast({ kind: 'error', message: err });
          });
          e.target.value = '';
        }}
      />

      <div className="explorer-toolbar config-explorer-toolbar">
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
      ) : hierarchyView && hierarchy ? (
        <div className="explorer-sections explorer-hierarchy-view" role="tree" aria-label={t.configurations}>
          {(() => {
            const { roots, orphans } = hierarchy;
            const sharedProps = {
              configurations,
              treeNodes,
              filteredNodeIds,
              kindFilter,
              selectedNodeId,
              selectedPathIds,
              showTechnicalDetails,
              expandMode,
              expandVersion,
              onSelect: selectNode,
              onNavigate: navigateToTreeNode,
              onDoubleClick: handleExplorerDoubleClick,
              onRemove: removeConfiguration,
            };
            const hasAnyRootVisible = roots.some(r =>
              groupHasVisibleContent(r, configurations, treeNodes, filteredNodeIds, kindFilter));
            const hasOrphans = orphans.some(idx => {
              const cfg = configurations[idx];
              return cfg && kindFilter.has(cfg.content.kind as ConfigKind) && filteredNodeIds.has(treeNodes[idx]?.id ?? '');
            });
            if (!hasAnyRootVisible && !hasOrphans) {
              return <div className="explorer-empty-state"><p>{t.noResults}</p></div>;
            }
            return (
              <>
                {roots.map(group => (
                  <ModelGroupSection key={group.configIdx} group={group} depth={0} {...sharedProps} />
                ))}
                {hasOrphans && (
                  <div className="explorer-orphan-section">
                    <div className="explorer-orphan-header">{t.explorerUnlinked}</div>
                    {orphans.map(idx => {
                      const node = treeNodes[idx];
                      const cfg = configurations[idx];
                      if (!node || !cfg) return null;
                      if (!kindFilter.has(cfg.content.kind as ConfigKind)) return null;
                      if (!filteredNodeIds.has(node.id)) return null;
                      return (
                        <TreeNodeRow
                          key={node.id}
                          node={node}
                          depth={0}
                          selectedId={selectedNodeId}
                          selectedPathIds={selectedPathIds}
                          showTechnicalDetails={showTechnicalDetails}
                          version={getBestVersion(cfg)}
                          onSelect={selectNode}
                          onNavigate={navigateToTreeNode}
                          expandMode={expandMode}
                          expandVersion={expandVersion}
                          onDoubleClick={handleExplorerDoubleClick}
                          onCloseConfiguration={(n) => { if (n.configIndex != null) removeConfiguration(n.configIndex); }}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="explorer-sections" role="tree" aria-label={t.configurations}>
          {groupedTreeNodes.map(group => {
            // An empty kind has nothing to show, so it stays visually folded.
            const isCollapsed = !isFiltering && (collapsedGroups.has(group.kind) || group.nodes.length === 0);
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
                    {group.nodes.length === 0 ? (
                      <div className="explorer-kind-group-empty">{t.noResults}</div>
                    ) : group.nodes.map(node => {
                      const cfg = node.configIndex != null ? configurations[node.configIndex] : undefined;
                      const version = getBestVersion(cfg);
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
                          onDoubleClick={handleExplorerDoubleClick}
                          inKindGroup
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
          })}
        </div>
      )}
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
  /** Row sits under a kind group header, which already names the kind. */
  inKindGroup?: boolean;
}

function TreeNodeRow({ node, depth, selectedId, selectedPathIds, showTechnicalDetails, version, onSelect, onNavigate, expandMode, expandVersion, onDoubleClick, onCloseConfiguration, inKindGroup }: TreeNodeRowProps) {
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

  const configurations = useAppStore(s => s.configurations);
  const rawLabel: string | undefined = node.type === 'file' || node.type === 'section'
    ? undefined
    : (typeof node.data?.label === 'string' ? node.data.label : undefined);
  const resolvedLabel = React.useMemo(() => {
    if (!rawLabel || node.configIndex == null) return undefined;
    const text = labelDisplayText(rawLabel, buildLabelPool(configurations, node.configIndex));
    if (!text || text === node.name) return undefined;
    // An unresolved reference is noise, not information — hide it.
    if (looksLikeLabelRef(rawLabel) && text === rawLabel) return undefined;
    return text;
  }, [rawLabel, configurations, node.configIndex, node.name, locale]);

  const isSelected = node.id === selectedId;
  const isAncestor = !isSelected && selectedPathIds.has(node.id);
  // The mapping definition the loaded format actually binds to — bold, so the
  // active one is obvious among sibling DataContainerDescriptor roots.
  const isActiveMappingDefinition = node.data?.isActiveMappingDefinition === true;

  // Selection can come from outside the explorer (designer rows, search,
  // where-used). Ancestors expand above, but the row itself may sit far
  // below the fold — bring it into view. `nearest` keeps a click inside the
  // explorer from jumping the list around.
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!isSelected) return;
    const el = rowRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [isSelected]);
  const accentClass = getExplorerNodeAccentClass(node);
  const sectionKindClass = node.type === 'section' && node.data?.sectionKind
    ? `tree-node-section-kind-${node.data.sectionKind}`
    : '';
  const sectionClass = node.type === 'section' ? 'tree-node-group' : '';
  const parentClass = hasChildren ? 'tree-node-parent' : '';
  const kindLabel = inKindGroup ? getExplorerKindPillInGroup(node) : getExplorerKindLabel(node);
  const canCloseConfiguration = depth === 0 && node.configIndex != null && node.type === 'file';

  return (
    <>
      <div
        ref={rowRef}
        className={`tree-node tree-node-${node.type} ${sectionClass} ${parentClass} ${sectionKindClass} ${accentClass} ${isSelected ? 'selected' : ''} ${isAncestor ? 'ancestor' : ''}`}
        data-depth={depth}
        style={{ paddingLeft: 8 + depth * 16, ['--depth' as string]: depth }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {hasChildren ? (
          <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        ) : (
          <span className="tree-chevron-placeholder" aria-hidden="true" />
        )}
        <span className="icon">{getExplorerNodeIcon(node)}</span>
        <span className="tree-node-label" title={resolvedLabel ? `${node.name} — ${resolvedLabel}` : node.name}>
          <span className={`tree-node-name${isActiveMappingDefinition ? ' tree-node-name--active' : ''}`}>{node.name}</span>
          {resolvedLabel && <span className="tree-node-sublabel">{resolvedLabel}</span>}
        </span>
        {isActiveMappingDefinition && (
          <span className="tree-node-active-pill" title={t.explorerActiveMappingHint}>{t.explorerActiveMapping}</span>
        )}
        {version != null && version !== '' && node.type === 'file' && (
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
      aria-label={label}
    >
      <span className="explorer-kind-chip-icon" aria-hidden="true">{icon}</span>
      <span className="explorer-kind-chip-label">{label}</span>
      <span className="explorer-kind-chip-count">{count}</span>
    </button>
  );
}

// ─── Hierarchical model group section ───

interface ModelGroupSectionProps {
  group: ExplorerModelGroup;
  depth: number;
  configurations: ERConfiguration[];
  treeNodes: TreeNode[];
  filteredNodeIds: Set<string>;
  kindFilter: Set<ConfigKind>;
  selectedNodeId: string | null;
  selectedPathIds: Set<string>;
  showTechnicalDetails: boolean;
  expandMode: 'default' | 'all' | 'none';
  expandVersion: number;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onDoubleClick: (node: TreeNode) => void;
  onRemove: (index: number) => void;
}

function ModelGroupSection({
  group,
  depth,
  configurations,
  treeNodes,
  filteredNodeIds,
  kindFilter,
  selectedNodeId,
  selectedPathIds,
  showTechnicalDetails,
  expandMode,
  expandVersion,
  onSelect,
  onNavigate,
  onDoubleClick,
  onRemove,
}: ModelGroupSectionProps) {
  const modelNode = treeNodes[group.configIdx];
  if (!modelNode) return null;

  const modelVisible = kindFilter.has('DataModel') && filteredNodeIds.has(modelNode.id);

  const visibleChildren = group.children.filter(idx => {
    const cfg = configurations[idx];
    if (!cfg) return false;
    if (!kindFilter.has(cfg.content.kind as ConfigKind)) return false;
    return filteredNodeIds.has(treeNodes[idx]?.id ?? '');
  });

  const visibleSubModels = group.subModels.filter(sub =>
    groupHasVisibleContent(sub, configurations, treeNodes, filteredNodeIds, kindFilter));

  // Check if any nested content is visible before rendering the group at all.
  const hasVisible = modelVisible || visibleChildren.length > 0 || visibleSubModels.length > 0;
  if (!hasVisible) return null;

  const sharedRowProps = (idx: number) => {
    const cfg = configurations[idx];
    return {
      depth: 0 as const,
      selectedId: selectedNodeId,
      selectedPathIds,
      showTechnicalDetails,
      version: getBestVersion(cfg),
      onSelect,
      onNavigate,
      expandMode,
      expandVersion,
      onDoubleClick,
      onCloseConfiguration: (n: TreeNode) => { if (n.configIndex != null) onRemove(n.configIndex); },
    };
  };

  // Indent child items with a subtle left border guide. The model node
  // itself sits flush with the current indent level.
  const childIndent: React.CSSProperties = depth === 0
    ? { paddingLeft: 12, borderLeft: '2px solid var(--border-subtle, rgba(128,128,128,0.2))', marginLeft: 4 }
    : { paddingLeft: 8, borderLeft: '2px solid var(--border-subtle, rgba(128,128,128,0.2))', marginLeft: 4 };

  return (
    <div className="explorer-model-hierarchy-group">
      {modelVisible && (
        <TreeNodeRow
          key={modelNode.id}
          node={modelNode}
          {...sharedRowProps(group.configIdx)}
        />
      )}
      {(visibleChildren.length > 0 || visibleSubModels.length > 0) && (
        <div style={childIndent}>
          {visibleChildren.map(idx => {
            const node = treeNodes[idx];
            return (
              <TreeNodeRow
                key={node.id}
                node={node}
                {...sharedRowProps(idx)}
              />
            );
          })}
          {visibleSubModels.map(subGroup => (
            <ModelGroupSection
              key={subGroup.configIdx}
              group={subGroup}
              depth={depth + 1}
              configurations={configurations}
              treeNodes={treeNodes}
              filteredNodeIds={filteredNodeIds}
              kindFilter={kindFilter}
              selectedNodeId={selectedNodeId}
              selectedPathIds={selectedPathIds}
              showTechnicalDetails={showTechnicalDetails}
              expandMode={expandMode}
              expandVersion={expandVersion}
              onSelect={onSelect}
              onNavigate={onNavigate}
              onDoubleClick={onDoubleClick}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
