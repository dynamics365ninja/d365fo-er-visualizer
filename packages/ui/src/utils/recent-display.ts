import type { RecentFile, RecentSession } from '../state/persistence';

/**
 * How a recent configuration is shown: by the name the workspace gives it
 * (the explorer shows `ERSolution.Name`), not by its file name — which for an
 * F&O download is a synthetic `fno://host/solution/config@version.xml` key
 * nobody recognises.
 */
export interface RecentDisplay {
  /** The configuration's name, as in the explorer. */
  title: string;
  version?: string;
  kind?: RecentFile['kind'];
  source: 'file' | 'fno';
  /**
   * Where it came from, when that adds something to the title: the F&O
   * environment's host, the file name if it is not just the title again, or
   * the bundle it was extracted from.
   */
  origin?: string;
  /** Extracted from a file that bundles several configurations. */
  bundled: boolean;
}

const XML_SUFFIX = /\.xml$/i;

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** `fno://host/solution/config@1.2.xml` → its parts; `null` for anything else. */
export function parseFnoPath(path: string): { host: string; solution: string; configuration: string; version?: string } | null {
  const match = /^fno:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:@([^/]+?))?\.xml(?:#.*)?$/i.exec(path);
  if (!match) return null;
  const readable = (segment: string) => {
    let text = segment.replace(/~[0-9a-z]+$/i, '');
    try { text = decodeURIComponent(text); } catch { /* keep as is */ }
    return text.replace(/-+/g, ' ').trim();
  };
  return { host: match[1], solution: readable(match[2]), configuration: readable(match[3]), version: match[4] };
}

/** Case- and punctuation-blind comparison, so `VAT_statement.xml` counts as the title "VAT statement". */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(XML_SUFFIX, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return norm(a) === norm(b);
}

/**
 * Describe `entry`, filling what an older entry (a session saved before it
 * kept names) lacks from the matching recent-files entry.
 */
export function describeRecent(entry: RecentFile, recentFiles: readonly RecentFile[] = []): RecentDisplay {
  const known = entry.solutionName ? entry : recentFiles.find(file => file.path === entry.path) ?? entry;
  const fno = parseFnoPath(entry.path);
  const source: RecentDisplay['source'] = known.source ?? entry.source ?? (fno ? 'fno' : 'file');
  const fileName = fileNameOf(entry.path).replace(/#.*$/, '');
  const title = known.solutionName
    || fno?.configuration
    || (entry.name || fileName).replace(/#.*$/, '').replace(XML_SUFFIX, '');
  const bundlePath = known.bundlePath ?? entry.bundlePath ?? (entry.path.includes('#') ? entry.path.replace(/#.*$/, '') : undefined);

  let origin: string | undefined;
  if (source === 'fno') {
    origin = fno?.host;
  } else if (bundlePath) {
    origin = fileNameOf(bundlePath);
  } else if (!sameName(fileName, title)) {
    origin = fileName;
  }

  return {
    title,
    version: known.version ?? entry.version ?? fno?.version,
    kind: known.kind ?? entry.kind,
    source,
    origin,
    bundled: Boolean(bundlePath),
  };
}

const KIND_ORDER: Record<string, number> = { Format: 0, ModelMapping: 1, DataModel: 2 };

/**
 * What a session is about: its formats first (what the user was working on),
 * then mappings, then models. The first one names the session.
 */
export function sessionHeadline(session: RecentSession, recentFiles: readonly RecentFile[] = []): {
  title: string;
  others: number;
  entries: Array<{ file: RecentFile; display: RecentDisplay }>;
  sources: Array<{ source: 'file' | 'fno'; origin?: string }>;
} {
  const entries = session.files
    .map(file => ({ file, display: describeRecent(file, recentFiles) }))
    .sort((a, b) => (KIND_ORDER[a.display.kind ?? ''] ?? 3) - (KIND_ORDER[b.display.kind ?? ''] ?? 3)
      || a.display.title.localeCompare(b.display.title));
  const sources = new Map<string, { source: 'file' | 'fno'; origin?: string }>();
  for (const { display } of entries) {
    const key = display.source === 'fno' ? `fno:${display.origin ?? ''}` : 'file';
    if (!sources.has(key)) sources.set(key, { source: display.source, origin: display.source === 'fno' ? display.origin : undefined });
  }
  return {
    title: entries[0]?.display.title ?? '',
    others: Math.max(0, entries.length - 1),
    entries,
    sources: Array.from(sources.values()),
  };
}

/** "5 minutes ago", "yesterday" — in the UI language. */
export function formatRelativeTime(timestamp: number, locale: string, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Number.POSITIVE_INFINITY],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      if (unit === 'second') value = 0;
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(value), unit === 'second' ? 'minute' : unit);
    }
    value /= size;
  }
  return '';
}
