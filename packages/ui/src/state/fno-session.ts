/**
 * In-memory Zustand store for F&O connection & browsing state.
 * Survives navigation between LandingPage and the analysis view
 * within a single browser session. NOT persisted to localStorage.
 */

import { create } from 'zustand';
import type {
  ErComponentType,
  ErConfigSummary,
  ErSolutionSummary,
  FnoConnection,
} from '@er-visualizer/fno-client';

export type ConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; account: string }
  | { kind: 'error'; message: string };

export interface FnoSessionStore {
  // ── Connection ──
  activeProfileId: string | null;
  connState: ConnectionState;
  setActiveProfileId: (id: string | null) => void;
  setConnState: (state: ConnectionState) => void;

  // ── Solutions (left panel) ──
  solutions: ErSolutionSummary[];
  loadingSolutions: boolean;
  solutionFilter: string;
  setSolutions: (list: ErSolutionSummary[]) => void;
  setLoadingSolutions: (v: boolean) => void;
  setSolutionFilter: (v: string) => void;

  // ── Components (right panel) ──
  activeSolution: string | null;
  solutionPath: string[];
  components: ErConfigSummary[];
  loadingComponents: boolean;
  componentTypeFilter: ErComponentType | 'All';
  setActiveSolution: (name: string | null) => void;
  setSolutionPath: (path: string[]) => void;
  setComponents: (list: ErConfigSummary[]) => void;
  setLoadingComponents: (v: boolean) => void;
  setComponentTypeFilter: (v: ErComponentType | 'All') => void;

  // ── Selection & download state ──
  selected: Map<string, ErConfigSummary>;
  setSelected: (map: Map<string, ErConfigSummary>) => void;
  toggleSelected: (key: string, comp: ErConfigSummary) => void;

  // ── DataModel tracking ──
  rootDataModelByPath: Map<string, ErConfigSummary>;
  allDataModelsSeen: Map<string, ErConfigSummary>;
  dataModelChain: ErConfigSummary[];
  setRootDataModelByPath: (fn: (prev: Map<string, ErConfigSummary>) => Map<string, ErConfigSummary>) => void;
  setAllDataModelsSeen: (fn: (prev: Map<string, ErConfigSummary>) => Map<string, ErConfigSummary>) => void;
  setDataModelChain: (chain: ErConfigSummary[]) => void;

  // ── Reset ──
  resetBrowsingState: () => void;
  resetAll: () => void;
}

export const useFnoSession = create<FnoSessionStore>((set, get) => ({
  // Connection
  activeProfileId: null,
  connState: { kind: 'disconnected' },
  setActiveProfileId: (id) => {
    set({
      activeProfileId: id,
      connState: { kind: 'disconnected' },
      solutions: [],
      activeSolution: null,
      components: [],
      selected: new Map(),
      rootDataModelByPath: new Map(),
      allDataModelsSeen: new Map(),
      dataModelChain: [],
      solutionPath: [],
      solutionFilter: '',
    });
  },
  setConnState: (state) => set({ connState: state }),

  // Solutions
  solutions: [],
  loadingSolutions: false,
  solutionFilter: '',
  setSolutions: (list) => set({ solutions: list }),
  setLoadingSolutions: (v) => set({ loadingSolutions: v }),
  setSolutionFilter: (v) => set({ solutionFilter: v }),

  // Components
  activeSolution: null,
  solutionPath: [],
  components: [],
  loadingComponents: false,
  componentTypeFilter: 'All',
  setActiveSolution: (name) => set({ activeSolution: name }),
  setSolutionPath: (path) => set({ solutionPath: path }),
  setComponents: (list) => set({ components: list }),
  setLoadingComponents: (v) => set({ loadingComponents: v }),
  setComponentTypeFilter: (v) => set({ componentTypeFilter: v }),

  // Selection
  selected: new Map(),
  setSelected: (map) => set({ selected: map }),
  toggleSelected: (key, comp) => {
    const prev = get().selected;
    const next = new Map(prev);
    if (next.has(key)) next.delete(key);
    else next.set(key, comp);
    set({ selected: next });
  },

  // DataModel tracking
  rootDataModelByPath: new Map(),
  allDataModelsSeen: new Map(),
  dataModelChain: [],
  setRootDataModelByPath: (fn) => set({ rootDataModelByPath: fn(get().rootDataModelByPath) }),
  setAllDataModelsSeen: (fn) => set({ allDataModelsSeen: fn(get().allDataModelsSeen) }),
  setDataModelChain: (chain) => set({ dataModelChain: chain }),

  // Reset
  resetBrowsingState: () => set({
    activeSolution: null,
    solutionPath: [],
    components: [],
    selected: new Map(),
    rootDataModelByPath: new Map(),
    allDataModelsSeen: new Map(),
    dataModelChain: [],
    solutionFilter: '',
  }),
  resetAll: () => set({
    activeProfileId: null,
    connState: { kind: 'disconnected' },
    solutions: [],
    loadingSolutions: false,
    solutionFilter: '',
    activeSolution: null,
    solutionPath: [],
    components: [],
    loadingComponents: false,
    componentTypeFilter: 'All',
    selected: new Map(),
    rootDataModelByPath: new Map(),
    allDataModelsSeen: new Map(),
    dataModelChain: [],
  }),
}));
