import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  MessageBarActions,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CloudRegular,
  DataBarVerticalRegular,
  DismissRegular,
  DocumentRegular,
  FolderOpenRegular,
  LinkRegular,
  OpenRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { FnoIngestPanel } from './FnoIngestPanel';
import { useAppStore } from '../state/store';
import { ThemeSwitch } from './ThemeSwitch';
import { setLocale, t, useLocale } from '../i18n';
import { FnoConnectPanel } from './FnoConnectPanel';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

/**
 * Workspace entry point.
 *
 * Deliberately *not* a marketing page: what the product is, which ER component
 * types exist and how the workflow goes are covered by the public site
 * (`/`, `/features`, `/docs/*`). This screen only does the three things you
 * cannot do anywhere else — open files, connect to F&O, reopen recent work —
 * and links to the site for everything else.
 */

// ────────────────────────── styles ──────────────────────────

const useStyles = makeStyles({
  root: {
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--er-bg)',
    color: 'var(--er-text)',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 20px',
    height: '60px',
    flexShrink: 0,
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-surface)',
  },
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: 'var(--er-font-display)',
    fontSize: '15px',
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  topbarActions: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  docsLink: {
    color: 'var(--er-text-muted)',
    fontSize: tokens.fontSizeBase200,
    fontWeight: 500,
    textDecorationLine: 'none',
    padding: '6px 8px',
    borderRadius: 'var(--er-radius-md)',
    ':hover': {
      color: 'var(--er-accent)',
      backgroundColor: 'var(--er-surface-2)',
    },
  },
  langSwitch: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    padding: '2px',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'var(--er-surface-2)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
  },
  langButton: {
    minWidth: '32px',
    height: '24px',
    fontSize: '11px',
    fontWeight: 600,
  },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: '1080px',
    margin: '0 auto',
    padding: '56px 20px 72px',
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
    '@media (max-width: 600px)': {
      padding: '32px 16px 48px',
    },
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    alignSelf: 'flex-start',
    padding: '5px 12px',
    borderRadius: 'var(--er-radius-pill)',
    backgroundColor: 'var(--er-surface)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    color: 'var(--er-text-muted)',
    fontSize: '12px',
    fontWeight: 500,
  },
  badgeDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--er-accent)',
  },
  title: {
    margin: 0,
    fontFamily: 'var(--er-font-display)',
    fontSize: 'clamp(30px, 4vw, 44px)',
    lineHeight: 1.1,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    maxWidth: '18ch',
  },
  lead: {
    margin: 0,
    maxWidth: '62ch',
    color: 'var(--er-text-muted)',
    fontSize: '15px',
    lineHeight: 1.6,
  },
  // ── workspace card ──
  card: {
    borderRadius: 'var(--er-radius-xl)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    backgroundColor: 'var(--er-surface)',
    overflow: 'hidden',
  },
  cardTabs: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '8px',
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-surface-2)',
  },
  cardTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: '32px',
    padding: '0 14px',
    borderRadius: 'var(--er-radius-md)',
    ...shorthands.border('1px', 'solid', 'transparent'),
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontFamily: tokens.fontFamilyBase,
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    ':hover': { color: 'var(--er-text)', backgroundColor: 'var(--er-surface)' },
  },
  cardTabActive: {
    backgroundColor: 'var(--er-surface)',
    ...shorthands.borderColor('var(--er-border)'),
    color: 'var(--er-text)',
    fontWeight: 600,
    boxShadow: 'var(--er-shadow-1)',
  },
  cardBody: {
    padding: '20px',
  },
  // ── drop zone ──
  dropzone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    minHeight: '208px',
    padding: '28px',
    borderRadius: 'var(--er-radius-lg)',
    ...shorthands.border('1px', 'dashed', 'var(--er-border-strong)'),
    backgroundColor: 'var(--er-bg-soft)',
    cursor: 'pointer',
    textAlign: 'center',
    transitionProperty: 'border-color, background-color',
    transitionDuration: 'var(--er-duration)',
    ':hover': {
      ...shorthands.borderColor('var(--er-accent)'),
      backgroundColor: 'var(--er-accent-soft)',
    },
    ':focus-visible': {
      ...shorthands.outline('2px', 'solid', 'var(--er-accent)'),
      outlineOffset: '2px',
    },
  },
  dropzoneDragging: {
    ...shorthands.border('1px', 'solid', 'var(--er-accent)'),
    backgroundColor: 'var(--er-accent-soft)',
  },
  dropIcon: {
    color: 'var(--er-accent)',
    display: 'inline-flex',
  },
  dropTitle: {
    margin: 0,
    fontFamily: 'var(--er-font-display)',
    fontSize: '17px',
    fontWeight: 700,
  },
  dropHint: {
    margin: 0,
    color: 'var(--er-text-muted)',
    fontSize: '13px',
  },
  kinds: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '6px',
    marginTop: '6px',
  },
  kindPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: 'var(--er-radius-pill)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    backgroundColor: 'var(--er-surface)',
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--er-text-muted)',
  },
  kindModel: { color: 'var(--er-model)' },
  kindMapping: { color: 'var(--er-mapping)' },
  kindFormat: { color: 'var(--er-format)' },
  // ── recents ──
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
    gap: '20px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  eyebrow: {
    fontSize: '10.5px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
    color: 'var(--er-text-muted)',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--er-radius-lg)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    backgroundColor: 'var(--er-surface)',
    transitionProperty: 'border-color, background-color',
    transitionDuration: 'var(--er-duration)',
    ':hover': {
      ...shorthands.borderColor('var(--er-accent-border)'),
      backgroundColor: 'var(--er-surface-2)',
    },
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: '13px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: {
    fontSize: '11px',
    color: 'var(--er-text-muted)',
    fontFamily: 'var(--er-font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sessionFiles: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    marginTop: '6px',
    fontSize: '11.5px',
    color: 'var(--er-text-muted)',
  },
  sessionFileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  sessionFileButton: {
    ...shorthands.border('1px', 'solid', 'transparent'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('2px', '6px'),
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
    color: 'var(--er-text-secondary)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'var(--er-surface-2)',
      ...shorthands.borderColor('var(--er-accent-border)'),
      color: 'var(--er-text-primary)',
    },
    ':disabled': {
      cursor: 'default',
      opacity: 0.6,
      backgroundColor: 'transparent',
      ...shorthands.borderColor('transparent'),
    },
  },
  footer: {
    borderTop: '1px solid var(--er-border)',
    padding: '18px 20px',
    textAlign: 'center',
    color: 'var(--er-text-subtle)',
    fontSize: '12px',
  },
  // ── F&O ingest overlay ──
  ingestOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'color-mix(in srgb, var(--er-bg) 78%, transparent)',
    backdropFilter: 'blur(4px)',
  },
  ingestCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '24px',
    width: '380px',
    maxWidth: 'calc(100vw - 32px)',
    borderRadius: 'var(--er-radius-xl)',
    ...shorthands.border('1px', 'solid', 'var(--er-border)'),
    backgroundColor: 'var(--er-surface)',
    boxShadow: 'var(--er-shadow-3)',
  },
  ingestHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  ingestIcon: {
    width: '40px',
    height: '40px',
    flexShrink: 0,
    borderRadius: 'var(--er-radius-lg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--er-accent-soft)',
    color: 'var(--er-accent)',
  },
  ingestTitle: {
    fontFamily: 'var(--er-font-display)',
    fontSize: '15px',
    fontWeight: 700,
  },
  ingestSub: {
    fontSize: '12px',
    color: 'var(--er-text-muted)',
  },
  ingestSteps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '9px',
  },
});

interface LandingPageProps {
  onFilesLoaded: () => void;
}

function ErVisualizerMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" rx="14" fill="var(--er-accent)" />
      <path d="M23 16h14l8 8v23a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3V19a3 3 0 0 1 3-3Z" fill="var(--er-accent-contrast)" opacity="0.94" />
      <path d="M37 16v8h8" stroke="var(--er-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 38h8.5l6-6" stroke="var(--er-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 38l6 6h8.5" stroke="var(--er-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="38" r="3.4" fill="var(--er-accent)" />
      <circle cx="43" cy="32" r="3" fill="var(--er-accent)" />
      <circle cx="43" cy="44" r="3" fill="var(--er-accent)" />
    </svg>
  );
}

/** Documentation lives on the marketing site; fall back to the repo in dev. */
function docsHref(): string {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app')) {
    return '/docs/getting-started';
  }
  return 'https://github.com/dynamics365ninja/d365fo-er-visualizer#readme';
}

// ────────────────────────── component ──────────────────────────

export function LandingPage({ onFilesLoaded }: LandingPageProps) {
  const styles = useStyles();
  const currentLocale = useLocale();
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const configs = useAppStore(s => s.configurations);
  const recentFiles = useAppStore(s => s.recentFiles);
  const removeRecentFile = useAppStore(s => s.removeRecentFile);
  const clearRecentFiles = useAppStore(s => s.clearRecentFiles);
  const reloadRecentFile = useAppStore(s => s.reloadRecentFile);
  const recentSessions = useAppStore(s => s.recentSessions);
  const removeRecentSession = useAppStore(s => s.removeRecentSession);
  const clearRecentSessions = useAppStore(s => s.clearRecentSessions);
  const loadRecentSession = useAppStore(s => s.loadRecentSession);
  const loadCachedFile = useAppStore(s => s.loadCachedFile);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceTab, setSourceTab] = useState<'local' | 'remote'>('local');
  const landingRequest = useAppStore(s => s.landingRequest);
  useEffect(() => {
    if (landingRequest) setSourceTab(landingRequest.tab);
  }, [landingRequest]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | null) => {
    setLoading(true);
    const { loaded, errors: newErrors } = await loadBrowserFiles(files, loadXmlFile);
    setLoading(false);
    if (newErrors.length > 0) setErrors(prev => [...prev, ...newErrors]);
    if (loaded > 0) onFilesLoaded();
  }, [loadXmlFile, onFilesLoaded]);

  const handleOpenFiles = useCallback(async () => {
    setLoading(true);
    const result = await openFilesWithSystemDialog(loadXmlFile);
    if (result == null) {
      setLoading(false);
      fileInputRef.current?.click();
      return;
    }
    setLoading(false);
    if (result.errors.length > 0) setErrors(prev => [...prev, ...result.errors]);
    if (result.loaded > 0) onFilesLoaded();
  }, [loadXmlFile, onFilesLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div
      className={styles.root}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {fnoIngestStatus && <FnoIngestPanel variant="overlay" />}

      <header className={styles.topbar}>
        <span className={styles.brand}>
          <ErVisualizerMark />
          {t.appName}
        </span>
        <div className={styles.topbarActions}>
          <a className={styles.docsLink} href={docsHref()} target="_blank" rel="noreferrer noopener">
            {t.landingDocsLink}
          </a>
          <div className={styles.langSwitch} aria-label={t.language} role="group">
            <Button
              appearance={currentLocale === 'cs' ? 'primary' : 'subtle'}
              size="small"
              className={styles.langButton}
              onClick={() => setLocale('cs')}
              aria-pressed={currentLocale === 'cs'}
              title={t.languageCzech}
            >
              CZ
            </Button>
            <Button
              appearance={currentLocale === 'en' ? 'primary' : 'subtle'}
              size="small"
              className={styles.langButton}
              onClick={() => setLocale('en')}
              aria-pressed={currentLocale === 'en'}
              title={t.languageEnglish}
            >
              EN
            </Button>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <main className={styles.main}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          {t.landingBadge}
        </span>
        <h1 className={styles.title}>{t.landingTitle}</h1>
        <p className={styles.lead}>{t.landingSub}</p>

        <section className={styles.card}>
          <div className={styles.cardTabs} role="tablist" aria-label={t.landingSourceLabel}>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'local'}
              className={mergeClasses(styles.cardTab, sourceTab === 'local' && styles.cardTabActive)}
              onClick={() => setSourceTab('local')}
            >
              <FolderOpenRegular fontSize={16} />
              {t.fnoTabLocal}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'remote'}
              className={mergeClasses(styles.cardTab, sourceTab === 'remote' && styles.cardTabActive)}
              onClick={() => setSourceTab('remote')}
            >
              <CloudRegular fontSize={16} />
              {t.fnoTabRemote}
            </button>
          </div>

          <div className={styles.cardBody}>
            {sourceTab === 'local' ? (
              <div
                className={mergeClasses(styles.dropzone, isDragging && styles.dropzoneDragging)}
                onClick={handleOpenFiles}
                onKeyDown={e => e.key === 'Enter' && handleOpenFiles()}
                role="button"
                tabIndex={0}
                aria-label={t.landingDropAriaLabel}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".xml"
                  style={{ display: 'none' }}
                  onChange={e => { processFiles(e.target.files); e.target.value = ''; }}
                />
                {loading ? (
                  <Spinner size="medium" label={t.landingLoading} labelPosition="below" />
                ) : (
                  <>
                    <span className={styles.dropIcon} aria-hidden="true">
                      {isDragging ? <ArrowDownloadRegular fontSize={30} /> : <FolderOpenRegular fontSize={30} />}
                    </span>
                    <h2 className={styles.dropTitle}>
                      {isDragging ? t.landingDropRelease : t.landingDropPrimary}
                    </h2>
                    <p className={styles.dropHint}>{t.landingDropSecondary}</p>
                    <div className={styles.kinds}>
                      <span className={styles.kindPill}>
                        <DataBarVerticalRegular fontSize={13} className={styles.kindModel} />
                        {t.landingPillModel}
                      </span>
                      <span className={styles.kindPill}>
                        <LinkRegular fontSize={13} className={styles.kindMapping} />
                        {t.landingPillMapping}
                      </span>
                      <span className={styles.kindPill}>
                        <DocumentRegular fontSize={13} className={styles.kindFormat} />
                        {t.landingPillFormat}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <FnoConnectPanel onFilesLoaded={onFilesLoaded} />
            )}
          </div>
        </section>

        {errors.map((e, i) => (
          <MessageBar key={i} intent="error" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>{t.landingErrors}</MessageBarTitle>
              {e}
            </MessageBarBody>
            <MessageBarActions
              containerAction={
                <Button
                  appearance="transparent"
                  aria-label={t.landingDismiss}
                  icon={<DismissRegular />}
                  size="small"
                  onClick={() => setErrors(prev => prev.filter((_, idx) => idx !== i))}
                />
              }
            />
          </MessageBar>
        ))}

        {/* Hidden during an F&O ingest so nobody jumps into a half-loaded workspace. */}
        {configs.length > 0 && !fnoIngestStatus && (
          <MessageBar intent="info">
            <MessageBarBody>{t.landingLoaded(configs.length)}</MessageBarBody>
            <MessageBarActions>
              <Button appearance="primary" size="small" icon={<OpenRegular />} onClick={onFilesLoaded}>
                {t.landingOpen}
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}

        {(recentSessions.length > 0 || recentFiles.length > 0) && (
          <div className={styles.columns}>
            {recentSessions.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.eyebrow}>{t.recentSessions}</span>
                  <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={clearRecentSessions}>
                    {t.clearRecent}
                  </Button>
                </div>
                <div className={styles.list}>
                  {recentSessions.map(session => {
                    const canLoad = session.files.some(f => cachedPaths.has(f.path));
                    const title = session.files.length === 1
                      ? session.files[0]?.name ?? ''
                      : t.recentSessionTitle(session.files.length);
                    const handleLoad = (replace: boolean) => {
                      if (!canLoad) return;
                      void loadRecentSession(session.id, { replace }).then(ok => { if (ok) onFilesLoaded(); });
                    };
                    return (
                      <div
                        key={session.id}
                        className={styles.item}
                        style={{ alignItems: 'flex-start', opacity: canLoad ? 1 : 0.6 }}
                      >
                        <div className={styles.itemBody}>
                          <div className={styles.itemName}>{title}</div>
                          <div className={styles.sessionFiles}>
                            {session.files.map(f => {
                              const cached = cachedPaths.has(f.path);
                              const openOne = () => {
                                if (!cached) return;
                                void loadCachedFile(f.path, f.name).then(ok => { if (ok) onFilesLoaded(); });
                              };
                              return (
                                <button
                                  key={f.path}
                                  type="button"
                                  disabled={!cached}
                                  className={mergeClasses(styles.sessionFileRow, styles.sessionFileButton)}
                                  title={cached ? `${t.recentSessionFileHint} — ${f.path}` : f.path}
                                  onClick={openOne}
                                >
                                  <KindIcon kind={f.kind} />
                                  {f.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {canLoad && (
                          <>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={<OpenRegular />}
                              aria-label={t.recentSessionMergeHint}
                              title={t.recentSessionMergeHint}
                              onClick={() => handleLoad(false)}
                            />
                            <Button
                              appearance="transparent"
                              size="small"
                              icon={<ArrowSyncRegular />}
                              aria-label={t.recentSessionReplaceHint}
                              title={t.recentSessionReplaceHint}
                              onClick={() => handleLoad(true)}
                            />
                          </>
                        )}
                        <Button
                          appearance="transparent"
                          size="small"
                          icon={<DismissRegular />}
                          aria-label={t.dismiss}
                          onClick={() => removeRecentSession(session.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {recentFiles.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.eyebrow}>{t.recentFiles}</span>
                  <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={clearRecentFiles}>
                    {t.clearRecent}
                  </Button>
                </div>
                <div className={styles.list}>
                  {recentFiles.map(rf => {
                    const canReload = cachedPaths.has(rf.path);
                    const handleReload = () => {
                      if (!canReload) return;
                      void reloadRecentFile(rf.path).then(ok => { if (ok) onFilesLoaded(); });
                    };
                    return (
                      <div
                        key={rf.path}
                        className={styles.item}
                        title={rf.path}
                        style={{ opacity: canReload ? 1 : 0.75 }}
                      >
                        <KindIcon kind={rf.kind} size={16} />
                        <div className={styles.itemBody}>
                          <div className={styles.itemName}>{rf.name}</div>
                          <div className={styles.itemMeta}>{rf.path}</div>
                        </div>
                        {canReload && (
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<OpenRegular />}
                            aria-label={t.recentReloadHint}
                            title={t.recentReloadHint}
                            onClick={handleReload}
                          />
                        )}
                        <Button
                          appearance="transparent"
                          size="small"
                          icon={<DismissRegular />}
                          aria-label={t.dismiss}
                          onClick={() => removeRecentFile(rf.path)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className={styles.footer}>{t.landingFooter}</footer>
    </div>
  );
}

function KindIcon({ kind, size = 14 }: { kind?: string; size?: number }) {
  const styles = useStyles();
  if (kind === 'DataModel') return <DataBarVerticalRegular fontSize={size} className={styles.kindModel} />;
  if (kind === 'ModelMapping') return <LinkRegular fontSize={size} className={styles.kindMapping} />;
  return <DocumentRegular fontSize={size} className={styles.kindFormat} />;
}
