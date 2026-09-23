/**
 * F&O connector panel — shown on the Landing page under the "D365 F&O server"
 * tab. Lets the user:
 *   1) manage connection profiles (add/pick/remove)
 *   2) sign in with MSAL (popup or loopback)
 *   3) browse ER solutions and their configurations
 *   4) multi-select configurations and ingest them into the session
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Caption1, Subtitle2, tokens } from '@fluentui/react-components';
import { LinkMultiple20Regular } from '@fluentui/react-icons';
import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { t } from '../i18n';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../state/store';
import { useFnoProfiles } from '../state/fno-profiles';
import { useFnoSession } from '../state/fno-session';
import { fnoSession } from '../fno/session';
import { clearRedirectPending, computeRedirectUri, peekRedirectPending } from '../fno/redirect-state';
import { componentKey, isUsableGuid } from '../fno/ingest/shared';
import { fnoUndownloadableReason } from '../utils/fno-downloadable';
import { DependencyPromptDialog, type DependencyPromptRequest } from './DependencyPromptDialog';
import { ConfigurationBrowser } from './fno/ConfigurationBrowser';
import { IngestFooter } from './fno/IngestFooter';
import { ProfileEditorDialog, useProfileEditor } from './fno/ProfileEditorDialog';
import { ProfilesCard } from './fno/ProfilesCard';
import { SolutionNavigator } from './fno/SolutionNavigator';
import { describeHttpError, explainAuthError } from './fno/errors';
import {
  annotateWithParentDataModel,
  componentMatchesQuery,
  promoteDmToSolutions,
  rememberDataModels,
  scopeComponentsToModel,
} from './fno/listing';
import { useFnoPanelStyles } from './fno/styles';
import { useDeepSearch } from './fno/useDeepSearch';
import { useFnoIngest } from './fno/useFnoIngest';

interface FnoConnectPanelProps {
  onFilesLoaded?: () => void;
}

export const FnoConnectPanel: React.FC<FnoConnectPanelProps> = ({ onFilesLoaded }) => {
  const styles = useFnoPanelStyles();
  const pushToast = useAppStore(s => s.pushToast);
  const { profiles, upsert, remove, markUsed } = useFnoProfiles(useShallow(s => ({
    profiles: s.profiles, upsert: s.upsert, remove: s.remove, markUsed: s.markUsed,
  })));

  // ── Zustand: connection & browsing state (survives unmount) ──
  // Picked field by field (shallow-compared) so a change elsewhere in the
  // store — e.g. rootDataModelByPath — does not re-render this whole panel.
  const {
    activeProfileId, connState, setActiveProfileId, setConnState,
    solutions, loadingSolutions, solutionFilter,
    setSolutions, setLoadingSolutions, setSolutionFilter,
    activeSolution, solutionPath, components, loadingComponents, componentTypeFilter, componentFilter,
    setActiveSolution, setSolutionPath, setComponents, setLoadingComponents, setComponentTypeFilter,
    setComponentFilter,
    selected, setSelected, clearSelection, toggleSelected,
    allDataModelsSeen, dataModelChain,
    setRootDataModelByPath, setAllDataModelsSeen, setDataModelChain,
  } = useFnoSession(useShallow(s => ({
    activeProfileId: s.activeProfileId, connState: s.connState,
    setActiveProfileId: s.setActiveProfileId, setConnState: s.setConnState,
    solutions: s.solutions, loadingSolutions: s.loadingSolutions, solutionFilter: s.solutionFilter,
    setSolutions: s.setSolutions, setLoadingSolutions: s.setLoadingSolutions, setSolutionFilter: s.setSolutionFilter,
    activeSolution: s.activeSolution, solutionPath: s.solutionPath, components: s.components,
    loadingComponents: s.loadingComponents, componentTypeFilter: s.componentTypeFilter, componentFilter: s.componentFilter,
    setActiveSolution: s.setActiveSolution, setSolutionPath: s.setSolutionPath, setComponents: s.setComponents,
    setLoadingComponents: s.setLoadingComponents, setComponentTypeFilter: s.setComponentTypeFilter,
    setComponentFilter: s.setComponentFilter,
    selected: s.selected, setSelected: s.setSelected, clearSelection: s.clearSelection, toggleSelected: s.toggleSelected,
    allDataModelsSeen: s.allDataModelsSeen, dataModelChain: s.dataModelChain,
    setRootDataModelByPath: s.setRootDataModelByPath, setAllDataModelsSeen: s.setAllDataModelsSeen,
    setDataModelChain: s.setDataModelChain,
  })));


  // ── Local-only state (OK to lose on unmount) ──
  const [customRoot, setCustomRoot] = useState('');
  const [expandedSolutions, setExpandedSolutions] = useState<Set<string>>(new Set());
  // Only meaningful for the web build; Electron signs in through a loopback URI.
  const redirectUri = useMemo(() => {
    const uri = computeRedirectUri();
    return /^https?:/i.test(uri) ? uri : '';
  }, []);

  // Cache: root DataModel name → full flat component list.
  // When the user clicks a derived DataModel whose root was already
  // fetched, we reuse the cached list instead of making a new API call
  // (which would return only the derived model's direct children,
  // missing sibling formats / mappings).
  const rootComponentCacheRef = useRef(new Map<string, ErConfigSummary[]>());
  // Monotonic id of the latest listing request. A slower, older response must
  // not overwrite the components of a newer click (pick / drill / back).
  const listRequestSeqRef = useRef(0);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  // ── Cross-model search ───────────────────────────────────────────────────
  // Walks every root model's configuration list for formats and mappings;
  // results take over the right-hand panel (see useDeepSearch).
  const { search, runSearch, clearSearch } = useDeepSearch(
    activeProfile, solutionFilter, solutions, rootComponentCacheRef.current,
  );

  const [depPrompt, setDepPrompt] = useState<(DependencyPromptRequest & { candidates: Array<{ key: string; kind: 'DataModel' | 'ModelMapping' | 'Format'; name: string; meta?: string; comp: ErConfigSummary }> }) | null>(null);

  // ── "Load selected" ──────────────────────────────────────────────────────
  // The pipeline lives in fno/ingest; the hook owns its AbortController and
  // the run keeps going in the background if this panel unmounts.
  const { ingesting, loadSelected: handleLoadSelected, cancel: cancelIngest } = useFnoIngest({
    activeProfile,
    selected,
    allDataModelsSeen,
    solutions,
    rootComponentCache: rootComponentCacheRef.current,
    setSelected,
    onFilesLoaded,
  });

  // Listings cached per root model belong to one environment. Switching
  // profile — or editing the active one to another URL — invalidates them,
  // along with any search still walking the old environment.
  const activeEnvKey = activeProfile ? `${activeProfile.id}|${activeProfile.envUrl}` : '';
  const lastEnvKeyRef = useRef(activeEnvKey);
  useEffect(() => {
    if (lastEnvKeyRef.current === activeEnvKey) return;
    lastEnvKeyRef.current = activeEnvKey;
    rootComponentCacheRef.current.clear();
    listRequestSeqRef.current++;
    cancelIngest();
    setLoadingComponents(false);
    clearSearch();
  }, [activeEnvKey, clearSearch, cancelIngest, setLoadingComponents]);

  // ── Connection profiles ──────────────────────────────────────────────────
  const { editor, openNewProfile, openEditProfile, forgetProfile } =
    useProfileEditor(activeProfileId, setActiveProfileId);

  const handleRemoveProfile = useCallback((id: string) => {
    fnoSession.clearTokenCache(id);
    remove(id);
    if (activeProfileId === id) setActiveProfileId(null);
    // Leaving the dialog open on a profile that no longer exists would silently
    // turn an edit into a create.
    forgetProfile(id);
  }, [remove, activeProfileId, setActiveProfileId, forgetProfile]);

  /**
   * Sign in and list solutions. `silentOnly` never opens a popup or redirects
   * — the redirect resume below runs without a user gesture, so a popup would
   * be blocked and its redirect fallback would loop the page back to Microsoft.
   */
  const handleConnect = useCallback(async (opts?: { silentOnly?: boolean }) => {
    if (!activeProfile) return;
    setConnState({ kind: 'connecting' });
    // Phase 1 — sign in (MSAL).
    let auth: Awaited<ReturnType<typeof fnoSession.signIn>>;
    try {
      if (opts?.silentOnly) {
        const resumed = await fnoSession.resumeSignIn(activeProfile);
        if (!resumed) {
          // Nothing to resume (the user backed out of the Microsoft page, or
          // the session expired): wait for an explicit Connect click.
          setConnState({ kind: 'disconnected' });
          return;
        }
        auth = resumed;
      } else {
        auth = await fnoSession.signIn(activeProfile);
      }
    } catch (err) {
      console.error('[fno-auth] sign-in failed', err);
      const message = explainAuthError(err);
      setConnState({ kind: 'error', message });
      pushToast({ kind: 'error', message: t.fnoSignInFailed(message) });
      return;
    }
    markUsed(activeProfile.id);
    setConnState({ kind: 'connected', account: auth.account?.username ?? 'unknown' });
    // Phase 2 — list ER solutions via custom services.
    setLoadingSolutions(true);
    try {
      const list = await fnoSession.listSolutions(activeProfile);
      list.sort((a, b) => (a.solutionName ?? '').localeCompare(b.solutionName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      setSolutions(list);
      if (list.length === 0) {
        pushToast({
          kind: 'info',
          message: t.fnoNoConfigurationsHint,
        });
      }
    } catch (err) {
      console.error('[fno] listSolutions failed', err);
      const detail = describeHttpError(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(detail) });
    } finally {
      setLoadingSolutions(false);
    }
  }, [activeProfile, markUsed, pushToast, setConnState, setLoadingSolutions, setSolutions]);

  // Finish a sign-in that went through the full-page redirect fallback (tablets
  // and any browser that blocks the popup). The redirect reloads the SPA, so
  // re-select the profile the user started from and resume automatically —
  // otherwise the app comes back looking exactly like a failed sign-in.
  //
  // The marker is consumed exactly once, whatever happens next: a profile that
  // no longer exists must not keep the landing page on the F&O tab, and the
  // resume is silent-only so backing out of the Microsoft page cannot bounce
  // the user straight back there.
  const redirectResumedRef = useRef(false);
  useEffect(() => {
    if (redirectResumedRef.current) return;
    const pendingId = peekRedirectPending();
    if (!pendingId) return;
    // Profiles load synchronously from localStorage, so a miss is final.
    if (!profiles.some(p => p.id === pendingId)) {
      redirectResumedRef.current = true;
      clearRedirectPending();
      return;
    }
    if (activeProfileId !== pendingId) {
      setActiveProfileId(pendingId);
      return;
    }
    if (!activeProfile) return;
    redirectResumedRef.current = true;
    clearRedirectPending();
    void handleConnect({ silentOnly: true });
  }, [profiles, activeProfileId, activeProfile, handleConnect, setActiveProfileId]);

  const handleRetryWithRoot = useCallback(async () => {
    if (!activeProfile) return;
    const root = customRoot.trim();
    if (!root) return;
    setLoadingSolutions(true);
    try {
      const list = await fnoSession.listSolutions(activeProfile, undefined, { extraRoots: [root] });
      list.sort((a, b) => (a.solutionName ?? '').localeCompare(b.solutionName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      console.info('[fno-odata] listSolutions(extraRoot) returned', list.length, 'solutions', list);
      setSolutions(list);
      // If the custom root actually produced hits, persist it on the profile
      // so it is probed automatically on every future load.
      const rootHit = list.some(s => s.solutionName === root || s.rootSolutionName === root);
      if (rootHit && !(activeProfile.extraRoots ?? []).includes(root)) {
        upsert({ ...activeProfile, extraRoots: [...(activeProfile.extraRoots ?? []), root] });
      }
      if (list.length === 0) {
        pushToast({
          kind: 'warning',
          message: t.fnoRootNoSolutions(root),
        });
      }
    } catch (err) {
      console.error('[fno-odata] listSolutions(extraRoot) failed', err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(describeHttpError(err)) });
    } finally {
      setLoadingSolutions(false);
    }
  }, [activeProfile, customRoot, pushToast, setLoadingSolutions, setSolutions, upsert]);

  const handleDisconnect = useCallback(async () => {
    if (!activeProfile) return;
    cancelIngest();
    try {
      await fnoSession.signOut(activeProfile);
    } catch (err) {
      // Local state is reset regardless — the user asked to disconnect.
      console.warn('[fno-ui] signOut failed', err);
    }
    setConnState({ kind: 'disconnected' });
    setSolutions([]);
    setComponents([]);
    setActiveSolution(null);
    setSelected(new Map());
    setRootDataModelByPath(() => new Map());
    setAllDataModelsSeen(() => new Map());
    setDataModelChain([]);
    rootComponentCacheRef.current.clear();
  }, [activeProfile, cancelIngest, setConnState, setSolutions, setComponents, setActiveSolution, setSelected, setRootDataModelByPath, setAllDataModelsSeen, setDataModelChain]);

  const handlePickSolution = useCallback(async (solutionName: string) => {
    if (!activeProfile) return;
    // Opening a model leaves search mode: the right panel now belongs to it.
    clearSearch();
    const requestSeq = ++listRequestSeqRef.current;
    setActiveSolution(solutionName);
    setSolutionPath([solutionName]);

    // Auto-expand the solution in the left panel tree when it's a root
    // (so the user can immediately see its derived children).
    setExpandedSolutions(prev => {
      if (prev.has(solutionName)) return prev;
      const next = new Set(prev);
      next.add(solutionName);
      return next;
    });

    // Resolve the root DataModel so the API call returns the full tree.
    // Derived solutions have few direct children in ERSolutionTable —
    // their formats and mappings live as siblings under the root model.
    // Fetching from the root ensures we always show the complete set.
    const sol = solutions.find(s => s.solutionName === solutionName);
    const rootName = sol?.rootSolutionName ?? solutionName;

    // Selection is intentionally preserved across navigation so the user
    // can queue items from multiple drill levels (e.g. a derived model at
    // level 2 + a mapping at level 1). Use the "Clear" button to reset.
    setLoadingComponents(true);
    setComponents([]);
    try {
      // Use cached root component list when available.
      const cached = rootComponentCacheRef.current.get(rootName);
      const fullTree = cached
        ? cached
        : await fnoSession.listComponents(activeProfile, rootName);
      if (!cached) {
        rootComponentCacheRef.current.set(rootName, fullTree);
      }
      if (requestSeq !== listRequestSeqRef.current) return;
      // Sort a copy: `fullTree` may be the cached list, shared with search.
      const sortedTree = [...fullTree].sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));

      // Accumulate every DataModel we've ever seen so handleLoadSelected
      // can resolve ancestor GUIDs back to downloadable summaries.
      setAllDataModelsSeen(prev => rememberDataModels(prev, sortedTree));

      // Promote nested DataModels found among the children to the
      // left solution panel so the user can navigate to them directly.
      const promoted = promoteDmToSolutions(solutions, sortedTree, rootName);
      if (promoted !== solutions) setSolutions(promoted);

      // Scope the component list to the clicked DataModel. When the
      // user clicks a derived model we must show only its direct
      // children — not all formats from the root. The `ownerDataModelName`
      // on each component identifies which DataModel it belongs to.
      const list = scopeComponentsToModel(sortedTree, solutionName);

      // The first DataModel we see at level 1 is the *root* DataModel
      // for this subtree. Remember it so deeper ModelMapping / Format
      // downloads can carry `parentDataModelGuid`, and seed the
      // model-ancestor chain at depth 0.
      const rootModel = list.find(
        c => c.componentType === 'DataModel' && (isUsableGuid(c.configurationGuid) || isUsableGuid(c.revisionGuid)),
      );
      setRootDataModelByPath(prev => {
        const next = new Map(prev);
        if (rootModel) next.set(solutionName, rootModel);
        return next;
      });
      const chain = rootModel ? [rootModel] : [];
      setDataModelChain(chain);
      setComponents(annotateWithParentDataModel(list, chain));
    } catch (err) {
      // A superseded request's failure is no longer the user's concern.
      if (requestSeq !== listRequestSeqRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      // A newer request owns the spinner now.
      if (requestSeq === listRequestSeqRef.current) setLoadingComponents(false);
    }
  }, [activeProfile, clearSearch, setActiveSolution, setSolutionPath, solutions, setLoadingComponents, setComponents, setAllDataModelsSeen, setSolutions, setRootDataModelByPath, setDataModelChain, pushToast]);

  /** Drill one level deeper: treat the clicked component as a sub-solution
   *  and list its children. Works because the ER tree in F&O is a single
   *  `ERSolutionTable` hierarchy — every node can be a parent. */
  const handleDrillInto = useCallback(async (comp: ErConfigSummary) => {
    if (!activeProfile) return;
    clearSearch();
    const requestSeq = ++listRequestSeqRef.current;
    const name = comp.configurationName;
    setSolutionPath([...solutionPath, name]);
    setActiveSolution(name);
    // If the user drilled into a DataModel, extend the ancestor chain
    // so downstream Formats / Mappings inherit *all* the models the
    // user traversed (root → derived → …). Non-DataModel drill-ins
    // (e.g. a ModelMapping container) don't modify the chain.
    const nextChain = comp.componentType === 'DataModel' && (isUsableGuid(comp.configurationGuid) || isUsableGuid(comp.revisionGuid))
      ? [...dataModelChain, comp]
      : dataModelChain;
    setDataModelChain(nextChain);
    // Preserve selection when drilling deeper — see handlePickSolution.
    setLoadingComponents(true);
    setComponents([]);
    try {
      const list = await fnoSession.listComponents(activeProfile, name);
      if (requestSeq !== listRequestSeqRef.current) return;
      list.sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      setAllDataModelsSeen(prev => rememberDataModels(prev, list));
      setComponents(annotateWithParentDataModel(list, nextChain));
      // Determine root from the solution path entry (the DataModel the user originally clicked).
      const pathRoot = solutionPath[0];
      const pathRootSol = pathRoot ? solutions.find(s => s.solutionName === pathRoot) : undefined;
      const drillRoot = pathRootSol?.rootSolutionName ?? pathRoot ?? name;
      const promoted = promoteDmToSolutions(solutions, list, drillRoot);
      if (promoted !== solutions) setSolutions(promoted);
    } catch (err) {
      // A superseded request's failure is no longer the user's concern.
      if (requestSeq !== listRequestSeqRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      // A newer request owns the spinner now.
      if (requestSeq === listRequestSeqRef.current) setLoadingComponents(false);
    }
  }, [activeProfile, clearSearch, setSolutionPath, solutionPath, setActiveSolution, dataModelChain, setDataModelChain, setLoadingComponents, setComponents, setAllDataModelsSeen, solutions, setSolutions, pushToast]);

  /** Pop back one level in the solution breadcrumb. */
  const handleBack = useCallback(async () => {
    if (!activeProfile) return;
    clearSearch();
    const requestSeq = ++listRequestSeqRef.current;
    if (solutionPath.length <= 1) {
      // Back to the root list — clear the component list but keep the
      // selection so the user can still load what they queued.
      setSolutionPath([]);
      setActiveSolution(null);
      setComponents([]);
      setDataModelChain([]);
      // Bumping the sequence above orphaned any in-flight listing, whose
      // `finally` will now leave the spinner alone — clear it here.
      setLoadingComponents(false);
      return;
    }
    const nextPath = solutionPath.slice(0, -1);
    const parent = nextPath[nextPath.length - 1];
    setSolutionPath(nextPath);
    setActiveSolution(parent);
    // Trim the model ancestor chain to match the new depth. A drill-in
    // only extended the chain when it was a DataModel, so the back
    // operation must pop the tail only when the current last entry
    // was pushed for the level being unwound. We approximate by
    // keeping chain length ≤ new depth.
    const nextChain = dataModelChain.slice(0, nextPath.length);
    setDataModelChain(nextChain);
    setLoadingComponents(true);
    setComponents([]);
    try {
      // When navigating back to the DataModel level (path length 1),
      // resolve the root model to fetch the full tree (same logic as
      // handlePickSolution). For deeper levels use the actual parent.
      const isBackToModel = nextPath.length === 1;
      const parentSol = isBackToModel
        ? solutions.find(s => s.solutionName === parent)
        : undefined;
      const apiName = parentSol?.rootSolutionName ?? parent;
      const cached = isBackToModel
        ? rootComponentCacheRef.current.get(apiName)
        : undefined;
      const fullTree = cached
        ? cached
        : await fnoSession.listComponents(activeProfile, apiName);
      if (isBackToModel && !cached) {
        rootComponentCacheRef.current.set(apiName, fullTree);
      }
      if (requestSeq !== listRequestSeqRef.current) return;
      // Sort a copy, never the cached list itself (see handlePickSolution).
      const sortedTree = [...fullTree].sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      setAllDataModelsSeen(prev => rememberDataModels(prev, sortedTree));
      const backRoot = parentSol?.rootSolutionName ?? parent;
      const promoted = promoteDmToSolutions(solutions, sortedTree, backRoot);
      if (promoted !== solutions) setSolutions(promoted);
      // Scope to the model being navigated back to.
      const list = isBackToModel
        ? scopeComponentsToModel(sortedTree, parent)
        : sortedTree;
      setComponents(annotateWithParentDataModel(list, nextChain));
    } catch (err) {
      // A superseded request's failure is no longer the user's concern.
      if (requestSeq !== listRequestSeqRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      // A newer request owns the spinner now.
      if (requestSeq === listRequestSeqRef.current) setLoadingComponents(false);
    }
  }, [activeProfile, clearSearch, solutionPath, setSolutionPath, setActiveSolution, dataModelChain, setDataModelChain, setLoadingComponents, setComponents, solutions, setAllDataModelsSeen, setSolutions, pushToast]);

  // Search results take over the right panel while a search is active; the
  // type dropdown and the text filter then narrow the hits instead of the
  // opened model's listing.
  const listedComponents = search ? search.results : components;

  const filteredComponents = useMemo(() => {
    // DataModel nodes are navigation-only (left panel) — exclude them from
    // the right detail/download panel entirely.
    let base = listedComponents.filter(c => c.componentType !== 'DataModel');
    if (componentTypeFilter !== 'All') base = base.filter(c => c.componentType === componentTypeFilter);
    const q = componentFilter.trim().toLowerCase();
    if (q) base = base.filter(c => componentMatchesQuery(c, q));
    return base;
  }, [listedComponents, componentTypeFilter, componentFilter]);

  // The rule lives in utils/fno-downloadable so it can be unit-tested: a
  // draft-only configuration has a perfectly good id, so every id-based test
  // says "downloadable" while F&O answers empty.
  const isComponentDownloadable = useCallback(
    (comp: ErConfigSummary): boolean => fnoUndownloadableReason(comp) === null,
    [],
  );

  const toggleSelect = useCallback((comp: ErConfigSummary) => {
    if (!isComponentDownloadable(comp)) return;
    const key = componentKey(comp);
    const wasSelected = selected.has(key);
    toggleSelected(key, comp);
    if (wasSelected || comp.componentType !== 'Format') return;

    // Ask whether to also pull the model and its mapping. Candidates come
    // from the listing the user is looking at: the owning DataModel row and
    // the ModelMapping rows under the same solution.
    const ownerNames = new Set([comp.ownerDataModelName, comp.solutionName].filter(Boolean) as string[]);
    const related = components.filter(c => {
      if (componentKey(c) === key || selected.has(componentKey(c))) return false;
      if (!isComponentDownloadable(c)) return false;
      if (c.componentType === 'DataModel') {
        return ownerNames.has(c.configurationName) || ownerNames.has(c.solutionName);
      }
      if (c.componentType === 'ModelMapping') {
        return (c.ownerDataModelName ? ownerNames.has(c.ownerDataModelName) : false) || ownerNames.has(c.solutionName);
      }
      return false;
    });
    // Also consider the DataModel the user drilled through (left panel) when
    // the listing itself carries no DataModel row.
    const chainDm = dataModelChain[dataModelChain.length - 1];
    if (chainDm && !related.some(c => c.componentType === 'DataModel') && isComponentDownloadable(chainDm)
      && !selected.has(componentKey(chainDm)) && ownerNames.has(chainDm.configurationName)) {
      related.unshift(chainDm);
    }
    if (related.length === 0) return;
    const seen = new Set<string>();
    setDepPrompt({
      subjectName: comp.configurationName,
      subjectKind: 'Format',
      body: t.depPromptBodyFno(comp.configurationName),
      candidates: related
        .filter(c => { const k = componentKey(c); if (seen.has(k)) return false; seen.add(k); return true; })
        .map(c => ({
          key: componentKey(c),
          kind: c.componentType as 'DataModel' | 'ModelMapping' | 'Format',
          name: c.configurationName,
          meta: c.version ? `v${c.version}` : undefined,
          comp: c,
        })),
    });
  }, [isComponentDownloadable, toggleSelected, selected, components, dataModelChain]);

  const selectAllVisible = useCallback(() => {
    const next = new Map(selected);
    for (const c of filteredComponents) {
      if (!isComponentDownloadable(c)) continue;
      next.set(componentKey(c), c);
    }
    setSelected(next);
  }, [filteredComponents, isComponentDownloadable, selected, setSelected]);

  const toggleExpanded = useCallback((name: string) => {
    setExpandedSolutions(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  return (
    <div className={styles.root}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderIcon}>
          <LinkMultiple20Regular fontSize={22} />
        </div>
        <div>
          <Subtitle2>{t.fnoHeading}</Subtitle2>
          <Caption1 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginTop: '4px' }}>{t.fnoSubheading}</Caption1>
        </div>
      </div>

      {/* ── Environments card ───────────────────────────────────────────── */}
      <ProfilesCard
        profiles={profiles}
        activeProfileId={activeProfileId}
        connState={connState}
        redirectUri={redirectUri}
        setActiveProfileId={setActiveProfileId}
        openNewProfile={openNewProfile}
        openEditProfile={openEditProfile}
        handleRemoveProfile={handleRemoveProfile}
        handleConnect={handleConnect}
        handleDisconnect={handleDisconnect}
      />

      {/* ── Profile editor dialog ───────────────────────────────────────── */}
      <ProfileEditorDialog editor={editor} />

      {/* ── Browser ──────────────────────────────────────────────────────── */}
      {connState.kind === 'connected' && (
        <>
          <div className={styles.columns}>
            {/* Left: DataModel navigator */}
            <SolutionNavigator
              solutions={solutions}
              loadingSolutions={loadingSolutions}
              solutionFilter={solutionFilter}
              setSolutionFilter={setSolutionFilter}
              activeSolution={activeSolution}
              expandedSolutions={expandedSolutions}
              toggleExpanded={toggleExpanded}
              handlePickSolution={handlePickSolution}
              search={search}
              runSearch={runSearch}
              clearSearch={clearSearch}
              customRoot={customRoot}
              setCustomRoot={setCustomRoot}
              handleRetryWithRoot={handleRetryWithRoot}
            />

            {/* Right: configuration browser */}
            <ConfigurationBrowser
              solutionPath={solutionPath}
              loadingSolutions={loadingSolutions}
              loadingComponents={loadingComponents}
              search={search}
              clearSearch={clearSearch}
              componentTypeFilter={componentTypeFilter}
              setComponentTypeFilter={setComponentTypeFilter}
              componentFilter={componentFilter}
              setComponentFilter={setComponentFilter}
              filteredComponents={filteredComponents}
              selected={selected}
              selectAllVisible={selectAllVisible}
              clearSelection={clearSelection}
              toggleSelect={toggleSelect}
              handleBack={handleBack}
              handleDrillInto={handleDrillInto}
              handlePickSolution={handlePickSolution}
            />
          </div>

          <DependencyPromptDialog
            request={depPrompt}
            onConfirm={keys => {
              const next = new Map(selected);
              for (const c of depPrompt?.candidates ?? []) {
                if (keys.includes(c.key)) next.set(c.key, c.comp);
              }
              setSelected(next);
              setDepPrompt(null);
            }}
            onOnlySubject={() => setDepPrompt(null)}
          />

          {/* ── Footer / download bar ─────────────────────────────────────── */}
          <IngestFooter selected={selected} ingesting={ingesting} onLoadSelected={handleLoadSelected} />
        </>
      )}
    </div>
  );
};
