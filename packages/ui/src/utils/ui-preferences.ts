import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * View choices the user makes and expects back after a reload — which side
 * panels are open, how the explorer lists the configurations, the options of
 * the preview, search and where-used. One localStorage key per choice, under
 * `er-visualizer.ui.`. Only how things are shown belongs here: a typed filter
 * or a picked category narrows the task at hand and starts fresh.
 *
 * A convenience, so storage that is blocked, full or holds another build's
 * value falls back to the default quietly. The panel widths are kept by
 * react-resizable-panels itself (`autoSaveId`), the designer split by
 * `split-ratio.ts`, the explorer sections by `explorer-sections.ts`.
 */

const PREFIX = 'er-visualizer.ui.';

/** Turns whatever is stored into a valid value, or `undefined` to use the default. */
export type PreferenceParser<T> = (value: unknown) => T | undefined;

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Some browsers throw on the mere access when site data is blocked.
    return undefined;
  }
}

export function readPreference<T>(name: string, fallback: T, parse: PreferenceParser<T>): T {
  try {
    const raw = storage()?.getItem(PREFIX + name);
    if (raw == null) return fallback;
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(name: string, value: unknown): void {
  try {
    storage()?.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the choice lasts for this session only.
  }
}

export const parseBoolean: PreferenceParser<boolean> = value =>
  typeof value === 'boolean' ? value : undefined;

/** A parser accepting only the listed values. */
export function oneOf<T extends string>(values: readonly T[]): PreferenceParser<T> {
  return value => (values as readonly unknown[]).includes(value) ? value as T : undefined;
}

/**
 * `useState` whose value outlives the page. Only a value the user set is
 * written: the default stays unstored, so changing it in a later build
 * reaches everyone who never picked one.
 */
export function usePreference<T>(name: string, fallback: T, parse: PreferenceParser<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readPreference(name, fallback, parse));
  const chosen = useRef(false);
  useEffect(() => {
    if (chosen.current) writePreference(name, value);
  }, [name, value]);
  const set = useCallback<Dispatch<SetStateAction<T>>>(next => {
    chosen.current = true;
    setValue(next);
  }, []);
  return [value, set];
}

// ────────────────────────── Side panels ──────────────────────────

export type SidePanelTab = 'properties' | 'search' | 'where-used';

/** Which side panels are open, and which tab the right one shows. */
export interface PanelVisibility {
  explorer: boolean;
  side: boolean;
  sideTab: SidePanelTab;
}

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = { explorer: true, side: false, sideTab: 'properties' };

const PANELS_KEY = 'panels';
const parseSideTab = oneOf<SidePanelTab>(['properties', 'search', 'where-used']);

/** A stored visibility made whole: each field of the wrong type takes its default. */
export function sanitizePanelVisibility(value: unknown): PanelVisibility {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof PanelVisibility, unknown>>;
  return {
    explorer: parseBoolean(raw.explorer) ?? DEFAULT_PANEL_VISIBILITY.explorer,
    side: parseBoolean(raw.side) ?? DEFAULT_PANEL_VISIBILITY.side,
    sideTab: parseSideTab(raw.sideTab) ?? DEFAULT_PANEL_VISIBILITY.sideTab,
  };
}

export function loadPanelVisibility(): PanelVisibility {
  return readPreference(PANELS_KEY, DEFAULT_PANEL_VISIBILITY, sanitizePanelVisibility);
}

export function savePanelVisibility(visibility: PanelVisibility): void {
  writePreference(PANELS_KEY, visibility);
}

/**
 * The `autoSaveId` of a resizable panel group. A tablet gives the side panels
 * a bigger share than a desktop monitor, so each layout keeps its own sizes.
 */
export function panelGroupSaveId(group: 'shell' | 'work', compact: boolean): string {
  return `er-visualizer.${group}.${compact ? 'compact' : 'wide'}`;
}
