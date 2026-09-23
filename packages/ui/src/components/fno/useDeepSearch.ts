/**
 * Cross-model search over formats and mappings.
 *
 * The left-hand filter only ever saw model names, because formats and
 * mappings live one API call *below* a model. Finding one by name therefore
 * means walking every root model's configuration list — reusing the per-root
 * cache, a few in parallel, and cancellable, since a real environment has
 * dozens of roots. Results take over the right-hand panel.
 */

import { useCallback, useRef, useState } from 'react';
import type { ErConfigSummary, ErSolutionSummary, FnoConnection } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import { useFnoSession } from '../../state/fno-session';
import { fnoSession } from '../../fno/session';
import { componentKey } from '../../fno/ingest/shared';
import {
  MIN_SEARCH_CHARS,
  SEARCH_CONCURRENCY,
  componentMatchesQuery,
  rememberDataModels,
  sortSearchHits,
  type DeepSearchState,
} from './listing';

export function useDeepSearch(
  activeProfile: FnoConnection | null,
  solutionFilter: string,
  solutions: ErSolutionSummary[],
  /** Root model → full component list, shared with the browser. */
  rootComponentCache: Map<string, ErConfigSummary[]>,
): {
  search: DeepSearchState | null;
  runSearch: () => Promise<void>;
  clearSearch: () => void;
} {
  const pushToast = useAppStore(s => s.pushToast);
  const setAllDataModelsSeen = useFnoSession(s => s.setAllDataModelsSeen);
  const [search, setSearch] = useState<DeepSearchState | null>(null);
  const searchSeqRef = useRef(0);

  /** Drop search results (and abandon a running scan). */
  const clearSearch = useCallback(() => {
    searchSeqRef.current++;
    setSearch(null);
  }, []);

  const runSearch = useCallback(async () => {
    if (!activeProfile) return;
    const query = solutionFilter.trim();
    if (query.length < MIN_SEARCH_CHARS) return;
    const q = query.toLowerCase();
    // One fetch per *root* model: `listComponents` answers with the whole
    // sub-tree, so derived models add nothing but duplicate calls.
    const roots = Array.from(new Set(
      solutions
        .filter(sol => sol.componentType === 'DataModel' || sol.componentType === 'Unknown')
        .map(sol => sol.rootSolutionName ?? sol.solutionName)
        .filter((name): name is string => Boolean(name)),
    ));
    const seq = ++searchSeqRef.current;
    setSearch({ query, results: [], scanned: 0, total: roots.length, failed: 0, running: roots.length > 0 });
    if (roots.length === 0) return;

    const hits = new Map<string, ErConfigSummary>();
    let scanned = 0;
    let failed = 0;
    let cursor = 0;
    const walkNextRoot = async (): Promise<void> => {
      for (;;) {
        if (seq !== searchSeqRef.current) return;
        const index = cursor++;
        if (index >= roots.length) return;
        const rootName = roots[index];
        let list = rootComponentCache.get(rootName);
        if (!list) {
          try {
            list = await fnoSession.listComponents(activeProfile, rootName);
            rootComponentCache.set(rootName, list);
          } catch (err) {
            // One unreachable model must not sink the whole search; the count
            // is reported at the end so the user knows the list is partial.
            console.warn('[fno-ui] search: listComponents failed', { rootName, err });
            failed++;
            list = [];
          }
        }
        if (seq !== searchSeqRef.current) return;
        // Remember every model we touch — handleLoadSelected resolves a hit's
        // ancestors out of this map when downloading.
        const fetched = list;
        setAllDataModelsSeen(prev => rememberDataModels(prev, fetched));
        for (const comp of fetched) {
          if (comp.componentType === 'DataModel') continue;
          if (!componentMatchesQuery(comp, q)) continue;
          hits.set(componentKey(comp), comp);
        }
        scanned++;
        const snapshot = sortSearchHits(hits);
        setSearch(prev => (prev && seq === searchSeqRef.current
          ? { ...prev, scanned, failed, results: snapshot }
          : prev));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SEARCH_CONCURRENCY, roots.length) }, () => walkNextRoot()),
    );
    if (seq !== searchSeqRef.current) return;
    const final = sortSearchHits(hits);
    setSearch(prev => (prev ? { ...prev, scanned, failed, results: final, running: false } : prev));
    if (failed > 0) pushToast({ kind: 'warning', message: t.fnoSearchFailed(failed) });
  }, [activeProfile, solutionFilter, solutions, rootComponentCache, setAllDataModelsSeen, pushToast]);

  return { search, runSearch, clearSearch };
}
