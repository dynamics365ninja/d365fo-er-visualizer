import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components';
import {
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
import { locale, t, useLocale } from '../i18n';
import { treeArrowAction } from '../utils/tree-keyboard';
import { flattenVisibleTree, indexFlatRows, type FlatTreeRow } from '../utils/flat-tree';
import { useTreeOpenState } from '../utils/use-tree-open-state';
import { useVirtualTree } from '../utils/use-virtual-tree';
import { useAppStore, focusedTabId, lastActiveFormatIndex, type TreeNode } from '../state/store';
import { ERDirection } from '@er-visualizer/core';
import type { ERConfiguration } from '@er-visualizer/core';
import { buildExplorerModelGroups, getDisplayVersion, type ExplorerModelGroup } from '../utils/model-hierarchy';
import { getNodeDisplayName, isXmlNamespaceDeclaration } from '../utils/consultant-labels';
import { getActiveFormatDescriptors, collectActiveScopeNodeIds } from '../utils/active-format-scope';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { buildLabelPool, labelDisplayText, labelLanguageTag, looksLikeLabelRef } from '../utils/label-resolver';
import { useCoarsePointer } from '../utils/responsive';
import { countTerms, suggestionsFromCounts, type FilterSuggestion } from '../utils/filter-suggestions';
import { FilterField } from './FilterField';
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
  // The mapping-definition row is named after the definition itself, so the
  // pill is what says it is a mapping. Configuration rows still get theirs.
  if (kind === 'ModelMapping') return labels.ModelMapping;
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

/**
 * The filter chips get one grid column each, which is not enough for
 * "Datové modely" / "Mapování modelu" — those were cut mid-word. The full
 * label stays on the chip's tooltip.
 */
function getExplorerChipLabel(kind: 'DataModel' | 'ModelMapping' | 'Format'): string {
  if (locale === 'cs') {
    return kind === 'DataModel' ? 'Modely' : kind === 'ModelMapping' ? 'Mapování' : 'Formáty';
  }
  return kind === 'DataModel' ? 'Models' : kind === 'ModelMapping' ? 'Mappings' : 'Formats';
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

/**
 * The explorer view of one configuration tree.
 *
 * A model mapping is explored as a plain list of its definitions: the data
 * sources, bindings and validations underneath one definition are three more
 * levels of tree for content the designer already lays out with room to read
 * it, so they are dropped here. Formats keep their embedded mapping subtrees —
 * there the mapping is a part of the format, not the thing being explored.
 * The store tree stays untouched, so search, where-used and navigation still
 * resolve every node inside a mapping.
 */
function toExplorerTreeNode(node: TreeNode, config: ERConfiguration | undefined): TreeNode {
  if (config?.content.kind !== 'ModelMapping') return node;
  if (!node.children?.length) return node;
  return {
    ...node,
    children: node.children.map(child => (
      child.type === 'mapping' && child.children?.length ? { ...child, children: undefined } : child
    )),
  };
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
  const childVisible = group.children.some(idx => isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter));
  if (childVisible) return true;
  return group.subModels.some(sub => groupHasVisibleContent(sub, configurations, treeNodes, filteredNodeIds, kindFilter));
}

/** A configuration passes both the kind chips and the text filter. */
function isConfigVisible(
  idx: number,
  configurations: ERConfiguration[],
  treeNodes: TreeNode[],
  filteredNodeIds: Set<string>,
  kindFilter: Set<ConfigKind>,
): boolean {
  const cfg = configurations[idx];
  return !!cfg
    && kindFilter.has(cfg.content.kind as ConfigKind)
    && filteredNodeIds.has(treeNodes[idx]?.id ?? '');
}

/**
 * What one model group of the hierarchy view shows. Shared by
 * `ModelGroupSection`, which renders it, and `hierarchyRootNodes`, which
 * lists the same rows in the same order for keyboard navigation.
 */
function visibleGroupParts(
  group: ExplorerModelGroup,
  configurations: ERConfiguration[],
  treeNodes: TreeNode[],
  filteredNodeIds: Set<string>,
  kindFilter: Set<ConfigKind>,
) {
  const modelNode: TreeNode | undefined = treeNodes[group.configIdx];
  const modelVisible = !!modelNode && kindFilter.has('DataModel') && filteredNodeIds.has(modelNode.id);
  const visibleChildren = group.children.filter(idx => isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter));
  const visibleSubModels = group.subModels.filter(sub =>
    groupHasVisibleContent(sub, configurations, treeNodes, filteredNodeIds, kindFilter));
  return { modelNode, modelVisible, visibleChildren, visibleSubModels };
}

/** The configuration rows of the hierarchy view, in the order they are rendered. */
function hierarchyRootNodes(
  hierarchy: { roots: ExplorerModelGroup[]; orphans: number[] },
  configurations: ERConfiguration[],
  treeNodes: TreeNode[],
  filteredNodeIds: Set<string>,
  kindFilter: Set<ConfigKind>,
): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (group: ExplorerModelGroup) => {
    const { modelNode, modelVisible, visibleChildren, visibleSubModels } = visibleGroupParts(group, configurations, treeNodes, filteredNodeIds, kindFilter);
    if (!modelNode) return;
    if (modelVisible) out.push(modelNode);
    for (const idx of visibleChildren) out.push(treeNodes[idx]);
    visibleSubModels.forEach(visit);
  };
  hierarchy.roots.forEach(visit);
  for (const idx of hierarchy.orphans) {
    if (treeNodes[idx] && isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter)) out.push(treeNodes[idx]);
  }
  return out;
}

/** The children a row shows: namespace declarations only in the technical view. */
function explorerChildren(node: TreeNode, showTechnicalDetails: boolean): TreeNode[] | undefined {
  return showTechnicalDetails
    ? node.children
    : node.children?.filter(child => !(child.type === 'formatElement' && isXmlNamespaceDeclaration(child.data)));
}

/** Whether a row is open before the user touches it, per expand mode. */
function defaultExpanded(expandMode: 'default' | 'all' | 'none', depth: number): boolean {
  if (expandMode === 'all') return true;
  if (expandMode === 'none') return false;
  return depth === 0;
}

/** Rows virtualized together: a kind group in the flat view, one configuration in the hierarchy view. */
interface ExplorerBlock {
  key: string;
  roots: TreeNode[];
  /** Root rows sit under a kind group header, which already names the kind. */
  inKindGroup: boolean;
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
  const storeTreeNodes = useAppStore(s => s.treeNodes);
  const configurations = useAppStore(s => s.configurations);
  // Everything the explorer renders goes through the pruned view; the store
  // tree stays the one that node ids and navigation are resolved against.
  const treeNodes = useMemo(
    () => storeTreeNodes.map((node, idx) => toExplorerTreeNode(node, configurations[idx])),
    [storeTreeNodes, configurations],
  );
  const activeTabId = useAppStore(focusedTabId);
  const openTabs = useAppStore(s => s.openTabs);
  const lastFormatIndex = useAppStore(lastActiveFormatIndex);
  const storeSelectedNodeId = useAppStore(s => s.selectedNodeId);
  const explorerMutedSelectionId = useAppStore(s => s.explorerMutedSelectionId);
  // A muted selection (walking the format designer's structure) neither
  // expands, highlights nor scrolls the explorer.
  const selectedNodeId = storeSelectedNodeId === explorerMutedSelectionId ? null : storeSelectedNodeId;
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const removeConfiguration = useAppStore(s => s.closeConfigurationWithUndo);
  const closeAllConfigurationsWithUndo = useAppStore(s => s.closeAllConfigurationsWithUndo);
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

  // The mapping definition / model root the *active* format binds to. Computed
  // here (not while the tree is built) so switching designer tabs re-points the
  // highlight instead of freezing on whichever format loaded first. On a
  // mapping or model tab the format that was active last still decides.
  const activeScopeNodeIds = useMemo(() => {
    const activeConfigIndex = openTabs.find(tab => tab.id === activeTabId)?.configIndex ?? null;
    return collectActiveScopeNodeIds(
      storeTreeNodes,
      getActiveFormatDescriptors(configurations, activeConfigIndex)
        ?? getActiveFormatDescriptors(configurations, lastFormatIndex),
    );
  }, [storeTreeNodes, configurations, openTabs, activeTabId, lastFormatIndex]);

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
  // Ancestors come from the store tree: a node selected from search or
  // where-used can sit below a pruned mapping definition, and its definition
  // row still has to open and highlight.
  const selectedPathIds = useMemo(() => collectAncestorIds(storeTreeNodes, selectedNodeId), [storeTreeNodes, selectedNodeId]);

  // Stable, so memoized rows are not re-rendered by a fresh closure each time.
  const closeConfigurationNode = useCallback((node: TreeNode) => {
    if (node.configIndex != null) removeConfiguration(node.configIndex);
  }, [removeConfiguration]);

  const treeRef = React.useRef<HTMLDivElement>(null);
  // The row that has focus stays mounted until focus moves on, so an arrow
  // key pressed after scrolling it out of view does not lose focus with it.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const treeFocusProps = {
    onFocus: (event: React.FocusEvent<HTMLDivElement>) => setFocusedRowId((event.target as HTMLElement).dataset.nodeId ?? null),
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedRowId(null);
    },
  };

  // Counts across the full unfiltered set, so filtering never disables a chip.
  const kindCounts = useMemo(() => {
    const counts: Record<ConfigKind, number> = { DataModel: 0, ModelMapping: 0, Format: 0 };
    for (const node of treeNodes) {
      const kind = getConfigurationKind(node);
      if (kind) counts[kind] += 1;
    }
    return counts;
  }, [treeNodes]);

  /* Terms the explorer filter can actually hit, grouped by configuration kind.
     Row names carry trailing detail — a binding's expression, a definition's
     descriptor and version — separated by a double space; suggesting the whole
     string would be unreadable, and the leading name filters just as well. */
  const filterSuggestions = useMemo<FilterSuggestion[]>(() => {
    const byKind = new Map<ConfigKind, string[]>();
    const collect = (node: TreeNode, bucket: string[]) => {
      if (node.type !== 'section') bucket.push(node.name.split('  ')[0]);
      for (const child of node.children ?? []) collect(child, bucket);
    };
    treeNodes.forEach((node, idx) => {
      const kind = configurations[idx]?.content.kind as ConfigKind | undefined;
      if (!kind) return;
      const bucket = byKind.get(kind) ?? [];
      collect(node, bucket);
      byKind.set(kind, bucket);
    });
    return (['DataModel', 'ModelMapping', 'Format'] as const)
      .flatMap(kind => suggestionsFromCounts(countTerms(byKind.get(kind) ?? []), getExplorerGroupLabel(kind)));
  }, [treeNodes, configurations]);

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

  /*
   * The rows are virtualized: each block (a kind group, or one configuration
   * in the hierarchy view) is flattened into the rows it shows and only those
   * near the viewport are mounted. Open/closed state therefore lives here, not
   * in the rows — per-row overrides on top of the expand mode, dropped by the
   * next expand-all / collapse-all as the rows used to reset themselves.
   */
  const { overrides: openOverrides, setOpen } = useTreeOpenState(`${expandMode}#${expandVersion}`);

  // Selection can come from outside the explorer (designer rows, search,
  // where-used): open every row on the way down to it.
  React.useEffect(() => {
    if (selectedPathIds.size > 0) setOpen(selectedPathIds, true);
  }, [selectedPathIds, setOpen]);

  const blocks = useMemo<ExplorerBlock[]>(() => {
    if (hierarchyView) {
      if (!hierarchy) return [];
      return hierarchyRootNodes(hierarchy, configurations, treeNodes, filteredNodeIds, kindFilter)
        .map(node => ({ key: node.id, roots: [node], inKindGroup: false }));
    }
    return groupedTreeNodes
      // An empty kind has nothing to show, so it stays visually folded.
      .filter(group => group.nodes.length > 0 && (isFiltering || !collapsedGroups.has(group.kind)))
      .map(group => ({ key: `kind:${group.kind}`, roots: group.nodes, inKindGroup: true }));
  }, [hierarchyView, hierarchy, configurations, treeNodes, filteredNodeIds, kindFilter, groupedTreeNodes, isFiltering, collapsedGroups]);

  const blockRows = useMemo(() => {
    const map = new Map<string, FlatTreeRow<TreeNode>[]>();
    for (const block of blocks) {
      map.set(block.key, flattenVisibleTree(block.roots, {
        getId: node => node.id,
        getChildren: node => explorerChildren(node, showTechnicalDetails),
        isExpanded: (node, _context, depth) => openOverrides.get(node.id) ?? defaultExpanded(expandMode, depth),
      }));
    }
    return map;
  }, [blocks, showTechnicalDetails, openOverrides, expandMode]);

  // Every shown row in display order, across blocks — what ↑ / ↓, Home and
  // End walk, whether or not the target row is mounted.
  const allRows = useMemo(() => blocks.flatMap(block => blockRows.get(block.key) ?? []), [blocks, blockRows]);
  const allRowIndex = useMemo(() => indexFlatRows(allRows), [allRows]);

  /*
   * Roving tabindex: the tree is one tab stop, on the selected row. When the
   * selection is not among the shown rows (nothing selected, filtered out,
   * folded into a collapsed kind group) the first row takes the tab stop, so
   * the tree never drops out of the tab order.
   */
  const fallbackTabStopId = selectedNodeId && allRowIndex.has(selectedNodeId) ? null : (allRows[0]?.id ?? null);

  const navRef = React.useRef({ allRows, allRowIndex });
  navRef.current = { allRows, allRowIndex };

  /** WAI-ARIA tree keys: arrows walk and fold, Home / End jump, Enter / Space select. */
  const handleRowKeyDown = useCallback((id: string, event: React.KeyboardEvent<HTMLDivElement>) => {
    const { allRows: rows, allRowIndex: index } = navRef.current;
    const at = index.get(id);
    if (at == null) return;
    const row = rows[at];

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(id);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? rows[0] : rows[rows.length - 1];
      if (target) selectNode(target.id);
      return;
    }
    const action = treeArrowAction(event.key, {
      hasChildren: row.hasChildren,
      expanded: row.expanded,
      collapsible: true,
      hasParent: row.parentId != null,
    });
    if (!action) return;
    event.preventDefault();
    if (action === 'expand') setOpen(id, true);
    else if (action === 'collapse') setOpen(id, false);
    else if (action === 'parent') selectNode(row.parentId!);
    else {
      // An open row's first child is simply the next row.
      const target = rows[at + (action === 'previous' ? -1 : 1)];
      if (target) selectNode(target.id);
    }
  }, [selectNode, setOpen]);

  const treeContext = useMemo<ExplorerTreeContextValue>(() => ({
    blockRows,
    scrollRef: treeRef,
    selectedNodeId,
    selectedPathIds,
    fallbackTabStopId,
    focusedRowId,
    showTechnicalDetails,
    onSelect: selectNode,
    onToggle: setOpen,
    onRowKeyDown: handleRowKeyDown,
    onDoubleClick: handleExplorerDoubleClick,
    onCloseConfiguration: closeConfigurationNode,
  }), [blockRows, selectedNodeId, selectedPathIds, fallbackTabStopId, focusedRowId, showTechnicalDetails, selectNode, setOpen, handleRowKeyDown, handleExplorerDoubleClick, closeConfigurationNode]);

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
    <ActiveScopeContext.Provider value={activeScopeNodeIds}>
    <ExplorerTreeContext.Provider value={treeContext}>
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
        <span className="explorer-panel-spacer" />
        <Button
          appearance="subtle"
          size="small"
          className="explorer-workspace-button"
          icon={<AppsListDetailRegular />}
          aria-label={t.workspaceManager}
          title={t.workspaceManager}
          onClick={() => setWorkspaceOpen(true)}
        >
          {t.workspaceManager}
        </Button>
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
              <MenuItem icon={<DismissSquareMultipleRegular />} onClick={closeAllConfigurationsWithUndo}>
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
          <FilterField
            value={filterQuery}
            onChange={setFilterQuery}
            placeholder={t.explorerFilterPlaceholder}
            suggestions={filterSuggestions}
            historyScope="explorer"
            className="explorer-filter-field"
          />
        </div>

        <div className="explorer-chip-row" role="toolbar" aria-label={t.explorerFilterByKind}>
          <ExplorerKindChip
            kind="DataModel"
            active={kindFilter.has('DataModel')}
            disabled={kindCounts.DataModel === 0}
            onToggle={() => toggleKind('DataModel')}
            icon={<DataBarVerticalFilled />}
          />
          <ExplorerKindChip
            kind="ModelMapping"
            active={kindFilter.has('ModelMapping')}
            disabled={kindCounts.ModelMapping === 0}
            onToggle={() => toggleKind('ModelMapping')}
            icon={<LinkFilled />}
          />
          <ExplorerKindChip
            kind="Format"
            active={kindFilter.has('Format')}
            disabled={kindCounts.Format === 0}
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
        <div ref={treeRef} {...treeFocusProps} className="explorer-sections explorer-hierarchy-view" role="tree" aria-label={t.configurations}>
          {(() => {
            const { roots, orphans } = hierarchy;
            const sharedProps = {
              configurations,
              treeNodes,
              filteredNodeIds,
              kindFilter,
            };
            const hasAnyRootVisible = roots.some(r =>
              groupHasVisibleContent(r, configurations, treeNodes, filteredNodeIds, kindFilter));
            const hasOrphans = orphans.some(idx => isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter));
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
                      if (!node || !isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter)) return null;
                      return <ExplorerTreeBlock key={node.id} blockKey={node.id} />;
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <div ref={treeRef} {...treeFocusProps} className="explorer-sections" role="tree" aria-label={t.configurations}>
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
                </button>
                {!isCollapsed && (
                  <div className="explorer-kind-group-body">
                    {group.nodes.length === 0 ? (
                      <div className="explorer-kind-group-empty">{t.noResults}</div>
                    ) : (
                      <ExplorerTreeBlock blockKey={`kind:${group.kind}`} inKindGroup />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </ExplorerTreeContext.Provider>
    </ActiveScopeContext.Provider>
  );
}

/**
 * Node ids that belong to the active format's scope. Read deep inside the
 * recursive row component, so a context beats drilling a prop through every
 * level of the tree.
 */
const ActiveScopeContext = React.createContext<ReadonlySet<string>>(new Set<string>());

interface ExplorerTreeContextValue {
  /** Each block's shown rows, keyed by block (see {@link ExplorerBlock}). */
  blockRows: ReadonlyMap<string, FlatTreeRow<TreeNode>[]>;
  /** The explorer's scroll pane, which every block virtualizes against. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  selectedNodeId: string | null;
  selectedPathIds: ReadonlySet<string>;
  /** The row that holds the tree's tab stop when the selected row is not shown. */
  fallbackTabStopId: string | null;
  /** The row that has focus, kept mounted while it does. */
  focusedRowId: string | null;
  showTechnicalDetails: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, open: boolean) => void;
  onRowKeyDown: (id: string, event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: (node: TreeNode) => void;
  onCloseConfiguration: (node: TreeNode) => void;
}

/** What the blocks need from the explorer, wherever in the layout they sit. */
const ExplorerTreeContext = React.createContext<ExplorerTreeContextValue | null>(null);

const NO_SELECTION_PATH: ReadonlySet<string> = new Set<string>();
const NO_ROWS: FlatTreeRow<TreeNode>[] = [];

/** Rendered row height before it is measured. */
const ESTIMATED_ROW_HEIGHT = 30;

/**
 * The selection as a row sees it. Only rows on the path to the selected node
 * are handed the selection; every other row gets the same `null` and empty
 * set on every render, so a selection change re-renders just the old and the
 * new path instead of the whole (memoized) tree.
 */
function selectionFor(id: string, selectedId: string | null, selectedPathIds: ReadonlySet<string>) {
  return id === selectedId || selectedPathIds.has(id)
    ? { selectedId, selectedPathIds }
    : { selectedId: null, selectedPathIds: NO_SELECTION_PATH };
}

/**
 * One virtualized run of explorer rows: a kind group's configurations in the
 * flat view, or one configuration in the hierarchy view, with everything open
 * below them. Only the rows near the viewport are mounted; the row holding the
 * tab stop always is, so focus survives scrolling it away.
 */
function ExplorerTreeBlock({ blockKey, inKindGroup }: { blockKey: string; inKindGroup?: boolean }) {
  const ctx = React.useContext(ExplorerTreeContext)!;
  const configurations = useAppStore(s => s.configurations);
  const rows = ctx.blockRows.get(blockKey) ?? NO_ROWS;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rowIndex = useMemo(() => indexFlatRows(rows), [rows]);
  const selectedIndex = ctx.selectedNodeId ? rowIndex.get(ctx.selectedNodeId) : undefined;
  const tabStopIndex = selectedIndex ?? (ctx.fallbackTabStopId ? rowIndex.get(ctx.fallbackTabStopId) : undefined);

  const { virtualizer, scrollMargin } = useVirtualTree({
    rows,
    scrollRef: ctx.scrollRef,
    containerRef,
    estimateSize: ESTIMATED_ROW_HEIGHT,
    pinned: [tabStopIndex, ctx.focusedRowId ? rowIndex.get(ctx.focusedRowId) : undefined],
  });

  // Selection can come from outside the explorer (designer rows, search,
  // where-used). Ancestors expand above, but the row itself may sit far
  // below the fold — bring it into view. `auto` keeps a click inside the
  // explorer from jumping the list around. Once per selection, and again if
  // the row is folded away and comes back, as the remounted row used to.
  const scrolledToRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = ctx.selectedNodeId;
    if (!id || selectedIndex == null) { scrolledToRef.current = null; return; }
    // Not before the virtualizer has found the pane (see useVirtualTree) —
    // this runs again on the render that attaches it.
    if (scrolledToRef.current === id || !virtualizer.scrollElement) return;
    scrolledToRef.current = id;
    // Arrow keys move the selection, so focus follows it — but only while
    // focus is already in the tree, never pulled in from elsewhere. The
    // selected row is pinned, so it is rendered even before the scroll lands.
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    const tree = containerRef.current?.closest('[role="tree"]');
    if (el && tree && document.activeElement !== el && tree.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
    virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => {
        const row = rows[item.index];
        if (!row) return null;
        const node = row.node;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <TreeNodeRow
              node={node}
              depth={row.depth}
              expanded={row.expanded}
              hasChildren={row.hasChildren}
              posInSet={row.posInSet}
              setSize={row.setSize}
              isTabStop={item.index === tabStopIndex}
              {...selectionFor(node.id, ctx.selectedNodeId, ctx.selectedPathIds)}
              showTechnicalDetails={ctx.showTechnicalDetails}
              version={row.depth === 0 && node.configIndex != null
                ? getDisplayVersion(configurations[node.configIndex], ctx.showTechnicalDetails)
                : undefined}
              onSelect={ctx.onSelect}
              onToggle={ctx.onToggle}
              onRowKeyDown={ctx.onRowKeyDown}
              onDoubleClick={ctx.onDoubleClick}
              onCloseConfiguration={ctx.onCloseConfiguration}
              inKindGroup={inKindGroup && row.depth === 0}
            />
          </div>
        );
      })}
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  /** The row's children are shown. */
  expanded: boolean;
  hasChildren: boolean;
  /** Position among the shown siblings — most of them are not in the DOM. */
  posInSet: number;
  setSize: number;
  /** The row holds the tree's single tab stop. */
  isTabStop: boolean;
  /** The selected node — only set on rows on its path (see {@link selectionFor}). */
  selectedId: string | null;
  selectedPathIds: ReadonlySet<string>;
  showTechnicalDetails: boolean;
  version?: string | number;
  onSelect: (id: string) => void;
  onToggle: (id: string, open: boolean) => void;
  onRowKeyDown: (id: string, event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: (node: TreeNode) => void;
  onCloseConfiguration: (node: TreeNode) => void;
  /** Row sits under a kind group header, which already names the kind. */
  inKindGroup?: boolean;
}

const TreeNodeRow = React.memo(function TreeNodeRowView({ node, depth, expanded, hasChildren, posInSet, setSize, isTabStop, selectedId, selectedPathIds, showTechnicalDetails, version, onSelect, onToggle, onRowKeyDown, onDoubleClick, onCloseConfiguration, inKindGroup }: TreeNodeRowProps) {
  const displayName = getNodeDisplayName(node, showTechnicalDetails);

  const handleClick = useCallback(() => {
    onSelect(node.id);
    if (hasChildren) onToggle(node.id, !expanded);
  }, [node.id, hasChildren, expanded, onSelect, onToggle]);

  const handleDoubleClick = useCallback(() => {
    onDoubleClick(node);
  }, [node, onDoubleClick]);

  const configurations = useAppStore(s => s.configurations);
  // A memoized row is not re-rendered by its parent on a language switch, so
  // it listens for one itself — its labels and kind pills are localized.
  const activeLocale = useLocale();
  const rawLabel: string | undefined = node.type === 'file' || node.type === 'section'
    ? undefined
    : (typeof node.data?.label === 'string' ? node.data.label : undefined);
  const resolvedLabel = React.useMemo(() => {
    if (!rawLabel || node.configIndex == null) return undefined;
    const text = labelDisplayText(rawLabel, buildLabelPool(configurations, node.configIndex), labelLanguageTag(activeLocale));
    if (!text || text === node.name) return undefined;
    // An unresolved reference is noise, not information — hide it.
    if (looksLikeLabelRef(rawLabel) && text === rawLabel) return undefined;
    return text;
  }, [rawLabel, configurations, node.configIndex, node.name, activeLocale]);

  const isSelected = node.id === selectedId;
  const isAncestor = !isSelected && selectedPathIds.has(node.id);
  // The mapping definition / model root the format in the active designer tab
  // binds to — bold, so the relevant one is obvious among its siblings. Falls
  // back to the tree's build-time guess when no format tab is active.
  const activeScopeIds = React.useContext(ActiveScopeContext);
  const isActiveMappingDefinition = activeScopeIds.size > 0
    ? activeScopeIds.has(node.id)
    : node.data?.isActiveMappingDefinition === true;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys from the row's menu button stay with the button; modified keys are
    // workspace shortcuts (Alt+Left / Alt+Right walk the navigation history).
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // The explorer walks its flat list of shown rows, so ↑ / ↓ reach rows
    // that are not mounted yet.
    onRowKeyDown(node.id, event);
  };
  const accentClass = getExplorerNodeAccentClass(node);
  const sectionKindClass = node.type === 'section' && node.data?.sectionKind
    ? `tree-node-section-kind-${node.data.sectionKind}`
    : '';
  const sectionClass = node.type === 'section' ? 'tree-node-group' : '';
  const parentClass = hasChildren ? 'tree-node-parent' : '';
  const kindLabel = inKindGroup ? getExplorerKindPillInGroup(node) : getExplorerKindLabel(node);
  const canCloseConfiguration = depth === 0 && node.configIndex != null && node.type === 'file';
  // Double-tap is unreliable on touch (it competes with the platform's own
  // zoom gesture), so on a coarse pointer every node that responds to a
  // double-click gets an explicit menu entry instead.
  const coarse = useCoarsePointer();
  const showRowMenu = canCloseConfiguration || (coarse && node.configIndex != null);

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-selected={isSelected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={isTabStop ? 0 : -1}
      data-node-id={node.id}
      className={`tree-node tree-node-${node.type} ${sectionClass} ${parentClass} ${sectionKindClass} ${accentClass} ${isSelected ? 'selected' : ''} ${isAncestor ? 'ancestor' : ''}`}
      data-depth={depth}
      // Absolutely positioned rows don't collapse their margins into each
      // other, so only the top one is kept.
      style={{ paddingLeft: 8 + depth * 16, marginBottom: 0, ['--depth' as string]: depth }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {hasChildren ? (
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
      ) : (
        <span className="tree-chevron-placeholder" aria-hidden="true" />
      )}
      <span className="icon">{getExplorerNodeIcon(node)}</span>
      <span className="tree-node-label" title={resolvedLabel ? `${displayName} — ${resolvedLabel}` : displayName}>
        <span className={`tree-node-name${isActiveMappingDefinition ? ' tree-node-name--active' : ''}`}>{displayName}</span>
        {resolvedLabel && <span className="tree-node-sublabel">{resolvedLabel}</span>}
      </span>
      {isActiveMappingDefinition && (
        <span className="tree-node-active-pill" title={t.explorerActiveMappingHint}>{t.explorerActiveMapping}</span>
      )}
      {version != null && version !== '' && node.type === 'file' && (
        <span className="tree-node-version-pill" title={`v${version}`}>v{version}</span>
      )}
      {kindLabel && <span className="tree-node-kind-pill">{kindLabel}</span>}
      {showRowMenu && (
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
                onClick={() => onDoubleClick(node)}
              >
                {t.explorerOpenInTab}
              </MenuItem>
              {canCloseConfiguration && (
                <MenuItem
                  icon={<DeleteRegular />}
                  onClick={() => onCloseConfiguration(node)}
                >
                  {t.closeConfiguration}
                </MenuItem>
              )}
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
  );
});

// ─── Kind filter chip ───

function ExplorerKindChip({
  kind, active, disabled, onToggle, icon,
}: {
  kind: ConfigKind;
  active: boolean;
  /** Nothing of this kind is loaded, so there is nothing to filter. */
  disabled: boolean;
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
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <span className="explorer-kind-chip-icon" aria-hidden="true">{icon}</span>
      <span className="explorer-kind-chip-label">{getExplorerChipLabel(kind)}</span>
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
}

function ModelGroupSection({
  group,
  depth,
  configurations,
  treeNodes,
  filteredNodeIds,
  kindFilter,
}: ModelGroupSectionProps) {
  const { modelNode, modelVisible, visibleChildren, visibleSubModels } = visibleGroupParts(group, configurations, treeNodes, filteredNodeIds, kindFilter);
  if (!modelNode) return null;

  // Check if any nested content is visible before rendering the group at all.
  const hasVisible = modelVisible || visibleChildren.length > 0 || visibleSubModels.length > 0;
  if (!hasVisible) return null;

  // Indent child items with a subtle left border guide. The model node
  // itself sits flush with the current indent level.
  const childIndent: React.CSSProperties = depth === 0
    ? { paddingLeft: 12, borderLeft: '2px solid var(--border-subtle, rgba(128,128,128,0.2))', marginLeft: 4 }
    : { paddingLeft: 8, borderLeft: '2px solid var(--border-subtle, rgba(128,128,128,0.2))', marginLeft: 4 };

  // Each configuration is its own virtualized block (with everything open
  // below it), so the indent guides stay plain nested boxes.
  return (
    <div className="explorer-model-hierarchy-group">
      {modelVisible && <ExplorerTreeBlock key={modelNode.id} blockKey={modelNode.id} />}
      {(visibleChildren.length > 0 || visibleSubModels.length > 0) && (
        <div style={childIndent}>
          {visibleChildren.map(idx => {
            const node = treeNodes[idx];
            return <ExplorerTreeBlock key={node.id} blockKey={node.id} />;
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
