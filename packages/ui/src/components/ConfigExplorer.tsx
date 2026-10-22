import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
  type PositioningVirtualElement,
} from '@fluentui/react-components';
import {
  AddRegular,
  AppsListDetailRegular,
  ArrowDownloadRegular,
  ArrowDownRegular,
  ArrowSyncRegular,
  ArrowUpRegular,
  ArrowUploadRegular,
  BracesRegular,
  BranchCompareRegular,
  BranchForkRegular,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  ChevronRightRegular,
  CircleSmallFilled,
  DataBarVerticalFilled,
  DatabaseRegular,
  DeleteRegular,
  DismissRegular,
  DismissSquareMultipleRegular,
  DocumentFilled,
  DocumentRegular,
  FolderOpenRegular,
  FolderRegular,
  LinkFilled,
  LinkRegular,
  ListRegular,
  MoreHorizontalRegular,
  ArrowResetRegular,
  NumberSymbolSquareRegular,
  OpenRegular,
  SearchRegular,
  TagRegular,
  TextBulletListTreeRegular,
  TextCollapseRegular,
  TextExpandRegular,
} from '@fluentui/react-icons';
import { whereUsedQueryFor, whereUsedTargetFor } from '../utils/where-used-query';
import { t, useLocale } from '../i18n';
import { treeArrowAction } from '../utils/tree-keyboard';
import { flattenVisibleTree, indexFlatRows, type FlatTreeRow } from '../utils/flat-tree';
import { useTreeOpenState } from '../utils/use-tree-open-state';
import { useVirtualTree } from '../utils/use-virtual-tree';
import { useAppStore, focusedTabId, lastActiveFormatIndex, type TreeNode } from '../state/store';
import { baseReference, knownBaseKind } from '../state/base-configuration';
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
import { FormatElementIcon, getFormatTypeColor } from './designers/format-type';
import {
  DEFAULT_SECTION_ORDER,
  arrangeSections,
  dropSection,
  loadSectionLayout,
  moveSection,
  saveSectionLayout,
} from '../utils/explorer-sections';

type ConfigKind = 'DataModel' | 'ModelMapping' | 'Format';
type SortMode = 'loadOrder' | 'nameAsc' | 'nameDesc';

const KINDS: readonly ConfigKind[] = ['DataModel', 'ModelMapping', 'Format'];
const KIND_ACCENT: Record<ConfigKind, 'model' | 'mapping' | 'format'> = { DataModel: 'model', ModelMapping: 'mapping', Format: 'format' };

/** Indentation per tree level and the row's own left padding — VS Code's tree metrics. */
const INDENT = 8;
const ROW_PAD = 8;

function getFormatDirectionLabel(direction: ERDirection | undefined): string {
  if (direction === ERDirection.Import) return t.formatDirectionImport;
  if (direction === ERDirection.Export) return t.formatDirectionExport;
  return t.formatDirectionUnknown;
}

function getConfigurationKind(node: TreeNode): ConfigKind | undefined {
  const kind = node.data?.kind ?? node.data?.content?.kind;
  if (kind === 'DataModel' || kind === 'ModelMapping' || kind === 'Format') {
    return kind;
  }
  return undefined;
}

function getExplorerGroupLabel(kind: ConfigKind): string {
  return t.explorerGroupLabels[kind];
}

function KindIcon({ kind, fontSize = 16 }: { kind: ConfigKind; fontSize?: number }) {
  if (kind === 'DataModel') return <DataBarVerticalFilled fontSize={fontSize} />;
  if (kind === 'ModelMapping') return <LinkFilled fontSize={fontSize} />;
  return <DocumentFilled fontSize={fontSize} />;
}

/**
 * The row's icon, as a file icon theme would draw it: the configuration kind
 * in its colour, a folder for a section (open while expanded), the format
 * element's type, and a plain glyph for the rest.
 */
function ExplorerNodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  const kind = getConfigurationKind(node);
  if (node.type === 'file' && kind) {
    return <span className={`vx-icon vx-icon--${KIND_ACCENT[kind]}`}><KindIcon kind={kind} /></span>;
  }
  switch (node.type) {
    case 'section':
      return <span className="vx-icon vx-icon--folder">{expanded ? <FolderOpenRegular fontSize={16} /> : <FolderRegular fontSize={16} />}</span>;
    case 'formatElement': {
      const type = String(node.data?.elementType ?? '');
      return <span className="vx-icon" style={{ color: getFormatTypeColor(type) }}><FormatElementIcon type={type} fontSize={16} /></span>;
    }
    case 'datasource':
      return <span className="vx-icon vx-icon--datasource"><DatabaseRegular fontSize={16} /></span>;
    case 'mapping':
      return <span className="vx-icon vx-icon--mapping"><LinkFilled fontSize={16} /></span>;
    case 'binding':
    case 'formatBinding':
      return <span className="vx-icon vx-icon--binding"><LinkRegular fontSize={16} /></span>;
    case 'validation':
      return <span className="vx-icon vx-icon--validation"><CheckmarkCircleRegular fontSize={16} /></span>;
    case 'transformation':
      return <span className="vx-icon vx-icon--transformation"><ArrowSyncRegular fontSize={16} /></span>;
    case 'container':
      return <span className="vx-icon vx-icon--record"><BracesRegular fontSize={16} /></span>;
    case 'field':
      return <span className="vx-icon vx-icon--field"><TagRegular fontSize={16} /></span>;
    case 'enum':
      return <span className="vx-icon vx-icon--enum"><NumberSymbolSquareRegular fontSize={16} /></span>;
    case 'enumValue':
      return <span className="vx-icon vx-icon--enum"><CircleSmallFilled fontSize={16} /></span>;
    case 'model':
      return <span className="vx-icon vx-icon--model"><DataBarVerticalFilled fontSize={16} /></span>;
    default:
      return <span className="vx-icon"><DocumentRegular fontSize={16} /></span>;
  }
}

/** `Výčty (6)` → the name and the count the tree builder appended to it. */
function splitCount(name: string): { name: string; count?: string } {
  const match = /^(.*\S)\s+\((\d+)\)$/.exec(name);
  return match ? { name: match[1], count: match[2] } : { name };
}

/** How the explorer's sections move: unhurried, easing in and out, so the eye follows them. */
const SECTION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SECTION_MOVE_MS = 420;
const SECTION_UNROLL_MS = 380;
const SECTION_CLOSE_MS = 220;

/** What a dragged section header carries — not files, so the explorer's file drop ignores it. */
const SECTION_DRAG_TYPE = 'application/x-er-explorer-section';

/** An invisible point to open a menu at — where the right click was. */
function pointAt(x: number, y: number): PositioningVirtualElement {
  return { getBoundingClientRect: () => ({ x, y, top: y, left: x, bottom: y, right: x, width: 0, height: 0 }) as DOMRect };
}

/** A small icon button of a title bar, pane header or row — VS Code's action bar. */
function VxAction({ icon, label, onClick, pressed, className }: {
  icon: React.ReactNode;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`vx-action${pressed ? ' vx-action--pressed' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
    </button>
  );
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
  // The kind sections in the order the user set, and which of them are
  // collapsed — both remembered, as VS Code remembers its views. Every
  // section starts open.
  const [initialSections] = useState(loadSectionLayout);
  const [sectionOrder, setSectionOrder] = useState<ConfigKind[]>(initialSections.order);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ConfigKind>>(
    () => new Set<ConfigKind>(initialSections.collapsed),
  );
  React.useEffect(() => {
    saveSectionLayout({ order: sectionOrder, collapsed: [...collapsedGroups] });
  }, [sectionOrder, collapsedGroups]);
  // A section header being dragged to a new place, and where it would land.
  const [sectionDrag, setSectionDrag] = useState<{ kind: ConfigKind; over?: { kind: ConfigKind; place: 'before' | 'after' } } | null>(null);
  const [sectionMenu, setSectionMenu] = useState<{ kind: ConfigKind; target: HTMLElement | PositioningVirtualElement } | null>(null);
  const [hierarchyView, setHierarchyView] = useState(false);
  // The context menu of one row, opened at its "…" button or at the pointer.
  const [menu, setMenu] = useState<{ node: TreeNode; target: HTMLElement | PositioningVirtualElement } | null>(null);
  const openMenu = useCallback((node: TreeNode, target: HTMLElement | PositioningVirtualElement) => setMenu({ node, target }), []);

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

  // The kind toggles narrow the tree to the kinds pressed — none pressed shows
  // every kind, as the option toggles of a VS Code filter box do.
  const toggleKind = useCallback((kind: ConfigKind) => {
    setKindFilter(prev => {
      const all = new Set<ConfigKind>(KINDS);
      if (prev.size === KINDS.length) return new Set<ConfigKind>([kind]);
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next.size === 0 || next.size === KINDS.length ? all : next;
    });
  }, []);

  /*
   * Sections move when they fold, open or change place — the collapsed ones
   * dock at the bottom. So the eye can follow, every such change is animated
   * the FLIP way: where each section header was is noted just before the
   * change, and right after the new layout each section is shifted back there
   * and let glide into its new place; a section that opens unrolls its rows.
   */
  const pendingSectionMove = React.useRef<Map<string, { top: number; open: boolean }> | null>(null);
  const noteSectionPositions = useCallback(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const before = new Map<string, { top: number; open: boolean }>();
    document.querySelectorAll<HTMLElement>('.vx [data-section]').forEach(header => {
      before.set(header.dataset.section!, { top: header.getBoundingClientRect().top, open: header.getAttribute('aria-expanded') === 'true' });
    });
    pendingSectionMove.current = before;
  }, []);
  React.useLayoutEffect(() => {
    const before = pendingSectionMove.current;
    if (!before) return;
    pendingSectionMove.current = null;
    document.querySelectorAll<HTMLElement>('.vx [data-section]').forEach(header => {
      const section = header.closest<HTMLElement>('.vx-pane');
      const was = before.get(header.dataset.section!);
      if (!section || !was) return;
      const shift = was.top - header.getBoundingClientRect().top;
      if (Math.abs(shift) > 1) {
        section.animate([{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }], { duration: SECTION_MOVE_MS, easing: SECTION_EASING });
      }
      const block = section.querySelector<HTMLElement>('.vx-block');
      if (block && !was.open && header.getAttribute('aria-expanded') === 'true') {
        block.animate(
          [{ clipPath: 'inset(0 0 100% 0)', opacity: 0 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }],
          { duration: SECTION_UNROLL_MS, easing: SECTION_EASING },
        );
      }
    });
  });

  // A section being folded closes its rows first, then moves to the dock.
  const closingSections = React.useRef(new Set<ConfigKind>());
  const toggleGroup = useCallback((kind: ConfigKind) => {
    const flip = () => {
      noteSectionPositions();
      setCollapsedGroups(prev => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
      });
    };
    const block = document.querySelector(`.vx [data-section="${kind}"]`)?.closest('.vx-pane')?.querySelector<HTMLElement>('.vx-block');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!block || reduced) { flip(); return; }
    if (closingSections.current.has(kind)) return;
    closingSections.current.add(kind);
    const closing = block.animate(
      [{ clipPath: 'inset(0 0 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 100% 0)', opacity: 0 }],
      { duration: SECTION_CLOSE_MS, easing: SECTION_EASING, fill: 'forwards' },
    );
    closing.finished.catch(() => undefined).finally(() => {
      closingSections.current.delete(kind);
      flip();
      // The rows unmount with the fold; should they stay (a filter keeps every
      // section open), they must not stay clipped away.
      requestAnimationFrame(() => requestAnimationFrame(() => closing.cancel()));
    });
  }, [noteSectionPositions]);

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

    return sectionOrder
      .filter(kind => kindFilter.has(kind))
      .map(kind => ({ kind, nodes: sortNodes(groups.get(kind) ?? []) }));
  }, [filteredTreeNodes, kindFilter, sortNodes, sectionOrder]);
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

  // Open sections on top in their order; the collapsed ones (and kinds with
  // nothing loaded) dock at the bottom of the explorer. A filter shows every
  // section open, in place.
  const sections = useMemo(() => {
    const byKind = new Map(groupedTreeNodes.map(group => [group.kind, group]));
    const { open, docked } = arrangeSections(
      groupedTreeNodes.map(group => group.kind),
      kind => !isFiltering && (collapsedGroups.has(kind) || (byKind.get(kind)?.nodes.length ?? 0) === 0),
    );
    return { open: open.map(kind => byKind.get(kind)!), docked: docked.map(kind => byKind.get(kind)!), openKinds: open, dockedKinds: docked };
  }, [groupedTreeNodes, isFiltering, collapsedGroups]);

  /** Move a section one place among the ones it is shown with, keeping focus on its header. */
  const moveSectionBy = useCallback((kind: ConfigKind, delta: -1 | 1) => {
    const neighbours = sections.openKinds.includes(kind) ? sections.openKinds : sections.dockedKinds;
    noteSectionPositions();
    setSectionOrder(order => moveSection(order, kind, delta, neighbours) as ConfigKind[]);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.vx [data-section="${kind}"]`)?.focus({ preventScroll: true }));
  }, [sections, noteSectionPositions]);

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

  /**
   * WAI-ARIA tree keys: arrows walk and fold, Home / End jump, Space selects,
   * Enter opens — what a double-click does.
   */
  const handleRowKeyDown = useCallback((id: string, event: React.KeyboardEvent<HTMLDivElement>) => {
    const { allRows: rows, allRowIndex: index } = navRef.current;
    const at = index.get(id);
    if (at == null) return;
    const row = rows[at];

    if (event.key === 'Enter') {
      event.preventDefault();
      selectNode(id);
      handleExplorerDoubleClick(row.node);
      return;
    }
    if (event.key === ' ') {
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
  }, [selectNode, setOpen, handleExplorerDoubleClick]);

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
    onOpenMenu: openMenu,
  }), [blockRows, selectedNodeId, selectedPathIds, fallbackTabStopId, focusedRowId, showTechnicalDetails, selectNode, setOpen, handleRowKeyDown, handleExplorerDoubleClick, closeConfigurationNode, openMenu]);

  const fileInput = (
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
  );
  const dropHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };
  const expandAll = () => { setExpandMode('all'); setExpandVersion(v => v + 1); };
  const collapseAll = () => { setExpandMode('none'); setExpandVersion(v => v + 1); };

  if (treeNodes.length === 0) {
    return (
      <div className={`vx${isDragging ? ' vx--dragging' : ''}`} {...dropHandlers}>
        <div className="vx-titlebar">
          <span className="vx-titlebar__title">{t.explorer}</span>
          <div className="vx-titlebar__actions" role="toolbar" aria-label={t.explorerMoreActions}>
            <VxAction icon={<AppsListDetailRegular fontSize={16} />} label={t.workspaceManager} onClick={() => setWorkspaceOpen(true)} />
          </div>
        </div>
        {fnoIngestStatus ? (
          <div className="vx-welcome"><FnoIngestPanel variant="card" /></div>
        ) : (
          <div className="vx-welcome">
            <p>{t.noConfigurationsLoaded}</p>
            <Button appearance="primary" className="vx-welcome__button" icon={<AddRegular />} onClick={openAddFiles}>{t.workspaceAddFiles}</Button>
            <Button appearance="secondary" className="vx-welcome__button" icon={<AppsListDetailRegular />} onClick={() => setWorkspaceOpen(true)}>{t.workspaceManager}</Button>
            <p className="vx-welcome__hint">{t.loadXmlHint}</p>
          </div>
        )}
        <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} onRequestFno={() => requestLanding('remote')} />
        {fileInput}
        {isDragging && <div className="vx-drop">{t.landingDropRelease}</div>}
      </div>
    );
  }

  const nothingShown = filteredTreeNodes.length === 0 || totalVisible === 0;

  /**
   * A kind section: its header — click to fold, drag to reorder, right click
   * or "…" for the section menu, Alt+↑ / Alt+↓ to move it — and, when open,
   * its rows.
   */
  const renderSection = (group: { kind: ConfigKind; nodes: TreeNode[] }, collapsed: boolean) => {
    const blockKey = `kind:${group.kind}`;
    const over = sectionDrag?.over?.kind === group.kind && sectionDrag.kind !== group.kind ? sectionDrag.over.place : undefined;
    const hasOpenRows = !collapsed && (blockRows.get(blockKey) ?? []).some(row => row.expanded);
    return (
      <section
        key={group.kind}
        className={[
          'vx-pane',
          `vx-pane--${KIND_ACCENT[group.kind]}`,
          collapsed ? 'vx-pane--collapsed' : '',
          sectionDrag?.kind === group.kind ? 'vx-pane--dragging' : '',
        ].filter(Boolean).join(' ')}
      >
        <div
          className={`vx-pane__header${over ? ` vx-pane__header--drop-${over}` : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          data-section={group.kind}
          title={t.explorerSectionDragHint}
          draggable
          onClick={() => toggleGroup(group.kind)}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              event.preventDefault();
              moveSectionBy(group.kind, event.key === 'ArrowUp' ? -1 : 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleGroup(group.kind);
            } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault();
              setSectionMenu({ kind: group.kind, target: event.currentTarget });
            }
          }}
          onContextMenu={event => {
            event.preventDefault();
            setSectionMenu({ kind: group.kind, target: pointAt(event.clientX, event.clientY) });
          }}
          onDragStart={event => {
            event.dataTransfer.setData(SECTION_DRAG_TYPE, group.kind);
            event.dataTransfer.effectAllowed = 'move';
            setSectionDrag({ kind: group.kind });
          }}
          onDragOver={event => {
            if (!sectionDrag || !event.dataTransfer.types.includes(SECTION_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const box = event.currentTarget.getBoundingClientRect();
            const place = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
            if (sectionDrag.over?.kind !== group.kind || sectionDrag.over.place !== place) {
              setSectionDrag({ kind: sectionDrag.kind, over: { kind: group.kind, place } });
            }
          }}
          onDragLeave={event => {
            if (sectionDrag?.over?.kind === group.kind && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setSectionDrag({ kind: sectionDrag.kind });
            }
          }}
          onDrop={event => {
            if (!sectionDrag || !event.dataTransfer.types.includes(SECTION_DRAG_TYPE)) return;
            event.preventDefault();
            const place = sectionDrag.over?.kind === group.kind ? sectionDrag.over.place : 'before';
            const moved = sectionDrag.kind;
            noteSectionPositions();
            setSectionOrder(order => dropSection(order, moved, group.kind, place) as ConfigKind[]);
            // Dropped among the open sections it opens, among the docked ones it folds.
            if (sections.dockedKinds.includes(moved) !== collapsed) {
              setCollapsedGroups(prev => {
                const next = new Set(prev);
                if (collapsed) next.add(moved); else next.delete(moved);
                return next;
              });
            }
            setSectionDrag(null);
          }}
          onDragEnd={() => setSectionDrag(null)}
        >
          <span className={`vx-twistie${collapsed ? '' : ' open'}`} aria-hidden><ChevronRightRegular fontSize={16} /></span>
          <span className="vx-pane__title">{getExplorerGroupLabel(group.kind)}</span>
          <span className="vx-pane__actions">
            {hasOpenRows && (
              <VxAction
                icon={<TextCollapseRegular fontSize={14} />}
                label={t.explorerCollapseGroup}
                onClick={event => {
                  event.stopPropagation();
                  setOpen((blockRows.get(blockKey) ?? []).filter(row => row.expanded).map(row => row.id), false);
                }}
              />
            )}
            <VxAction
              icon={<MoreHorizontalRegular fontSize={14} />}
              label={t.explorerSectionActions}
              onClick={event => {
                event.stopPropagation();
                setSectionMenu({ kind: group.kind, target: event.currentTarget });
              }}
            />
          </span>
        </div>
        {!collapsed && <ExplorerTreeBlock blockKey={blockKey} />}
      </section>
    );
  };

  return (
    <ActiveScopeContext.Provider value={activeScopeNodeIds}>
    <ExplorerTreeContext.Provider value={treeContext}>
    <div className={`vx${isDragging ? ' vx--dragging' : ''}`} {...dropHandlers}>
      <div className="vx-titlebar">
        <span className="vx-titlebar__title">{t.explorer}</span>
        <div className="vx-titlebar__actions" role="toolbar" aria-label={t.explorerMoreActions}>
          <VxAction icon={<AddRegular fontSize={16} />} label={t.workspaceAddFiles} onClick={openAddFiles} />
          <VxAction
            icon={hierarchyView ? <ListRegular fontSize={16} /> : <TextBulletListTreeRegular fontSize={16} />}
            label={hierarchyView ? t.explorerViewFlat : t.explorerViewHierarchy}
            onClick={() => setHierarchyView(v => !v)}
          />
          <VxAction icon={<TextCollapseRegular fontSize={16} />} label={t.cmdCollapseAll} onClick={collapseAll} />
          <VxAction icon={<AppsListDetailRegular fontSize={16} />} label={t.workspaceManager} onClick={() => setWorkspaceOpen(true)} />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <button type="button" className="vx-action" title={t.explorerMoreActions} aria-label={t.explorerMoreActions}>
                <MoreHorizontalRegular fontSize={16} />
              </button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<TextExpandRegular />} onClick={expandAll}>{t.cmdExpandAll}</MenuItem>
                <MenuItem icon={<TextCollapseRegular />} onClick={collapseAll}>{t.cmdCollapseAll}</MenuItem>
                <MenuDivider />
                {(['loadOrder', 'nameAsc', 'nameDesc'] as const).map(mode => (
                  <MenuItem
                    key={mode}
                    icon={sortMode === mode ? <CheckmarkRegular /> : <span className="vx-menu-blank" />}
                    onClick={() => setSortMode(mode)}
                  >
                    {mode === 'loadOrder' ? t.explorerSortLoadOrder : mode === 'nameAsc' ? t.explorerSortNameAsc : t.explorerSortNameDesc}
                  </MenuItem>
                ))}
                <MenuDivider />
                <MenuItem icon={<DismissSquareMultipleRegular />} onClick={closeAllConfigurationsWithUndo}>
                  {t.closeAllConfigurations}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>

      {fnoIngestStatus && (
        <div className="vx-progress" role="status">
          <div className="vx-progress__track"><div className="vx-progress__bar" /></div>
          <div className="vx-progress__text" title={fnoIngestStatus}>
            <ArrowSyncRegular fontSize={12} className="vx-spin" aria-hidden />
            <span>{t.explorerLoading}</span>
            <span className="vx-progress__status">{fnoIngestStatus}</span>
          </div>
        </div>
      )}

      <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} onRequestFno={() => requestLanding('remote')} />
      {fileInput}

      <div className="vx-filter">
        <div className="vx-filter__box">
          <FilterField
            value={filterQuery}
            onChange={setFilterQuery}
            placeholder={t.explorerFilterPlaceholder}
            suggestions={filterSuggestions}
            historyScope="explorer"
            className="vx-filter__field"
          />
          <div className="vx-filter__toggles" role="group" aria-label={t.explorerFilterByKind}>
            {KINDS.map(kind => (
              <button
                key={kind}
                type="button"
                className={`vx-toggle vx-toggle--${KIND_ACCENT[kind]}${kindFilter.has(kind) && kindFilter.size < KINDS.length ? ' active' : ''}`}
                aria-pressed={kindFilter.has(kind) && kindFilter.size < KINDS.length}
                disabled={kindCounts[kind] === 0}
                title={t.explorerShowOnlyKind(getExplorerGroupLabel(kind))}
                aria-label={getExplorerGroupLabel(kind)}
                onClick={() => toggleKind(kind)}
              >
                <KindIcon kind={kind} fontSize={14} />
              </button>
            ))}
          </div>
        </div>
        {isFiltering && <div className="vx-filter__info">{t.explorerResultsCount(totalVisible, totalAll)}</div>}
      </div>

      <div
        ref={treeRef}
        {...treeFocusProps}
        className={`vx-tree${hierarchyView ? ' vx-tree--hierarchy' : ''}${!hierarchyView && !nothingShown && sections.open.length === 0 ? ' vx-tree--empty' : ''}`}
        role="tree"
        aria-label={t.configurations}
      >
        {nothingShown ? (
          <p className="vx-empty">{t.noResults}</p>
        ) : hierarchyView && hierarchy ? (
          <section className="vx-pane">
            <div className="vx-pane__header vx-pane__header--static">
              <span className="vx-pane__title">{t.explorerViewHierarchyTitle}</span>
            </div>
            {hierarchy.roots.map(group => (
              <ModelGroupSection
                key={group.configIdx}
                group={group}
                configurations={configurations}
                treeNodes={treeNodes}
                filteredNodeIds={filteredNodeIds}
                kindFilter={kindFilter}
              />
            ))}
            {hierarchy.orphans.some(idx => isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter)) && (
              <div className="vx-hgroup">
                <div className="vx-subheader">{t.explorerUnlinked}</div>
                {hierarchy.orphans.map(idx => {
                  const node = treeNodes[idx];
                  if (!node || !isConfigVisible(idx, configurations, treeNodes, filteredNodeIds, kindFilter)) return null;
                  return <ExplorerTreeBlock key={node.id} blockKey={node.id} />;
                })}
              </div>
            )}
          </section>
        ) : (
          sections.open.map(group => renderSection(group, false))
        )}
      </div>
      {!hierarchyView && !nothingShown && sections.docked.length > 0 && (
        <div className="vx-docked">
          {sections.docked.map(group => renderSection(group, true))}
        </div>
      )}
      <Menu
        open={Boolean(sectionMenu)}
        onOpenChange={(_, data) => {
          if (data.open) return;
          const kind = sectionMenu?.kind;
          setSectionMenu(null);
          if (kind) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.vx [data-section="${kind}"]`)?.focus({ preventScroll: true }));
        }}
        positioning={sectionMenu ? { target: sectionMenu.target, position: 'below', align: 'start', offset: 2 } : undefined}
      >
        <MenuPopover>
          {sectionMenu && (() => {
            const kind = sectionMenu.kind;
            const neighbours = sections.openKinds.includes(kind) ? sections.openKinds : sections.dockedKinds;
            const at = neighbours.indexOf(kind);
            const collapsed = collapsedGroups.has(kind);
            const blockKey = `kind:${kind}`;
            const rows = blockRows.get(blockKey) ?? [];
            return (
              <MenuList>
                <MenuItem icon={<ArrowUpRegular />} secondaryContent="Alt+↑" disabled={at <= 0} onClick={() => moveSectionBy(kind, -1)}>
                  {t.explorerSectionMoveUp}
                </MenuItem>
                <MenuItem icon={<ArrowDownRegular />} secondaryContent="Alt+↓" disabled={at < 0 || at >= neighbours.length - 1} onClick={() => moveSectionBy(kind, 1)}>
                  {t.explorerSectionMoveDown}
                </MenuItem>
                <MenuDivider />
                <MenuItem icon={collapsed ? <TextExpandRegular /> : <TextCollapseRegular />} onClick={() => toggleGroup(kind)}>
                  {collapsed ? t.explorerSectionExpand : t.explorerSectionCollapse}
                </MenuItem>
                {!collapsed && rows.some(row => row.expanded) && (
                  <MenuItem icon={<TextCollapseRegular />} onClick={() => setOpen(rows.filter(row => row.expanded).map(row => row.id), false)}>
                    {t.explorerCollapseGroup}
                  </MenuItem>
                )}
                <MenuDivider />
                <MenuItem
                  icon={<ArrowResetRegular />}
                  disabled={sectionOrder.every((k, i) => k === DEFAULT_SECTION_ORDER[i])}
                  onClick={() => { noteSectionPositions(); setSectionOrder([...DEFAULT_SECTION_ORDER]); }}
                >
                  {t.explorerSectionResetOrder}
                </MenuItem>
              </MenuList>
            );
          })()}
        </MenuPopover>
      </Menu>
      <ExplorerContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onOpen={handleExplorerDoubleClick}
        onCloseConfiguration={closeConfigurationNode}
      />
      {isDragging && <div className="vx-drop">{t.landingDropRelease}</div>}
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
  /** Open the row's context menu at a button or at the pointer. */
  onOpenMenu: (node: TreeNode, target: HTMLElement | PositioningVirtualElement) => void;
}

/** What the blocks need from the explorer, wherever in the layout they sit. */
const ExplorerTreeContext = React.createContext<ExplorerTreeContextValue | null>(null);

const NO_SELECTION_PATH: ReadonlySet<string> = new Set<string>();
const NO_ROWS: FlatTreeRow<TreeNode>[] = [];

/** A row's height (VS Code's 22px), before it is measured. */
const ESTIMATED_ROW_HEIGHT = 22;

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
function ExplorerTreeBlock({ blockKey }: { blockKey: string }) {
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
    <div ref={containerRef} className="vx-block" style={{ height: virtualizer.getTotalSize() }}>
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
              onOpenMenu={ctx.onOpenMenu}
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
  onOpenMenu: (node: TreeNode, target: HTMLElement | PositioningVirtualElement) => void;
}

/** Whether a row has anything for its context menu beyond "open". */
function rowHasMenu(node: TreeNode, depth: number, coarse: boolean): boolean {
  const isConfiguration = depth === 0 && node.configIndex != null && node.type === 'file';
  return isConfiguration || Boolean(whereUsedQueryFor(node)) || (coarse && node.configIndex != null);
}

const TreeNodeRow = React.memo(function TreeNodeRowView({ node, depth, expanded, hasChildren, posInSet, setSize, isTabStop, selectedId, selectedPathIds, showTechnicalDetails, version, onSelect, onToggle, onRowKeyDown, onDoubleClick, onCloseConfiguration, onOpenMenu }: TreeNodeRowProps) {
  const displayName = getNodeDisplayName(node, showTechnicalDetails);
  // A section is named without the count the tree builder appends to it.
  const name = node.type === 'section' ? splitCount(displayName).name : displayName;

  const handleClick = useCallback((event: React.MouseEvent) => {
    onSelect(node.id);
    // The second click of a double-click opens the node; folding the row
    // back as well made it flicker shut on every open.
    if (hasChildren && event.detail < 2) onToggle(node.id, !expanded);
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

  const isConfiguration = depth === 0 && node.configIndex != null && node.type === 'file';
  const coarse = useCoarsePointer();
  const hasMenu = rowHasMenu(node, depth, coarse);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    // The context menu key (or Shift+F10) opens the row's menu at the row.
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      onOpenMenu(node, event.currentTarget);
      return;
    }
    // Modified keys are workspace shortcuts (Alt+Left / Alt+Right walk the navigation history).
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // The explorer walks its flat list of shown rows, so ↑ / ↓ reach rows
    // that are not mounted yet.
    onRowKeyDown(node.id, event);
  };

  const isFormat = node.data?.content?.kind === 'Format';
  const direction = isConfiguration && isFormat ? node.data.content.direction as ERDirection | undefined : undefined;
  // The description VS Code puts after a name: the version of a configuration,
  // the label text of an item.
  const description = isConfiguration && version != null && version !== '' ? `v${version}` : resolvedLabel;
  const title = [displayName, resolvedLabel, isConfiguration && isFormat ? getFormatDirectionLabel(direction) : undefined]
    .filter(Boolean).join(' — ');

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
      className={[
        'vx-row',
        `vx-row--${node.type}`,
        isConfiguration ? 'vx-row--root' : '',
        hasMenu ? 'vx-row--actions' : '',
        isSelected ? 'selected' : '',
        isAncestor ? 'ancestor' : '',
      ].filter(Boolean).join(' ')}
      style={{ paddingLeft: ROW_PAD + depth * INDENT }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={hasMenu ? event => {
        event.preventDefault();
        onSelect(node.id);
        onOpenMenu(node, pointAt(event.clientX, event.clientY));
      } : undefined}
    >
      <span className={`vx-twistie${hasChildren ? (expanded ? ' open' : '') : ' leaf'}`} aria-hidden>
        <ChevronRightRegular fontSize={16} />
      </span>
      <ExplorerNodeIcon node={node} expanded={expanded} />
      <span className="vx-label" title={title}>
        <span className={`vx-name${isActiveMappingDefinition ? ' vx-name--active' : ''}`}>{name}</span>
        {description && <span className="vx-desc">{description}</span>}
        {showTechnicalDetails && node.type === 'datasource' && node.data?.type && (
          <span className="vx-desc vx-desc--type">{node.data.type}</span>
        )}
      </span>
      <span className="vx-decorations">
        {isActiveMappingDefinition && (
          <span className="vx-decoration vx-decoration--active" title={t.explorerActiveMappingHint} aria-label={t.explorerActiveMapping}>
            <CircleSmallFilled fontSize={16} />
          </span>
        )}
        {direction != null && (
          <span className="vx-decoration" title={getFormatDirectionLabel(direction)} aria-label={getFormatDirectionLabel(direction)} role="img">
            {direction === ERDirection.Import ? <ArrowDownloadRegular fontSize={14} /> : <ArrowUploadRegular fontSize={14} />}
          </span>
        )}
      </span>
      {hasMenu && (
        <span className="vx-row-actions">
          <VxAction
            icon={<MoreHorizontalRegular fontSize={16} />}
            label={t.explorerMoreActions}
            onClick={event => { event.stopPropagation(); onSelect(node.id); onOpenMenu(node, event.currentTarget); }}
          />
          {isConfiguration && (
            <VxAction
              icon={<DismissRegular fontSize={14} />}
              label={t.closeConfiguration}
              onClick={event => { event.stopPropagation(); onCloseConfiguration(node); }}
            />
          )}
        </span>
      )}
    </div>
  );
});

/**
 * The one context menu of the explorer — opened by a right click, the row's
 * "…" button or the context menu key — with what applies to that row.
 */
function ExplorerContextMenu({ menu, onClose, onOpen, onCloseConfiguration }: {
  menu: { node: TreeNode; target: HTMLElement | PositioningVirtualElement } | null;
  onClose: () => void;
  onOpen: (node: TreeNode) => void;
  onCloseConfiguration: (node: TreeNode) => void;
}) {
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const openVersionComparePicker = useAppStore(s => s.openVersionComparePicker);
  const compareWithBase = useAppStore(s => s.compareWithBase);
  const node = menu?.node;
  const isConfiguration = Boolean(node && node.type === 'file' && node.id === `cfg-${node.configIndex}`);
  // A derived configuration can be set against its base — unless that is known
  // to be another kind (the data model a root format or mapping hangs under).
  const hasComparableBase = useAppStore(s => {
    if (!node || !isConfiguration || node.configIndex == null) return false;
    const cfg = s.configurations[node.configIndex];
    return Boolean(cfg && baseReference(cfg) && knownBaseKind(s.configurations, s.recentFiles, cfg).kind !== 'other');
  });
  const whereUsedQuery = node ? whereUsedQueryFor(node) : undefined;

  const close = () => {
    onClose();
    // Back to the row the menu was for, as a native context menu does.
    if (node) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.vx [data-node-id="${CSS.escape(node.id)}"]`)?.focus({ preventScroll: true }));
    }
  };

  return (
    <Menu
      open={Boolean(menu)}
      onOpenChange={(_, data) => { if (!data.open) close(); }}
      positioning={menu ? { target: menu.target, position: 'below', align: 'start', offset: 2 } : undefined}
    >
      <MenuPopover>
        {node && (
          <MenuList>
            <MenuItem icon={<OpenRegular />} onClick={() => onOpen(node)}>{t.explorerOpenInTab}</MenuItem>
            {whereUsedQuery && (
              <MenuItem icon={<SearchRegular />} onClick={() => triggerWhereUsed(whereUsedQuery, whereUsedTargetFor(node))}>
                {t.whereUsedAction}
              </MenuItem>
            )}
            {isConfiguration && (
              <>
                <MenuDivider />
                <MenuItem icon={<BranchCompareRegular />} onClick={() => openVersionComparePicker(node.configIndex ?? null)}>
                  {t.compareWithVersionAction}
                </MenuItem>
                {hasComparableBase && (
                  <MenuItem icon={<BranchForkRegular />} onClick={() => { if (node.configIndex != null) void compareWithBase(node.configIndex); }}>
                    {t.compareWithBaseAction}
                  </MenuItem>
                )}
                <MenuDivider />
                <MenuItem icon={<DeleteRegular />} onClick={() => onCloseConfiguration(node)}>{t.closeConfiguration}</MenuItem>
              </>
            )}
          </MenuList>
        )}
      </MenuPopover>
    </Menu>
  );
}

// ─── Hierarchical model group section ───

interface ModelGroupSectionProps {
  group: ExplorerModelGroup;
  configurations: ERConfiguration[];
  treeNodes: TreeNode[];
  filteredNodeIds: Set<string>;
  kindFilter: Set<ConfigKind>;
}

function ModelGroupSection({
  group,
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

  // Each configuration is its own virtualized block (with everything open
  // below it); what hangs under a model is indented.
  return (
    <div className="vx-hgroup">
      {modelVisible && <ExplorerTreeBlock key={modelNode.id} blockKey={modelNode.id} />}
      {(visibleChildren.length > 0 || visibleSubModels.length > 0) && (
        <div className="vx-hgroup__children">
          {visibleChildren.map(idx => {
            const node = treeNodes[idx];
            return <ExplorerTreeBlock key={node.id} blockKey={node.id} />;
          })}
          {visibleSubModels.map(subGroup => (
            <ModelGroupSection
              key={subGroup.configIdx}
              group={subGroup}
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
