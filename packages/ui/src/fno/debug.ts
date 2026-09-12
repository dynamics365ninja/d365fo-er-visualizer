/**
 * Opt-in recorder for diagnosing what the F&O connector actually asked for
 * and what came back.
 *
 * Turn it on in the browser console and reload:
 *
 *   localStorage.setItem('er_debug_fno', '1'); // everything
 *   localStorage.setItem('er_debug_fno', 'sales invoice'); // only matching names
 *
 * Every listing, every download request that succeeded (operation + the ids it
 * was given) and the resolved download plan are collected in memory; the
 * connector prints the whole batch as one JSON blob when an ingest finishes,
 * so it can be copied out in a single go. Off by default and free when off:
 * the recorder is only consulted behind `fnoDebugEnabled()`.
 *
 * The dump carries configuration names, solution names and GUIDs from the
 * environment it ran against — it is meant to be read by whoever is debugging,
 * not shipped anywhere automatically.
 */

const STORAGE_KEY = 'er_debug_fno';

interface DebugEntry {
  at: number;
  event: string;
  data: unknown;
}

let entries: DebugEntry[] = [];

/** Raw switch value: '' when off, '1' for everything, otherwise a name filter. */
function debugSetting(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function fnoDebugEnabled(): boolean {
  return debugSetting().length > 0;
}

/**
 * True when `name` should be recorded: everything passes while the switch is
 * '1'/'true', otherwise the switch is a case-insensitive substring filter so a
 * single configuration can be followed through a large environment.
 */
export function fnoDebugMatches(name: string | undefined): boolean {
  const setting = debugSetting();
  if (!setting) return false;
  if (setting === '1' || setting.toLowerCase() === 'true') return true;
  return (name ?? '').toLowerCase().includes(setting.toLowerCase());
}

/** Append one entry. Cheap no-op while the switch is off. */
export function recordFnoDebug(event: string, data: unknown): void {
  if (!fnoDebugEnabled()) return;
  entries.push({ at: Date.now(), event, data });
  // A runaway session must not eat memory: keep the most recent slice.
  if (entries.length > 500) entries = entries.slice(-500);
}

/** Print everything recorded so far as one copyable JSON blob, then reset. */
export function dumpFnoDebug(label: string): void {
  if (!fnoDebugEnabled() || entries.length === 0) return;
  const payload = entries;
  entries = [];
  // eslint-disable-next-line no-console
  console.log(
    `[er-fno-debug] ${label} — ${payload.length} entries (copy the JSON below)\n` +
      JSON.stringify(payload, jsonSafe, 2),
  );
}

/**
 * Console handle, installed on every start — `window.__erFnoDebug`.
 *
 * Installed even while recording is off, on purpose: typing `__erFnoDebug` in
 * the console then answers the first question of any "I see no output" report.
 * `undefined` means the running build predates the recorder (or is being
 * served from somewhere else); an object means the build has it and the switch
 * is simply off. Turning it on from here also writes the flag to the origin
 * the app actually runs on, which a hand-typed `localStorage.setItem` in the
 * wrong tab does not.
 */
export interface FnoDebugHandle {
  /** Whether entries are being recorded right now. */
  readonly enabled: boolean;
  /** Current switch value: '1', a name filter, or '' when off. */
  readonly filter: string;
  /** Turn recording on (optionally for names containing `filter`). */
  enable(filter?: string): string;
  disable(): string;
  /** Everything recorded so far, without consuming it. */
  entries(): unknown[];
  /** Print and consume what has been recorded. */
  dump(label?: string): void;
  clear(): void;
}

export function installFnoDebugHandle(): void {
  if (typeof window === 'undefined') return;
  const handle: FnoDebugHandle = {
    get enabled() {
      return fnoDebugEnabled();
    },
    get filter() {
      return debugSetting();
    },
    enable(filter?: string) {
      const value = filter && filter.trim() ? filter.trim() : '1';
      try {
        window.localStorage.setItem(STORAGE_KEY, value);
      } catch {
        return 'could not write localStorage (private mode?)';
      }
      return `[er-fno-debug] recording ${value === '1' ? 'everything' : `names containing "${value}"`}. ` +
        'Reproduce the problem; the JSON blob prints when the download finishes.';
    },
    disable() {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // nothing to do — the switch simply stays as it was
      }
      entries = [];
      return '[er-fno-debug] recording off';
    },
    entries: () => entries.slice(),
    dump: (label = 'on demand') => dumpFnoDebug(label),
    clear: () => {
      entries = [];
    },
  };
  Object.defineProperty(window, '__erFnoDebug', { value: handle, configurable: true });
  if (fnoDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log(
      `[er-fno-debug] recording is on (${debugSetting()}). ` +
        'The JSON blob prints when a download finishes — or call __erFnoDebug.dump().',
    );
  }
}

/** Maps / Sets would serialise as `{}`; unfold them instead. */
function jsonSafe(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return Array.from(value);
  return value;
}

/** The fields of a listing row that decide how it is downloaded. */
export function describeSummary(c: {
  solutionName?: string;
  configurationName?: string;
  componentType?: string;
  version?: string;
  configurationGuid?: string;
  revisionGuid?: string;
  guidCandidates?: string[];
  parentDataModelGuid?: string;
  referencedModelGuid?: string;
  ownerDataModelName?: string;
  parentConfigName?: string;
  derivationDepth?: number;
  hasChildren?: boolean;
  versionNumbers?: number[];
}): Record<string, unknown> {
  return {
    name: c.configurationName,
    solution: c.solutionName,
    type: c.componentType,
    version: c.version,
    cfgGuid: c.configurationGuid,
    revGuid: c.revisionGuid,
    candidates: c.guidCandidates,
    parentDmGuid: c.parentDataModelGuid,
    referencedModelGuid: c.referencedModelGuid,
    owner: c.ownerDataModelName,
    parentConfig: c.parentConfigName,
    depth: c.derivationDepth,
    hasChildren: c.hasChildren,
    versions: c.versionNumbers,
  };
}
