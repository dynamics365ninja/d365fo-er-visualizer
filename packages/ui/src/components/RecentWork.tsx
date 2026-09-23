import { useMemo, useState } from 'react';
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner } from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  CloudRegular,
  DeleteRegular,
  DismissRegular,
  DesktopRegular,
  MoreHorizontalRegular,
  OpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import type { RecentFile, RecentSession } from '../state/persistence';
import { t, useLocale } from '../i18n';
import { describeRecent, formatRelativeTime, sessionHeadline, type RecentDisplay } from '../utils/recent-display';
import { DependencyKindIcon, dependencyKindLabel } from './DependencyPromptDialog';
import { FilterField } from './FilterField';

const SESSIONS_SHOWN = 4;
const CONFIGS_SHOWN = 8;
/** Below this many entries a filter is more in the way than it helps. */
const FILTER_FROM = 7;

const kindClass: Record<string, string> = { DataModel: 'model', ModelMapping: 'mapping', Format: 'format' };

/** Where a configuration came from, as one short phrase. */
function sourceLabel(display: Pick<RecentDisplay, 'source' | 'origin' | 'bundled'>): string {
  if (display.source === 'fno') return display.origin ? t.recentSourceFnoHost(display.origin) : t.recentSourceFno;
  if (display.bundled && display.origin) return t.recentBundledFrom(display.origin);
  return display.origin ? t.recentSourceFileNamed(display.origin) : t.recentSourceFile;
}

function SourceIcon({ source }: { source: 'file' | 'fno' }) {
  return source === 'fno'
    ? <CloudRegular fontSize={13} aria-hidden />
    : <DesktopRegular fontSize={13} aria-hidden />;
}

/**
 * The landing page's recent work: sessions (the sets of configurations that
 * were open together) and the configurations one by one. Both name a
 * configuration the way the workspace does — its name and version, where it
 * came from — rather than by file name or a synthetic F&O key.
 */
export function RecentWork({ onFilesLoaded }: { onFilesLoaded: () => void }) {
  const recentSessions = useAppStore(s => s.recentSessions);
  const recentFiles = useAppStore(s => s.recentFiles);
  if (recentSessions.length === 0 && recentFiles.length === 0) return null;
  return (
    <div className="recent-work">
      {recentSessions.length > 0 && <RecentSessions sessions={recentSessions} recentFiles={recentFiles} onFilesLoaded={onFilesLoaded} />}
      {recentFiles.length > 0 && <RecentConfigurations files={recentFiles} onFilesLoaded={onFilesLoaded} />}
    </div>
  );
}

function RecentSessions({ sessions, recentFiles, onFilesLoaded }: {
  sessions: RecentSession[];
  recentFiles: RecentFile[];
  onFilesLoaded: () => void;
}) {
  const clearRecentSessions = useAppStore(s => s.clearRecentSessions);
  const [showAll, setShowAll] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const shown = showAll ? sessions : sessions.slice(0, SESSIONS_SHOWN);
  return (
    <section className="recent-section" aria-labelledby="recent-sessions-title">
      <header className="recent-section__head">
        <h2 id="recent-sessions-title" className="recent-section__title">{t.recentSessions}</h2>
        <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={clearRecentSessions}>{t.clearRecent}</Button>
      </header>
      <ul className="recent-sessions">
        {shown.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            recentFiles={recentFiles}
            loadingId={loadingId}
            setLoadingId={setLoadingId}
            onFilesLoaded={onFilesLoaded}
          />
        ))}
      </ul>
      {sessions.length > SESSIONS_SHOWN && (
        <button type="button" className="recent-section__more" onClick={() => setShowAll(v => !v)}>
          {showAll ? t.recentShowLess : t.recentShowAll(sessions.length)}
        </button>
      )}
    </section>
  );
}

function SessionCard({ session, recentFiles, loadingId, setLoadingId, onFilesLoaded }: {
  session: RecentSession;
  recentFiles: RecentFile[];
  loadingId: string | null;
  setLoadingId: (id: string | null) => void;
  onFilesLoaded: () => void;
}) {
  const locale = useLocale();
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const loadRecentSession = useAppStore(s => s.loadRecentSession);
  const loadCachedFile = useAppStore(s => s.loadCachedFile);
  const removeRecentSession = useAppStore(s => s.removeRecentSession);
  const pushToast = useAppStore(s => s.pushToast);
  // With nothing open, adding a session and replacing the workspace with it
  // are the same thing — "Replace" is only offered when there is something
  // to replace.
  const workspaceOpen = useAppStore(s => s.configurations.length > 0);

  const headline = useMemo(() => sessionHeadline(session, recentFiles), [session, recentFiles]);
  const available = session.files.some(f => cachedPaths.has(f.path));
  const busy = loadingId === session.id;

  const load = (replace: boolean) => {
    if (!available || loadingId) return;
    setLoadingId(session.id);
    loadRecentSession(session.id, { replace })
      .then(ok => { if (ok) onFilesLoaded(); })
      .catch(error => pushToast({
        kind: 'error',
        message: t.recentSessionLoadFailed(error instanceof Error ? error.message : String(error)),
      }))
      .finally(() => setLoadingId(null));
  };

  return (
    <li className={`recent-session${available ? '' : ' recent-session--unavailable'}`}>
      <div className="recent-session__head">
        <div className="recent-session__titles">
          <span className="recent-session__title" title={headline.title}>{headline.title}</span>
          <span className="recent-session__meta">
            <span>{formatRelativeTime(session.openedAt, locale)}</span>
            <span>{t.recentSessionCount(headline.entries.length)}</span>
            {headline.sources.map(src => (
              <span key={`${src.source}:${src.origin ?? ''}`} className="recent-source">
                <SourceIcon source={src.source} />
                {src.source === 'fno' ? (src.origin ? t.recentSourceFnoHost(src.origin) : t.recentSourceFno) : t.recentSourceFiles}
              </span>
            ))}
          </span>
        </div>
        <div className="recent-session__actions">
          {available && (
            <Button
              appearance="primary"
              size="small"
              icon={busy ? <Spinner size="extra-tiny" /> : <OpenRegular />}
              disabled={Boolean(loadingId)}
              title={workspaceOpen ? t.recentSessionMergeHint : undefined}
              onClick={() => load(false)}
            >
              {workspaceOpen ? t.recentAddToOpen : t.recentOpen}
            </Button>
          )}
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} aria-label={t.recentMoreActions} title={t.recentMoreActions} />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {available && workspaceOpen && (
                  <MenuItem icon={<ArrowSyncRegular />} disabled={Boolean(loadingId)} onClick={() => load(true)}>
                    {t.recentSessionReplaceHint}
                  </MenuItem>
                )}
                <MenuItem icon={<DismissRegular />} onClick={() => removeRecentSession(session.id)}>
                  {t.removeFromHistory}
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>
      <ul className="recent-session__configs" aria-label={t.recentSessionContents(headline.entries.length)}>
        {headline.entries.map(({ file, display }) => {
          const cached = cachedPaths.has(file.path);
          return (
            <li key={file.path}>
              <button
                type="button"
                className={`recent-config-chip recent-kind--${kindClass[display.kind ?? ''] ?? 'format'}`}
                disabled={!cached}
                title={cached
                  ? `${t.recentOpenConfigHint} — ${sourceLabel(display)}`
                  : t.recentNotCachedHint}
                onClick={() => {
                  void loadCachedFile(file.path, display.title).then(ok => { if (ok) onFilesLoaded(); });
                }}
              >
                <span className="recent-config-chip__icon"><DependencyKindIcon kind={display.kind} /></span>
                <span className="recent-config-chip__name">{display.title}</span>
                {display.version && <span className="recent-version">v{display.version}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {!available && <p className="recent-session__note">{t.recentSessionUnavailable}</p>}
    </li>
  );
}

function RecentConfigurations({ files, onFilesLoaded }: { files: RecentFile[]; onFilesLoaded: () => void }) {
  const locale = useLocale();
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const reloadRecentFile = useAppStore(s => s.reloadRecentFile);
  const removeRecentFile = useAppStore(s => s.removeRecentFile);
  const clearRecentFiles = useAppStore(s => s.clearRecentFiles);
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const described = useMemo(() => files.map(file => ({ file, display: describeRecent(file) })), [files]);
  const query = filter.trim().toLowerCase();
  const matching = query
    ? described.filter(({ display }) =>
      [display.title, display.version, display.origin, dependencyKindLabel(display.kind)]
        .some(part => part?.toLowerCase().includes(query)))
    : described;
  const shown = showAll || query ? matching : matching.slice(0, CONFIGS_SHOWN);

  return (
    <section className="recent-section" aria-labelledby="recent-configs-title">
      <header className="recent-section__head">
        <h2 id="recent-configs-title" className="recent-section__title">{t.recentConfigs}</h2>
        <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={clearRecentFiles}>{t.clearRecent}</Button>
      </header>
      {files.length >= FILTER_FROM && (
        <FilterField value={filter} onChange={setFilter} placeholder={t.recentFilterPlaceholder} ariaLabel={t.recentFilterPlaceholder} />
      )}
      {shown.length === 0 ? (
        <p className="recent-section__hint">{t.noResults}</p>
      ) : (
        <ul className="recent-configs">
          {shown.map(({ file, display }) => {
            const cached = cachedPaths.has(file.path);
            return (
              <li key={file.path} className={`recent-config${cached ? '' : ' recent-config--unavailable'}`}>
                <button
                  type="button"
                  className="recent-config__open"
                  disabled={!cached}
                  title={cached ? t.recentOpenConfigHint : t.recentNotCachedHint}
                  onClick={() => { void reloadRecentFile(file.path).then(ok => { if (ok) onFilesLoaded(); }); }}
                >
                  <span className={`recent-config__icon recent-kind--${kindClass[display.kind ?? ''] ?? 'format'}`}>
                    <DependencyKindIcon kind={display.kind} />
                  </span>
                  <span className="recent-config__body">
                    <span className="recent-config__title">
                      <span className="recent-config__name">{display.title}</span>
                      {display.version && <span className="recent-version">v{display.version}</span>}
                    </span>
                    <span className="recent-config__meta">
                      <span>{dependencyKindLabel(display.kind)}</span>
                      <span className="recent-source"><SourceIcon source={display.source} />{sourceLabel(display)}</span>
                      <span>{cached ? formatRelativeTime(file.openedAt, locale) : t.recentNotCached}</span>
                    </span>
                  </span>
                </button>
                <Button
                  className="recent-config__remove"
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={`${t.removeFromHistory}: ${display.title}`}
                  title={t.removeFromHistory}
                  onClick={() => removeRecentFile(file.path)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!query && matching.length > CONFIGS_SHOWN && (
        <button type="button" className="recent-section__more" onClick={() => setShowAll(v => !v)}>
          {showAll ? t.recentShowLess : t.recentShowAll(matching.length)}
        </button>
      )}
    </section>
  );
}
