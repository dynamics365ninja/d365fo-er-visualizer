/**
 * Tabs and back/forward history: snapshot stacks, and remapping ids after a
 * configuration is closed.
 */
import type { ERConfiguration } from '@er-visualizer/core';
import { findNodeById, type TreeNode } from './tree-builder';

export interface NavigationSnapshot {
  activeTabId: string | null;
  selectedNodeId: string | null;
}

/**
 * A tab is either bound to a tree node (default) or a free-form drill-down session
 * carrying an expression + configIndex to analyse.
 */
export type OpenTab =
  | { kind?: 'node'; id: string; label: string; configIndex: number }
  | {
      kind: 'drillDown';
      id: string;
      label: string;
      configIndex: number;
      expression: string;
      elementName?: string;
    };

/** Which tabs are open, which one is active and which node is selected. */
export interface TabSelectionState {
  openTabs: OpenTab[];
  activeTabId: string | null;
  selectedNodeId: string | null;
  selectedNode: TreeNode | null;
}

/** The store fields back/forward navigation reads. */
export interface NavigationState extends TabSelectionState {
  configurations: ERConfiguration[];
  treeNodes: TreeNode[];
  navigationHistory: NavigationSnapshot[];
  navigationForward: NavigationSnapshot[];
}

/** The store fields a back/forward step changes. */
export type NavigationPatch = Partial<TabSelectionState & {
  navigationHistory: NavigationSnapshot[];
  navigationForward: NavigationSnapshot[];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
}>;

/**
 * Shift a tab or tree-node id past the removal of configuration
 * `removedIndex`. Both id shapes carry the config index: tree nodes and node
 * tabs are `cfg-N…`, drill-down tabs are `drilldown:N:…`. Returns `null` for
 * an id that belonged to the removed configuration; ids of any other shape are
 * returned unchanged.
 */
export function remapIdAfterConfigRemoval(id: string | null, removedIndex: number): string | null {
  if (!id) return null;
  const match = id.match(/^(cfg-|drilldown:)(\d+)(.*)$/s);
  if (!match) return id;

  const [, prefix, indexText, suffix] = match;
  const currentIndex = parseInt(indexText, 10);
  if (currentIndex === removedIndex) return null;
  if (currentIndex < removedIndex) return id;
  return `${prefix}${currentIndex - 1}${suffix}`;
}

/**
 * Remap a back/forward stack after a configuration is removed. A snapshot
 * that pointed into the removed configuration (by tab or by selection) is
 * dropped — going "back" into a closed config has nowhere to land.
 */
export function remapNavigationStackAfterRemoval(
  stack: NavigationSnapshot[],
  removedIndex: number,
): NavigationSnapshot[] {
  const remapped: NavigationSnapshot[] = [];
  for (const snapshot of stack) {
    const activeTabId = remapIdAfterConfigRemoval(snapshot.activeTabId, removedIndex);
    const selectedNodeId = remapIdAfterConfigRemoval(snapshot.selectedNodeId, removedIndex);
    if (snapshot.activeTabId && !activeTabId) continue;
    if (snapshot.selectedNodeId && !selectedNodeId) continue;
    if (!activeTabId && !selectedNodeId) continue;
    remapped.push({ activeTabId, selectedNodeId });
  }
  return remapped;
}

/**
 * Formats are what the tool is opened for, so put their designer on screen as
 * soon as they load instead of leaving the user on an empty canvas. Only the
 * configurations that just came in get a tab; already-open ones are left alone
 * and the last format loaded becomes the active tab.
 */
export function openDesignerTabsForFormats(
  state: TabSelectionState,
  loaded: ERConfiguration[],
  configurations: ERConfiguration[],
  treeNodes: TreeNode[],
): TabSelectionState {
  let openTabs = state.openTabs;
  let activeTabId = state.activeTabId;
  let selectedNodeId = state.selectedNodeId;
  let selectedNode = state.selectedNode;

  for (const candidate of loaded) {
    if (candidate.content.kind !== 'Format') continue;

    // A merge may have kept the already-loaded object, so fall back to the path.
    const index = configurations.indexOf(candidate) >= 0
      ? configurations.indexOf(candidate)
      : configurations.findIndex(config => config.filePath === candidate.filePath);
    if (index < 0) continue;

    const tabId = `cfg-${index}`;
    if (!openTabs.some(tab => tab.id === tabId)) {
      openTabs = [
        ...openTabs,
        { id: tabId, label: configurations[index].solutionVersion.solution.name, configIndex: index },
      ];
    }
    activeTabId = tabId;
    selectedNodeId = tabId;
    selectedNode = treeNodes[index] ?? null;
  }

  return { openTabs, activeTabId, selectedNodeId, selectedNode };
}

export function pushNavigationHistory(
  state: Pick<NavigationState, 'activeTabId' | 'selectedNodeId' | 'navigationHistory'>,
  nextActiveTabId: string | null,
  nextSelectedNodeId: string | null,
): NavigationSnapshot[] {
  const currentSnapshot: NavigationSnapshot = {
    activeTabId: state.activeTabId,
    selectedNodeId: state.selectedNodeId,
  };

  const nextSnapshot: NavigationSnapshot = {
    activeTabId: nextActiveTabId,
    selectedNodeId: nextSelectedNodeId,
  };

  if (isSameNavigationSnapshot(currentSnapshot, nextSnapshot)) {
    return state.navigationHistory;
  }

  const previous = state.navigationHistory[state.navigationHistory.length - 1];
  if (previous && isSameNavigationSnapshot(previous, currentSnapshot)) {
    return state.navigationHistory;
  }

  return [...state.navigationHistory, currentSnapshot].slice(-50);
}

/**
 * Where a back/forward snapshot lands in the current state. A snapshot whose
 * tab was closed reopens it from the selected node when that node still
 * exists; `null` means neither the tab nor the node is left and the snapshot
 * should be skipped.
 */
export function resolveNavigationSnapshot(
  state: Pick<NavigationState, 'openTabs' | 'treeNodes' | 'configurations'>,
  snapshot: NavigationSnapshot,
): TabSelectionState | null {
  const selectedNode = snapshot.selectedNodeId ? findNodeById(state.treeNodes, snapshot.selectedNodeId) : null;
  let openTabs = state.openTabs;
  let activeTabId = snapshot.activeTabId;

  if (activeTabId && !openTabs.some(tab => tab.id === activeTabId)) {
    if (selectedNode?.configIndex == null) return null;
    const label = selectedNode.type === 'file'
      ? selectedNode.name
      : `${state.configurations[selectedNode.configIndex]?.solutionVersion.solution.name ?? selectedNode.name} • ${selectedNode.name}`;
    if (!openTabs.some(tab => tab.id === selectedNode.id)) {
      openTabs = [...openTabs, { id: selectedNode.id, label, configIndex: selectedNode.configIndex }];
    }
    activeTabId = selectedNode.id;
  } else if (!activeTabId && !selectedNode) {
    return null;
  }

  return { openTabs, activeTabId, selectedNodeId: selectedNode?.id ?? null, selectedNode };
}

/** Drop the snapshots of a back/forward stack that sat on tab `tabId`. */
export function pruneNavigationStack(stack: NavigationSnapshot[], tabId: string): NavigationSnapshot[] {
  const pruned = stack.filter(snapshot => snapshot.activeTabId !== tabId);
  return pruned.length === stack.length ? stack : pruned;
}

function isSameNavigationSnapshot(left: NavigationSnapshot, right: NavigationSnapshot): boolean {
  return left.activeTabId === right.activeTabId && left.selectedNodeId === right.selectedNodeId;
}

/**
 * One Back (`'back'`) or Forward (`'forward'`) step. The current position is
 * pushed onto the opposite stack, and snapshots are popped off the walked one
 * until one still lands somewhere. Returns the state patch to apply, or `null`
 * when there is nothing to step to.
 */
export function stepNavigation(state: NavigationState, direction: 'back' | 'forward'): NavigationPatch | null {
  const walked = direction === 'back' ? state.navigationHistory : state.navigationForward;
  if (walked.length === 0) return null;

  const source = [...walked];
  const currentSnapshot: NavigationSnapshot = {
    activeTabId: state.activeTabId,
    selectedNodeId: state.selectedNodeId,
  };
  const opposite = direction === 'back' ? state.navigationForward : state.navigationHistory;
  const target = [...opposite, currentSnapshot].slice(-50);
  const history = direction === 'back' ? source : target;
  const forward = direction === 'back' ? target : source;

  // Skip entries whose tab and node are both gone; landing on nothing would
  // turn Back into a no-op the user has to press again.
  while (source.length > 0) {
    const landing = resolveNavigationSnapshot(state, source.pop()!);
    if (!landing) continue;
    return {
      ...landing,
      navigationHistory: history,
      navigationForward: forward,
      canNavigateBack: history.length > 0,
      canNavigateForward: forward.length > 0,
    };
  }

  return direction === 'back'
    ? { navigationHistory: [], canNavigateBack: false }
    : { navigationForward: [], canNavigateForward: false };
}
