/**
 * F&O connector panel — shown on the Landing page under the "D365 F&O server"
 * tab. Lets the user:
 *   1) manage connection profiles (add/pick/remove)
 *   2) sign in with MSAL (popup or loopback)
 *   3) browse ER solutions and their configurations
 *   4) multi-select configurations and ingest them into the session
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Field,
  Input,
  Dropdown,
  Option,
  Checkbox,
  Spinner,
  Caption1,
  Title3,
  Body1,
  Body1Strong,
  Divider,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  PlugConnectedRegular,
  PlugDisconnectedRegular,
  CloudArrowDownRegular,
  ArrowSyncRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import type {
  ErComponentType,
  ErConfigSummary,
   ErSolutionSummary,
  FnoConnection,
} from '@er-visualizer/fno-client';
import { FnoHttpError, FnoEmptyContentError } from '@er-visualizer/fno-client';
import { t } from '../i18n';
import { useAppStore } from '../state/store';
import { useFnoProfiles, newProfileId } from '../state/fno-profiles';
import { useFnoSession } from '../state/fno-session';
import { fnoSession } from '../fno/session';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    width: '100%',
    maxWidth: '1400px',
    marginLeft: 'auto',
    marginRight: 'auto',
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  row: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalM,
    width: '100%',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  profileRowActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    minHeight: '420px',
    width: '100%',
    '@media (max-width: 860px)': {
      gridTemplateColumns: '1fr',
    },
  },
  listBox: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden',
    minHeight: '420px',
    maxHeight: '640px',
  },
  listScroll: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    cursor: 'pointer',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  listItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
  },
  emptyStateRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'stretch',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
});

const DEFAULT_CLIENT_ID = '';
const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

interface FnoConnectPanelProps {
  onFilesLoaded?: () => void;
}

export const FnoConnectPanel: React.FC<FnoConnectPanelProps> = ({ onFilesLoaded }) => {
  const styles = useStyles();
  const pushToast = useAppStore(s => s.pushToast);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const { profiles, upsert, remove, markUsed } = useFnoProfiles();

  // ── Zustand: connection & browsing state (survives unmount) ──
  const {
    activeProfileId, connState, setActiveProfileId, setConnState,
    solutions, loadingSolutions, solutionFilter,
    setSolutions, setLoadingSolutions, setSolutionFilter,
    activeSolution, solutionPath, components, loadingComponents, componentTypeFilter,
    setActiveSolution, setSolutionPath, setComponents, setLoadingComponents, setComponentTypeFilter,
    selected, setSelected, toggleSelected,
    rootDataModelByPath, allDataModelsSeen, dataModelChain,
    setRootDataModelByPath, setAllDataModelsSeen, setDataModelChain,
  } = useFnoSession();

  // ── Local-only state (OK to lose on unmount) ──
  const [profileName, setProfileName] = useState('');
  const [envUrl, setEnvUrl] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [customRoot, setCustomRoot] = useState('');
  const [ingesting, setIngesting] = useState(false);

  // Cache: root DataModel name → full flat component list.
  // When the user clicks a derived DataModel whose root was already
  // fetched, we reuse the cached list instead of making a new API call
  // (which would return only the derived model's direct children,
  // missing sibling formats / mappings).
  const rootComponentCacheRef = useRef(new Map<string, ErConfigSummary[]>());
  const setFnoIngestStatus = useAppStore(s => s.setFnoIngestStatus);
  const setIngestStatus = useCallback((status: string) => {
    setFnoIngestStatus(status);
  }, [setFnoIngestStatus]);
  const ingestStatus = useAppStore(s => s.fnoIngestStatus);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  // When the active profile changes, populate the editor with its values.
  // The Zustand store already resets browsing state in `setActiveProfileId`.
  useEffect(() => {
    const profile = profiles.find(p => p.id === activeProfileId) ?? null;
    if (profile) {
      setProfileName(profile.displayName);
      setEnvUrl(profile.envUrl);
      setTenantId(profile.tenantId);
      setClientId(profile.clientId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  const canSave = profileName.trim().length > 0 && envUrl.trim().length > 0 && tenantId.trim().length > 0 && clientId.trim().length > 0;
  const isEditing = activeProfile !== null;

  const handleSaveProfile = useCallback(() => {
    const base: FnoConnection = activeProfile
      ? { ...activeProfile }
      : { id: newProfileId(), createdAt: Date.now(), displayName: '', envUrl: '', tenantId: '', clientId: '' };
    const profile: FnoConnection = {
      ...base,
      displayName: profileName.trim(),
      envUrl: envUrl.trim().replace(/\/+$/, ''),
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
    };
    upsert(profile);
    setActiveProfileId(profile.id);
    pushToast({
      kind: 'success',
      message: activeProfile ? t.fnoProfileUpdated(profile.displayName) : t.fnoProfileSaved(profile.displayName),
    });
  }, [activeProfile, profileName, envUrl, tenantId, clientId, upsert, pushToast]);

  const handleNewProfile = useCallback(() => {
    setActiveProfileId(null);
    setProfileName('');
    setEnvUrl('');
    setTenantId('');
    setClientId(DEFAULT_CLIENT_ID);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!activeProfile) return;
    setConnState({ kind: 'connecting' });
    // Phase 1 — sign in (MSAL).
    let auth: Awaited<ReturnType<typeof fnoSession.signIn>>;
    try {
      auth = await fnoSession.signIn(activeProfile);
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
      // Dev diagnostic: always log so we can inspect shape in DevTools.
      console.info(
        '[fno] listSolutions returned',
        list.length,
        'solutions',
        list.map(s => s.solutionName),
        list,
      );
      setSolutions(list);
      if (list.length === 0) {
        pushToast({
          kind: 'info',
          message:
            'No ER configurations found in this environment. Sign in to F&O and go to ' +
            'Organization administration → Electronic reporting → Configuration providers → ' +
            'Microsoft (Active) → Repositories → LCS → Open → Import to pull configurations ' +
            'from Lifecycle Services. Then reconnect here. ' +
            '(Details: DevTools → Console → filter "[fno-client]".)',
        });
      }
    } catch (err) {
      console.error('[fno] listSolutions failed', err);
      const detail = describeHttpError(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(detail) });
    } finally {
      setLoadingSolutions(false);
    }
  }, [activeProfile, markUsed, pushToast]);

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
      if (list.length === 0) {
        pushToast({
          kind: 'warning',
          message: `Root "${root}" still returned no solutions. Either the publisher name is wrong, or the environment has no ER configurations imported.`,
        });
      }
    } catch (err) {
      console.error('[fno-odata] listSolutions(extraRoot) failed', err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(describeHttpError(err)) });
    } finally {
      setLoadingSolutions(false);
    }
  }, [activeProfile, customRoot, pushToast]);

  const handleDisconnect = useCallback(async () => {
    if (!activeProfile) return;
    await fnoSession.signOut(activeProfile);
    setConnState({ kind: 'disconnected' });
    setSolutions([]);
    setComponents([]);
    setActiveSolution(null);
    setSelected(new Map());
    setRootDataModelByPath(() => new Map());
    setAllDataModelsSeen(() => new Map());
    setDataModelChain([]);
    rootComponentCacheRef.current.clear();
  }, [activeProfile, setConnState, setSolutions, setComponents, setActiveSolution, setSelected, setRootDataModelByPath, setAllDataModelsSeen, setDataModelChain]);

  const handlePickSolution = useCallback(async (solutionName: string) => {
    if (!activeProfile) return;
    setActiveSolution(solutionName);
    setSolutionPath([solutionName]);

    // Resolve the root DataModel so the API call returns the full tree.
    // Country-specific derived models (e.g. "Asl Tax declaration model (SK)")
    // have very few direct children in ERSolutionTable — their formats and
    // mappings live as siblings under the root model. Fetching from the root
    // ensures we always show the complete set of configurations.
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
      fullTree.sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      console.info('[fno-ui] components for', solutionName, '(root:', rootName, ')', fullTree);

      // Accumulate every DataModel we've ever seen so handleLoadSelected
      // can resolve ancestor GUIDs back to downloadable summaries.
      setAllDataModelsSeen(prev => rememberDataModels(prev, fullTree));

      // Promote nested DataModels found among the children to the
      // left solution panel so the user can navigate to them directly.
      const promoted = promoteDmToSolutions(solutions, fullTree, rootName);
      if (promoted !== solutions) setSolutions(promoted);

      // Scope the component list to the clicked DataModel. When the
      // user clicks a derived model (e.g. "Asl Bank statement model")
      // we must show only its direct children — not all formats from
      // the root. The `ownerDataModelName` on each component identifies
      // which DataModel it belongs to.
      const list = scopeComponentsToModel(fullTree, solutionName);

      // The first DataModel we see at level 1 is the *root* DataModel
      // for this subtree. Remember it so deeper ModelMapping / Format
      // downloads can carry `parentDataModelGuid`, and seed the
      // model-ancestor chain at depth 0.
      const rootModel = list.find(
        c => c.componentType === 'DataModel' && (c.configurationGuid || c.revisionGuid),
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
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, solutions, pushToast]);

  /** Drill one level deeper: treat the clicked component as a sub-solution
   *  and list its children. Works because the ER tree in F&O is a single
   *  `ERSolutionTable` hierarchy — every node can be a parent. */
  const handleDrillInto = useCallback(async (comp: ErConfigSummary) => {
    if (!activeProfile) return;
    const name = comp.configurationName;
    setSolutionPath([...solutionPath, name]);
    setActiveSolution(name);
    // If the user drilled into a DataModel, extend the ancestor chain
    // so downstream Formats / Mappings inherit *all* the models the
    // user traversed (root → derived → …). Non-DataModel drill-ins
    // (e.g. a ModelMapping container) don't modify the chain.
    const nextChain = comp.componentType === 'DataModel' && (comp.configurationGuid || comp.revisionGuid)
      ? [...dataModelChain, comp]
      : dataModelChain;
    setDataModelChain(nextChain);
    // Preserve selection when drilling deeper — see handlePickSolution.
    setLoadingComponents(true);
    setComponents([]);
    try {
      const list = await fnoSession.listComponents(activeProfile, name);
      list.sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      console.info('[fno-ui] components for', name, list);
      setAllDataModelsSeen(prev => rememberDataModels(prev, list));
      setComponents(annotateWithParentDataModel(list, nextChain));
      // Determine root from the solution path entry (the DataModel the user originally clicked).
      const pathRoot = solutionPath[0];
      const pathRootSol = pathRoot ? solutions.find(s => s.solutionName === pathRoot) : undefined;
      const drillRoot = pathRootSol?.rootSolutionName ?? pathRoot ?? name;
      const promoted = promoteDmToSolutions(solutions, list, drillRoot);
      if (promoted !== solutions) setSolutions(promoted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, solutions, pushToast, dataModelChain, solutionPath]);

  /** Pop back one level in the solution breadcrumb. */
  const handleBack = useCallback(async () => {
    if (!activeProfile) return;
    if (solutionPath.length <= 1) {
      // Back to the root list — clear the component list but keep the
      // selection so the user can still load what they queued.
      setSolutionPath([]);
      setActiveSolution(null);
      setComponents([]);
      setDataModelChain([]);
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
      setAllDataModelsSeen(prev => rememberDataModels(prev, fullTree));
      const backRoot = parentSol?.rootSolutionName ?? parent;
      const promoted = promoteDmToSolutions(solutions, fullTree, backRoot);
      if (promoted !== solutions) setSolutions(promoted);
      // Scope to the model being navigated back to.
      const list = isBackToModel
        ? scopeComponentsToModel(fullTree, parent)
        : fullTree;
      setComponents(annotateWithParentDataModel(list, nextChain));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, solutions, solutionPath, dataModelChain, pushToast]);

  const filteredComponents = useMemo(() => {
    // DataModel nodes are shown only in the left navigation panel — exclude
    // them from the right detail/download panel entirely.
    const base = components.filter(c => c.componentType !== 'DataModel');
    if (componentTypeFilter === 'All') return base;
    return base.filter(c => c.componentType === componentTypeFilter);
  }, [components, componentTypeFilter]);

  const isComponentDownloadable = useCallback((comp: ErConfigSummary): boolean => {
    if (comp.revisionGuid || comp.configurationGuid) return true;
    // ModelMapping rows from `getFormatSolutionsSubHierarchy` are
    // missing their own GUID but can still be resolved via
    // `getModelMappingByID(_dataModelGuid, _dataContainerDescriptorName)`
    // when we know the parent DataModel GUID. See the matching
    // fallback path in `buildDownloadAttempts` (fno-client/er-services.ts).
    if (
      comp.componentType === 'ModelMapping' &&
      (comp.parentDataModelGuid || comp.parentDataModelRevisionGuid)
    ) {
      return true;
    }
    return false;
  }, []);

  const toggleSelect = useCallback((comp: ErConfigSummary) => {
    if (!isComponentDownloadable(comp)) return;
    const key = componentKey(comp);
    toggleSelected(key, comp);
  }, [isComponentDownloadable, toggleSelected]);

  const selectAllVisible = useCallback(() => {
    const next = new Map(selected);
    for (const c of filteredComponents) {
      if (!isComponentDownloadable(c)) continue;
      next.set(componentKey(c), c);
    }
    setSelected(next);
  }, [filteredComponents, isComponentDownloadable, selected, setSelected]);

  const clearSelection = useCallback(() => setSelected(new Map()), [setSelected]);

  const handleLoadSelected = useCallback(async () => {
    if (!activeProfile) return;
    // Iterate the accumulated selection map directly — items queued at
    // other drill levels are no longer in `filteredComponents` but must
    // still be downloaded.
    const toLoad = Array.from(selected.values());
    if (toLoad.length === 0) return;
    // Auto-include *every* DataModel ancestor for each selected
    // Format / ModelMapping. The ER tree nests Formats under one or
    // more DataModels (root → derived → …) and every intermediate
    // model is needed to resolve inherited bindings. We captured the
    // chain during drill navigation as `ancestorDataModelGuids` on
    // each listed component and now resolve those GUIDs back to
    // downloadable summaries via `allDataModelsSeen`.
    const augmented = new Map(selected);
    const resolveByGuid = (guid: string): ErConfigSummary | undefined => {
      for (const m of allDataModelsSeen.values()) {
        if (m.configurationGuid === guid || m.revisionGuid === guid) return m;
      }
      return undefined;
    };
    for (const c of toLoad) {
      // If the user picked a DataModel explicitly, don't second-guess
      // them, but we still pull ancestors above it below via the
      // parentDataModelGuid path.
      const ancestorGuids = c.ancestorDataModelGuids ?? [];
      for (const guid of ancestorGuids) {
        const model = resolveByGuid(guid);
        if (!model) continue;
        // Skip DataModels whose rows carried no real GUID. F&O's
        // `getFormatSolutionsSubHierarchy` returns DataModel entries
        // with only `FormatMappingGUID=00000000…` (zero placeholder)
        // and no separate DataModel GUID, so we have nothing usable
        // to pass to `GetDataModelByIDAndRevision`. Queuing them
        // would cascade into "all revisions empty" errors and red
        // toasts on the user's Load action.
        if (!model.configurationGuid && !model.revisionGuid) {
          console.info(
            '[fno-ui] skipping ancestor model without downloadable GUID',
            { name: model.configurationName },
          );
          continue;
        }
        const key = componentKey(model);
        if (!augmented.has(key)) augmented.set(key, model);
      }
      // Backstop for older component objects (without ancestor list)
      // that only have parentDataModelGuid set.
      if (ancestorGuids.length === 0) {
        const nearest = resolveByGuid(c.parentDataModelGuid ?? '')
          ?? resolveByGuid(c.parentDataModelRevisionGuid ?? '');
        if (nearest && (nearest.configurationGuid || nearest.revisionGuid)) {
          const key = componentKey(nearest);
          if (!augmented.has(key)) augmented.set(key, nearest);
        }
      }
    }
    // ── Name-based DataModel fallback ──
    // For import formats (and any Format/ModelMapping whose parent
    // DataModel has no GUID in the listing), the GUID-based paths above
    // leave nothing in `augmented`. Use the component's `solutionName`
    // as the root DataModel's configuration name and look it up in
    // `allDataModelsSeen`. If found (even with a potentially wrong
    // GUID from `findAnyGuid`), include it — a wrong GUID will silently
    // return 200-empty and be skipped without a toast.
    for (const c of toLoad) {
      if (c.componentType === 'DataModel') continue;
      if (!c.solutionName) continue;
      // Already resolved via GUID path?
      const alreadyHasDm = Array.from(augmented.values()).some(
        a => a.componentType === 'DataModel' &&
          (a.configurationName === c.solutionName || a.solutionName === c.solutionName),
      );
      if (alreadyHasDm) continue;
      // Look up the root DataModel by its configuration name.
      const rootByName = Array.from(allDataModelsSeen.values()).find(
        m => m.configurationName === c.solutionName,
      );
      if (rootByName) {
        console.info('[fno-ui] name-based DataModel fallback', {
          formatName: c.configurationName,
          solutionName: c.solutionName,
          foundDmGuid: rootByName.configurationGuid ?? rootByName.revisionGuid,
        });
        augmented.set(componentKey(rootByName), rootByName);
        continue;
      }
      // Also try the rootSolutionName from the solutions list — when the user
      // selected a derived solution (e.g. "Asl Advanced bank reconciliation
      // statement model") the DataModel's configurationName is the root
      // ("Advanced bank reconciliation statement model").
      const sol = solutions.find(s => s.solutionName === c.solutionName);
      const rootSolName = sol?.rootSolutionName ?? c.solutionName;
      const rootByRootName = rootSolName !== c.solutionName
        ? Array.from(allDataModelsSeen.values()).find(m => m.configurationName === rootSolName)
        : undefined;
      if (rootByRootName) {
        console.info('[fno-ui] root-solution-name DataModel fallback', {
          formatName: c.configurationName,
          solutionName: c.solutionName,
          rootSolName,
          foundDmGuid: rootByRootName.configurationGuid ?? rootByRootName.revisionGuid,
        });
        augmented.set(componentKey(rootByRootName), rootByRootName);
        continue;
      }
      // Last resort: use referencedModelGuid from the listing API's Base field.
      // This is the ERSolution GUID of the DataModel the format references —
      // valid input for GetDataModelByIDAndRevision even when the DataModel
      // listing row itself carried no GUID. Typical for import formats whose
      // root DataModel was never browsed (allDataModelsSeen is empty).
      if (c.referencedModelGuid) {
        const synthDm: ErConfigSummary = {
          solutionName: rootSolName,
          configurationName: rootSolName,
          componentType: 'DataModel',
          configurationGuid: c.referencedModelGuid,
          hasContent: true,
          versionNumbers: [1, 2, 3, 0],
        };
        console.info('[fno-ui] referencedModelGuid DataModel fallback', {
          formatName: c.configurationName,
          solutionName: c.solutionName,
          referencedModelGuid: c.referencedModelGuid,
        });
        augmented.set(componentKey(synthDm), synthDm);
      }
    }
    setIngesting(true);
    setIngestStatus(t.fnoStatusPreparing);

    const finalToLoad = Array.from(augmented.values());
    // Order: root DataModels first (so downstream imports can resolve
    // references), then ModelMappings, then the rest (Formats).
    finalToLoad.sort((a, b) => {
      const order = (k: ErComponentType) =>
        k === 'DataModel' ? 0 : k === 'ModelMapping' ? 1 : 2;
      return order(a.componentType) - order(b.componentType);
    });
    // Key set of components the user picked explicitly — used to
    // differentiate "real failure on user-selected item" (error toast)
    // from "auto-injected root model had no own XML" (silent skip).
    const explicitKeys = new Set(Array.from(selected.keys()));
    let ok = 0;
    let skippedEmpty = 0;
    // Follow-up queue: DataModel GUIDs extracted from `Model="…"`
    // attributes inside Format / ModelMapping XML. F&O's
    // `getFormatSolutionsSubHierarchy` often returns DataModel rows
    // with only the zero GUID placeholder, so these cross-references
    // inside the downloaded content are the *only* reliable way to
    // discover the real DataModel GUID we can pass to
    // `GetDataModelByIDAndRevision`.
    const pendingModelFollowUps = new Map<string, { guid: string; rev?: number }>();
    // Late-discovered DataModel GUIDs from ModelMapping/Format XML downloaded
    // in the synth pass (passes 3+). Import formats often lack
    // ERFormatMappingVersion.Model in their own XML but the ModelMapping that
    // is synthesised for the same DataModel DOES carry a correct Model= GUID.
    // Harvesting it here lets us download the root DataModel even when passes
    // 1 and 2 couldn't find its GUID.
    const lateModelFollowUps = new Map<string, { guid: string; rev?: number }>();
    const alreadyLoadedGuids = new Set<string>();
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel' && c.configurationGuid) {
        alreadyLoadedGuids.add(c.configurationGuid.toLowerCase());
      }
    }

    // GUIDs of ModelMapping configs referenced from downloaded Format XMLs
    // (via ERFormatMappingVersion.ModelMappingVersion or similar attributes).
    // Populated by downloadSelectedTask; consumed by the synth pass to queue
    // direct-GUID mapping downloads that bypass the unreliable descriptor
    // fallback (which always returns the DEFAULT mapping, not the CZ/SK one).
    const formatMmGuids = new Set<string>();

    // Maps DataModel VERSION GUID (from ERModelDataSourceHandler.ModelGuid inside
    // format XML) → DataModel ERSolution GUID (from the listing API's `Base` field
    // stored as referencedModelGuid on the format ErConfigSummary).
    //
    // WHY: `GetModelMappingByID(_mappingGuid=zero, _dataModelGuid, descriptor)`
    // resolves `_dataModelGuid` through ERSolutionTable (keyed by ERSolution.ID).
    // The version GUID (from inside XML) is NOT in ERSolutionTable.ID — so F&O
    // falls through to the global default mapping instead of the country-specific
    // one. The ERSolution GUID from the listing's `Base` field IS in
    // ERSolutionTable.ID and resolves directly to the CZ/SK mapping.
    const dmVersionToSolutionGuid = new Map<string, string>();

    // Helper: process a single download result, harvest cross-references.
    const harvestRefs = (download: Awaited<ReturnType<typeof fnoSession.downloadConfiguration>>) => {
      const refs = download.referencedDataModelGuids ?? [];
      const refRevs = download.referencedDataModelRevisions ?? {};
      // Capture version GUID → ERSolution GUID mapping from Format downloads.
      // `referencedModelGuid` on a Format component = listing API `Base` field =
      // the ERSolution GUID of the DataModel this format derives from.
      if (download.source.componentType === 'Format') {
        const rawSolGuid = download.source.referencedModelGuid;
        const solGuid = (rawSolGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (solGuid && solGuid !== ZERO_GUID_LOWER) {
          for (const guid of refs) {
            const lower = guid.toLowerCase();
            if (lower && lower !== ZERO_GUID_LOWER) {
              dmVersionToSolutionGuid.set(lower, solGuid);
            }
          }
          // For import formats, GetEffectiveFormatMappingByID returns only the format
          // structure — no ERSolution wrapper (no Base= attribute) and no embedded
          // ERModelMappingVersion (no Model= attribute). extractReferencedDataModelGuids
          // therefore finds 0 GUIDs and pendingModelFollowUps stays empty.
          // The listing API's referencedModelGuid IS reliable — it comes from the
          // ERSolution.Base field in the listing row. Use it as a fallback so the
          // synth pass can try GetDataModelByIDAndRevision with the ERSolution GUID.
          if (refs.length === 0 && !alreadyLoadedGuids.has(solGuid)) {
            if (!pendingModelFollowUps.has(solGuid)) {
              pendingModelFollowUps.set(solGuid, { guid: solGuid, rev: undefined });
            }
          }
        }
      }
      for (const guid of refs) {
        const lower = guid.toLowerCase();
        if (alreadyLoadedGuids.has(lower)) continue;
        const existing = pendingModelFollowUps.get(lower);
        const rev = refRevs[lower];
        if (!existing || (typeof rev === 'number' && (existing.rev ?? -1) < rev)) {
          pendingModelFollowUps.set(lower, { guid, rev });
        }
      }
    };

    const handleDownloadError = (component: ErConfigSummary, err: unknown) => {
      if (err instanceof FnoEmptyContentError) {
        skippedEmpty += 1;
        const wasExplicit = explicitKeys.has(componentKey(component));
        if (wasExplicit) {
          pushToast({
            kind: 'info',
            message: t.fnoSkippedDerived(component.configurationName),
          });
        } else {
          console.info('[fno-ui] auto-included root has no own XML, skipping', component.configurationName);
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoDownloadFailed(component.configurationName, message) });
    };

    // ── Phase 0: GUID discovery for no-GUID DataModels ──
    // F&O's getFormatSolutionsSubHierarchy does not return GUIDs for DataModel /
    // ModelMapping rows on modern builds. However Format siblings in the same tree
    // carry FormatMappingGUID AND referencedModelGuid (ERSolution GUID from Base field).
    //
    // Root cause of the problem: F&O listing API returns no GUIDs for DataModel/ModelMapping.
    // Import format XML (GetEffectiveFormatMappingByID) returns only the bare format element
    // tree — no <ERSolutionVersion> wrapper, no Base= attribute, no Model= attribute.
    // So neither allDataModelsSeen nor XML extraction can provide a DataModel GUID.
    //
    // Strategy: for each selected Format that has no DataModel in finalToLoad,
    // find sibling Format rows (with FormatMappingGUID = configurationGuid) from
    // rootComponentCacheRef keyed by the format's solutionName, and download up to 3
    // of them as scouts. Export-format siblings embed Model="{dm-guid}" in their XML.
    // Once we have the GUID, synthesize a DataModel entry and push it into finalToLoad.
    {
      // Build a set of DataModel solution/config names already covered in finalToLoad.
      const dmNamesInLoad = new Set(
        finalToLoad
          .filter(c => c.componentType === 'DataModel')
          .flatMap(c => [c.configurationName, c.solutionName].filter(Boolean)),
      );

      // For each selected Format whose DataModel isn't already covered, try to discover
      // the DataModel GUID via sibling format scouts from the listing cache.
      for (const fmt of Array.from(selected.values())) {
        if (fmt.componentType !== 'Format') continue;
        // Is the parent DataModel already in finalToLoad?
        const parentDmName = fmt.solutionName ?? '';
        if (dmNamesInLoad.has(parentDmName)) continue;
        if (!parentDmName) continue;

        // Collect Format siblings from the cached tree rooted at parentDmName.
        const siblings: ErConfigSummary[] = [];
        for (const [cacheKey, rootComponents] of rootComponentCacheRef.current) {
          if (cacheKey !== parentDmName) continue;
          for (const c of rootComponents) {
            if (c.componentType === 'Format' && c.configurationGuid
              && c.configurationName !== fmt.configurationName) {
              siblings.push(c);
            }
          }
        }

        // Deduplicate by configurationGuid.
        const seenGuids = new Set<string>();
        const scouts: ErConfigSummary[] = [];
        for (const c of siblings) {
          if (seenGuids.has(c.configurationGuid!)) continue;
          seenGuids.add(c.configurationGuid!);
          scouts.push(c);
          if (scouts.length >= 4) break;
        }

        let discoveredGuid: string | undefined;
        for (const scout of scouts) {
          try {
            const scoutDownload = await fnoSession.downloadConfiguration(activeProfile, scout);

            // Harvest ModelMapping GUIDs from the scout XML.
            // er-services.ts handles standard camelCase attributes; here we also
            // cover the non-standard `Mapping ID.="{guid}"` pattern that F&O ER
            // uses on ERModelMappingVersion elements (attribute name has a space
            // and a dot — technically invalid XML but real in F&O responses).
            for (const mmGuid of scoutDownload.referencedModelMappingGuids ?? []) {
              formatMmGuids.add(mmGuid);
            }
            // Fallback: scan raw XML for `Mapping ID.="{guid}"` pattern directly.
            // F&O ER XML uses a non-standard attribute name with space+dot.
            // Using indexOf instead of regex to avoid encoding/boundary issues.
            {
              const xml = scoutDownload.xml;
              const needle = 'mapping id';
              let searchFrom = 0;
              const simpleGuidRe = /\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?/i;
              while (true) {
                const idx = xml.toLowerCase().indexOf(needle, searchFrom);
                if (idx < 0) break;
                // Look ahead up to 60 chars for a GUID value
                const segment = xml.slice(idx, idx + 80);
                const gm = segment.match(simpleGuidRe);
                if (gm) {
                  const guid = gm[1].toLowerCase();
                  if (guid !== '00000000-0000-0000-0000-000000000000') {
                    formatMmGuids.add(guid);
                  }
                }
                searchFrom = idx + needle.length;
              }
            }

            const refs = scoutDownload.referencedDataModelGuids ?? [];
            if (refs.length > 0) {
              const dmGuid = refs[0].toLowerCase();
              const revisions = scoutDownload.referencedDataModelRevisions ?? {};
              const rev = revisions[dmGuid];
              discoveredGuid = dmGuid;
              const synthDm: ErConfigSummary = {
                solutionName: parentDmName,
                configurationName: parentDmName,
                componentType: 'DataModel',
                configurationGuid: dmGuid,
                hasContent: true,
                // Wide probe range: the format XML references a specific revision (e.g. 1)
                // but the locally-stored revision may be much higher (e.g. 8-15 in newer F&O).
                // Probe 1-20 + 0 to maximise the chance of finding the correct local revision.
                versionNumbers: [
                  ...(typeof rev === 'number' ? [rev] : []),
                  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0,
                ],
                version: typeof rev === 'number' ? String(rev) : undefined,
              };
              const key = componentKey(synthDm);
              if (!finalToLoad.some(c => componentKey(c) === key)) {
                finalToLoad.unshift(synthDm); // DataModel first
                dmNamesInLoad.add(parentDmName);
              }
              console.info('[fno-ui] GUID discovery: scouted DataModel GUID from sibling format', {
                parentDmName,
                dmGuid,
                rev,
                scoutFormat: scout.configurationName,
                formatMmGuidsTotal: formatMmGuids.size,
              });
              break;
            }
          } catch {
            // scout download failed — try next
          }
        }

        if (!discoveredGuid) {
          console.warn('[fno-ui] GUID discovery: no sibling export format found DataModel GUID', {
            parentDmName,
            scoutCount: scouts.length,
          });
        }
      }
    }

    // ── Phase 1: DataModels (must come first for cross-reference resolution) ──
    const dataModels = finalToLoad.filter(c => c.componentType === 'DataModel');
    const nonDataModels = finalToLoad.filter(c => c.componentType !== 'DataModel');

    // Download DataModels in parallel batches of 4
    const DM_BATCH_SIZE = 2;
    for (let batch = 0; batch < dataModels.length; batch += DM_BATCH_SIZE) {
      const slice = dataModels.slice(batch, batch + DM_BATCH_SIZE);
      setIngestStatus(t.fnoStatusDownloadingDM(Math.min(batch + DM_BATCH_SIZE, dataModels.length)));
      const results = await Promise.allSettled(
        slice.map(async component => {
          const download = await fnoSession.downloadConfiguration(activeProfile, component);
          return { component, download };
        }),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
          ok += 1;
          harvestRefs(result.value.download);
        } else {
          const component = slice[results.indexOf(result)];
          handleDownloadError(component, result.reason);
        }
      }
    }

    // ── Phase 2: Downloads + Mapping listing scan run concurrently ──
    // The mapping listing scan (listComponents calls) can run in parallel
    // with Format/ModelMapping downloads since it only queries the F&O
    // listing API. The actual synth-pass downloads need parsed DM data
    // from the store, so they run after both tasks complete.

    // --- Concurrent task A: download selected Formats + ModelMappings ---
    const downloadSelectedTask = async () => {
      if (nonDataModels.length === 0) return;
      setIngestStatus(t.fnoStatusDownloadingFM(nonDataModels.length));
      const PARALLEL_BATCH_SIZE = 2;
      for (let batch = 0; batch < nonDataModels.length; batch += PARALLEL_BATCH_SIZE) {
        const slice = nonDataModels.slice(batch, batch + PARALLEL_BATCH_SIZE);
        const results = await Promise.allSettled(
          slice.map(async component => {
            const download = await fnoSession.downloadConfiguration(activeProfile, component);
            return { component, download };
          }),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
            ok += 1;
            harvestRefs(result.value.download);
            // Collect ModelMapping GUIDs from format XMLs for the synth pass.
            for (const mmGuid of result.value.download.referencedModelMappingGuids ?? []) {
              formatMmGuids.add(mmGuid);
            }
          } else {
            const component = slice[results.indexOf(result)];
            handleDownloadError(component, result.reason);
          }
        }
      }
      // Follow-up: referenced DataModels from downloaded XML
      if (pendingModelFollowUps.size > 0) {
        setIngestStatus(t.fnoStatusResolvingDM);
        const followUpEntries = Array.from(pendingModelFollowUps.values());
        console.info('[fno-ui] pendingModelFollowUps to probe', followUpEntries.length, followUpEntries.map(e => e.guid));
        const FOLLOW_UP_BATCH_SIZE = 2;
        for (let fub = 0; fub < followUpEntries.length; fub += FOLLOW_UP_BATCH_SIZE) {
          const fuSlice = followUpEntries.slice(fub, fub + FOLLOW_UP_BATCH_SIZE);
          const followUpResults = await Promise.allSettled(
            fuSlice.map(async ({ guid, rev }) => {
              // When we know the exact revision from the XML, probe only that revision.
              // For GUIDs from broad listing-fallback (no revision info), limit probing
              // to the most common DataModel revisions.
              const versionNumbers = typeof rev === 'number'
                ? [rev]
                : [1, 2, 3, 4, 5, 0];
              // Try to resolve a real DM name from listing data — enables legacy name-based
              // ops (getRevisionContent etc.) as fallback when GUID-based op returns empty.
              // For import formats, the guid here is the ERSolution GUID from the listing's
              // Base field, not the DataModel version GUID — real name improves hit rate.
              const listingDm = Array.from(allDataModelsSeen.values()).find(
                m => (m.configurationGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase() === guid ||
                     (m.revisionGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase() === guid,
              );
              const dmName = listingDm?.configurationName ?? `DataModel ${guid}`;
              const dmSolution = listingDm?.solutionName ?? dmName;
              const synth: ErConfigSummary = {
                solutionName: dmSolution,
                configurationName: dmName,
                componentType: 'DataModel',
                configurationGuid: guid,
                hasContent: true,
                version: typeof rev === 'number' ? String(rev) : undefined,
                versionNumbers,
              };
              const download = await fnoSession.downloadConfiguration(activeProfile, synth);
              return { guid, download };
            }),
          );
          for (const result of followUpResults) {
            if (result.status === 'fulfilled') {
              loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
              ok += 1;
            } else {
              const reason = result.reason;
              if (reason instanceof FnoEmptyContentError) {
                // empty: no own XML
              } else {
                console.warn('[fno-ui] referenced DataModel download failed', reason);
              }
            }
          }
        }
      }
    };

    // --- Concurrent task B: mapping LISTING scan (no downloads yet) ---
    // Only enumerates the hierarchy via listComponents. Actual mapping
    // downloads happen later once parsed DM data is available.
    const alreadyLoadedKeys = new Set(finalToLoad.map(c => componentKey(c)));
    const mappingsToLoad = new Map<string, ErConfigSummary>();
    const visitedScanNames = new Set<string>();
    const pendingMappingBranchesByDmName = new Map<string, {
      parentDmName: string;
      mappingName: string;
      mappingSolutionName: string;
      mappingVersion: string | undefined;
      /** ERSolution GUID of the parent DataModel from the listing's Base field. */
      referencedModelGuid?: string;
    }[]>();

    const mappingListingScanTask = async () => {
      // Enumerate ModelMapping siblings for loaded DataModels.
      // Only the listing scan (listComponents) runs here — actual
      // mapping downloads require parsed DM data from the store and
      // happen sequentially after both concurrent tasks complete.
    const dmNamesToScan = new Set<string>();
    // Names from explicit / ancestor DataModel summaries.
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel' && c.configurationName) {
        dmNamesToScan.add(c.configurationName);
      }
    }
    // Names harvested from freshly-loaded model XML (covers the
    // pendingModelFollowUps batch — those start as synthetic
    // `DataModel <guid>` entries with no real name until parsed).
    const loadedConfigs = useAppStore.getState().configurations;
    for (const cfg of loadedConfigs) {
      if (cfg.kind !== 'DataModel') continue;
      const name = cfg.solutionVersion?.solution?.name;
      if (name) dmNamesToScan.add(name);
    }
    // Also include every `solutionPath` step the user navigated, plus
    // the active F&O explorer roots — captures derived DMs the user
    // browsed past without explicitly selecting.
    for (const step of solutionPath) {
      if (step) dmNamesToScan.add(step);
    }
    console.info('[fno-ui] mapping-scan dmNamesToScan', Array.from(dmNamesToScan));
    const queue: { name: string; owningDmName: string }[] = Array.from(dmNamesToScan).map(n => ({ name: n, owningDmName: n }));
    while (queue.length > 0) {
      const { name: dmName, owningDmName } = queue.shift()!;
      if (visitedScanNames.has(dmName)) continue;
      visitedScanNames.add(dmName);
      let children: ErConfigSummary[];
      try {
        children = await fnoSession.listComponents(activeProfile, dmName);
      } catch (err) {
        console.warn('[fno-ui] listComponents failed during mapping scan for', dmName, err);
        continue;
      }
      // Resolve the owning DM for the *current* parent name so we can
      // forward it to mapping leaves discovered below this branch.
      const owningDm = Array.from(allDataModelsSeen.values()).find(
        m => m.configurationName === owningDmName && (m.configurationGuid || m.revisionGuid),
      );
      for (const child of children) {
        if (child.componentType === 'DataModel') {
          // Walk into derived DataModels too — they can host their
          // own ModelMapping descendants.
          if (child.configurationName && !visitedScanNames.has(child.configurationName)) {
            queue.push({ name: child.configurationName, owningDmName: child.configurationName });
          }
          continue;
        }
        if (child.componentType !== 'ModelMapping') continue;
        if (!child.revisionGuid && !child.configurationGuid) {
          // F&O surfaces this row but does not expose the mapping's
          // own GUID (the listing service only attaches GUIDs to
          // Format leaves). We still want to download it though —
          // X++ `getModelMappingByID(_mappingGuid=zero, _dataModelGuid,
          // _dataContainerDescriptorName)` resolves the default
          // mapping for any DM whose GUID we eventually know.
          //
          // Stash the mapping under its owning DM name. The synth
          // pass below will look up the DM GUID (parsed XML or
          // base-walk) and queue the actual download with the right
          // `descriptorNameCandidates` and `parentDataModelGuid`.
          const list = pendingMappingBranchesByDmName.get(owningDmName) ?? [];
          list.push({
            parentDmName: owningDmName,
            mappingName: child.configurationName,
            mappingSolutionName: child.solutionName,
            mappingVersion: child.version,
            referencedModelGuid: child.referencedModelGuid,
          });
          pendingMappingBranchesByDmName.set(owningDmName, list);
          // Drill into mapping branches that have children (derived mappings).
          if (child.hasChildren && child.configurationName && !visitedScanNames.has(child.configurationName)) {
            queue.push({ name: child.configurationName, owningDmName });
          }
          continue;
        }
        const key = componentKey(child);
        if (alreadyLoadedKeys.has(key)) continue;
        if (mappingsToLoad.has(key)) continue;
        // GetModelMappingByID needs a `_dataModelGuid`. Resolve via
        // the owning DM (look it up in `allDataModelsSeen` or pull
        // the freshly-loaded summary).
        let parentDm = owningDm
          ?? Array.from(allDataModelsSeen.values()).find(
            m => m.configurationName === owningDmName && (m.configurationGuid || m.revisionGuid),
          );
        if (!parentDm) {
          // Last-resort: if `dmName` is itself a mapping branch we
          // drilled into, look up which DM the mapping-branch was
          // listed under by scanning ancestors via parentDataModelGuid.
          parentDm = Array.from(allDataModelsSeen.values()).find(
            m => m.configurationGuid === child.parentDataModelGuid
              || m.revisionGuid === child.parentDataModelRevisionGuid,
          );
        }
        const annotated: ErConfigSummary = {
          ...child,
          parentDataModelGuid: child.parentDataModelGuid ?? parentDm?.configurationGuid,
          parentDataModelRevisionGuid:
            child.parentDataModelRevisionGuid ?? parentDm?.revisionGuid,
        };
        mappingsToLoad.set(key, annotated);
      }
    }

    // --- Supplementary harvest: ModelMappings from cached root trees ---
    // When the flat tree from listComponents(rootDmName) contains ModelMapping
    // rows, they typically have NO configurationGuid because F&O only attaches
    // GUIDs to *direct* DerivedSolutions. Calling listComponents on the BASE
    // mapping name (e.g. "Tax declaration model mapping") returns its derived
    // variants (CZ, SK, UK …) as direct children — those rows DO carry their
    // ERSolution GUID as ConfigurationGuid, making them downloadable.
    for (const [, rootComponents] of rootComponentCacheRef.current) {
      // Only process trees that include a DataModel we care about.
      const hasRelevantDm = rootComponents.some(
        c => c.componentType === 'DataModel' && dmNamesToScan.has(c.configurationName ?? ''),
      );
      if (!hasRelevantDm) continue;

      for (const comp of rootComponents) {
        if (comp.componentType !== 'ModelMapping') continue;

        if (comp.configurationGuid || comp.revisionGuid) {
          // Rare: mapping row already carries a GUID — add directly.
          const key = componentKey(comp);
          if (alreadyLoadedKeys.has(key) || mappingsToLoad.has(key)) continue;
          const parentDm = Array.from(allDataModelsSeen.values()).find(
            m =>
              m.configurationGuid === comp.parentDataModelGuid ||
              m.revisionGuid === comp.parentDataModelRevisionGuid ||
              m.configurationName === (comp.ownerDataModelName ?? ''),
          );
          mappingsToLoad.set(key, {
            ...comp,
            parentDataModelGuid: comp.parentDataModelGuid ?? parentDm?.configurationGuid,
            parentDataModelRevisionGuid: comp.parentDataModelRevisionGuid ?? parentDm?.revisionGuid,
          });
          continue;
        }

        // No GUID. Drill into this base mapping if it has children —
        // derived rows returned at that level expose their own GUIDs.
        if (!comp.hasChildren || !comp.configurationName) continue;
        if (visitedScanNames.has(comp.configurationName)) continue;
        visitedScanNames.add(comp.configurationName);

        let derivedRows: ErConfigSummary[];
        try {
          derivedRows = await fnoSession.listComponents(activeProfile, comp.configurationName);
        } catch (err) {
          console.warn('[fno-ui] mapping-scan drill into base mapping failed', comp.configurationName, err);
          continue;
        }

        for (const derived of derivedRows) {
          if (derived.componentType !== 'ModelMapping') continue;
          // Strip " mapping" from the mapping name → candidate DM name.
          // e.g. "Asl Tax declaration model mapping (CZ)"
          //    → "Asl Tax declaration model (CZ)"
          const candidateDmName = (derived.configurationName ?? '')
            .replace(/\s+mapping\b/i, '')
            .trim();
          const parentDm =
            Array.from(allDataModelsSeen.values()).find(
              m =>
                dmNamesToScan.has(m.configurationName ?? '') &&
                (m.configurationName === candidateDmName ||
                  m.configurationGuid === derived.parentDataModelGuid),
            ) ??
            Array.from(allDataModelsSeen.values()).find(
              m => dmNamesToScan.has(m.configurationName ?? '') && (m.configurationGuid || m.revisionGuid),
            );

          if (derived.configurationGuid || derived.revisionGuid) {
            // Has a GUID — downloadable directly via _mappingGuid.
            const dkey = componentKey(derived);
            if (alreadyLoadedKeys.has(dkey) || mappingsToLoad.has(dkey)) continue;
            mappingsToLoad.set(dkey, {
              ...derived,
              parentDataModelGuid: derived.parentDataModelGuid ?? parentDm?.configurationGuid,
              parentDataModelRevisionGuid: derived.parentDataModelRevisionGuid ?? parentDm?.revisionGuid,
            });
          } else {
            // No GUID — add as pending branch only if the candidate DM
            // is one we are actually interested in (present in dmNamesToScan).
            // This prevents SK / base mappings from being queued when the
            // user only selected a CZ format.
            const branchDmName = parentDm?.configurationName ?? candidateDmName;
            if (!branchDmName || !dmNamesToScan.has(branchDmName)) continue;
            const existingBranches = pendingMappingBranchesByDmName.get(branchDmName) ?? [];
            const alreadyPending = existingBranches.some(b => b.mappingName === (derived.configurationName ?? ''));
            if (alreadyPending) continue;
            existingBranches.push({
              parentDmName: branchDmName,
              mappingName: derived.configurationName ?? '',
              mappingSolutionName: derived.solutionName ?? '',
              mappingVersion: derived.version,
              referencedModelGuid: derived.referencedModelGuid,
            });
            pendingMappingBranchesByDmName.set(branchDmName, existingBranches);
          }
        }
      }
    }

    console.info('[fno-ui] mapping-scan finished', {
      scannedDmNames: Array.from(visitedScanNames),
      guidMappingsFound: mappingsToLoad.size,
      pendingBranchKeys: Array.from(pendingMappingBranchesByDmName.keys()),
    });
    }; // end mappingListingScanTask

    // ── Run listing scan concurrently with Format/ModelMapping downloads ──
    setIngestStatus(t.fnoStatusScanMappings);
    await Promise.all([downloadSelectedTask(), mappingListingScanTask()]);

    // ── Import format: post-download ModelMapping listing scan ──
    // `GetEffectiveFormatMappingByID` returns only the format XML for import formats —
    // there is no embedded ModelMapping. The listing scan above ran concurrently with
    // downloads, so it couldn't see DataModels resolved by the follow-up pass.
    // Re-scan any format's DataModel that wasn't already covered by the listing scan
    // so we can discover named import ModelMapping children and add them to mappingsToLoad.
    {
      const stripBraces = (g: string | undefined) =>
        (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
      const nowInStore = useAppStore.getState().configurations;
      const importDmNamesToScan = new Set<string>();
      for (const fmt of finalToLoad) {
        if (fmt.componentType !== 'Format' || !fmt.referencedModelGuid) continue;
        const rawGuid = stripBraces(fmt.referencedModelGuid);
        if (!rawGuid || rawGuid === ZERO_GUID_LOWER) continue;
        // 1. Prefer the just-downloaded store entry (follow-up pass result).
        const storeDm = nowInStore.find(c => {
          if (c.kind !== 'DataModel') return false;
          const dm = (c.content as ParsedDmContent | undefined)?.version?.model;
          return stripBraces(dm?.id) === rawGuid
            || stripBraces(c.solutionVersion?.solution?.id) === rawGuid;
        });
        const dmName = storeDm?.solutionVersion?.solution?.name
          ?? Array.from(allDataModelsSeen.values()).find(
              m => stripBraces(m.configurationGuid) === rawGuid
                || stripBraces(m.revisionGuid) === rawGuid,
            )?.configurationName;
        if (dmName && !visitedScanNames.has(dmName)) {
          importDmNamesToScan.add(dmName);
        }
      }
      for (const dmName of importDmNamesToScan) {
        if (visitedScanNames.has(dmName)) continue;
        visitedScanNames.add(dmName);
        let children: ErConfigSummary[];
        try {
          children = await fnoSession.listComponents(activeProfile, dmName);
        } catch (err) {
          console.warn('[fno-ui] import format DM scan failed', dmName, err);
          continue;
        }
        for (const child of children) {
          if (child.componentType !== 'ModelMapping') continue;
          if (!child.configurationGuid && !child.revisionGuid) continue;
          const dkey = componentKey(child);
          if (alreadyLoadedKeys.has(dkey) || mappingsToLoad.has(dkey)) continue;
          mappingsToLoad.set(dkey, child);
        }
      }
    }

    // ── Synth pass: needs parsed DM data from store, runs sequentially ──

    // ── Synthesized ModelMapping fetches via the X++ AOT fallback ──
    setIngestStatus(t.fnoStatusDownloadingMM);
    //
    // Per X++ source (ERConfigurationStorageService.getModelMappingByID,
    // confirmed against the D365FO VM), the second resolution branch
    // selects the **default** ModelMapping for a given DataModel:
    //
    //   var dmTable = ERDataModelTable::findByGUID(_dataModelGuid);
    //   var selector = ERModelMappingTableSelector::constructByModel(
    //       dmTable,
    //       ERDataContainerDescriptorTable::findByName(
    //           dmTable.recID, _dataContainerDescriptorName).RecId);
    //   mappingTable = selector.getModelMapping();
    //
    // `getFormatSolutionsSubHierarchy` cannot list ModelMappings
    // (its WHERE clause filters strictly on ERSolutionTable.Base —
    // ModelMappings live in a separate table), so the listing scan
    // above will miss every standalone mapping. To compensate, for
    // every DataModel we know the GUID of, we synthesize a
    // ModelMapping summary and let `buildDownloadAttempts` invoke
    // the (parent-DM, descriptor name) fallback path. Descriptor
    // name guesses are: empty (default container), DataModel name.
    const synthesizedMappingKeys = new Set<string>();
    // Aggregate every DataModel GUID we know — three sources, in order
    // of trust:
    //   1. Selected / discovered summaries that already carry a GUID
    //      (rare with `getFormatSolutionsSubHierarchy` but possible
    //      for older F&O versions that surface FormatMappingGUID).
    //   2. The freshly-parsed `ERDataModel.id` GUID of every DataModel
    //      configuration that landed in the workspace store during
    //      this Load action — this is the *primary* source on modern
    //      F&O builds, because the listing API never returns DM GUIDs
    //      but the parsed XML payload always does.
    //   3. The cross-references we harvested from Format / mapping
    //      XML (`pendingModelFollowUps`).
    interface DmSynthCandidate {
      guid: string;
      name: string;
      solutionName: string;
      /** Container/descriptor names harvested from parsed model XML. */
      descriptorNames: string[];
      /**
       * ERSolution GUID of this DataModel (from the listing API `Base` field on
       * formats that reference it). Distinct from `guid` which is the DataModel
       * VERSION GUID (from inside the XML). Used as a second `_dataModelGuid`
       * candidate for `GetModelMappingByID` so F&O can resolve the country-
       * specific mapping instead of falling back to the global default.
       */
      solutionGuid?: string;
    }
    const dmGuidIndex = new Map<string, DmSynthCandidate>();
    /** Lowercase, brace-stripped GUID for stable map keys. */
    const normalizeGuid = (g: string | undefined): string =>
      (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
    const recordDm = (
      guid: string | undefined,
      name: string,
      solutionName?: string,
      descriptorNames?: string[],
      solutionGuid?: string,
    ): void => {
      if (!guid) return;
      const lower = normalizeGuid(guid);
      if (!lower || lower === ZERO_GUID_LOWER) return;
      const existing = dmGuidIndex.get(lower);
      if (existing) {
        // Merge descriptor names if a later source has more.
        if (descriptorNames && descriptorNames.length > 0) {
          const merged = new Set(existing.descriptorNames);
          for (const d of descriptorNames) merged.add(d);
          existing.descriptorNames = Array.from(merged);
        }
        // Prefer a real human-readable name over a synthetic
        // `DataModel <guid>` placeholder.
        if (
          existing.name.startsWith('DataModel ') &&
          !name.startsWith('DataModel ')
        ) {
          existing.name = name;
        }
        // Record the ERSolution GUID if not yet known.
        if (solutionGuid && !existing.solutionGuid) {
          existing.solutionGuid = solutionGuid;
        }
        return;
      }
      dmGuidIndex.set(lower, {
        guid: lower, // store normalized form so downstream paths match
        name,
        solutionName: solutionName ?? '<referenced>',
        descriptorNames: descriptorNames ?? [],
        solutionGuid,
      });
    };
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel') {
        recordDm(c.configurationGuid, c.configurationName, c.solutionName);
        recordDm(c.revisionGuid, c.configurationName, c.solutionName);
      }
    }
    for (const m of allDataModelsSeen.values()) {
      recordDm(m.configurationGuid, m.configurationName, m.solutionName);
      recordDm(m.revisionGuid, m.configurationName, m.solutionName);
    }
    // Pick up GUIDs and descriptor names from parsed DataModel XML in the store.
    // Each `ERDataModel.containers[].name` is a valid `_dataContainerDescriptorName`
    // for `getModelMappingByID`.
    type ParsedDmContent = {
      version?: {
        model?: { id?: string; name?: string; containers?: { name?: string }[] };
      };
    };
    const refreshedConfigs = useAppStore.getState().configurations;
    const baseGuidsToFetch = new Map<string, { lowerSelf: string; baseGuid: string }>();
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'DataModel') continue;
      const dm = (cfg.content as ParsedDmContent | undefined)?.version?.model;
      const containerNames = (dm?.containers ?? [])
        .map(c => (c?.name ?? '').trim())
        .filter(s => s.length > 0);
      const baseRaw = cfg.solutionVersion?.solution?.baseSolutionId;
      if (dm?.id) {
        const dmVersionLower = normalizeGuid(dm.id);
        // Look up the ERSolution GUID paired with this DataModel version GUID.
        // Primary: from format XML referencedModelGuid (populated by harvestRefs).
        // Fallback: from allDataModelsSeen — the listing API may expose the
        // ERSolution GUID of the DM as its configurationGuid, distinct from the
        // version GUID in dm.id. Passing it as parentDataModelRevisionGuid lets
        // buildDownloadAttempts try _dataModelGuid=ERSolutionGUID which F&O may
        // resolve to the country-specific mapping instead of the default.
        let dmSolGuid = dmVersionToSolutionGuid.get(dmVersionLower);
        if (!dmSolGuid) {
          const listingEntry = Array.from(allDataModelsSeen.values()).find(
            m => m.configurationName === (dm.name ?? '') && m.configurationGuid,
          );
          if (listingEntry?.configurationGuid) {
            dmSolGuid = listingEntry.configurationGuid;
          }
        }
        recordDm(
          dm.id,
          dm.name ?? cfg.solutionVersion?.solution?.name ?? '<unknown>',
          cfg.solutionVersion?.solution?.name,
          containerNames,
          dmSolGuid,
        );
      }
      // Capture baseSolutionId so we can walk up the inheritance chain
      // (the listing service can't enumerate ancestors). Strip the
      // surrounding `{}` if F&O included them.
      if (baseRaw) {
        const baseGuid = normalizeGuid(baseRaw);
        if (baseGuid && baseGuid !== ZERO_GUID_LOWER && dm?.id) {
          baseGuidsToFetch.set(baseGuid, {
            lowerSelf: normalizeGuid(dm.id),
            baseGuid,
          });
        }
      }
    }
    // Cross-references harvested earlier in this pass.
    for (const { guid } of pendingModelFollowUps.values()) {
      recordDm(guid, `DataModel ${guid}`);
    }
    // ── Scan parsed Format configs for embedded model mapping model IDs ──
    //
    // `GetEffectiveFormatMappingByID` may return an embedded `ERModelMappingVersion`
    // whose `ERModelMapping.Model="{dm-guid}"` is the DataModel GUID. The raw
    // `extractReferencedDataModelGuids` regex scans are sometimes insufficient
    // (e.g. when the format is an import format without a bound mapping, or when
    // GUIDs live in `ID.="{guid},N"` attributes that the regex misses).
    // After parsing, `cfg.content.embeddedModelMappingVersions[*].mapping.modelId`
    // (and `.modelVersion`) hold the same GUID in a structured form.
    type FormatContent = {
      embeddedModelMappingVersions?: Array<{
        mapping?: { modelId?: string; modelVersion?: string };
      }>;
    };
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'Format') continue;
      const fmtContent = cfg.content as FormatContent | undefined;
      for (const mmv of fmtContent?.embeddedModelMappingVersions ?? []) {
        const modelId = (mmv?.mapping?.modelId ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (modelId && modelId !== ZERO_GUID_LOWER) {
          recordDm(modelId, `DataModel ${modelId}`);
        }
        const modelVersionRaw = mmv?.mapping?.modelVersion ?? '';
        const modelVersion = modelVersionRaw.split(',')[0].replace(/^\{|\}$/g, '').toLowerCase();
        if (modelVersion && modelVersion !== ZERO_GUID_LOWER) {
          recordDm(modelVersion, `DataModel ${modelVersion}`);
        }
      }
    }
    // Walk up the base-solution chain to discover ancestor DataModel GUIDs.
    // Parsed DM XML carries `Base="{guid},rev"` which leads to the parent;
    // we repeat until reaching a DM with no parent.
    const ancestorVisited = new Set<string>();
    const ancestorQueue = Array.from(baseGuidsToFetch.values()).map(b => b.baseGuid);
    // Also seed ancestor walk from downloaded Format configs.
    // ERSolution.Base on a Format points to the parent DataModel's ERSolution GUID.
    // On environments that return no GUIDs in the listing API, this is the only way
    // to discover the parent DataModel GUID without it appearing in extractReferencedDataModelGuids.
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'Format') continue;
      const baseRaw = cfg.solutionVersion?.solution?.baseSolutionId;
      if (!baseRaw) continue;
      const baseGuid = normalizeGuid(baseRaw);
      if (baseGuid && baseGuid !== ZERO_GUID_LOWER && !dmGuidIndex.has(baseGuid)) {
        ancestorQueue.push(baseGuid);
      }
    }
    while (ancestorQueue.length > 0) {
      const baseGuid = ancestorQueue.shift()!;
      if (ancestorVisited.has(baseGuid)) continue;
      ancestorVisited.add(baseGuid);
      if (dmGuidIndex.has(baseGuid)) continue;
      const synthDm: ErConfigSummary = {
        solutionName: '<ancestor>',
        configurationName: `DataModel ${baseGuid}`,
        componentType: 'DataModel',
        configurationGuid: baseGuid,
        hasContent: true,
        versionNumbers: [1, 2, 3, 4, 5, 0],
      };
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, synthDm);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
        const newest = useAppStore.getState().configurations
          .find(c => c.kind === 'DataModel'
            && normalizeGuid((c.content as ParsedDmContent | undefined)?.version?.model?.id)
              === baseGuid);
        const dm = (newest?.content as ParsedDmContent | undefined)?.version?.model;
        const containerNames = (dm?.containers ?? [])
          .map(c => (c?.name ?? '').trim())
          .filter(s => s.length > 0);
        recordDm(
          baseGuid,
          dm?.name ?? newest?.solutionVersion?.solution?.name ?? `DataModel ${baseGuid}`,
          newest?.solutionVersion?.solution?.name,
          containerNames,
        );
        const grandRaw = newest?.solutionVersion?.solution?.baseSolutionId;
        if (grandRaw) {
          const grandGuid = normalizeGuid(grandRaw);
          if (grandGuid && grandGuid !== ZERO_GUID_LOWER && !ancestorVisited.has(grandGuid)) {
            ancestorQueue.push(grandGuid);
          }
        }
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          recordDm(baseGuid, `DataModel ${baseGuid}`);
          continue;
        }
        console.warn('[fno-ui] ancestor DataModel fetch failed', baseGuid, err);
      }
    }
    console.info('[fno-ui] synthesized mapping pass', {
      dmCount: dmGuidIndex.size,
    });

    const dmByName = new Map<string, DmSynthCandidate>();
    for (const dm of dmGuidIndex.values()) {
      if (!dm.name.startsWith('DataModel ')) {
        dmByName.set(dm.name, dm);
      }
    }

    // Name-based DataModel probe: last resort when dmGuidIndex is empty and
    // the listing API never exposed GUIDs for DataModel rows.
    if (dmByName.size === 0 && pendingMappingBranchesByDmName.size > 0) {
      const namesToProbe = new Set<string>();
      for (const branches of pendingMappingBranchesByDmName.values()) {
        for (const b of branches) {
          if (b.parentDmName) namesToProbe.add(b.parentDmName);
        }
      }
      for (const dmName of namesToProbe) {
        const synthDm: ErConfigSummary = {
          solutionName: dmName,
          configurationName: dmName,
          componentType: 'DataModel',
          hasContent: false, // no GUID — will use legacy name-based ops
          versionNumbers: [1, 2, 3, 0],
        };
        try {
          const download = await fnoSession.downloadConfiguration(activeProfile, synthDm);
          loadXmlFile(download.xml, download.syntheticPath);
          ok += 1;
          const newestConfigs = useAppStore.getState().configurations;
          const parsedDm = newestConfigs.find(
            c => c.kind === 'DataModel' &&
              (c.solutionVersion?.solution?.name === dmName ||
               (c.content as ParsedDmContent | undefined)?.version?.model?.name === dmName),
          );
          const dm = (parsedDm?.content as ParsedDmContent | undefined)?.version?.model;
          if (dm?.id) {
            const containerNames = (dm.containers ?? [])
              .map(c => (c?.name ?? '').trim())
              .filter(s => s.length > 0);
            recordDm(dm.id, dm.name ?? dmName, parsedDm?.solutionVersion?.solution?.name, containerNames);
            // Also populate dmByName so the branch-resolution pass below finds it.
            const lower = dm.id.replace(/^\{|\}$/g, '').toLowerCase();
            const candidate = dmGuidIndex.get(lower);
            if (candidate) dmByName.set(dmName, candidate);
          }
        } catch (err) {
          if (!(err instanceof FnoEmptyContentError)) {
            console.warn('[fno-ui] synth-pass: name-based DataModel download failed', dmName, err);
          }
        }
      }
    }
    const synthQueue: { synth: ErConfigSummary; dmGuid: string; label: string }[] = [];

    // Priority pass: direct model-mapping GUIDs extracted from format XML.
    // These target the exact country-specific mapping (e.g. CZ/SK) and bypass
    // the descriptor-based fallback that always returns the default mapping.
    const embeddedMappingGuidsQueued = new Set<string>(formatMmGuids);
    if (formatMmGuids.size > 0) {
      for (const guid of formatMmGuids) {
        synthQueue.push({
          synth: {
            solutionName: '<from-format-xml>',
            configurationName: `Mapping ${guid}`,
            componentType: 'ModelMapping',
            configurationGuid: guid,
            hasContent: true,
          },
          dmGuid: guid,
          label: `direct mapping GUID ${guid} (from format XML)`,
        });
      }
    }

    // ── Resolve pending mapping branches first ──
    // These carry correct configurationName + version from the listing
    // service. When resolved, they also suppress the default probe for
    // that DM GUID (which would download the same XML without metadata).
    const dmGuidsWithResolvedBranch = new Set<string>();
    let resolvedBranchCount = 0;
    let unresolvedBranchCount = 0;
    for (const branches of pendingMappingBranchesByDmName.values()) {
      for (const branch of branches) {
        let ownerDm = dmByName.get(branch.parentDmName);
        if (!ownerDm) {
          // Fallback: the branch was listed under a base DM that we
          // don't have in `dmByName` (typical: base-walk returned
          // empty XML). Use any available DM — F&O resolves
          // inheritance automatically, so GetModelMappingByID with a
          // derived DM GUID returns the effective mapping that covers
          // the base too.
          for (const candidate of dmGuidIndex.values()) {
            if (!candidate.name.startsWith('DataModel ')) {
              ownerDm = candidate;
              break;
            }
          }
        }
        if (!ownerDm && branch.referencedModelGuid) {
          const refGuid = branch.referencedModelGuid;
          const lowerRef = refGuid.toLowerCase();
          let synthCandidate = dmGuidIndex.get(lowerRef);
          if (!synthCandidate) {
            synthCandidate = {
              name: branch.parentDmName,
              guid: refGuid,
              solutionName: branch.mappingSolutionName,
              solutionGuid: undefined,
              descriptorNames: [],
            };
            dmGuidIndex.set(lowerRef, synthCandidate);
          }
          if (!dmByName.has(branch.parentDmName)) {
            dmByName.set(branch.parentDmName, synthCandidate);
          }
          ownerDm = synthCandidate;
        }
        if (!ownerDm) {
          unresolvedBranchCount += 1;
          // dmByName is empty (all dmGuidIndex entries are synthetic "DataModel {guid}").
          // Brute-force: try every available DataModel GUID with the mapping's real
          // configurationName as _dataContainerDescriptorName.
          // F&O resolves: ERDataContainerDescriptorTable::findByName(dm.RecId, mappingName)
          // which returns the correct mapping when descriptorName = ERSolution.Name of the mapping.
          for (const candidate of dmGuidIndex.values()) {
            synthQueue.push({
              synth: {
                solutionName: branch.mappingSolutionName,
                configurationName: branch.mappingName,
                componentType: 'ModelMapping',
                version: branch.mappingVersion,
                parentDataModelGuid: candidate.guid,
                parentDataModelRevisionGuid: candidate.solutionGuid,
                // Put the real mapping name first — most likely to match the
                // ERDataContainerDescriptorTable row on this environment.
                descriptorNameCandidates: [
                  branch.mappingName,
                  branch.mappingSolutionName,
                  ...candidate.descriptorNames,
                ],
                hasContent: true,
              },
              dmGuid: candidate.guid,
              label: `${branch.mappingName} (brute-force vs ${candidate.guid})`,
            });
            dmGuidsWithResolvedBranch.add(candidate.guid);
          }
          continue;
        }
        resolvedBranchCount += 1;
        dmGuidsWithResolvedBranch.add(ownerDm.guid);
        synthQueue.push({
          synth: {
            solutionName: branch.mappingSolutionName,
            configurationName: branch.mappingName,
            componentType: 'ModelMapping',
            version: branch.mappingVersion,
            parentDataModelGuid: ownerDm.guid,
              parentDataModelRevisionGuid: ownerDm.solutionGuid,
              descriptorNameCandidates: ownerDm.descriptorNames,
              hasContent: true,
            },
            dmGuid: ownerDm.guid,
            label: `${branch.mappingName} (under ${branch.parentDmName})`,
          });
      }
    }
    if (resolvedBranchCount > 0 || unresolvedBranchCount > 0) {
      console.info('[fno-ui] pending ModelMapping branches', {
        resolved: resolvedBranchCount, unresolved: unresolvedBranchCount,
      });
    }

    // Default mapping probes for DMs without a direct-GUID entry.
    for (const dm of dmGuidIndex.values()) {
      if (dmGuidsWithResolvedBranch.has(dm.guid)) continue;
      // When embedded mapping GUIDs are present, skip the default probe \u2014
      // it would return the base mapping, and pending-branch logic already covers edge cases.
      if (embeddedMappingGuidsQueued.size > 0) {
        continue;
      }
      synthQueue.push({
        synth: {
          solutionName: dm.solutionName,
          configurationName: `${dm.name} (default mapping)`,
          componentType: 'ModelMapping',
          parentDataModelGuid: dm.guid,
          parentDataModelRevisionGuid: dm.solutionGuid,
          descriptorNameCandidates: dm.descriptorNames,
          hasContent: true,
        },
        dmGuid: dm.guid,
        label: `default mapping for ${dm.name}`,
      });
    }

    // Helper: merge newly discovered DataModel GUIDs from a mapping
    // download into `lateModelFollowUps` so the late pass can download them.
    const collectLateRefs = (download: Awaited<ReturnType<typeof fnoSession.downloadConfiguration>>): void => {
      const refs = download.referencedDataModelGuids ?? [];
      const refRevs = download.referencedDataModelRevisions ?? {};
      for (const guid of refs) {
        const lower = guid.toLowerCase();
        if (alreadyLoadedGuids.has(lower)) continue;
        if (pendingModelFollowUps.has(lower)) continue; // already scheduled
        const existing = lateModelFollowUps.get(lower);
        const rev = refRevs[lower];
        if (!existing || (typeof rev === 'number' && (existing.rev ?? -1) < rev)) {
          lateModelFollowUps.set(lower, { guid, rev });
        }
      }
    };

    // Download synthesized mappings and sibling mappings in parallel
    const allMappingDownloads: { synth: ErConfigSummary; label: string; dmGuid?: string }[] = [];

    for (const item of synthQueue) {
      // Key by (dmGuid + configurationName) so multiple distinct mappings
      // for the same DataModel (e.g. base + CZ) are all downloaded.
      // The default probe is still suppressed via dmGuidsWithResolvedBranch.
      const synthKey = `synth-mapping:${item.dmGuid}:${item.synth.configurationName}`;
          if (synthesizedMappingKeys.has(synthKey)) continue;
      synthesizedMappingKeys.add(synthKey);
      allMappingDownloads.push({ synth: item.synth, label: item.label, dmGuid: item.dmGuid });
    }

    for (const mapping of mappingsToLoad.values()) {
      allMappingDownloads.push({ synth: mapping, label: mapping.configurationName });
    }

    if (allMappingDownloads.length > 0) {
      console.info('[fno-ui] DIAG allMappingDownloads', allMappingDownloads.map(d => ({
        label: d.label,
        dmGuid: d.dmGuid,
        descriptorCandidates: d.synth.descriptorNameCandidates,
        parentDataModelGuid: d.synth.parentDataModelGuid,
        configGuid: d.synth.configurationGuid,
      })));
      setIngestStatus(t.fnoStatusDownloadingMMCount(allMappingDownloads.length));
      const MAPPING_BATCH_SIZE = 2;
      for (let batch = 0; batch < allMappingDownloads.length; batch += MAPPING_BATCH_SIZE) {
        const slice = allMappingDownloads.slice(batch, batch + MAPPING_BATCH_SIZE);
        const results = await Promise.allSettled(
          slice.map(async item => {
            const download = await fnoSession.downloadConfiguration(activeProfile, item.synth);
            return { item, download };
          }),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
            ok += 1;
            collectLateRefs(result.value.download);
          } else {
            const reason = result.reason;
            if (reason instanceof FnoEmptyContentError) {
              console.info('[fno-ui] DIAG mapping empty content', result.reason instanceof Error ? result.reason.message.slice(0, 200) : String(result.reason));
            } else {
              console.warn('[fno-ui] mapping fetch failed', reason);
            }
          }
        }
      }
    }

    // ── Late DataModel pass ──
    // DataModel GUIDs discovered from ModelMapping XML in the synth pass.
    // Covers import formats whose own XML carries no ERFormatMappingVersion.Model
    // reference: the ModelMapping downloaded above contains the correct
    // Model= attribute, so we can now fetch the root DataModel.
    if (lateModelFollowUps.size > 0) {
      setIngestStatus(t.fnoStatusLateDM);
      console.info('[fno-ui] late DataModel follow-ups', Array.from(lateModelFollowUps.values()));
      const lateEntries = Array.from(lateModelFollowUps.values());
      const LATE_BATCH_SIZE = 2;
      for (let lb = 0; lb < lateEntries.length; lb += LATE_BATCH_SIZE) {
        const lateSlice = lateEntries.slice(lb, lb + LATE_BATCH_SIZE);
        const lateResults = await Promise.allSettled(
          lateSlice.map(async ({ guid, rev }) => {
            const versionNumbers = typeof rev === 'number'
              ? [rev]
              : [1, 2, 3, 0];
            const synthDm: ErConfigSummary = {
              solutionName: '<late-referenced>',
              configurationName: `DataModel ${guid}`,
              componentType: 'DataModel',
              configurationGuid: guid,
              hasContent: true,
              version: typeof rev === 'number' ? String(rev) : undefined,
              versionNumbers,
            };
            const download = await fnoSession.downloadConfiguration(activeProfile, synthDm);
            return { guid, download };
          }),
        );
        for (const result of lateResults) {
          if (result.status === 'fulfilled') {
            loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
            ok += 1;
            alreadyLoadedGuids.add(result.value.guid.toLowerCase());
          } else {
            const reason = result.reason;
            if (reason instanceof FnoEmptyContentError) {
              // no own XML
            } else {
              console.warn('[fno-ui] late DataModel download failed', reason);
            }
          }
        }
      }
    }

    setIngesting(false);
    setIngestStatus('');
    if (ok > 0) {
      // Clear the queue when the entire batch resolved (success or
      // benign empty). Partial *real* failures stay selected for retry.
      if (ok + skippedEmpty === finalToLoad.length) setSelected(new Map());
      pushToast({ kind: 'success', message: t.fnoLoadedCount(ok) });
      onFilesLoaded?.();
    }
  }, [activeProfile, selected, allDataModelsSeen, solutions, solutionPath, loadXmlFile, pushToast]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title3>{t.fnoHeading}</Title3>
        <Caption1>{t.fnoSubheading}</Caption1>
      </div>

      <div className={styles.fieldGrid}>
        <Field label={t.fnoProfileName}>
          <Input value={profileName} onChange={(_, d) => setProfileName(d.value)} placeholder="CHE · Sandbox" />
        </Field>
        <Field label={t.fnoEnvUrl}>
          <Input value={envUrl} onChange={(_, d) => setEnvUrl(d.value)} placeholder="https://org.sandbox.operations.dynamics.com" />
        </Field>
        <Field label={t.fnoTenantId}>
          <Input value={tenantId} onChange={(_, d) => setTenantId(d.value)} placeholder="contoso.onmicrosoft.com nebo GUID" />
        </Field>
        <Field label={t.fnoClientId}>
          <Input value={clientId} onChange={(_, d) => setClientId(d.value)} />
        </Field>
      </div>
      <div>
        <Button appearance="primary" disabled={!canSave} onClick={handleSaveProfile}>
          {isEditing ? t.fnoUpdateProfile : t.fnoSaveProfile}
        </Button>
        {isEditing && (
          <Button style={{ marginLeft: 8 }} onClick={handleNewProfile}>
            {t.fnoNewProfile}
          </Button>
        )}
      </div>

      <Divider />

      <Body1Strong>{t.fnoProfiles}</Body1Strong>
      {profiles.length === 0 ? (
        <Body1>{t.fnoNoProfiles}</Body1>
      ) : (
        <div className={styles.profileList}>
          {profiles.map(p => (
            <div
              key={p.id}
              className={`${styles.profileRow} ${activeProfileId === p.id ? styles.profileRowActive : ''}`}
              onClick={() => setActiveProfileId(p.id)}
              role="button"
              tabIndex={0}
            >
              <div>
                <Body1Strong>{p.displayName}</Body1Strong>
                <div><Caption1>{p.envUrl}</Caption1></div>
              </div>
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                aria-label={t.fnoRemoveProfile}
                onClick={(e) => { e.stopPropagation(); remove(p.id); if (activeProfileId === p.id) setActiveProfileId(null); }}
              />
            </div>
          ))}
        </div>
      )}

      {activeProfile && (
        <>
          <Divider />
          <div className={styles.row}>
            {connState.kind === 'connected' ? (
              <>
                <Body1>{t.fnoConnected(connState.account)}</Body1>
                <Button icon={<PlugDisconnectedRegular />} onClick={handleDisconnect}>{t.fnoDisconnect}</Button>
              </>
            ) : (
              <Button
                appearance="primary"
                icon={<PlugConnectedRegular />}
                onClick={handleConnect}
                disabled={connState.kind === 'connecting'}
              >
                {connState.kind === 'connecting' ? t.fnoConnecting : t.fnoConnect}
              </Button>
            )}
          </div>

          {connState.kind === 'error' && (
            <MessageBar intent="error">
              <MessageBarBody>{connState.message}</MessageBarBody>
            </MessageBar>
          )}
        </>
      )}

      {connState.kind === 'connected' && (
        <div className={styles.columns}>
          <div className={styles.listBox}>
            <div className={styles.listHeader}>
              <Body1Strong>{t.fnoSolutions}</Body1Strong>
              {!loadingSolutions && solutions.length > 0 && (
                <Caption1 style={{ marginLeft: 6, opacity: 0.7 }}>({solutions.filter(s => s.componentType === 'DataModel' || s.componentType === 'Unknown').length})</Caption1>
              )}
              {loadingSolutions && <Spinner size="tiny" />}
            </div>
            <div style={{ padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}` }}>
              <Input
                size="small"
                placeholder={t.fnoFilterModels}
                value={solutionFilter}
                onChange={(_, d) => setSolutionFilter(d.value)}
                contentBefore={<SearchRegular />}
                style={{ width: '100%' }}
              />
            </div>
            <div className={styles.listScroll}>
              {solutions
                .filter(sol => sol.componentType === 'DataModel' || sol.componentType === 'Unknown')
                .filter(sol => {
                  if (!solutionFilter) return true;
                  const q = solutionFilter.toLowerCase();
                  return (sol.solutionName ?? '').toLowerCase().includes(q)
                    || (sol.displayName ?? '').toLowerCase().includes(q)
                    || (sol.publisher ?? '').toLowerCase().includes(q);
                })
                .map(sol => (
                  <div
                    key={sol.solutionName}
                    className={`${styles.listItem} ${activeSolution === sol.solutionName ? styles.listItemActive : ''}`}
                    onClick={() => handlePickSolution(sol.solutionName)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <Body1Strong>{sol.solutionName}</Body1Strong>
                      {sol.publisher && <div><Caption1>{sol.publisher}</Caption1></div>}
                    </div>
                  </div>
                ))}
              {!loadingSolutions && solutions.filter(s => s.componentType === 'DataModel' || s.componentType === 'Unknown').length === 0 && !solutionFilter && (
                <div className={styles.emptyState}>
                  <Caption1>
                    No solutions found under the known roots. If you know a specific publisher
                    name (e.g. a custom solution root), type it here and retry:
                  </Caption1>
                  <div className={styles.emptyStateRow}>
                    <Input
                      size="small"
                      placeholder="Publisher / root solution name"
                      value={customRoot}
                      onChange={(_, d) => setCustomRoot(d.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Button
                      size="small"
                      appearance="primary"
                      disabled={!customRoot.trim() || loadingSolutions}
                      onClick={handleRetryWithRoot}
                    >
                      {t.fnoRetry}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={styles.listBox}>
            <div className={styles.listHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {solutionPath.length > 0 && (
                  <Button size="small" appearance="subtle" onClick={handleBack}>
                    {t.fnoBack}
                  </Button>
                )}
                <Body1Strong
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={solutionPath.join(' / ') || t.fnoConfigurations}
                >
                  {solutionPath.length > 0 ? solutionPath.join(' / ') : t.fnoConfigurations}
                </Body1Strong>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {loadingComponents && <Spinner size="tiny" />}
                <Dropdown
                  size="small"
                  value={componentTypeFilter === 'All' ? t.fnoAllTypes : componentTypeFilter}
                  selectedOptions={[componentTypeFilter]}
                  onOptionSelect={(_, d) => setComponentTypeFilter(d.optionValue as ErComponentType | 'All')}
                >
                  <Option value="All">{t.fnoAllTypes}</Option>
                  <Option value="ModelMapping">ModelMapping</Option>
                  <Option value="Format">Format</Option>
                </Dropdown>
                <Button size="small" onClick={selectAllVisible} disabled={filteredComponents.length === 0}>{t.fnoSelectAll}</Button>
                <Button size="small" onClick={clearSelection} disabled={selected.size === 0}>{t.fnoSelectNone}</Button>
              </div>
            </div>
            <div className={styles.listScroll}>
              {filteredComponents.map(comp => {
                const key = componentKey(comp);
                const hasGuid = Boolean(comp.revisionGuid || comp.configurationGuid);
                const hasChildren = Boolean(comp.hasChildren);
                // ModelMapping rows from `getFormatSolutionsSubHierarchy`
                // typically come back without their own GUID — the
                // listing service only surfaces FormatMappingGUID for
                // Format leaves. The X++ AOT signature
                //   getModelMappingByID(_mappingGuid, _dataModelGuid,
                //                       _dataContainerDescriptorName)
                // however accepts an alternative resolution path: when
                // `_mappingGuid` is empty the service looks the mapping
                // up by `(_dataModelGuid, _dataContainerDescriptorName)`.
                // We therefore treat a ModelMapping as downloadable
                // whenever we know its parent DataModel GUID, even
                // without its own GUID. `buildDownloadAttempts` in
                // fno-client emits the matching fallback request.
                const canResolveMappingViaParent =
                  comp.componentType === 'ModelMapping' &&
                  Boolean(comp.parentDataModelGuid || comp.parentDataModelRevisionGuid);
                const isDownloadable = hasGuid || canResolveMappingViaParent;
                // Three classes of rows:
                //   1) isDownloadable → directly downloadable (selectable).
                //   2) !isDownloadable && hasChildren → branch (drill in).
                //   3) !isDownloadable && !hasChildren → dead row: F&O
                //      surfaces it but it has neither own GUID nor
                //      descendants. Most often a pure-inheritance
                //      derived configuration whose content lives in
                //      the base — already auto-included when the base
                //      is loaded. Disable both drill and select.
                const isDead = !isDownloadable && !hasChildren;
                // Country-variant ModelMapping where we *also* lack
                // the parent DataModel GUID is genuinely unreachable
                // — F&O does not expose any service ID we could use.
                // Its rules are already merged into Format XML downloads.
                const isUnreachableMapping =
                  !isDownloadable && comp.componentType === 'ModelMapping';
                const disabledCheckboxTitle = isUnreachableMapping
                  ? 'F&O does not expose a service ID for this ModelMapping. Its rules are bundled into the Format XML, so loading the parent Format is enough.'
                  : isDead
                    ? 'No downloadable content — pure-inheritance derived configuration. Loading the base solution already brings its definition.'
                    : 'Branch node — drill in (click row) to find downloadable children';
                const drillTitle = hasChildren
                  ? isUnreachableMapping
                    ? 'Click to drill in (informational only — children are not downloadable either).'
                    : 'Click to drill into children'
                  : isDead
                    ? 'No children and no own GUID — nothing to open.'
                    : undefined;
                let captionSuffix = '';
                if (isUnreachableMapping) {
                  captionSuffix = ' · (not downloadable — bundled into Format XML)';
                } else if (canResolveMappingViaParent && !hasGuid) {
                  captionSuffix = ' · (resolved via parent DataModel)';
                } else if (!isDownloadable) {
                  captionSuffix = hasChildren
                    ? ' · (no own content — click to drill in)'
                    : ' · (no own content, no children — derived from a base configuration)';
                }
                return (
                  <div
                    key={key}
                    className={styles.listItem}
                    style={{ gap: 8, opacity: isDead || isUnreachableMapping ? 0.55 : 1 }}
                  >
                    <Checkbox
                      checked={selected.has(key)}
                      disabled={!isDownloadable}
                      title={isDownloadable ? undefined : disabledCheckboxTitle}
                      onChange={() => toggleSelect(comp)}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        cursor: hasChildren ? 'pointer' : isDownloadable ? 'default' : 'not-allowed',
                      }}
                      onClick={hasChildren ? () => handleDrillInto(comp) : undefined}
                      onKeyDown={hasChildren ? e => { if (e.key === 'Enter') handleDrillInto(comp); } : undefined}
                      role={hasChildren ? 'button' : undefined}
                      tabIndex={hasChildren ? 0 : undefined}
                      title={drillTitle}
                    >
                      <Body1Strong>{comp.configurationName}</Body1Strong>
                      <div>
                        <Caption1>
                          {comp.componentType}
                          {comp.countryRegion ? ` · ${comp.countryRegion}` : ''}
                          {captionSuffix}
                        </Caption1>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!loadingComponents && filteredComponents.length === 0 && solutionPath.length > 0 && (
                <div className={styles.emptyState}>
                  <Caption1>{t.fnoNoChildren(solutionPath[solutionPath.length - 1])}</Caption1>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {connState.kind === 'connected' && (
        <div className={styles.footer}>
          {ingesting && ingestStatus ? (
            <Caption1 style={{ fontStyle: 'italic' }}>{ingestStatus}</Caption1>
          ) : (
            <Caption1
              title={
                selected.size > 0
                  ? Array.from(selected.values())
                      .map(c => `${c.solutionName} / ${c.configurationName} (${c.componentType})`)
                      .join('\n')
                  : undefined
              }
            >
              {selected.size > 0 ? t.fnoSelectedCount(selected.size) : ''}
            </Caption1>
          )}
          <Button
            appearance="primary"
            icon={ingesting ? <ArrowSyncRegular /> : <CloudArrowDownRegular />}
            disabled={selected.size === 0 || ingesting}
            onClick={handleLoadSelected}
          >
            {ingesting ? t.fnoLoading : t.fnoLoadSelected}
          </Button>
        </div>
      )}
    </div>
  );
};

function componentKey(c: ErConfigSummary): string {
  return `${c.solutionName}::${c.configurationName}::${c.componentType}::${c.version ?? ''}`;
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
 * 2. **DM with child DataModels** (e.g. MT940 Model → Asl MT940 Model):
 *    show directly-owned items at `childDepth` only + child DMs.
 *    Deeper items belong to child DMs.
 *
 * 3. **Leaf DM** (no child DataModels): show directly-owned items +
 *    parent-DM-owned items at `childDepth`. These are derivations of
 *    the parent's base configs that the API can't attribute precisely.
 */
function scopeComponentsToModel(
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

    // Leaf DMs WITHOUT any direct content (e.g. "Asl Bank statement
    // model" — its formats derive from the root's base formats so
    // the tree-walk never attributes them to this DM). Fall back to
    // parent-DM-owned items at childDepth. This is imprecise but the
    // API doesn't expose the model-reference link.
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
function rememberDataModels(
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
 * `rootSolutionName` is the root DataModel whose sub-tree these
 * components belong to — propagated so `handlePickSolution` can
 * always call `listComponents(root)` and get the full tree.
 *
 * Returns the same array reference when nothing changed.
 */
function promoteDmToSolutions(
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
    toAdd.push({
      solutionName: name,
      publisher: undefined,
      version: c.version,
      displayName: undefined,
      componentType: 'DataModel',
      // Point back to the root so handlePickSolution fetches the full tree.
      rootSolutionName: name === rootSolutionName ? undefined : rootSolutionName,
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
function annotateWithParentDataModel(
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

function describeHttpError(err: unknown): string {
  if (err instanceof FnoHttpError) {
    const bodyHint = (err.body ?? '').trim().split(/\r?\n/)[0]?.slice(0, 200);
    const suffix = bodyHint ? ` — ${bodyHint}` : '';
    // Our own "no matching operation" error already carries actionable info
    // (tried candidates + available operations discovered from /api/services).
    if (/No matching operation/i.test(err.message)) {
      return `${err.message}${suffix}`;
    }
    if (err.status === 404) {
      const isCustomService = /\/api\/services\//i.test(err.url);
      if (isCustomService) {
        const opMatch = err.url.match(/\/api\/services\/([^/]+)\/([^/]+)\/([^/?#]+)/);
        const [, group, service, op] = opMatch ?? [];
        return `404 Not Found (${err.url}). Custom service nebo operace na tomto prostředí neexistuje. ` +
          `Otevři v prohlížeči ${err.url.split('/api/services/')[0]}/api/services/${group ?? '<group>'}/${service ?? '<service>'} ` +
          `a zkontroluj, že operace "${op ?? ''}" je v seznamu <Operations>. Pokud má jiný název, uprav ER_SERVICE_OPS v packages/fno-client/src/er-services.ts${suffix}`;
      }
      return `${err.status} ${err.message} (${err.url}). Endpoint na prostředí neexistuje. Ověř přesnou URL prostředí (bez /namespace) a že jsou ER služby nainstalovány${suffix}`;
    }
    if (err.status === 401 || err.status === 403) {
      return `${err.status} ${err.message}. Uživatel v F&O nemá oprávnění na ER služby. Přidej uživatele / roli "Electronic reporting developer" nebo "Electronic reporting functional consultant"${suffix}`;
    }
    return `${err.status} ${err.message} (${err.url})${suffix}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function explainAuthError(err: unknown): string {
  // Unwrap FnoAuthError.cause so we see the *original* MSAL/IPC message.
  const chain: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current instanceof Error && current.message) chain.push(current.message);
    const next = (current as { cause?: unknown })?.cause;
    if (!next || next === current) break;
    current = next;
  }
  // Electron wraps IPC rejections as:
  //   "Error invoking remote method 'fno:auth:login': Error: <original>"
  // Strip the wrapper so the user sees the real reason.
  const cleaned = chain
    .map(m => m.replace(/^Error invoking remote method '[^']*':\s*Error:\s*/i, ''))
    .filter(Boolean);
  const raw = cleaned.join(' — ') || (err instanceof Error ? err.message : String(err)) || 'Unknown error';

  const code = raw.match(/AADSTS(\d{4,6})/)?.[1];
  switch (code) {
    case '700016':
      return 'AADSTS700016: Application (client) ID v tomto tenantu neexistuje. Zaregistruj app v Microsoft Entra ID (App registrations → New registration), povol „Allow public client flows", přidej redirect URI „http://localhost" a použij přesně to Application ID.';
    case '65001':
      return 'AADSTS65001: Uživatel/administrátor neudělil consent. V Entra portálu otevři registraci aplikace → API permissions → Grant admin consent pro F&O (Dynamics ERP) user_impersonation.';
    case '500011':
      return 'AADSTS500011: Scope (envUrl) neodpovídá žádnému service principálu. Ověř přesnou URL prostředí (bez lomítka na konci) a že v daném tenantu je Dynamics 365 F&O nainstalován.';
    case '50020':
      return 'AADSTS50020: Uživatel není v domovském tenantu této aplikace. Buď přihlaš se guest účtem přijatým v tomto tenantu, nebo změň registraci aplikace na „Accounts in any organizational directory".';
    case '54005':
    case '9002313':
      return `AADSTS${code}: Autorizační kód byl již použit nebo je neplatný. Zkus se přihlásit znovu.`;
    case '50076':
    case '50079':
      return `AADSTS${code}: Je vyžadováno MFA. Projdi výzvou v prohlížeči a zkus to znovu.`;
    case '7000218':
      return 'AADSTS7000218: App registration nemá povolené public client flows. V Entra → App registrations → Authentication zapni „Allow public client flows" = Yes.';
    case '9002326':
      return 'AADSTS9002326: Redirect URI je u App registration zařazené jako „Single-page application". Přesuň ho pod „Mobile and desktop applications" (http://localhost).';
    case '50011':
      return 'AADSTS50011: Redirect URI nesedí. V App registration → Authentication → Mobile and desktop applications přidej „http://localhost".';
    default:
      return code ? `AADSTS${code}: ${raw}` : raw;
  }
}
