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
  Caption2,
  Title3,
  Subtitle2,
  Body1,
  Body1Strong,
  Badge,
  Tooltip,
  Divider,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
  shorthands,
  mergeClasses,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  PlugConnectedRegular,
  PlugDisconnectedRegular,
  CloudArrowDownRegular,
  ArrowSyncRegular,
  SearchRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  AddRegular,
  PersonCircleRegular,
  LinkMultiple20Regular,
  DocumentTableRegular,
  TableSimpleRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  ArrowLeftRegular,
  SelectAllOffRegular,
  CheckboxCheckedRegular,
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

  // ── Page header ──────────────────────────────────────────────
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  pageHeaderIcon: {
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForegroundOnBrand,
    flexShrink: 0,
  },

  // ── Card wrapper ─────────────────────────────────────────────
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    ...shorthands.padding(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  cardHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  cardIcon: {
    color: tokens.colorBrandForeground1,
  },

  // ── Field grid ───────────────────────────────────────────────
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    width: '100%',
  },
  fieldActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: tokens.spacingVerticalXS,
  },

  // ── Profile list ─────────────────────────────────────────────
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    transition: 'background-color 0.1s, border-color 0.1s',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  profileRowActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  profileAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: '700',
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  profileAvatarActive: {
    backgroundColor: tokens.colorBrandBackgroundPressed,
  },
  profileMeta: {
    flex: 1,
    minWidth: 0,
  },

  // ── Connection status bar ─────────────────────────────────────
  connBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalM),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    flexWrap: 'wrap',
  },
  connStatusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  connStatusDotConnected: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  connStatusDotConnecting: { backgroundColor: tokens.colorPaletteYellowForeground1 },
  connStatusDotDisconnected: { backgroundColor: tokens.colorNeutralForeground3 },
  connStatusDotError: { backgroundColor: tokens.colorPaletteRedForeground1 },
  connBarInfo: {
    flex: 1,
    minWidth: 0,
  },
  connBarActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexShrink: 0,
  },

  // ── Browser (two-column) ──────────────────────────────────────
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)',
    gap: tokens.spacingHorizontalL,
    minHeight: '480px',
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
    minHeight: '480px',
    maxHeight: '660px',
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
    minHeight: '44px',
  },
  listHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  listSearchBar: {
    ...shorthands.padding(tokens.spacingVerticalXS, tokens.spacingHorizontalM),
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    flexShrink: 0,
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
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  listItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorBrandStroke1,
  },
  listItemContent: {
    flex: 1,
    minWidth: 0,
  },
  listItemDead: {
    opacity: 0.5,
  },
  listItemChild: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  listItemChildActive: {
    backgroundColor: tokens.colorBrandBackground2,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.colorBrandStroke1,
  },
  expandBtn: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground3,
    borderRadius: tokens.borderRadiusSmall,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      color: tokens.colorNeutralForeground2,
    },
    transition: 'color 0.1s',
  },
  expandBtnPlaceholder: {
    flexShrink: 0,
    width: '20px',
    height: '20px',
  },

  // ── Component type badge ──────────────────────────────────────
  typeBadge: {
    flexShrink: 0,
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },

  // ── Breadcrumb ────────────────────────────────────────────────
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: 0,
    overflow: 'hidden',
  },
  breadcrumbSep: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    fontSize: '12px',
  },
  breadcrumbItem: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },

  // ── Empty states ──────────────────────────────────────────────
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalS,
    ...shorthands.padding(tokens.spacingVerticalXXL, tokens.spacingHorizontalM),
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  emptyStateRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '340px',
  },

  // ── Footer ────────────────────────────────────────────────────
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    ...shorthands.padding(tokens.spacingVerticalM, tokens.spacingHorizontalL),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: tokens.borderRadiusMedium,
  },
  footerStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    flex: 1,
  },
  row: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});

const DEFAULT_CLIENT_ID = '';
const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

// ── Solution tree node (N-level recursive) ───────────────────────────────────
interface SolutionNode {
  sol: ErSolutionSummary;
  children: SolutionNode[];
}

/** Recursively checks whether a node or any of its descendants match `q`. */
function solNodeMatchesFilter(node: SolutionNode, q: string): boolean {
  return (
    (node.sol.solutionName ?? '').toLowerCase().includes(q) ||
    (node.sol.publisher ?? '').toLowerCase().includes(q) ||
    node.children.some(c => solNodeMatchesFilter(c, q))
  );
}

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
  const [expandedSolutions, setExpandedSolutions] = useState<Set<string>>(new Set());

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

    // Auto-expand the solution in the left panel tree when it's a root
    // (so the user can immediately see its derived children).
    setExpandedSolutions(prev => {
      if (prev.has(solutionName)) return prev;
      const next = new Set(prev);
      next.add(solutionName);
      return next;
    });

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
      // Only include the NEAREST (immediate parent) DataModel — not the
      // entire ancestor chain. For derived formats we want just the derived
      // model, not the base one. The nearest parent is the last element.
      if (ancestorGuids.length > 0) {
        const nearestGuid = ancestorGuids[ancestorGuids.length - 1];
        const model = resolveByGuid(nearestGuid);
        if (model && (model.configurationGuid || model.revisionGuid)) {
          const key = componentKey(model);
          if (!augmented.has(key)) augmented.set(key, model);
        }
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

        augmented.set(componentKey(synthDm), synthDm);
      }
    }
    setIngesting(true);
    // Set a non-empty status immediately so the "Already loaded / Open" button
    // is hidden from the very first moment (fnoIngestStatus gate in LandingPage).
    // Without this, Phase 0 scout downloads run with fnoIngestStatus='', leaving
    // the Open button visible for several seconds while the user has cached configs.
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

    // Maps DataModel VERSION GUID (from format XML ERModelDataSourceHandler.ModelGuid)
    // → DataModel ERSolution GUID (from listing API `Base` field / referencedModelGuid).
    // WHY: GetModelMappingByID resolves _dataModelGuid via ERSolutionTable.ID;
    // the version GUID isn't there — the ERSolution GUID IS, and resolves correctly.
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
          // Import format XML carries no Base= or Model= → extractReferencedDataModelGuids
          // finds 0 GUIDs. Use listing API's referencedModelGuid (= ERSolution.Base) as
          // fallback so the synth pass can try GetDataModelByIDAndRevision.
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
    // F&O listing API returns no GUIDs for DataModel/ModelMapping rows on modern builds.
    // For Formats whose parent DataModel has no GUID, we use sibling Formats from the
    // listing cache as scouts: export-format siblings embed Model="{dm-guid}" in XML.
    // For import formats (no Model= in XML), we auto-include ModelMapping siblings —
    // GetModelMappingByID(mappingGuid) returns DataModel XML for free via parmModel.
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
                // Probe a wide range: the format XML references a specific revision,
                // but the locally-stored revision may be much higher on newer F&O builds.
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
              break;
            }
          } catch {
            // scout download failed — try next
          }
        }

        if (!discoveredGuid) {
          // Fallback: include ModelMapping siblings — GetModelMappingByID(mappingGuid)
          // returns both the ModelMapping XML and the DataModel XML via parmModel.
          const mmSiblings: ErConfigSummary[] = [];
          for (const [cacheKey, rootComponents] of rootComponentCacheRef.current) {
            if (cacheKey !== parentDmName) continue;
            for (const c of rootComponents) {
              if (
                c.componentType === 'ModelMapping' &&
                c.configurationGuid &&
                !finalToLoad.some(existing => componentKey(existing) === componentKey(c))
              ) {
                mmSiblings.push(c);
              }
            }
          }
          if (mmSiblings.length > 0) {
            // Add at most 2 — their download will return the DataModel XML too.
            for (const mm of mmSiblings.slice(0, 2)) {
              finalToLoad.push(mm);
            }
            dmNamesInLoad.add(parentDmName);

          }
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

    // Refresh alreadyLoadedGuids with all DataModel GUIDs now in the store.
    // The Phase 0 scout may have identified the DataModel via one revision GUID,
    // while the selected Format XML embeds a DIFFERENT revision GUID for the same
    // DataModel. Without this refresh, harvestRefs would add that second GUID to
    // pendingModelFollowUps and trigger a duplicate DataModel download.
    {
      const freshDmConfigs = useAppStore.getState().configurations;
      for (const cfg of freshDmConfigs) {
        if (cfg.kind !== 'DataModel') continue;
        const solId = (cfg.solutionVersion?.solution?.id ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (solId && solId !== ZERO_GUID_LOWER) alreadyLoadedGuids.add(solId);
        const dmVersionId = ((cfg.content as { version?: { model?: { id?: string } } } | undefined)
          ?.version?.model?.id ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (dmVersionId && dmVersionId !== ZERO_GUID_LOWER) alreadyLoadedGuids.add(dmVersionId);
      }
    }

    // ── Phase 2: Downloads + Mapping listing scan run concurrently ──
    // Mapping listing scan runs in parallel with Format/ModelMapping downloads
    // (only queries the listing API). Synth-pass downloads need parsed DM data
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
          } else {
            const component = slice[results.indexOf(result)];
            handleDownloadError(component, result.reason);
          }
        }
      }
      if (pendingModelFollowUps.size > 0) {
        setIngestStatus(t.fnoStatusResolvingDM);
        const followUpEntries = Array.from(pendingModelFollowUps.values());
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
              alreadyLoadedGuids.add(result.value.guid.toLowerCase());
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
    // DataModel GUIDs discovered during the listing scan (name → configurationGuid).
    // Populated when listComponents returns a DataModel node with a GUID —
    // used in the synth pass to resolve dmByName for derived/customer DataModels.
    const discoveredDmGuidsByName = new Map<string, string>();
    // DataModel names found during the scan that have NO GUID in the listing API.
    // These are customer-derived DataModels (e.g. "Asl Advanced bank reconciliation
    // statement model") whose ERDataModel.ID we need to get via legacy name-based ops.
    const noGuidDmNamesFromScan = new Set<string>();
    const pendingMappingBranchesByDmName = new Map<string, {
      parentDmName: string;
      mappingName: string;
      mappingSolutionName: string;
      mappingVersion: string | undefined;
      /** ERModelMappingTable.Guid from listing — used when DataModel GUID is not yet known. */
      configurationGuid?: string;
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
    // Only scan DataModels that are directly relevant to the selected
    // components — skip browsed-past ancestors to avoid downloading
    // base mappings for derived configurations.
    // For formats whose DataModel is not in finalToLoad (e.g. import formats),
    // add their solutionName so the listing scan finds ModelMapping children.
    // GetModelMappingByID(mappingGuid) returns both the ModelMapping AND the DataModel.
    {
      const dmNamesInLoad = new Set(
        finalToLoad
          .filter(c => c.componentType === 'DataModel')
          .flatMap(c => [c.configurationName, c.solutionName].filter(Boolean)),
      );
      for (const c of finalToLoad) {
        if (c.componentType === 'Format' && c.solutionName && !dmNamesInLoad.has(c.solutionName)) {
          dmNamesToScan.add(c.solutionName);
        }
      }
    }
    // Format children of no-GUID DataModels — collected during the scan and
    // downloaded afterwards to extract the DataModel GUID via Model= attribute.
    const noGuidDmFormatScouts = new Map<string, ErConfigSummary>();
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
      // Capture the GUID of the root DataModel when it appears as the first element
      // (getFormatSolutionsSubHierarchy includes the query root in its flat output).
      // This is the only place we see the GUID for derived DataModels like
      // "Asl Advanced bank reconciliation statement model" — the listing of their
      // parent DM returns them without a GUID, but their OWN listing has one.
      if (children.length > 0 && children[0].componentType === 'DataModel' &&
          children[0].configurationName === dmName && children[0].configurationGuid &&
          !discoveredDmGuidsByName.has(dmName)) {
        discoveredDmGuidsByName.set(dmName, children[0].configurationGuid);
      }
      for (const child of children) {
        if (child.componentType === 'DataModel') {
          // Only walk into derived DataModels that are directly relevant
          // (in dmNamesToScan) — avoid recursing into the entire tree
          // which would download base mappings for derived configurations.
          if (child.configurationName && !visitedScanNames.has(child.configurationName)
            && dmNamesToScan.has(child.configurationName)) {
            queue.push({ name: child.configurationName, owningDmName: child.configurationName });
            if (child.configurationGuid) {
              if (!discoveredDmGuidsByName.has(child.configurationName))
                discoveredDmGuidsByName.set(child.configurationName, child.configurationGuid);
            } else {
              // No GUID — track this name for the legacy name-probe retry pass.
              noGuidDmNamesFromScan.add(child.configurationName);
            }
          } else if (child.configurationName && child.configurationGuid
            && !discoveredDmGuidsByName.has(child.configurationName)) {
            // Still record the GUID even if we don't recurse into it.
            discoveredDmGuidsByName.set(child.configurationName, child.configurationGuid);
          }
          continue;
        }
        // Format children of a no-GUID DataModel: collect as scouts for DM GUID extraction.
        // The DM node itself always precedes its DerivedSolutions in the flat DFS list, so
        // noGuidDmNamesFromScan already contains ownerDataModelName by this point.
        if (child.componentType === 'Format' && child.configurationGuid) {
          const ownerDm = child.ownerDataModelName ?? owningDmName;
          if (ownerDm && noGuidDmNamesFromScan.has(ownerDm) && !discoveredDmGuidsByName.has(ownerDm) && !noGuidDmFormatScouts.has(ownerDm)) {
            noGuidDmFormatScouts.set(ownerDm, child);
          }
        }
        if (child.componentType !== 'ModelMapping') continue;
        // Only accept mappings whose ownerDataModelName matches one of
        // the DataModels we're actually downloading. This prevents
        // downloading a derived mapping when a base format is selected
        // (and vice versa). The mapping's model must match the format's model.
        const childOwnerDm = child.ownerDataModelName ?? owningDmName;
        if (!dmNamesToScan.has(childOwnerDm)) continue;
        if (!child.revisionGuid && !child.configurationGuid) {
          // No GUID — stash as pending branch; synth pass resolves via descriptor.
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
        // Has a GUID — stash as pending branch with the GUID preserved so the synth
        // pass can use GetModelMappingByID(guid) when the DataModel is not yet known.
        if (alreadyLoadedKeys.has(componentKey(child))) continue;
        const branches = pendingMappingBranchesByDmName.get(owningDmName) ?? [];
        if (!branches.some(b => b.mappingName === child.configurationName)) {
          branches.push({
            parentDmName: owningDmName,
            mappingName: child.configurationName,
            mappingSolutionName: child.solutionName,
            mappingVersion: child.version,
            configurationGuid: child.configurationGuid ?? child.revisionGuid,
            referencedModelGuid: child.referencedModelGuid,
          });
          pendingMappingBranchesByDmName.set(owningDmName, branches);
        }
      }
    }

    // ── Post-scan: extract no-GUID DataModel GUIDs via child format scouts ──
    // For each DataModel with no GUID (e.g. "Asl Advanced bank reconciliation
    // statement model"), we try three escalating approaches:
    // 1. referencedModelGuid on the scout format row (free, from listing Base/ModelID field).
    // 2. Download the format XML and read Model= attributes (extractReferencedDataModelGuids).
    // 3. Probe every non-zero GUID in the format XML with GetDataModelByIDAndRevision
    //    until one succeeds — the first success is the DM GUID.
    for (const [scoutDmName, scoutFormat] of noGuidDmFormatScouts) {
      if (discoveredDmGuidsByName.has(scoutDmName)) continue;

      // Phase 1 — listing row already carries referencedModelGuid (r.Base / r.ModelID).
      if (scoutFormat.referencedModelGuid) {
        const lower = scoutFormat.referencedModelGuid.replace(/^\{|\}$/g, '').toLowerCase();
        if (lower && lower !== ZERO_GUID_LOWER) {
          discoveredDmGuidsByName.set(scoutDmName, lower);
          continue;
        }
      }

      // Phase 2 & 3 — download the format XML.
      try {
        const dl = await fnoSession.downloadConfiguration(activeProfile, scoutFormat);

        // Phase 2: standard model-attribute extraction.
        const refs = dl.referencedDataModelGuids ?? [];
        for (const refGuid of refs) {
          const lower = refGuid.replace(/^\{|\}$/g, '').toLowerCase();
          if (!lower || lower === ZERO_GUID_LOWER) continue;
          discoveredDmGuidsByName.set(scoutDmName, lower);
          break;
        }

        if (!discoveredDmGuidsByName.has(scoutDmName)) {
          // Phase 3: probe each GUID from the format XML as a potential ERDataModelTable GUID
          // by calling GetModelMappingByID(ZERO, candidateGuid, descriptor).
          const candidateGuids = Array.from(
            new Set(
              (dl.xml.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])
                .map(g => g.toLowerCase())
                .filter(g => g !== ZERO_GUID_LOWER),
            ),
          );
          const phase3Descriptors = Array.from(
            new Set(
              Array.from(pendingMappingBranchesByDmName.values())
                .flat()
                .map(b => b.mappingName)
                .filter(Boolean)
                .concat(['']),
            ),
          );
          for (const candidateGuid of candidateGuids) {
            if (discoveredDmGuidsByName.has(scoutDmName)) break;
            try {
              const mappingProbe: ErConfigSummary = {
                solutionName: scoutDmName,
                configurationName: scoutDmName,
                componentType: 'ModelMapping',
                parentDataModelGuid: candidateGuid,
                descriptorNameCandidates: phase3Descriptors,
                hasContent: true,
                hasChildren: false,
              };
              await fnoSession.downloadConfiguration(activeProfile, mappingProbe);
              discoveredDmGuidsByName.set(scoutDmName, candidateGuid);
            } catch {
              // Not the DataModel GUID, try next.
            }
          }
          if (!discoveredDmGuidsByName.has(scoutDmName)) {
            // All phases failed. The mapping's ERDataModelTable GUID is not discoverable:
            // - The listing API returns ZERO GUIDs for all ABR-family components
            // - Format XML GUIDs are format-component GUIDs (not the DataModel GUID)
            // - Legacy name-based ops are unavailable in this F&O environment
            // The mapping will be skipped during import.
            console.warn('[fno-ui] scan-scout: DataModel GUID not discoverable — mapping will be skipped', {
              dmName: scoutDmName,
            });
          }
        }
      } catch (err) {
        console.warn('[fno-ui] scan-scout: format download failed', scoutDmName, err);
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

        const ownerDmName = comp.ownerDataModelName ?? comp.solutionName ?? '';
        // Only include mappings owned by DataModels we're actually downloading.
        if (!dmNamesToScan.has(ownerDmName)) continue;
        if (comp.configurationGuid || comp.revisionGuid) {
          // Has GUID — stash as pending branch (not mappingsToLoad) so
          // the synth pass downloads only ONE mapping per DataModel.
          if (alreadyLoadedKeys.has(componentKey(comp))) continue;
          const branchList = pendingMappingBranchesByDmName.get(ownerDmName) ?? [];
          if (!branchList.some(b => b.mappingName === comp.configurationName)) {
            branchList.push({
              parentDmName: ownerDmName,
              mappingName: comp.configurationName,
              mappingSolutionName: comp.solutionName,
              mappingVersion: comp.version,
              configurationGuid: comp.configurationGuid ?? comp.revisionGuid,
              referencedModelGuid: comp.referencedModelGuid,
            });
            pendingMappingBranchesByDmName.set(ownerDmName, branchList);
          }
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
            // Has GUID — stash as pending branch (not mappingsToLoad).
            if (!alreadyLoadedKeys.has(componentKey(derived))) {
              const branchDmName2 = parentDm?.configurationName ?? candidateDmName;
              // Only include if the owner DM is one we're actually downloading.
              if (!dmNamesToScan.has(branchDmName2)) continue;
              const bList = pendingMappingBranchesByDmName.get(branchDmName2) ?? [];
              if (!bList.some(b => b.mappingName === (derived.configurationName ?? ''))) {
                bList.push({
                  parentDmName: branchDmName2,
                  mappingName: derived.configurationName ?? '',
                  mappingSolutionName: derived.solutionName ?? '',
                  mappingVersion: derived.version,
                  configurationGuid: derived.configurationGuid ?? derived.revisionGuid,
                  referencedModelGuid: derived.referencedModelGuid,
                });
                pendingMappingBranchesByDmName.set(branchDmName2, bList);
              }
            }
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

    }; // end mappingListingScanTask

    // ── Run listing scan concurrently with Format/ModelMapping downloads ──
    setIngestStatus(t.fnoStatusScanMappings);
    await Promise.all([downloadSelectedTask(), mappingListingScanTask()]);

    // ── Import format: post-download ModelMapping listing scan ──
    // GetEffectiveFormatMappingByID returns only the format XML for import formats.
    // Re-scan DataModels that the concurrent listing scan couldn't see (resolved by
    // the follow-up pass) to discover import ModelMapping children.
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
          if (alreadyLoadedKeys.has(componentKey(child))) continue;
          // Add as pending branch — the synth pass (already built) won't see these,
          // so push directly into mappingsToLoad for immediate download.
          const dkey = componentKey(child);
          if (!mappingsToLoad.has(dkey)) {
            mappingsToLoad.set(dkey, {
              ...child,
              configurationGuid: child.configurationGuid ?? child.revisionGuid,
            });
          }
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
        // Look up ERSolution GUID for this DataModel version GUID.
        // Primary: from format XML via harvestRefs. Fallback: from listing API entry.
        // Needed so buildDownloadAttempts can pass _dataModelGuid=ERSolutionGUID,
        // which F&O resolves to the country-specific mapping (not the default).
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
    // ── Scan parsed Format configs for embedded ModelMapping model IDs ──
    // After parsing, cfg.content.embeddedModelMappingVersions[*].mapping.modelId
    // holds the DataModel GUID in structured form (supplements the regex scan).
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
    // Register base-solution GUIDs in dmGuidIndex for mapping resolution
    // but do NOT download/load the ancestor DataModel XML — for derived
    // configs we only want the derived model, not the entire ancestor chain.
    // ERSolution.Base on a Format (or DM XML Base=) points to parent DataModel's GUID.
    const ancestorVisited = new Set<string>();
    const ancestorQueue = Array.from(baseGuidsToFetch.values()).map(b => b.baseGuid);
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'Format') continue;
      const baseRaw = cfg.solutionVersion?.solution?.baseSolutionId;
      if (!baseRaw) continue;
      const baseGuid = normalizeGuid(baseRaw);
      if (baseGuid && baseGuid !== ZERO_GUID_LOWER && !dmGuidIndex.has(baseGuid)) {
        ancestorQueue.push(baseGuid);
      }
    }
    // Only register ancestor GUIDs in the index (for mapping descriptor
    // resolution) — skip actual download of base DataModels.
    for (const baseGuid of ancestorQueue) {
      if (ancestorVisited.has(baseGuid)) continue;
      ancestorVisited.add(baseGuid);
      if (dmGuidIndex.has(baseGuid)) continue;
      // Register the base GUID so mapping synth pass can reference it,
      // but don't download it.
      recordDm(baseGuid, `DataModel ${baseGuid}`);
    }
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
    // ── Populate dmByName from GUIDs captured during the listing scan ──
    // discoveredDmGuidsByName holds configurationGuids for DataModel nodes that appeared
    // as the root of their own listComponents result (e.g. "Asl Advanced..." queried
    // directly — F&O includes the root node WITH its GUID in that response).
    // Use these to fill gaps in dmByName that the store-config walk couldn't cover.
    for (const [dmName, rawGuid] of discoveredDmGuidsByName) {
      if (dmByName.has(dmName)) continue;
      const lower = rawGuid.replace(/^\{|\}$/g, '').toLowerCase();
      if (!lower || lower === ZERO_GUID_LOWER) continue;
      let candidate = dmGuidIndex.get(lower);
      if (!candidate) {
        // Not in the index yet (DM was not downloaded). Create a stub so the
        // synth pass can at least try GetModelMappingByID with this GUID.
        candidate = { name: dmName, guid: lower, solutionName: dmName, solutionGuid: undefined, descriptorNames: [] };
        dmGuidIndex.set(lower, candidate);
      }
      dmByName.set(dmName, candidate);
    }

    const synthQueue: { synth: ErConfigSummary; dmGuid: string; label: string }[] = [];

    // ── Resolve pending mapping branches ──
    // Each DataModel key in `pendingMappingBranchesByDmName` gets ONE synthQueue entry.
    // buildDownloadAttempts tries descriptor candidates in order and stops at the
    // first success → F&O returns the effective mapping for this environment.
    const dmGuidsWithResolvedBranch = new Set<string>();
    for (const [dmName, branches] of pendingMappingBranchesByDmName) {
      if (branches.length === 0) continue;

      let ownerDm = dmByName.get(dmName);
      if (!ownerDm) {
        // Fallback: any named DM candidate (F&O resolves inheritance automatically).
        for (const candidate of dmGuidIndex.values()) {
          if (!candidate.name.startsWith('DataModel ')) {
            ownerDm = candidate;
            break;
          }
        }
      }
      if (!ownerDm) {
        // Try ERSolution GUID from any branch's referencedModelGuid.
        const refGuid = branches.find(b => b.referencedModelGuid)?.referencedModelGuid;
        if (refGuid) {
          const lowerRef = refGuid.toLowerCase();
          let synthCandidate = dmGuidIndex.get(lowerRef);
          if (!synthCandidate) {
            synthCandidate = {
              name: dmName,
              guid: lowerRef,
              solutionName: branches[0].mappingSolutionName,
              solutionGuid: undefined,
              descriptorNames: [],
            };
            dmGuidIndex.set(lowerRef, synthCandidate);
          }
          if (!dmByName.has(dmName)) dmByName.set(dmName, synthCandidate);
          ownerDm = synthCandidate;
        }
      }

      if (ownerDm) {
        // DataModel GUID known — create ONE entry per DM key (not per branch).
        // All branch names become ordered descriptor candidates so buildDownloadAttempts
        // tries each in sequence and stops at the first F&O hit. This prevents
        // downloading both the base variant ("ABR…") AND the customer variant
        // ("Asl ABR…") simultaneously — F&O returns exactly ONE effective mapping
        // for this DM in the customer's environment.
        dmGuidsWithResolvedBranch.add(ownerDm.guid);
        const allBranchNames = [...new Set(branches.map(b => b.mappingName).filter(s => s))];
        const descriptors = [...new Set([...allBranchNames, ...ownerDm.descriptorNames, ''])];
        // Pick the most derived branch as primary: GUID-bearing branch first, else
        // last in the array (deepest in the listing tree = most derived).
        const primaryBranch = branches.find(b => b.configurationGuid) ?? branches[branches.length - 1];
        synthQueue.push({
          synth: {
            solutionName: primaryBranch.mappingSolutionName,
            configurationName: primaryBranch.mappingName,
            componentType: 'ModelMapping',
            configurationGuid: primaryBranch.configurationGuid,
            version: primaryBranch.mappingVersion,
            parentDataModelGuid: ownerDm.guid,
            parentDataModelRevisionGuid: ownerDm.solutionGuid,
            descriptorNameCandidates: descriptors,
            hasContent: true,
          },
          dmGuid: ownerDm.guid,
          label: `mapping (under ${dmName})`,
        });
      } else {
        // DataModel GUID unknown. If any branch has a mapping GUID, use it —
        // GetModelMappingByID(mappingGuid) returns BOTH the mapping AND the DataModel.
        const branchWithGuid = branches.find(b => b.configurationGuid);
        if (branchWithGuid?.configurationGuid) {
          synthQueue.push({
            synth: {
              solutionName: branchWithGuid.mappingSolutionName,
              configurationName: branchWithGuid.mappingName,
              componentType: 'ModelMapping',
              configurationGuid: branchWithGuid.configurationGuid,
              version: branchWithGuid.mappingVersion,
              hasContent: true,
            },
            dmGuid: branchWithGuid.configurationGuid,
            label: `${branchWithGuid.mappingName} (GUID-direct; DataModel unknown)`,
          });
        } else {
          // No GUID at all — brute-force across all known DataModel GUIDs.
          const branchDescriptors = [...new Set(branches.map(b => b.mappingName).filter(Boolean))];
          for (const candidate of dmGuidIndex.values()) {
            synthQueue.push({
              synth: {
                solutionName: branches[0].mappingSolutionName,
                configurationName: `${dmName} mapping (brute-force)`,
                componentType: 'ModelMapping',
                version: branches[0].mappingVersion,
                parentDataModelGuid: candidate.guid,
                parentDataModelRevisionGuid: candidate.solutionGuid,
                descriptorNameCandidates: [...branchDescriptors, ...candidate.descriptorNames],
                hasContent: true,
              },
              dmGuid: candidate.guid,
              label: `${dmName} mapping (brute-force vs ${candidate.guid})`,
            });
            dmGuidsWithResolvedBranch.add(candidate.guid);
          }
        }
      }
    }

    // Suppress default probes for DMs whose mapping was already loaded in Phase 2
    // (user explicitly selected both a Format and its ModelMapping). The listing scan
    // filtered that mapping via alreadyLoadedKeys so pendingMappingBranchesByDmName
    // has no entry for it — without this seed, the default probe would re-download.
    {
      type MmContent = { version?: { mapping?: { modelId?: string } } };
      for (const cfg of useAppStore.getState().configurations) {
        if (cfg.kind !== 'ModelMapping') continue;
        const modelId = ((cfg.content as MmContent | undefined)?.version?.mapping?.modelId ?? '')
          .replace(/^\{|\}$/g, '').toLowerCase();
        if (modelId && modelId !== ZERO_GUID_LOWER) dmGuidsWithResolvedBranch.add(modelId);
      }
    }

    // Default mapping probes for DMs without a direct-GUID entry.
    // Only probe DataModels that are actually in finalToLoad (selected +
    // immediate parent) — skip base/ancestor DataModels to avoid
    // downloading their mappings for derived configurations.
    const loadedDmGuids = new Set<string>();
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel') {
        if (c.configurationGuid) loadedDmGuids.add(normalizeGuid(c.configurationGuid));
        if (c.revisionGuid) loadedDmGuids.add(normalizeGuid(c.revisionGuid));
      }
    }
    for (const dm of dmGuidIndex.values()) {
      if (dmGuidsWithResolvedBranch.has(dm.guid)) continue;
      if (!loadedDmGuids.has(dm.guid)) continue;
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
      setIngestStatus(t.fnoStatusDownloadingMMCount(allMappingDownloads.length));
      // Track DM GUIDs for which a mapping was *successfully* downloaded.
      // Once a branch for a given DM GUID returns real XML, all remaining
      // branches for that DM are skipped. Branches that return empty content
      // do NOT mark the DM as resolved so the next branch in a later batch
      // still gets a chance (important: "ABR…" may be empty while "Asl ABR…"
      // for the same DM GUID carries the customer-deployed mapping).
      // NOTE: no within-batch DM-GUID dedup — concurrent requests for the
      // same DM are fine because the store deduplicates by solution GUID.
      const downloadedMappingDmGuids = new Set<string>();
      const MAPPING_BATCH_SIZE = 2;
      for (let batch = 0; batch < allMappingDownloads.length; batch += MAPPING_BATCH_SIZE) {
        const slice = allMappingDownloads.slice(batch, batch + MAPPING_BATCH_SIZE);
        // Only skip entries whose DM GUID was resolved (success) in a prior batch.
        const pending = slice.filter(
          item => !item.dmGuid || !downloadedMappingDmGuids.has(item.dmGuid),
        );
        if (pending.length === 0) continue;
        const results = await Promise.allSettled(
          pending.map(async item => {
            const download = await fnoSession.downloadConfiguration(activeProfile, item.synth);
            return { item, download };
          }),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            loadXmlFile(result.value.download.xml, result.value.download.syntheticPath);
            ok += 1;
            // Mark DM as resolved so subsequent branches for the same DM are skipped.
            if (result.value.item.dmGuid) downloadedMappingDmGuids.add(result.value.item.dmGuid);
            collectLateRefs(result.value.download);
          } else {
            const reason = result.reason;
            if (reason instanceof FnoEmptyContentError) {
              // empty — try next branch for same DM
            } else {
              console.warn('[fno-ui] mapping fetch failed', reason);
            }
          }
        }
      }
      // ── Retry pass: probe unresolved DataModel names when no mapping was found ──
      // Triggered only when ALL initial download attempts failed (downloadedMappingDmGuids
      // is empty). This handles the case where the customer has a DERIVED DataModel
      // (e.g. "Asl Advanced bank reconciliation statement model") registered in F&O
      // under a different GUID than the standard one we discovered via GUID-scout.
      // For export formats the initial pass usually SUCCEEDS → no retry needed.
      // For import-only formats the initial pass returns empty → retry fires here.
      if (downloadedMappingDmGuids.size === 0) {
        const retryDownloads: { synth: ErConfigSummary; label: string; dmGuid: string }[] = [];
        for (const [dmName, branches] of pendingMappingBranchesByDmName) {
          if (branches.length === 0) continue;
          const resolvedDm = dmByName.get(dmName);

          // Case A: DM was resolved but all mapping attempts returned empty.
          // Try each branch's referencedModelGuid as an alternative _dataModelGuid.
          // For customer-derived DataModels, referencedModelGuid = ERSolution GUID of the
          // derived DM — F&O may resolve it if it stores a GUID alias on ERDataModelTable.
          if (resolvedDm) {
            const altGuids = new Set<string>();
            for (const branch of branches) {
              if (!branch.referencedModelGuid) continue;
              const lower = branch.referencedModelGuid.replace(/^\{|\}$/g, '').toLowerCase();
              if (!lower || lower === ZERO_GUID_LOWER) continue;
              if (lower === resolvedDm.guid) continue;
              if (lower === (resolvedDm.solutionGuid ?? '').toLowerCase()) continue;
              altGuids.add(lower);
            }
            const allBranchNames = [...new Set(branches.map(b => b.mappingName).filter(Boolean))];
            const primaryBranch = branches.find(b => b.configurationGuid) ?? branches[branches.length - 1];

            // Case A: branch referencedModelGuids as alternative DM GUIDs.
            for (const altGuid of altGuids) {
              const retryDescriptors = [...new Set([...allBranchNames, ...resolvedDm.descriptorNames, ''])];
              const retryKey = `synth-retry:${altGuid}`;
              if (synthesizedMappingKeys.has(retryKey)) continue;
              synthesizedMappingKeys.add(retryKey);
              retryDownloads.push({
                synth: {
                  solutionName: primaryBranch.mappingSolutionName,
                  configurationName: primaryBranch.mappingName,
                  componentType: 'ModelMapping',
                  configurationGuid: primaryBranch.configurationGuid,
                  version: primaryBranch.mappingVersion,
                  parentDataModelGuid: altGuid,
                  descriptorNameCandidates: retryDescriptors,
                  hasContent: true,
                },
                dmGuid: altGuid,
                label: `${primaryBranch.mappingName} (retry altGuid ${altGuid} under ${dmName})`,
              });
            }

            // Case D: try DM GUIDs discovered via the post-scan format scout
            // (e.g. the Asl derived DM GUID found via GetModelMappingByID probing).
            // These are keyed under Asl DM names and not yet in dmByName, but they
            // may resolve mappings that are listed under the base DM name.
            for (const [discoveredName, discoveredGuid] of discoveredDmGuidsByName) {
              if (discoveredGuid === resolvedDm.guid) continue;
              if (dmByName.has(discoveredName) && dmByName.get(discoveredName)?.guid === discoveredGuid) continue;
              const retryDescriptorsD = [...new Set([...allBranchNames, ...resolvedDm.descriptorNames, ''])];
              const retryKeyD = `synth-retry-d:${discoveredGuid}:${dmName}`;
              if (synthesizedMappingKeys.has(retryKeyD)) continue;
              synthesizedMappingKeys.add(retryKeyD);
              retryDownloads.push({
                synth: {
                  solutionName: primaryBranch.mappingSolutionName,
                  configurationName: primaryBranch.mappingName,
                  componentType: 'ModelMapping',
                  configurationGuid: primaryBranch.configurationGuid,
                  version: primaryBranch.mappingVersion,
                  parentDataModelGuid: discoveredGuid,
                  descriptorNameCandidates: retryDescriptorsD,
                  hasContent: true,
                },
                dmGuid: discoveredGuid,
                label: `${primaryBranch.mappingName} (retry Case D: discovered ${discoveredName} → ${discoveredGuid})`,
              });
            }

            if (altGuids.size > 0 || retryDownloads.some(r => r.label.includes('Case D'))) continue;
          }

          // Case B: DM unresolved — probe by DataModel name via legacy ops.
          const probeSpec: ErConfigSummary = {
            solutionName: dmName,
            configurationName: dmName,
            componentType: 'DataModel',
            hasContent: false, // no GUID → legacy name-based ops
            versionNumbers: [1, 2, 3, 0],
          };
          let resolvedGuid: string | undefined;
          try {
            const dmDownload = await fnoSession.downloadConfiguration(activeProfile, probeSpec);
            loadXmlFile(dmDownload.xml, dmDownload.syntheticPath);
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
              const lower = dm.id.replace(/^\{|\}$/g, '').toLowerCase();
              const candidate = dmGuidIndex.get(lower);
              if (candidate) {
                dmByName.set(dmName, candidate);
                resolvedGuid = candidate.guid;
              }
            }
          } catch (err) {
            if (!(err instanceof FnoEmptyContentError)) {
              console.warn('[fno-ui] synth-retry: DM name-based probe failed', dmName, err);
            }
          }
          if (!resolvedGuid) continue;
          const ownerDm = dmByName.get(dmName);
          if (!ownerDm) continue;
          const seenBranchNames = new Set<string>();
          for (const branch of branches) {
            const bName = branch.mappingName;
            if (seenBranchNames.has(bName)) continue;
            seenBranchNames.add(bName);
            const retryKey = `synth-mapping:${resolvedGuid}:${bName}`;
            if (synthesizedMappingKeys.has(retryKey)) continue;
            synthesizedMappingKeys.add(retryKey);
            const descriptors = (branch.mappingName ? [branch.mappingName] : []).concat(
              ownerDm.descriptorNames.filter(d => d !== branch.mappingName),
              [''],
            );
            retryDownloads.push({
              synth: {
                solutionName: branch.mappingSolutionName,
                configurationName: bName,
                componentType: 'ModelMapping',
                configurationGuid: branch.configurationGuid,
                version: branch.mappingVersion,
                parentDataModelGuid: ownerDm.guid,
                parentDataModelRevisionGuid: ownerDm.solutionGuid,
                descriptorNameCandidates: descriptors,
                hasContent: true,
              },
              dmGuid: resolvedGuid,
              label: `${bName} (retry under ${dmName})`,
            });
          }
        }
        // Case C: probe no-GUID DataModels from allDataModelsSeen via legacy name-based ops.
        // Handles the scenario where ALL mappings are registered under a DERIVED DataModel
        // (e.g. "Asl Advanced bank reconciliation statement model") whose GUID is unknown
        // because F&O's listing API returns it without a GUID. The derived DM appears in
        // allDataModelsSeen because the user browsed it (rememberDataModels logs it as
        // "DataModel has no GUID — skipping"). We try downloading it by name; if the
        // environment has legacy ops (getRevisionContent / getConfigurationXml), we get
        // its XML → parse its ERDataModel.ID → retry GetModelMappingByID with that GUID.
        if (retryDownloads.length === 0) {
          // Collect all pending branch descriptor candidates (used for each new DM GUID).
          const allPendingDescriptors = [...new Set(
            Array.from(pendingMappingBranchesByDmName.values())
              .flat()
              .map(b => b.mappingName)
              .filter(Boolean),
          )];
          const allPendingBranches = Array.from(pendingMappingBranchesByDmName.values()).flat();
          const primaryBranchGlobal =
            allPendingBranches.find(b => b.configurationGuid) ?? allPendingBranches[allPendingBranches.length - 1];

          // Merge allDataModelsSeen (stale closure) with noGuidDmNamesFromScan
          // (collected live during this ingest). allDataModelsSeen may be empty
          // when the user hasn't browsed the tree first (ingest from a fresh session).
          const noGuidNamesC = new Set<string>(noGuidDmNamesFromScan);
          for (const dm of allDataModelsSeen.values()) {
            if (!dm.configurationGuid && !dm.revisionGuid && dm.configurationName)
              noGuidNamesC.add(dm.configurationName);
          }
          for (const dmNameC of noGuidNamesC) {
            if (dmByName.has(dmNameC)) continue; // already resolved
            let candidateGuid: string | undefined;

            // Step 1 — try legacy name-based download (works on older F&O builds).
            const probeSpecC: ErConfigSummary = {
              solutionName: dmNameC,
              configurationName: dmNameC,
              componentType: 'DataModel',
              hasContent: false, // no GUID → legacy name-based ops
              versionNumbers: [1, 2, 3, 0],
            };
            try {
              const dmDl = await fnoSession.downloadConfiguration(activeProfile, probeSpecC);
              loadXmlFile(dmDl.xml, dmDl.syntheticPath);
              ok += 1;
              const newest = useAppStore.getState().configurations;
              const parsed = newest.find(
                c => c.kind === 'DataModel' &&
                  (c.solutionVersion?.solution?.name === dmNameC ||
                   (c.content as ParsedDmContent | undefined)?.version?.model?.name === dmNameC),
              );
              const parsedModel = (parsed?.content as ParsedDmContent | undefined)?.version?.model;
              if (parsedModel?.id) {
                const lower = parsedModel.id.replace(/^\{|\}$/g, '').toLowerCase();
                if (lower && lower !== ZERO_GUID_LOWER) {
                  const containers = (parsedModel.containers ?? [])
                    .map(c => (c?.name ?? '').trim())
                    .filter(s => s.length > 0);
                  recordDm(parsedModel.id, parsedModel.name ?? dmNameC, parsed?.solutionVersion?.solution?.name, containers);
                  let cand = dmGuidIndex.get(lower);
                  if (!cand) {
                    cand = { name: dmNameC, guid: lower, solutionName: dmNameC, solutionGuid: undefined, descriptorNames: containers };
                    dmGuidIndex.set(lower, cand);
                  }
                  dmByName.set(dmNameC, cand);
                  candidateGuid = lower;
                }
              }
            } catch (err) {
              if (!(err instanceof FnoEmptyContentError)) {
                console.warn('[fno-ui] synth-retry-C: legacy DM probe failed', dmNameC, err);
              }
            }

            // Step 2 — (OData entities for ER DataModels do not exist in F&O,
            // so this is intentionally left as a no-op. If a future F&O build
            // exposes such an entity, probe it here.)

            if (!candidateGuid || allPendingDescriptors.length === 0 || !primaryBranchGlobal) continue;
            const ownerCand = dmByName.get(dmNameC);
            const descriptorsComb = [...new Set([...allPendingDescriptors, ...(ownerCand?.descriptorNames ?? []), ''])];
            const retryKeyC = `synth-retry-c:${candidateGuid}`;
            if (synthesizedMappingKeys.has(retryKeyC)) continue;
            synthesizedMappingKeys.add(retryKeyC);
            retryDownloads.push({
              synth: {
                solutionName: primaryBranchGlobal.mappingSolutionName,
                configurationName: primaryBranchGlobal.mappingName,
                componentType: 'ModelMapping',
                configurationGuid: primaryBranchGlobal.configurationGuid,
                version: primaryBranchGlobal.mappingVersion,
                parentDataModelGuid: candidateGuid,
                parentDataModelRevisionGuid: ownerCand?.solutionGuid,
                descriptorNameCandidates: descriptorsComb,
                hasContent: true,
              },
              dmGuid: candidateGuid,
              label: `mapping (Case C: ${dmNameC} → ${candidateGuid})`,
            });
          }
        }

        if (retryDownloads.length > 0) {
          setIngestStatus(t.fnoStatusDownloadingMMCount(retryDownloads.length));
          for (let batch = 0; batch < retryDownloads.length; batch += MAPPING_BATCH_SIZE) {
            const slice = retryDownloads.slice(batch, batch + MAPPING_BATCH_SIZE);
            const pending = slice.filter(item => !downloadedMappingDmGuids.has(item.dmGuid));
            if (pending.length === 0) continue;
            const results = await Promise.allSettled(
              pending.map(async item => {
                const dl = await fnoSession.downloadConfiguration(activeProfile, item.synth);
                return { item, dl };
              }),
            );
            for (const result of results) {
              if (result.status === 'fulfilled') {
                loadXmlFile(result.value.dl.xml, result.value.dl.syntheticPath);
                ok += 1;
                downloadedMappingDmGuids.add(result.value.item.dmGuid);
                collectLateRefs(result.value.dl);
              } else {
                const reason = result.reason;
                if (reason instanceof FnoEmptyContentError) {
                  // empty — mapping not found for this DM GUID, retry with next
                } else {
                  console.warn('[fno-ui] synth-retry mapping fetch failed', reason);
                }
              }
            }
          }
        }
      }
    }

    // ── Late DataModel pass ──
    // DataModel GUIDs discovered from ModelMapping XML in the synth pass.
    // Covers import formats: their ModelMapping XML carries the correct Model= attribute.
    if (lateModelFollowUps.size > 0) {
      setIngestStatus(t.fnoStatusLateDM);
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

  // ── Helper: type badge ──────────────────────────────────────────────────
  const TypeBadge = ({ type }: { type: ErComponentType }) => {
    const color =
      type === 'ModelMapping' ? 'success' :
      type === 'Format' ? 'informative' :
      type === 'DataModel' ? 'important' : 'subtle';
    const label =
      type === 'ModelMapping' ? 'Mapping' :
      type === 'Format' ? 'Format' :
      type === 'DataModel' ? 'Model' : type;
    return (
      <Badge appearance="tint" color={color} size="small" className={styles.typeBadge}>
        {label}
      </Badge>
    );
  };

  // ── Helper: skeleton list item for loading states ─────────────────────
  const SkeletonListItem = ({ wide = false, delay = 0 }: { wide?: boolean; delay?: number }) => (
    <div className="fno-skeleton-row" style={{ animationDelay: `${delay}ms` }}>
      <div className="fno-skeleton-block fno-skeleton-icon" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fno-skeleton-block fno-skeleton-line-main" style={{ width: wide ? '75%' : '60%' }} />
        <div className="fno-skeleton-block fno-skeleton-line-sub" style={{ width: wide ? '50%' : '38%' }} />
      </div>
    </div>
  );

  // ── Helper: build N-level recursive tree from flat solutions list ────────
  const solutionTree = useMemo<SolutionNode[]>(() => {
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
  }, [solutions]);

  const toggleExpanded = useCallback((name: string) => {
    setExpandedSolutions(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── Recursive solution-row renderer ─────────────────────────────────────
  const renderSolNode = (node: SolutionNode, depth: number): React.ReactNode => {
    const { sol, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedSolutions.has(sol.solutionName);
    const isActive = activeSolution === sol.solutionName;
    const q = solutionFilter.toLowerCase();

    const visibleChildren = solutionFilter
      ? children.filter(c => solNodeMatchesFilter(c, q))
      : children;

    // Fluent spacingHorizontalM ≈ 12px; add 16px per extra level
    const basePad = 12;
    const padLeft = depth > 0 ? `${basePad + depth * 16}px` : undefined;
    const padLeftActive = depth > 0 ? `${basePad + depth * 16 - 3}px` : undefined;

    return (
      <React.Fragment key={sol.solutionName}>
        <div
          className={mergeClasses(
            styles.listItem,
            isActive
              ? (depth > 0 ? styles.listItemChildActive : styles.listItemActive)
              : (depth > 0 ? styles.listItemChild : ''),
          )}
          style={depth > 0 ? { paddingLeft: isActive ? padLeftActive : padLeft } : undefined}
          onClick={() => handlePickSolution(sol.solutionName)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') handlePickSolution(sol.solutionName); }}
        >
          {hasChildren ? (
            <div
              className={styles.expandBtn}
              role="button"
              tabIndex={0}
              aria-label={isExpanded ? 'Sbalit' : 'Rozbalit'}
              onClick={e => { e.stopPropagation(); toggleExpanded(sol.solutionName); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleExpanded(sol.solutionName); } }}
            >
              {isExpanded
                ? <ChevronDownRegular fontSize={12} />
                : <ChevronRightRegular fontSize={12} />}
            </div>
          ) : (
            <div className={styles.expandBtnPlaceholder} />
          )}
          <div className={styles.listItemContent}>
            {depth === 0 ? (
              <Body1Strong style={{ display: 'block' }}>{sol.solutionName}</Body1Strong>
            ) : (
              <Caption1 style={{ display: 'block', fontWeight: '600' }}>{sol.solutionName}</Caption1>
            )}
            {sol.publisher && depth === 0 && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{sol.publisher}</Caption1>
            )}
          </div>
          {hasChildren && (
            <Badge appearance="outline" size="small" style={{ flexShrink: 0, fontSize: '10px' }}>
              {children.length}
            </Badge>
          )}
        </div>
        {(isExpanded || !!solutionFilter) && visibleChildren.map(child => renderSolNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  // ── Helper: profile initials avatar ─────────────────────────────────────
  const initials = (name: string) => {
    const parts = name.trim().split(/[\s·\-_]+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  // ── Connection state derived values ──────────────────────────────────────
  const connDotClass =
    connState.kind === 'connected' ? styles.connStatusDotConnected :
    connState.kind === 'connecting' ? styles.connStatusDotConnecting :
    connState.kind === 'error' ? styles.connStatusDotError :
    styles.connStatusDotDisconnected;

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

      {/* ── Profile editor card ─────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderLeft}>
            <PersonCircleRegular fontSize={18} className={styles.cardIcon} />
            <Body1Strong>{isEditing ? t.fnoUpdateProfile : t.fnoSaveProfile}</Body1Strong>
          </div>
          {isEditing && (
            <Button size="small" appearance="subtle" icon={<AddRegular />} onClick={handleNewProfile}>
              {t.fnoNewProfile}
            </Button>
          )}
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

        <div className={styles.fieldActions}>
          <Button appearance="primary" disabled={!canSave} icon={<CheckmarkCircleRegular />} onClick={handleSaveProfile}>
            {isEditing ? t.fnoUpdateProfile : t.fnoSaveProfile}
          </Button>
        </div>

        {/* Profile list */}
        {profiles.length > 0 && (
          <>
            <Divider style={{ marginTop: tokens.spacingVerticalXS }} />
            <Caption2 style={{ color: tokens.colorNeutralForeground3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t.fnoProfiles}
            </Caption2>
            <div className={styles.profileList}>
              {profiles.map(p => (
                <div
                  key={p.id}
                  className={mergeClasses(styles.profileRow, activeProfileId === p.id ? styles.profileRowActive : '')}
                  onClick={() => setActiveProfileId(p.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActiveProfileId(p.id); }}
                >
                  <div className={mergeClasses(styles.profileAvatar, activeProfileId === p.id ? styles.profileAvatarActive : '')}>
                    {initials(p.displayName || p.envUrl)}
                  </div>
                  <div className={styles.profileMeta}>
                    <Body1Strong>{p.displayName}</Body1Strong>
                    <div>
                      <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{p.envUrl}</Caption1>
                    </div>
                  </div>
                  <Tooltip content={t.fnoRemoveProfile} relationship="label">
                    <Button
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={t.fnoRemoveProfile}
                      onClick={e => {
                        e.stopPropagation();
                        remove(p.id);
                        if (activeProfileId === p.id) setActiveProfileId(null);
                      }}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          </>
        )}
        {profiles.length === 0 && (
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{t.fnoNoProfiles}</Caption1>
        )}
      </div>

      {/* ── Connection status bar ────────────────────────────────────────── */}
      {activeProfile && (
        <div className={styles.connBar}>
          <div className={mergeClasses(styles.connStatusDot, connDotClass)} />
          <div className={styles.connBarInfo}>
            {connState.kind === 'connected' ? (
              <>
                <Body1Strong style={{ color: tokens.colorPaletteGreenForeground1 }}>
                  {t.fnoConnected(connState.account)}
                </Body1Strong>
                <div>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{activeProfile.envUrl}</Caption1>
                </div>
              </>
            ) : connState.kind === 'connecting' ? (
              <Body1Strong style={{ fontStyle: 'italic', color: tokens.colorNeutralForeground2 }}>
                {t.fnoConnecting}
              </Body1Strong>
            ) : connState.kind === 'error' ? (
              <Body1Strong style={{ color: tokens.colorPaletteRedForeground1 }}>
                {connState.message}
              </Body1Strong>
            ) : (
              <>
                <Body1Strong>{activeProfile.displayName}</Body1Strong>
                <div>
                  <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{activeProfile.envUrl}</Caption1>
                </div>
              </>
            )}
          </div>
          <div className={styles.connBarActions}>
            {connState.kind === 'connected' ? (
              <Button icon={<PlugDisconnectedRegular />} onClick={handleDisconnect}>
                {t.fnoDisconnect}
              </Button>
            ) : (
              <Button
                appearance="primary"
                icon={connState.kind === 'connecting' ? <Spinner size="tiny" /> : <PlugConnectedRegular />}
                onClick={handleConnect}
                disabled={connState.kind === 'connecting'}
              >
                {connState.kind === 'connecting' ? t.fnoConnecting : t.fnoConnect}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Browser ──────────────────────────────────────────────────────── */}
      {connState.kind === 'connected' && (
        <>
          <div className={styles.columns}>
            {/* Left: DataModel navigator */}
            <div className={styles.listBox}>
              <div className={styles.listHeader}>
                <div className={styles.listHeaderLeft}>
                  <TableSimpleRegular fontSize={16} style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
                  <Body1Strong style={{ whiteSpace: 'nowrap' }}>{t.fnoSolutions}</Body1Strong>
                  {!loadingSolutions && solutionTree.length > 0 && (
                    <Badge appearance="filled" color="brand" size="small" style={{ flexShrink: 0 }}>
                      {solutionTree.length}
                    </Badge>
                  )}
                </div>
                {loadingSolutions && <Spinner size="tiny" />}
              </div>
              <div className={styles.listSearchBar}>
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
                {/* Skeleton while loading */}
                {loadingSolutions && (
                  <>
                    <SkeletonListItem wide delay={0} />
                    <SkeletonListItem delay={80} />
                    <SkeletonListItem wide delay={160} />
                    <SkeletonListItem delay={240} />
                    <SkeletonListItem wide delay={320} />
                  </>
                )}

                {!loadingSolutions && solutionTree
                  .filter(node => !solutionFilter || solNodeMatchesFilter(node, solutionFilter.toLowerCase()))
                  .map(node => renderSolNode(node, 0))}

                {!loadingSolutions && solutionTree.length === 0 && !solutionFilter && (
                  <div className={styles.emptyState}>
                    <TableSimpleRegular fontSize={32} style={{ opacity: 0.3 }} />
                    <Caption1>No solutions found under the known roots.</Caption1>
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                      If you know a specific publisher name, type it here and retry:
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

            {/* Right: configuration browser */}
            <div className={styles.listBox}>
              <div className={styles.listHeader}>
                {/* Breadcrumb */}
                <div className={styles.listHeaderLeft} style={{ minWidth: 0, flex: 1 }}>
                  {solutionPath.length > 0 && (
                    <Tooltip content={t.fnoBack} relationship="label">
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<ArrowLeftRegular />}
                        onClick={handleBack}
                        style={{ flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                  <div className={styles.breadcrumb}>
                    {solutionPath.length === 0 ? (
                      <Body1Strong className={styles.breadcrumbItem}>{t.fnoConfigurations}</Body1Strong>
                    ) : (
                      solutionPath.map((seg, i) => (
                        <React.Fragment key={seg}>
                          {i > 0 && <ChevronRightRegular fontSize={12} className={styles.breadcrumbSep} />}
                          <Caption1
                            className={styles.breadcrumbItem}
                            style={{ fontWeight: i === solutionPath.length - 1 ? '600' : undefined, color: i < solutionPath.length - 1 ? tokens.colorNeutralForeground3 : undefined }}
                            title={seg}
                          >
                            {seg}
                          </Caption1>
                        </React.Fragment>
                      ))
                    )}
                  </div>
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS, alignItems: 'center', flexShrink: 0 }}>
                  {loadingComponents && <Spinner size="tiny" />}
                  <Dropdown
                    size="small"
                    value={componentTypeFilter === 'All' ? t.fnoAllTypes : componentTypeFilter}
                    selectedOptions={[componentTypeFilter]}
                    onOptionSelect={(_, d) => setComponentTypeFilter(d.optionValue as ErComponentType | 'All')}
                  >
                    <Option value="All">{t.fnoAllTypes}</Option>
                    <Option value="ModelMapping">Mapping</Option>
                    <Option value="Format">Format</Option>
                  </Dropdown>
                  <Tooltip content={t.fnoSelectAll} relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<CheckboxCheckedRegular />}
                      disabled={filteredComponents.length === 0}
                      onClick={selectAllVisible}
                    />
                  </Tooltip>
                  <Tooltip content={t.fnoSelectNone} relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<SelectAllOffRegular />}
                      disabled={selected.size === 0}
                      onClick={clearSelection}
                    />
                  </Tooltip>
                </div>
              </div>

              <div className={styles.listScroll}>
                {/* Skeleton while loading components */}
                {loadingComponents && (
                  <>
                    <SkeletonListItem wide delay={0} />
                    <SkeletonListItem delay={60} />
                    <SkeletonListItem wide delay={120} />
                  </>
                )}

                {!loadingComponents && filteredComponents.map(comp => {
                  const key = componentKey(comp);
                  const hasGuid = Boolean(comp.revisionGuid || comp.configurationGuid);
                  const hasChildren = Boolean(comp.hasChildren);
                  const canResolveMappingViaParent =
                    comp.componentType === 'ModelMapping' &&
                    Boolean(comp.parentDataModelGuid || comp.parentDataModelRevisionGuid);
                  const isDownloadable = hasGuid || canResolveMappingViaParent;
                  const isDead = !isDownloadable && !hasChildren;
                  const isUnreachableMapping =
                    !isDownloadable && comp.componentType === 'ModelMapping';

                  const disabledTitle = isUnreachableMapping
                    ? 'F&O does not expose a service ID for this ModelMapping. Its rules are bundled into the Format XML.'
                    : isDead
                      ? 'No downloadable content — pure-inheritance derived configuration.'
                      : 'Branch node — click to drill into children';

                  return (
                    <div
                      key={key}
                      className={mergeClasses(
                        styles.listItem,
                        (isDead || isUnreachableMapping) ? styles.listItemDead : '',
                      )}
                    >
                      {/* Checkbox */}
                      <Checkbox
                        checked={selected.has(key)}
                        disabled={!isDownloadable}
                        title={isDownloadable ? undefined : disabledTitle}
                        onChange={() => toggleSelect(comp)}
                      />

                      {/* Content */}
                      <div
                        className={styles.listItemContent}
                        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
                        onClick={hasChildren ? () => handleDrillInto(comp) : undefined}
                        onKeyDown={hasChildren ? e => { if (e.key === 'Enter') handleDrillInto(comp); } : undefined}
                        role={hasChildren ? 'button' : undefined}
                        tabIndex={hasChildren ? 0 : undefined}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap' }}>
                          <TypeBadge type={comp.componentType} />
                          {comp.countryRegion && (
                            <Badge appearance="outline" size="small" style={{ fontSize: '10px' }}>
                              {comp.countryRegion}
                            </Badge>
                          )}
                          {canResolveMappingViaParent && !hasGuid && (
                            <Badge appearance="outline" color="success" size="small" style={{ fontSize: '10px' }}>
                              via parent
                            </Badge>
                          )}
                        </div>
                        <Body1Strong style={{ display: 'block', marginTop: '2px' }}>
                          {comp.configurationName}
                        </Body1Strong>
                        {comp.version && (
                          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>v{comp.version}</Caption1>
                        )}
                      </div>

                      {/* Drill icon */}
                      {hasChildren ? (
                        <Tooltip content="Drill into children" relationship="label">
                          <ChevronRightRegular
                            fontSize={16}
                            style={{ color: tokens.colorBrandForeground1, flexShrink: 0, cursor: 'pointer' }}
                            onClick={() => handleDrillInto(comp)}
                          />
                        </Tooltip>
                      ) : isDownloadable ? (
                        <CloudArrowDownRegular fontSize={14} style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
                      ) : (
                        <DismissCircleRegular fontSize={14} style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }} />
                      )}
                    </div>
                  );
                })}

                {!loadingComponents && filteredComponents.length === 0 && solutionPath.length > 0 && (
                  <div className={styles.emptyState}>
                    <DocumentTableRegular fontSize={32} style={{ opacity: 0.3 }} />
                    <Caption1>{t.fnoNoChildren(solutionPath[solutionPath.length - 1])}</Caption1>
                  </div>
                )}
                {!loadingComponents && filteredComponents.length === 0 && solutionPath.length === 0 && !loadingSolutions && (
                  <div className={styles.emptyState}>
                    <ChevronDownRegular fontSize={32} style={{ opacity: 0.3 }} />
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                      Select a Data Model on the left to browse its configurations.
                    </Caption1>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer / download bar ─────────────────────────────────────── */}
          <div className={styles.footer}>
            <div className={styles.footerStatus}>
              {ingesting && ingestStatus ? (
                <>
                  <ArrowSyncRegular fontSize={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0, color: tokens.colorBrandForeground1 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Caption2 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '2px' }}>
                      Stahování konfigurací&hellip;
                    </Caption2>
                    <Caption1 style={{ fontWeight: '600', color: tokens.colorNeutralForeground1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {ingestStatus}
                    </Caption1>
                  </div>
                </>
              ) : selected.size > 0 ? (
                <>
                  <CheckmarkCircleRegular fontSize={16} style={{ color: tokens.colorBrandForeground1 }} />
                  <Caption1>
                    <strong>{selected.size}</strong> {t.fnoSelectedCount(selected.size).replace(String(selected.size), '').trim()}
                  </Caption1>
                  <Tooltip
                    content={Array.from(selected.values()).map(c => `${c.solutionName} / ${c.configurationName} (${c.componentType})`).join('\n')}
                    relationship="description"
                  >
                    <Caption1 style={{ color: tokens.colorNeutralForeground3, cursor: 'default' }}>
                      {Array.from(selected.values()).slice(0, 2).map(c => c.configurationName).join(', ')}
                      {selected.size > 2 ? ` +${selected.size - 2}` : ''}
                    </Caption1>
                  </Tooltip>
                </>
              ) : (
                <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
                  Select configurations to download
                </Caption1>
              )}
            </div>
            <Button
              appearance="primary"
              size="large"
              icon={ingesting ? <ArrowSyncRegular style={{ animation: 'spin 1s linear infinite' }} /> : <CloudArrowDownRegular />}
              disabled={selected.size === 0 || ingesting}
              onClick={handleLoadSelected}
            >
              {ingesting ? t.fnoLoading : t.fnoLoadSelected}
            </Button>
          </div>
        </>
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
 * `rootSolutionName` is the top-level root — propagated so `handlePickSolution`
 * can always call `listComponents(root)` and get the full tree.
 * `parentConfigName` on each `ErConfigSummary` is used as the direct-parent
 * pointer so the UI can render a multi-level tree.
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
