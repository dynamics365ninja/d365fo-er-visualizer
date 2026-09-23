/**
 * Pure helpers behind the F&O configuration browser: the solution tree, the
 * cross-model search and the shaping of `listComponents` results.
 */

import type { ErConfigSummary, ErSolutionSummary } from '@er-visualizer/fno-client';
import { componentKey } from '../../fno/ingest/shared';

// ── Solution tree node (N-level recursive) ───────────────────────────────────
export interface SolutionNode {
  sol: ErSolutionSummary;
  children: SolutionNode[];
}

/** Recursively checks whether a node or any of its descendants match `q`. */
export function solNodeMatchesFilter(node: SolutionNode, q: string): boolean {
  return (
    (node.sol.solutionName ?? '').toLowerCase().includes(q) ||
    (node.sol.publisher ?? '').toLowerCase().includes(q) ||
    node.children.some(c => solNodeMatchesFilter(c, q))
  );
}

/** Shortest query worth walking every model for. */
export const MIN_SEARCH_CHARS = 2;
/** Parallel `listComponents` calls while searching across models. */
export const SEARCH_CONCURRENCY = 4;

/** Matches a listed configuration against a lower-cased search query. */
export function componentMatchesQuery(c: ErConfigSummary, q: string): boolean {
  return (
    (c.configurationName ?? '').toLowerCase().includes(q) ||
    (c.solutionName ?? '').toLowerCase().includes(q) ||
    (c.ownerDataModelName ?? '').toLowerCase().includes(q) ||
    (c.countryRegion ?? '').toLowerCase().includes(q)
  );
}

/** Search hits grouped by the model they live under, then by name. */
export function sortSearchHits(hits: Map<string, ErConfigSummary>): ErConfigSummary[] {
  const owner = (c: ErConfigSummary) => c.ownerDataModelName ?? c.solutionName ?? '';
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return Array.from(hits.values()).sort(
    (a, b) => cmp(owner(a), owner(b)) || cmp(a.configurationName ?? '', b.configurationName ?? ''),
  );
}

/** State of a cross-model search over formats and mappings. */
export interface DeepSearchState {
  query: string;
  results: ErConfigSummary[];
  /** Root models already walked / to walk. */
  scanned: number;
  total: number;
  /** Roots whose configuration list could not be fetched. */
  failed: number;
  running: boolean;
}

/** Environment URLs compared the way sign-in scopes them (case, trailing slash). */
export function sameEnvUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Scope a full tree of components (fetched from a root DataModel) to
 * only the configurations that belong to the given `modelName`.
 *
 * The ER listing API does NOT expose which DataModel a Format/Mapping
 * *references* — it only reports the ERSolutionTable derivation tree.
 * So we rely on positional heuristics:
 *
 * 1. **Root model** (not in the response): show only depth-0 items
 *    (base configs + child DataModels). Deeper items are derivations
 *    that belong to derived DataModels.
 *
 * 2. **DM with child DataModels** (e.g. BaseModel → DerivedModel):
 *    show directly-owned items at `childDepth` only + child DMs.
 *    Deeper items belong to child DMs.
 *
 * 3. **Leaf DM** (no child DataModels): show directly-owned items +
 *    parent-DM-owned items at `childDepth`. These are derivations of
 *    the parent's base configs that the API can't attribute precisely.
 */
export function scopeComponentsToModel(
  fullTree: readonly ErConfigSummary[],
  modelName: string,
): ErConfigSummary[] {
  const dm = fullTree.find(
    c => c.componentType === 'DataModel' && c.configurationName === modelName,
  );
  const rootName = fullTree[0]?.solutionName ?? modelName;
  const isRoot = !dm; // Not in tree → it's the query root.

  if (isRoot) {
    // Root model: only depth-0 items (base configs + child DataModels).
    return fullTree.filter(c => (c.derivationDepth ?? 0) === 0) as ErConfigSummary[];
  }

  const dmDepth = dm.derivationDepth ?? 0;
  const childDepth = dmDepth + 1;
  // The DM that owns this DM in the tree (its parent model).
  const parentDmName = dm.ownerDataModelName ?? rootName;

  // Does this DM have child DataModels of its own?
  const hasChildDm = fullTree.some(
    c => c.componentType === 'DataModel'
      && c.configurationName !== modelName
      && c.ownerDataModelName === modelName,
  );

  // Does this DM have any directly-owned non-DataModel content?
  // (i.e. items whose ownerDataModelName was set to this DM during
  // the tree walk — meaning they sit under this DM in DerivedSolutions)
  const hasDirectContent = fullTree.some(
    c => c.ownerDataModelName === modelName && c.componentType !== 'DataModel',
  );

  return fullTree.filter(c => {
    // The DM entry itself.
    if (c.configurationName === modelName && c.componentType === 'DataModel') return true;

    // Items directly owned by this model (tree-walk attribution).
    if (c.ownerDataModelName === modelName) {
      // DMs with child DMs: restrict non-DM items to childDepth
      // (deeper items belong to child DMs, reachable via drill-in).
      if (hasChildDm && c.componentType !== 'DataModel') {
        return (c.derivationDepth ?? 0) === childDepth;
      }
      return true;
    }

    // Leaf DMs WITHOUT any direct content (e.g. a derived model whose
    // formats derive from the root's base formats so the tree-walk never
    // attributes them to this DM). Fall back to parent-DM-owned items at
    // childDepth. This is imprecise but the API doesn't expose the model-reference link.
    if (!hasDirectContent
        && c.componentType !== 'DataModel'
        && c.ownerDataModelName === parentDmName
        && (c.derivationDepth ?? 0) === childDepth) {
      return true;
    }

    return false;
  }) as ErConfigSummary[];
}

/**
 * Merge every DataModel summary from `list` into `prev`, keyed by
 * `componentKey`. Non-mutating — returns a new Map when anything was
 * added, the same Map otherwise (so React's `setState` can bail out).
 */
export function rememberDataModels(
  prev: Map<string, ErConfigSummary>,
  list: readonly ErConfigSummary[],
): Map<string, ErConfigSummary> {
  let next: Map<string, ErConfigSummary> | null = null;
  for (const c of list) {
    if (c.componentType !== 'DataModel') continue;
    if (!c.configurationGuid && !c.revisionGuid) {
      console.warn('[fno-ui] rememberDataModels: DataModel has no GUID — skipping', {
        configurationName: c.configurationName,
        solutionName: c.solutionName,
        hasContent: c.hasContent,
        versionNumbers: c.versionNumbers,
      });
      continue;
    }
    const key = componentKey(c);
    if (prev.has(key)) continue;
    if (!next) next = new Map(prev);
    next.set(key, c);
  }
  return next ?? prev;
}

/**
 * Extract DataModel components from a `listComponents` response and
 * merge them into the solutions array shown in the left panel. This
 * ensures nested DataModels discovered while browsing appear as
 * top-level navigable entries alongside root DataModels.
 *
 * `rootSolutionName` is the top-level root — propagated so `handlePickSolution`
 * can always call `listComponents(root)` and get the full tree.
 * `parentConfigName` on each `ErConfigSummary` is used as the direct-parent
 * pointer so the UI can render a multi-level tree.
 *
 * Returns the same array reference when nothing changed.
 */
export function promoteDmToSolutions(
  prev: ErSolutionSummary[],
  components: readonly ErConfigSummary[],
  rootSolutionName: string,
): ErSolutionSummary[] {
  const existing = new Set(prev.map(s => s.solutionName));
  const toAdd: ErSolutionSummary[] = [];
  for (const c of components) {
    if (c.componentType !== 'DataModel') continue;
    const name = c.configurationName;
    if (!name || existing.has(name)) continue;
    existing.add(name);
    // parentSolutionName = direct parent in ER hierarchy (for tree rendering)
    // rootSolutionName   = top-level root (for listComponents API calls)
    const directParent = c.parentConfigName && c.parentConfigName !== name ? c.parentConfigName : undefined;
    toAdd.push({
      solutionName: name,
      publisher: undefined,
      version: c.version,
      displayName: undefined,
      componentType: 'DataModel',
      rootSolutionName: name === rootSolutionName ? undefined : rootSolutionName,
      parentSolutionName: directParent,
    });
  }
  if (toAdd.length === 0) return prev;
  const merged = [...prev, ...toAdd];
  merged.sort((a, b) =>
    (a.solutionName ?? '').localeCompare(b.solutionName ?? '', undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  );
  return merged;
}

/**
 * Decorate every component in `list` with the current model-ancestor
 * chain (root DataModel at index 0 … nearest parent DataModel at the
 * end). We set:
 *   - `parentDataModelGuid` / `parentDataModelRevisionGuid`
 *     → the *nearest* parent (preferred by `GetModelMappingByID`).
 *   - `ancestorDataModelGuids` → every model in the chain, in order.
 *
 * Non-mutating. No-op if the chain is empty or the component is
 * itself a DataModel already in the chain.
 */
export function annotateWithParentDataModel(
  list: ErConfigSummary[],
  chain: readonly ErConfigSummary[],
): ErConfigSummary[] {
  if (chain.length === 0) return list;
  const nearest = chain[chain.length - 1];
  const nearestGuid = nearest.configurationGuid;
  const nearestRev = nearest.revisionGuid;
  const ancestorGuids = chain
    .map(m => m.configurationGuid)
    .filter((g): g is string => Boolean(g));
  return list.map(c => {
    // Don't clobber pre-annotated summaries and skip chain members
    // themselves (a DataModel doesn't need its own GUID as an ancestor).
    if (c.parentDataModelGuid || c.ancestorDataModelGuids) return c;
    if (chain.includes(c)) return c;
    if (c.configurationGuid && ancestorGuids.includes(c.configurationGuid)) return c;
    return {
      ...c,
      parentDataModelGuid: nearestGuid ?? c.parentDataModelGuid,
      parentDataModelRevisionGuid: nearestRev ?? c.parentDataModelRevisionGuid,
      ancestorDataModelGuids: ancestorGuids.length > 0 ? ancestorGuids : undefined,
    };
  });
}

// ── Helper: build N-level recursive tree from flat solutions list ────────
export function buildSolutionTree(solutions: readonly ErSolutionSummary[]): SolutionNode[] {
  // Create a node for every DataModel/Unknown solution
  const nodeMap = new Map<string, SolutionNode>();
  for (const sol of solutions) {
    if (sol.componentType !== 'DataModel' && sol.componentType !== 'Unknown') continue;
    nodeMap.set(sol.solutionName, { sol, children: [] });
  }

  // Attach each node to its direct parent; collect true roots.
  // Prefer parentSolutionName (direct parent) over rootSolutionName (root)
  // so multi-level hierarchies render correctly.
  const roots: SolutionNode[] = [];
  for (const node of nodeMap.values()) {
    const parentName = node.sol.parentSolutionName ?? (node.sol.rootSolutionName ? node.sol.rootSolutionName : undefined);
    if (parentName && nodeMap.has(parentName) && parentName !== node.sol.solutionName) {
      nodeMap.get(parentName)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort all levels alphabetically
  const sortLevel = (nodes: SolutionNode[]) => {
    nodes.sort((a, b) =>
      (a.sol.solutionName ?? '').localeCompare(b.sol.solutionName ?? '', undefined, { sensitivity: 'base', numeric: true }),
    );
    for (const n of nodes) sortLevel(n.children);
  };
  sortLevel(roots);

  return roots;
}
