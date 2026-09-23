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
  CloudRegular,
  DataBarVerticalRegular,
  DismissRegular,
  DocumentRegular,
  FolderOpenRegular,
  LinkRegular,
  OpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { ThemeSwitch } from './ThemeSwitch';
import { BrandWordmark } from './BrandWordmark';
import { setLocale, t, useLocale } from '../i18n';
import { RecentWork } from './RecentWork';
import { FnoConnectPanel } from './FnoConnectPanel';
import { useFnoSession } from '../state/fno-session';
import { peekRedirectPending } from '../fno/redirect-state';
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
    textDecorationLine: 'none',
    borderRadius: 'var(--er-radius-md)',
    // The wordmark is gradient-clipped text, so a colour change would not show.
    ':hover': {
      opacity: 0.8,
    },
    ':focus-visible': {
      outline: '2px solid var(--er-accent)',
      outlineOffset: '2px',
    },
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
    transitionProperty: 'max-width, padding-top',
    transitionDuration: 'var(--er-duration)',
    '@media (max-width: 600px)': {
      padding: '32px 16px 48px',
    },
  },
  // Connected to an environment, the card stops being a launcher and becomes a
  // two-pane browser over hundreds of configurations — so it gets the window.
  mainWide: {
    maxWidth: '1680px',
    paddingTop: '28px',
    paddingBottom: '32px',
    gap: '20px',
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
  footer: {
    borderTop: '1px solid var(--er-border)',
    padding: '18px 20px',
    textAlign: 'center',
    color: 'var(--er-text-subtle)',
    fontSize: '12px',
  },
});

interface LandingPageProps {
  onFilesLoaded: () => void;
}

/** Documentation lives on the marketing site; fall back to the repo in dev. */
function docsHref(): string {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app')) {
    return '/docs/getting-started';
  }
  return 'https://github.com/dynamics365ninja/d365fo-er-visualizer#readme';
}

/**
 * The app is staged under /app on the marketing site (see stage-app.mjs), so
 * the logo can link back to the marketing homepage at the site root. When
 * running the UI's own Vite dev server standalone (`pnpm --filter
 * @er-visualizer/ui dev`), the marketing site normally runs alongside it on
 * localhost:3000 (`packages/site`'s dev script), so link there instead of
 * falling back to the repo — that only happens for other standalone builds
 * (e.g. the Electron shell) where no marketing site is running at all.
 */
function marketingHomeHref(): string {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app')) {
    return '/';
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:3000';
  }
  return 'https://github.com/dynamics365ninja/d365fo-er-visualizer#readme';
}

// ────────────────────────── component ──────────────────────────

export function LandingPage({ onFilesLoaded }: LandingPageProps) {
  const styles = useStyles();
  const currentLocale = useLocale();
  // eslint-disable-next-line no-restricted-syntax -- which language button is pressed, not text
  const isCs = currentLocale === 'cs';
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const configs = useAppStore(s => s.configurations);
  const fnoIngestStatus = useAppStore(s => s.fnoIngestStatus);
  const fnoConnected = useFnoSession(s => s.connState.kind === 'connected');
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Coming back from a full-page MSAL redirect sign-in: open the F&O tab so the
  // connect panel mounts and can resume the flow instead of showing "local files".
  const [sourceTab, setSourceTab] = useState<'local' | 'remote'>(
    () => (peekRedirectPending() ? 'remote' : 'local'),
  );
  const landingRequest = useAppStore(s => s.landingRequest);
  // One-shot: honour each request exactly once (tracked by its version), so a
  // later plain "Home" click does not keep re-opening the remembered tab.
  const consumedLandingVersionRef = useRef(0);
  useEffect(() => {
    if (!landingRequest || landingRequest.version === consumedLandingVersionRef.current) return;
    consumedLandingVersionRef.current = landingRequest.version;
    setSourceTab(landingRequest.tab);
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

  // Browsing a live environment needs the width; the launcher does not.
  const wideLayout = sourceTab === 'remote' && fnoConnected;

  return (
    <div
      className={styles.root}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <header className={styles.topbar}>
        <a
          className={styles.brand}
          href={marketingHomeHref()}
          title={t.landingHomeLinkLabel}
          aria-label={t.landingHomeLinkLabel}
        >
          <BrandWordmark />
        </a>
        <div className={styles.topbarActions}>
          <a className={styles.docsLink} href={docsHref()} target="_blank" rel="noreferrer noopener">
            {t.landingDocsLink}
          </a>
          <div className={styles.langSwitch} aria-label={t.language} role="group">
            <Button
              appearance={isCs ? 'primary' : 'subtle'}
              size="small"
              className={styles.langButton}
              onClick={() => setLocale('cs')}
              aria-pressed={isCs}
              title={t.languageCzech}
            >
              CZ
            </Button>
            <Button
              appearance={isCs ? 'subtle' : 'primary'}
              size="small"
              className={styles.langButton}
              onClick={() => setLocale('en')}
              aria-pressed={!isCs}
              title={t.languageEnglish}
            >
              EN
            </Button>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <main className={mergeClasses(styles.main, wideLayout && styles.mainWide)}>
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
                  // The input sits inside the clickable dropzone: without this the
                  // programmatic .click() bubbles back into handleOpenFiles forever.
                  onClick={e => e.stopPropagation()}
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

        <RecentWork onFilesLoaded={onFilesLoaded} />
      </main>

      <footer className={styles.footer}>{t.landingFooter}</footer>
    </div>
  );
}
