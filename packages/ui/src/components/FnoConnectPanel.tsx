/**
 * F&O connector panel — shown on the Landing page under the "D365 F&O server"
 * tab. Lets the user:
 *   1) manage connection profiles (add/pick/remove)
 *   2) sign in with MSAL (popup or loopback)
 *   3) browse ER solutions and their configurations
 *   4) multi-select configurations and ingest them into the session
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type ConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; account: string }
  | { kind: 'error'; message: string };

/**
 * The client ID must be a Microsoft Entra app registration in YOUR tenant
 * with delegated permission on the target F&O environment and
 * "Allow public client flows = Yes". We intentionally ship no default — using
 * someone else's clientId triggers AADSTS700016 ("app not found in tenant").
 */
const DEFAULT_CLIENT_ID = '';
const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

export const FnoConnectPanel: React.FC = () => {
  const styles = useStyles();
  const pushToast = useAppStore(s => s.pushToast);
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const { profiles, upsert, remove, markUsed } = useFnoProfiles();

  // Editor state
  const [profileName, setProfileName] = useState('');
  const [envUrl, setEnvUrl] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);

  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [connState, setConnState] = useState<ConnectionState>({ kind: 'disconnected' });

  const [solutions, setSolutions] = useState<ErSolutionSummary[]>([]);
  const [loadingSolutions, setLoadingSolutions] = useState(false);
  const [activeSolution, setActiveSolution] = useState<string | null>(null);
  /** Breadcrumb of solution names the user has drilled into (root → leaf). */
  const [solutionPath, setSolutionPath] = useState<string[]>([]);
  const [customRoot, setCustomRoot] = useState('');

  const [components, setComponents] = useState<ErConfigSummary[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [componentTypeFilter, setComponentTypeFilter] = useState<ErComponentType | 'All'>('All');
  /**
   * Accumulated selection across all drill levels. Keyed by `componentKey`
   * so components from different sub-solutions stay distinct. We keep the
   * full `ErConfigSummary` as the value because the user can queue
   * components that are no longer visible in the current list view —
   * `handleLoadSelected` must still know how to download them.
   */
  const [selected, setSelected] = useState<Map<string, ErConfigSummary>>(new Map());
  /**
   * Remembered root DataModel for each breadcrumb root. F&O's
   * `GetModelMappingByID` requires the owning DataModel's GUID, so we
   * capture the first DataModel we see when the user drills into a
   * root solution (level 1) and attach it as `parentDataModelGuid` to
   * every descendant summary. Also used to auto-include the root
   * DataModel when the user loads only derived formats/mappings.
   */
  const [rootDataModelByPath, setRootDataModelByPath] = useState<Map<string, ErConfigSummary>>(new Map());
  /**
   * Every DataModel encountered during browsing, keyed by
   * `componentKey`. We build this up as the user drills around so we
   * can later resolve `ancestorDataModelGuids` back to downloadable
   * `ErConfigSummary` objects.
   */
  const [allDataModelsSeen, setAllDataModelsSeen] = useState<Map<string, ErConfigSummary>>(new Map());
  /**
   * Ordered stack of DataModels the user has drilled *into* on the
   * current path, from root at index 0 to the nearest parent at the
   * top. Aligns with `solutionPath`. Resets on `handlePickSolution`,
   * push on `handleDrillInto(datamodel)`, pop on `handleBack`. We
   * snapshot this chain onto every listed component so that selecting
   * a Format at depth N auto-queues *all* DataModels at depths 0..N
   * — every intermediate derived model is required to resolve
   * inherited bindings, not just the top root.
   */
  const [dataModelChain, setDataModelChain] = useState<ErConfigSummary[]>([]);

  const [ingesting, setIngesting] = useState(false);
  const setFnoIngestStatus = useAppStore(s => s.setFnoIngestStatus);
  /** Human-readable progress label shown while ingesting. */
  const setIngestStatus = useCallback((status: string) => {
    setFnoIngestStatus(status);
  }, [setFnoIngestStatus]);
  const ingestStatus = useAppStore(s => s.fnoIngestStatus);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  // When the active profile changes, populate the editor with its values so
  // the user can edit it in place, and reset dependent state.
  useEffect(() => {
    const profile = profiles.find(p => p.id === activeProfileId) ?? null;
    if (profile) {
      setProfileName(profile.displayName);
      setEnvUrl(profile.envUrl);
      setTenantId(profile.tenantId);
      setClientId(profile.clientId);
    }
    setConnState({ kind: 'disconnected' });
    setSolutions([]);
    setActiveSolution(null);
    setComponents([]);
    setSelected(new Map());
    setRootDataModelByPath(new Map());
    setAllDataModelsSeen(new Map());
    setDataModelChain([]);
  // Intentionally depend only on the id — we don't want to reset the editor
  // whenever the profiles array changes (e.g. after upsert).
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
    // Phase 2 — list ER solutions via OData.
    setLoadingSolutions(true);
    try {
      const list = await fnoSession.listSolutions(activeProfile);
      list.sort((a, b) => (a.solutionName ?? '').localeCompare(b.solutionName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      // Dev diagnostic: always log so we can inspect shape in DevTools.
      console.info(
        '[fno-odata] listSolutions returned',
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
      console.error('[fno-odata] listSolutions failed', err);
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
    setRootDataModelByPath(new Map());
    setAllDataModelsSeen(new Map());
    setDataModelChain([]);
  }, [activeProfile]);

  const handlePickSolution = useCallback(async (solutionName: string) => {
    if (!activeProfile) return;
    setActiveSolution(solutionName);
    setSolutionPath([solutionName]);
    // Selection is intentionally preserved across navigation so the user
    // can queue items from multiple drill levels (e.g. a derived model at
    // level 2 + a mapping at level 1). Use the "Clear" button to reset.
    setLoadingComponents(true);
    setComponents([]);
    try {
      const list = await fnoSession.listComponents(activeProfile, solutionName);
      list.sort((a, b) => (a.configurationName ?? '').localeCompare(b.configurationName ?? '', undefined, { sensitivity: 'base', numeric: true }));
      console.info('[fno-ui] components for', solutionName, list);
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
      // Accumulate every DataModel we've ever seen so handleLoadSelected
      // can resolve ancestor GUIDs back to downloadable summaries.
      setAllDataModelsSeen(prev => rememberDataModels(prev, list));
      setComponents(annotateWithParentDataModel(list, chain));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, pushToast]);

  /** Drill one level deeper: treat the clicked component as a sub-solution
   *  and list its children. Works because the ER tree in F&O is a single
   *  `ERSolutionTable` hierarchy — every node can be a parent. */
  const handleDrillInto = useCallback(async (comp: ErConfigSummary) => {
    if (!activeProfile) return;
    const name = comp.configurationName;
    setSolutionPath(prev => [...prev, name]);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, pushToast, dataModelChain]);

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
      const list = await fnoSession.listComponents(activeProfile, parent);
      setAllDataModelsSeen(prev => rememberDataModels(prev, list));
      setComponents(annotateWithParentDataModel(list, nextChain));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', message: t.fnoLoadingFailed(message) });
    } finally {
      setLoadingComponents(false);
    }
  }, [activeProfile, solutionPath, dataModelChain, pushToast]);

  const filteredComponents = useMemo(() => {
    if (componentTypeFilter === 'All') return components;
    return components.filter(c => c.componentType === componentTypeFilter);
  }, [components, componentTypeFilter]);

  const isComponentDownloadable = useCallback((comp: ErConfigSummary): boolean => {
    if (comp.revisionGuid || comp.configurationGuid) return true;
    // ModelMapping rows from `getFormatSolutionsSubHierarchy` are
    // missing their own GUID but can still be resolved via
    // `getModelMappingByID(_dataModelGuid, _dataContainerDescriptorName)`
    // when we know the parent DataModel GUID. See the matching
    // fallback path in `buildDownloadAttempts` (fno-client/odata.ts).
    if (
      comp.componentType === 'ModelMapping' &&
      (comp.parentDataModelGuid || comp.parentDataModelRevisionGuid)
    ) {
      return true;
    }
    return false;
  }, []);

  const toggleSelect = useCallback((comp: ErConfigSummary) => {
    // Branch nodes (no own GUID and no parent-DataModel resolution
    // path) can't be downloaded — selecting them would surface a red
    // error toast on the user's "Load" action. Silently ignore the
    // toggle so the disabled checkbox stays in sync with the
    // selection map.
    if (!isComponentDownloadable(comp)) return;
    const key = componentKey(comp);
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, comp);
      return next;
    });
  }, [isComponentDownloadable]);

  const selectAllVisible = useCallback(() => {
    // Merge into existing selection rather than replace it — preserves
    // items chosen at other drill levels. Skip non-downloadable branch
    // nodes so "select all" doesn't queue items that fail immediately
    // at download time.
    setSelected(prev => {
      const next = new Map(prev);
      for (const c of filteredComponents) {
        if (!isComponentDownloadable(c)) continue;
        next.set(componentKey(c), c);
      }
      return next;
    });
  }, [filteredComponents, isComponentDownloadable]);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

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
    setIngesting(true);
    setIngestStatus('Preparing…');

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
    const alreadyLoadedGuids = new Set<string>();
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel' && c.configurationGuid) {
        alreadyLoadedGuids.add(c.configurationGuid.toLowerCase());
      }
    }
    for (let i = 0; i < finalToLoad.length; i++) {
      const component = finalToLoad[i];
      setIngestStatus(`Downloading ${component.configurationName} (${i + 1}/${finalToLoad.length})…`);
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, component);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
        // Harvest cross-references to DataModel GUIDs that the listing
        // API didn't expose.
        const refs = download.referencedDataModelGuids ?? [];
        const refRevs = download.referencedDataModelRevisions ?? {};
        for (const guid of refs) {
          const lower = guid.toLowerCase();
          if (alreadyLoadedGuids.has(lower)) continue;
          const existing = pendingModelFollowUps.get(lower);
          const rev = refRevs[lower];
          if (!existing || (typeof rev === 'number' && (existing.rev ?? -1) < rev)) {
            pendingModelFollowUps.set(lower, { guid, rev });
          }
        }
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          // Derived/pure-inheritance configurations have no own XML.
          // Silent skip for auto-injected roots; info toast when the
          // user asked for this item explicitly (so they understand
          // why nothing was loaded).
          skippedEmpty += 1;
          const wasExplicit = explicitKeys.has(componentKey(component));
          if (wasExplicit) {
            pushToast({
              kind: 'info',
              message: `"${component.configurationName}" nemá vlastní XML (odvozená konfigurace) — přeskočeno.`,
            });
          } else {
            console.info('[fno-ui] auto-included root has no own XML, skipping', component.configurationName);
          }
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        pushToast({ kind: 'error', message: t.fnoDownloadFailed(component.configurationName, message) });
      }
    }
    // Second pass: download any DataModel referenced from inside the
    // just-loaded XML. We fabricate a minimal `ErConfigSummary` so the
    // existing `downloadConfigXml` plumbing can target it. If the
    // model is a pure-inheritance pointer (200-empty everywhere),
    // silently skip — the base model already carries the definition
    // via the normal auto-inject path.
    if (pendingModelFollowUps.size > 0) {
      setIngestStatus('Resolving referenced DataModels…');
      console.info('[fno-ui] following up on referenced DataModels', Array.from(pendingModelFollowUps.values()));
    }
    for (const { guid, rev } of pendingModelFollowUps.values()) {
      // If we harvested a specific revision from `ModelVersion="{guid},N"`,
      // use exactly that; otherwise fall through to a broad probe (0..20)
      // so the base `buildDownloadAttempts` DataModel path picks the
      // first non-empty.
      const versionNumbers = typeof rev === 'number'
        ? [rev]
        : Array.from({ length: 21 }, (_, i) => i); // 0..20
      const synth: ErConfigSummary = {
        solutionName: '<referenced>',
        configurationName: `DataModel ${guid}`,
        componentType: 'DataModel',
        configurationGuid: guid,
        hasContent: true,
        version: typeof rev === 'number' ? String(rev) : undefined,
        versionNumbers,
      };
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, synth);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          console.info('[fno-ui] referenced DataModel has no own XML, skipping', guid);
          continue;
        }
        console.warn('[fno-ui] referenced DataModel download failed', guid, err);
      }
    }

    // Third pass: now that every DataModel (explicit + ancestor +
    // referenced) is on disk in the workspace, enumerate ModelMapping
    // siblings for each one and download them.
    setIngestStatus('Scanning for Model Mappings…');
    //
    // ER hierarchy refresher (per F&O ERSolutionTable):
    //   - Root DataModel
    //     ├─ Derived DataModel (recursive: any depth)
    //     ├─ ModelMapping  (often under the root, but a derived
    //     │                  ModelMapping that overrides bindings can
    //     │                  live under any DataModel level — see the
    //     │                  user's note)
    //     └─ Format        (under any DataModel level; the format's
    //                       mapping references the nearest
    //                       ModelMapping in the chain)
    // Special case: a ModelMapping can also be **embedded inside a
    // DataModel/Format XML payload** (`<ERModelMappingVersion>`
    // siblings of the format/model entity). Those don't need a
    // separate download because the `core` parser already lifts them
    // into `ERFormatContent.embeddedModelMappingVersions` /
    // `ERDataModelContent` during `parseERConfiguration`.
    //
    // To cover the standalone-mapping case we walk the hierarchy
    // recursively from every loaded DataModel solution name and from
    // every ancestor name we collected during navigation, then
    // download every ModelMapping leaf that has any usable GUID.
    // Failures are logged but never block the user-picked downloads.
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

    const alreadyLoadedKeys = new Set(finalToLoad.map(c => componentKey(c)));
    const mappingsToLoad = new Map<string, ErConfigSummary>();
    const visitedScanNames = new Set<string>();
    /**
     * ModelMapping branch rows the listing surfaced without a GUID
     * (typical: F&O lists `<dmName> mapping` as a child of a DataModel
     * but only exposes its own GUID/IDs in the in-product workspace).
     * They're not usable until we resolve their parent DataModel's
     * GUID — which often only becomes available after the synth-pass
     * base-walk fetches the parent DM XML. We therefore stash them
     * keyed by parent DM NAME and revisit during the synth pass.
     */
    const pendingMappingBranchesByDmName = new Map<string, {
      parentDmName: string;
      mappingName: string;
      mappingSolutionName: string;
      mappingVersion: string | undefined;
    }[]>();
    // Recursive scan: a mapping can be under the root DM, a derived
    // DM, or any depth in between. We walk the listComponents tree
    // breadth-first across all known DM names + their derived DM
    // descendants and queue every ModelMapping leaf we find.
    const queue: string[] = Array.from(dmNamesToScan);
    while (queue.length > 0) {
      const dmName = queue.shift()!;
      if (visitedScanNames.has(dmName)) continue;
      visitedScanNames.add(dmName);
      let children: ErConfigSummary[];
      try {
        children = await fnoSession.listComponents(activeProfile, dmName);
      } catch (err) {
        console.warn('[fno-ui] listComponents failed during mapping scan for', dmName, err);
        continue;
      }
      console.info('[fno-ui] mapping-scan listComponents', {
        parent: dmName,
        rowCount: children.length,
        types: children.map(c => `${c.componentType}:${c.configurationName}(guid=${Boolean(c.configurationGuid || c.revisionGuid)})`),
      });
      // Resolve the owning DM for the *current* parent name so we can
      // forward it to mapping leaves discovered below this branch.
      const owningDm = Array.from(allDataModelsSeen.values()).find(
        m => m.configurationName === dmName && (m.configurationGuid || m.revisionGuid),
      );
      for (const child of children) {
        if (child.componentType === 'DataModel') {
          // Walk into derived DataModels too — they can host their
          // own ModelMapping descendants.
          if (child.configurationName && !visitedScanNames.has(child.configurationName)) {
            queue.push(child.configurationName);
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
          // Stash the mapping under its parent DM name. The synth
          // pass below will look up the DM GUID (parsed XML or
          // base-walk) and queue the actual download with the right
          // `descriptorNameCandidates` and `parentDataModelGuid`.
          const list = pendingMappingBranchesByDmName.get(dmName) ?? [];
          list.push({
            parentDmName: dmName,
            mappingName: child.configurationName,
            mappingSolutionName: child.solutionName,
            mappingVersion: child.version,
          });
          pendingMappingBranchesByDmName.set(dmName, list);
          console.info(
            '[fno-ui] pending ModelMapping branch (no GUID — will resolve via parent DM in synth pass)',
            { name: child.configurationName, parent: dmName, hasChildren: child.hasChildren },
          );
          continue;
        }
        const key = componentKey(child);
        if (alreadyLoadedKeys.has(key)) continue;
        if (mappingsToLoad.has(key)) continue;
        // GetModelMappingByID needs a `_dataModelGuid`. Resolve via
        // the parent DM we just scanned (look it up in
        // `allDataModelsSeen` or pull the freshly-loaded summary).
        // NB: when we drilled into a ModelMapping branch, `dmName` is
        // the mapping branch name, not a DM — fall back to the
        // accumulated `allDataModelsSeen` and finally any DataModel
        // currently loaded in the workspace store.
        let parentDm = owningDm
          ?? Array.from(allDataModelsSeen.values()).find(
            m => m.configurationName === dmName && (m.configurationGuid || m.revisionGuid),
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

    if (mappingsToLoad.size > 0) {
      console.info(
        '[fno-ui] auto-loading ModelMapping siblings',
        Array.from(mappingsToLoad.values()).map(m => m.configurationName),
      );
    } else {
      console.info('[fno-ui] mapping scan finished — no ModelMappings found', {
        scannedDmNames: Array.from(visitedScanNames),
      });
    }

    // ── Synthesized ModelMapping fetches via the X++ AOT fallback ──
    setIngestStatus('Downloading Model Mappings…');
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
        return;
      }
      dmGuidIndex.set(lower, {
        guid: lower, // store normalized form so downstream paths match
        name,
        solutionName: solutionName ?? '<referenced>',
        descriptorNames: descriptorNames ?? [],
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
    // Pick up GUIDs and descriptor names from parsed DataModel XML
    // now sitting in the store. Each `ERDataModel.containers[].name`
    // is a valid `_dataContainerDescriptorName` we can pass to
    // `getModelMappingByID` — without it, the fallback path returns
    // empty for every model that authored its default mapping under a
    // non-root container.
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
      console.info('[fno-ui] parsed DataModel inspection (synth pass)', {
        configFile: cfg.filePath,
        solutionName: cfg.solutionVersion?.solution?.name,
        modelId: dm?.id,
        modelName: dm?.name,
        baseSolutionId: baseRaw,
        containerCount: containerNames.length,
      });
      if (dm?.id) {
        recordDm(
          dm.id,
          dm.name ?? cfg.solutionVersion?.solution?.name ?? '<unknown>',
          cfg.solutionVersion?.solution?.name,
          containerNames,
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
    // ── Walk up the base-solution chain ──
    //
    // F&O's `getFormatSolutionsSubHierarchy` only enumerates
    // *descendants*, so the listing API cannot surface ancestor
    // DataModel GUIDs. The parsed CZ DM XML, however, carries
    // `Base="{baseGuid},rev"` — we use that to fetch the base model
    // via `GetDataModelByIDAndRevision`, parse it, harvest its own
    // base, and repeat until we hit a DM with no parent. Each newly
    // fetched DM also surfaces fresh container names that we feed
    // back into the descriptor-candidate pool.
    const ancestorVisited = new Set<string>();
    const ancestorQueue = Array.from(baseGuidsToFetch.values()).map(b => b.baseGuid);
    while (ancestorQueue.length > 0) {
      const baseGuid = ancestorQueue.shift()!;
      if (ancestorVisited.has(baseGuid)) continue;
      ancestorVisited.add(baseGuid);
      if (dmGuidIndex.has(baseGuid)) continue; // already loaded
      const synthDm: ErConfigSummary = {
        solutionName: '<ancestor>',
        configurationName: `DataModel ${baseGuid}`,
        componentType: 'DataModel',
        configurationGuid: baseGuid,
        hasContent: true,
        // Probe a wide range of revisions; F&O typically returns 200
        // OK with body for the rev that actually carries XML and
        // 200-empty for the rest. `buildDownloadAttempts` already
        // handles this strategy for DataModel components.
        versionNumbers: Array.from({ length: 21 }, (_, i) => i),
      };
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, synthDm);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
        console.info('[fno-ui] ancestor DataModel fetched via base-walk', {
          baseGuid,
        });
        // Re-read the store to pick up the newly parsed DM.
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
        // Walk further up if this base has its own base.
        const grandRaw = newest?.solutionVersion?.solution?.baseSolutionId;
        if (grandRaw) {
          const grandGuid = normalizeGuid(grandRaw);
          if (grandGuid && grandGuid !== ZERO_GUID_LOWER && !ancestorVisited.has(grandGuid)) {
            ancestorQueue.push(grandGuid);
          }
        }
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          // Pure-inheritance ancestor with no own XML — record the
          // GUID anyway so the synth pass tries its mapping.
          recordDm(baseGuid, `DataModel ${baseGuid}`);
          console.info('[fno-ui] ancestor DataModel returned empty XML, recorded GUID only', baseGuid);
          continue;
        }
        console.warn('[fno-ui] ancestor DataModel fetch failed (base-walk)', baseGuid, err);
      }
    }
    console.info('[fno-ui] synthesized mapping pass: candidate DataModels', {
      count: dmGuidIndex.size,
      dms: Array.from(dmGuidIndex.values()).map(
        d => `${d.name} (${d.guid}) [descriptors: ${d.descriptorNames.join(', ') || '<none>'}]`,
      ),
    });

    // Build a name → DmSynthCandidate index so we can resolve the
    // ModelMapping *branch* rows the listing scan stashed without a
    // GUID. Each branch maps 1:1 to a default ModelMapping owned by
    // the parent DataModel (X++ ERModelMappingTableSelector picks it
    // by `(model.RecId, descriptorRecId)`); we just need to attach
    // the freshly-resolved DM GUID + container names.
    const dmByName = new Map<string, DmSynthCandidate>();
    for (const dm of dmGuidIndex.values()) {
      if (!dm.name.startsWith('DataModel ')) {
        dmByName.set(dm.name, dm);
      }
    }
    const synthQueue: { synth: ErConfigSummary; dmGuid: string; label: string }[] = [];

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
        if (!ownerDm) {
          unresolvedBranchCount += 1;
          console.info(
            '[fno-ui] pending ModelMapping branch unresolved (no DM GUID at all)',
            branch,
          );
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
        resolved: resolvedBranchCount,
        unresolved: unresolvedBranchCount,
      });
    }

    // ── Default mapping probes for DMs without a resolved branch ──
    for (const dm of dmGuidIndex.values()) {
      if (dmGuidsWithResolvedBranch.has(dm.guid)) continue;
      synthQueue.push({
        synth: {
          solutionName: dm.solutionName,
          configurationName: `${dm.name} (default mapping)`,
          componentType: 'ModelMapping',
          parentDataModelGuid: dm.guid,
          descriptorNameCandidates: dm.descriptorNames,
          hasContent: true,
        },
        dmGuid: dm.guid,
        label: `default mapping for ${dm.name}`,
      });
    }

    for (const item of synthQueue) {
      const synthKey = `synth-mapping:${item.dmGuid}`;
      if (synthesizedMappingKeys.has(synthKey)) continue;
      synthesizedMappingKeys.add(synthKey);
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, item.synth);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
        console.info('[fno-ui] synthesized ModelMapping fetched', {
          which: item.label,
          dmGuid: item.dmGuid,
        });
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          console.info(
            '[fno-ui] synthesized ModelMapping returned empty XML, skipping',
            item.label,
          );
          continue;
        }
        console.info(
          '[fno-ui] synthesized ModelMapping fetch failed',
          { which: item.label, dmGuid: item.dmGuid, err },
        );
      }
    }

    for (const mapping of mappingsToLoad.values()) {
      try {
        const download = await fnoSession.downloadConfiguration(activeProfile, mapping);
        loadXmlFile(download.xml, download.syntheticPath);
        ok += 1;
      } catch (err) {
        if (err instanceof FnoEmptyContentError) {
          console.info('[fno-ui] sibling ModelMapping has no own XML, skipping', mapping.configurationName);
          continue;
        }
        console.warn('[fno-ui] sibling ModelMapping download failed', mapping.configurationName, err);
      }
    }

    setIngesting(false);
    setIngestStatus('');
    if (ok > 0) {
      // Clear the queue when the entire batch resolved (success or
      // benign empty). Partial *real* failures stay selected for retry.
      if (ok + skippedEmpty === finalToLoad.length) setSelected(new Map());
      pushToast({ kind: 'success', message: t.fnoLoadedCount(ok) });
    }
  }, [activeProfile, selected, allDataModelsSeen, solutionPath, loadXmlFile, pushToast]);

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
              {loadingSolutions && <Spinner size="tiny" />}
            </div>
            <div className={styles.listScroll}>
              {solutions.map(sol => (
                <div
                  key={sol.solutionName}
                  className={`${styles.listItem} ${activeSolution === sol.solutionName ? styles.listItemActive : ''}`}
                  onClick={() => handlePickSolution(sol.solutionName)}
                  role="button"
                  tabIndex={0}
                >
                  <div>
                    <Body1Strong>{sol.displayName ?? sol.solutionName}</Body1Strong>
                    <div><Caption1>{sol.publisher ?? ''} {sol.version ? `· v${sol.version}` : ''}</Caption1></div>
                  </div>
                </div>
              ))}
              {!loadingSolutions && solutions.length === 0 && (
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
                      Retry
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
                    ← Back
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
                  <Option value="DataModel">DataModel</Option>
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
                          {comp.version ? ` · v${comp.version}` : ''}
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
                  <Caption1>No children under "{solutionPath[solutionPath.length - 1]}".</Caption1>
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
              {selected.size > 0 ? `${selected.size} vybráno (napříč úrovněmi)` : ''}
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
    if (!c.configurationGuid && !c.revisionGuid) continue;
    const key = componentKey(c);
    if (prev.has(key)) continue;
    if (!next) next = new Map(prev);
    next.set(key, c);
  }
  return next ?? prev;
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
          `a zkontroluj, že operace "${op ?? ''}" je v seznamu <Operations>. Pokud má jiný název, uprav ER_SERVICE_OPS v packages/fno-client/src/odata.ts${suffix}`;
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
