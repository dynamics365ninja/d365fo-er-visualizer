import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  makeStyles,
  mergeClasses,
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
  ArrowUploadRegular,
  BookOpenRegular,
  ChevronRightRegular,
  CloudRegular,
  DismissRegular,
  FolderOpenRegular,
  GlobeRegular,
  OpenRegular,
  WindowDevToolsRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { ThemeSwitch } from './ThemeSwitch';
import { BrandMark } from './BrandWordmark';
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
 *
 * Laid out like the workbench it leads to: the indigo sidebar with the brand
 * and the ways in, a light top bar, and the work itself in panels.
 */

// ────────────────────────── styles ──────────────────────────

const useStyles = makeStyles({
  root: {
    minHeight: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    backgroundColor: 'var(--er-bg)',
    color: 'var(--er-text)',
    fontFamily: tokens.fontFamilyBase,
    fontSize: '14px',
    lineHeight: 1.5,
  },
  // ── indigo sidebar ──
  // Sticky beside the page on a desktop; on a phone it wraps above the page
  // (the flex-wrap above) and scrolls away with it.
  side: {
    flex: '1 1 248px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
    height: '100vh',
    overflowY: 'auto',
    padding: '24px 14px 16px',
    backgroundColor: 'var(--er-side-bg)',
    color: 'var(--er-side-ink)',
    scrollbarWidth: 'thin',
    '@media (max-width: 820px)': {
      position: 'static',
      height: 'auto',
      alignSelf: 'stretch',
    },
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 10px',
    color: 'var(--er-side-strong)',
    textDecorationLine: 'none',
    borderRadius: 'var(--er-radius-lg)',
    ':focus-visible': {
      outline: '2px solid var(--er-gold)',
      outlineOffset: '2px',
    },
  },
  brandTile: {
    display: 'grid',
    placeItems: 'center',
    width: '34px',
    height: '34px',
    flexShrink: 0,
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-side-active)',
  },
  brandMark: {
    width: '20px',
    height: '20px',
  },
  brandName: {
    fontSize: '17px',
    fontWeight: 600,
    letterSpacing: '-0.2px',
    whiteSpace: 'nowrap',
  },
  brandSub: {
    margin: '8px 10px 0',
    color: 'var(--er-side-muted)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  navLabel: {
    margin: '26px 10px 6px',
    color: 'var(--er-side-muted)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    minHeight: '40px',
    boxSizing: 'border-box',
    padding: '0 10px',
    border: 'none',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'transparent',
    color: 'var(--er-side-ink)',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 450,
    textAlign: 'left',
    textDecorationLine: 'none',
    cursor: 'pointer',
    transitionProperty: 'background-color, color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      backgroundColor: 'var(--er-side-hover)',
      color: 'var(--er-side-strong)',
    },
    ':focus-visible': {
      outline: '2px solid var(--er-gold)',
      outlineOffset: '1px',
    },
  },
  navItemActive: {
    backgroundColor: 'var(--er-side-active)',
    color: 'var(--er-side-strong)',
    fontWeight: 550,
    ':hover': {
      backgroundColor: 'var(--er-side-active)',
    },
  },
  navIcon: {
    flexShrink: 0,
    fontSize: '18px',
  },
  navIconActive: {
    color: 'var(--er-gold)',
  },
  navCount: {
    marginLeft: 'auto',
    minWidth: '22px',
    padding: '1px 6px',
    borderRadius: 'var(--er-radius-pill)',
    backgroundColor: 'var(--er-gold)',
    color: 'var(--er-on-gold)',
    fontSize: '11px',
    fontWeight: 650,
    lineHeight: 1.6,
    textAlign: 'center',
  },
  sideBottom: {
    marginTop: 'auto',
    paddingTop: '24px',
    // Stacked above the page on a phone; the page's own footer says the same.
    '@media (max-width: 820px)': {
      display: 'none',
    },
  },
  sideFoot: {
    margin: 0,
    padding: '14px 10px 0',
    borderTop: '1px solid var(--er-side-line)',
    color: 'var(--er-side-muted)',
    fontSize: '11px',
    lineHeight: 1.5,
  },
  // ── page ──
  page: {
    flex: '999 1 560px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  topbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px 20px',
    minHeight: '64px',
    boxSizing: 'border-box',
    padding: '12px 32px',
    borderBottom: '1px solid var(--er-border)',
    backgroundColor: 'var(--er-surface)',
    '@media (max-width: 600px)': {
      padding: '10px 16px',
    },
  },
  crumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--er-text-muted)',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  crumbSep: {
    color: 'var(--er-text-subtle)',
    fontSize: '14px',
  },
  crumbCurrent: {
    color: 'var(--er-text)',
    fontSize: '14px',
    fontWeight: 550,
  },
  topbarActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
  },
  // A sunken track with the pressed segment lifted, as in the License Hub.
  segmented: {
    display: 'inline-flex',
    gap: '2px',
    height: '36px',
    boxSizing: 'border-box',
    padding: '3px',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-surface-3)',
  },
  segment: {
    minWidth: '36px',
    padding: '0 8px',
    border: 'none',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.3px',
    cursor: 'pointer',
    ':hover': {
      color: 'var(--er-text)',
    },
  },
  segmentOn: {
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text)',
    boxShadow: '0 1px 2px var(--er-shadow-color)',
  },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: '1240px',
    boxSizing: 'border-box',
    margin: '0 auto',
    padding: '28px 32px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    transitionProperty: 'max-width',
    transitionDuration: 'var(--er-duration)',
    '@media (max-width: 600px)': {
      padding: '20px 16px 24px',
    },
  },
  // Connected to an environment, the source panel stops being a launcher and
  // becomes a two-pane browser over hundreds of configurations — so it gets
  // the window.
  mainWide: {
    maxWidth: '1680px',
  },
  heading: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '16px 24px',
  },
  headingText: {
    minWidth: 0,
    maxWidth: '760px',
  },
  eyebrow: {
    margin: '0 0 6px',
    color: 'var(--er-accent)',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '28px',
    lineHeight: 1.15,
    fontWeight: 600,
    letterSpacing: '-0.6px',
  },
  lead: {
    margin: 0,
    color: 'var(--er-text-muted)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  // Neutral and primary buttons of the License Hub: 38px, 9px corners.
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '38px',
    padding: '0 14px',
    border: '1px solid var(--er-border-strong)',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text)',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    boxShadow: 'var(--er-shadow-1)',
    transitionProperty: 'background-color, border-color, color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
      color: 'var(--er-text)',
    },
    ':active': {
      transform: 'translateY(1px)',
    },
    ':focus-visible': {
      outline: '2px solid var(--er-accent)',
      outlineOffset: '2px',
    },
  },
  btnPrimary: {
    border: '1px solid var(--er-accent-fill)',
    backgroundColor: 'var(--er-accent-fill)',
    color: 'var(--er-on-accent-fill)',
    ':hover': {
      border: '1px solid var(--er-accent-fill-hover)',
      backgroundColor: 'var(--er-accent-fill-hover)',
      color: 'var(--er-on-accent-fill)',
    },
  },
  // ── source panel ──
  card: {
    border: '1px solid var(--er-border)',
    borderRadius: 'var(--er-radius-xl)',
    backgroundColor: 'var(--er-surface)',
    boxShadow: 'var(--er-shadow-1)',
    overflow: 'hidden',
  },
  cardHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    minHeight: '64px',
    boxSizing: 'border-box',
    padding: '12px 20px',
  },
  cardTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    letterSpacing: '-0.2px',
  },
  cardTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: '30px',
    padding: '0 12px',
    border: 'none',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    ':hover': { color: 'var(--er-text)' },
  },
  cardTabActive: {
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text)',
    fontWeight: 550,
    boxShadow: '0 1px 2px var(--er-shadow-color)',
  },
  cardBody: {
    padding: '0 20px 20px',
  },
  // ── drop zone ──
  dropzone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    minHeight: '220px',
    boxSizing: 'border-box',
    padding: '36px 24px',
    borderRadius: 'var(--er-radius-xl)',
    border: '1.5px dashed var(--er-border-strong)',
    backgroundColor: 'var(--er-surface-2)',
    cursor: 'pointer',
    textAlign: 'center',
    ':hover': {
      border: '1.5px dashed var(--er-accent)',
      backgroundColor: 'var(--er-accent-soft)',
    },
    ':focus-visible': {
      outline: '2px solid var(--er-accent)',
      outlineOffset: '2px',
    },
  },
  dropzoneDragging: {
    border: '1.5px solid var(--er-accent)',
    backgroundColor: 'var(--er-accent-soft)',
  },
  dropIcon: {
    display: 'grid',
    placeItems: 'center',
    width: '52px',
    height: '52px',
    borderRadius: 'var(--er-radius-xl)',
    backgroundColor: 'var(--er-accent-soft)',
    color: 'var(--er-accent)',
  },
  dropTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    letterSpacing: '-0.2px',
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
  // A pill in the tint of its kind, led by a dot.
  kindPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 10px',
    borderRadius: 'var(--er-radius-pill)',
    fontSize: '12px',
    fontWeight: 500,
    '::before': {
      content: '""',
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      backgroundColor: 'currentColor',
    },
  },
  kindModel: { backgroundColor: 'var(--er-model-soft)', color: 'var(--er-model)' },
  kindMapping: { backgroundColor: 'var(--er-mapping-soft)', color: 'var(--er-mapping)' },
  kindFormat: { backgroundColor: 'var(--er-format-soft)', color: 'var(--er-format)' },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: '10px',
    marginTop: '8px',
    paddingTop: '16px',
    borderTop: '1px solid var(--er-border)',
    color: 'var(--er-text-muted)',
    fontSize: '11px',
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
  // Hidden during an F&O ingest so nobody jumps into a half-loaded workspace.
  const canReturn = configs.length > 0 && !fnoIngestStatus;

  return (
    <div
      className={styles.root}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Outside the drop zone, so "Open files" in the heading works from
          either tab. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".xml"
        style={{ display: 'none' }}
        onChange={e => { processFiles(e.target.files); e.target.value = ''; }}
      />

      <aside className={mergeClasses('wb-indigo', styles.side)}>
        <a
          className={styles.brand}
          href={marketingHomeHref()}
          title={t.landingHomeLinkLabel}
          aria-label={t.landingHomeLinkLabel}
        >
          <span className={styles.brandTile}><BrandMark className={styles.brandMark} /></span>
          <span className={styles.brandName}>{t.appName}</span>
        </a>
        <p className={styles.brandSub}>Electronic Reporting</p>

        <p className={styles.navLabel}>{t.landingNavStart}</p>
        <nav className={styles.nav} aria-label={t.landingSourceLabel}>
          <button
            type="button"
            className={mergeClasses(styles.navItem, sourceTab === 'local' && styles.navItemActive)}
            aria-current={sourceTab === 'local' ? 'page' : undefined}
            onClick={() => setSourceTab('local')}
          >
            <FolderOpenRegular className={mergeClasses(styles.navIcon, sourceTab === 'local' && styles.navIconActive)} />
            {t.fnoTabLocal}
          </button>
          <button
            type="button"
            className={mergeClasses(styles.navItem, sourceTab === 'remote' && styles.navItemActive)}
            aria-current={sourceTab === 'remote' ? 'page' : undefined}
            onClick={() => setSourceTab('remote')}
          >
            <CloudRegular className={mergeClasses(styles.navIcon, sourceTab === 'remote' && styles.navIconActive)} />
            {t.fnoTabRemote}
          </button>
          {canReturn && (
            <button type="button" className={styles.navItem} onClick={onFilesLoaded}>
              <WindowDevToolsRegular className={styles.navIcon} />
              {t.landingNavWorkspace}
              <span className={styles.navCount}>{configs.length}</span>
            </button>
          )}
        </nav>

        <p className={styles.navLabel}>{t.landingNavHelp}</p>
        <nav className={styles.nav} aria-label={t.landingNavHelp}>
          <a className={styles.navItem} href={docsHref()} target="_blank" rel="noreferrer noopener">
            <BookOpenRegular className={styles.navIcon} />
            {t.landingDocsLink}
          </a>
          <a className={styles.navItem} href={marketingHomeHref()}>
            <GlobeRegular className={styles.navIcon} />
            {t.landingNavProject}
          </a>
        </nav>

        <div className={styles.sideBottom}>
          <p className={styles.sideFoot}>{t.landingFooter}</p>
        </div>
      </aside>

      <div className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.crumbs}>
            <span>{t.appName}</span>
            <ChevronRightRegular className={styles.crumbSep} aria-hidden />
            <strong className={styles.crumbCurrent}>{t.home}</strong>
          </div>
          <div className={styles.topbarActions}>
            <div className={styles.segmented} aria-label={t.language} role="group">
              <button
                type="button"
                className={mergeClasses(styles.segment, isCs && styles.segmentOn)}
                onClick={() => setLocale('cs')}
                aria-pressed={isCs}
                title={t.languageCzech}
              >
                CZ
              </button>
              <button
                type="button"
                className={mergeClasses(styles.segment, !isCs && styles.segmentOn)}
                onClick={() => setLocale('en')}
                aria-pressed={!isCs}
                title={t.languageEnglish}
              >
                EN
              </button>
            </div>
            <ThemeSwitch />
          </div>
        </header>

        <main className={mergeClasses(styles.main, wideLayout && styles.mainWide)}>
          <div className={styles.heading}>
            <div className={styles.headingText}>
              <p className={styles.eyebrow}>{t.landingBadge}</p>
              <h1 className={styles.title}>{t.landingTitle}</h1>
              <p className={styles.lead}>{t.landingSub}</p>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => setSourceTab('remote')}>
                <CloudRegular fontSize={16} aria-hidden />
                {t.landingConnect}
              </button>
              <button type="button" className={mergeClasses(styles.btn, styles.btnPrimary)} onClick={handleOpenFiles}>
                <FolderOpenRegular fontSize={16} aria-hidden />
                {t.landingOpenFiles}
              </button>
            </div>
          </div>

          <section className={styles.card} aria-labelledby="landing-source-title">
            <div className={styles.cardHead}>
              <h2 id="landing-source-title" className={styles.cardTitle}>{t.landingSourceLabel}</h2>
              <div className={styles.segmented} role="tablist" aria-label={t.landingSourceLabel}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'local'}
                  className={mergeClasses(styles.cardTab, sourceTab === 'local' && styles.cardTabActive)}
                  onClick={() => setSourceTab('local')}
                >
                  <FolderOpenRegular fontSize={15} />
                  {t.fnoTabLocal}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'remote'}
                  className={mergeClasses(styles.cardTab, sourceTab === 'remote' && styles.cardTabActive)}
                  onClick={() => setSourceTab('remote')}
                >
                  <CloudRegular fontSize={15} />
                  {t.fnoTabRemote}
                </button>
              </div>
            </div>

            <div className={styles.cardBody}>
              {sourceTab === 'local' ? (
                <div
                  className={mergeClasses('landing-dropzone', styles.dropzone, isDragging && styles.dropzoneDragging)}
                  onClick={handleOpenFiles}
                  onKeyDown={e => e.key === 'Enter' && handleOpenFiles()}
                  role="button"
                  tabIndex={0}
                  aria-label={t.landingDropAriaLabel}
                >
                  {loading ? (
                    <Spinner size="medium" label={t.landingLoading} labelPosition="below" />
                  ) : (
                    <>
                      <span className={styles.dropIcon} aria-hidden="true">
                        {isDragging ? <ArrowDownloadRegular fontSize={26} /> : <ArrowUploadRegular fontSize={26} />}
                      </span>
                      <h2 className={styles.dropTitle}>
                        {isDragging ? t.landingDropRelease : t.landingDropPrimary}
                      </h2>
                      <p className={styles.dropHint}>{t.landingDropSecondary}</p>
                      <div className={styles.kinds}>
                        <span className={mergeClasses(styles.kindPill, styles.kindModel)}>{t.landingPillModel}</span>
                        <span className={mergeClasses(styles.kindPill, styles.kindMapping)}>{t.landingPillMapping}</span>
                        <span className={mergeClasses(styles.kindPill, styles.kindFormat)}>{t.landingPillFormat}</span>
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

          {canReturn && (
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

          <footer className={styles.footer}>
            <span>{t.landingFooter}</span>
            <a href={docsHref()} target="_blank" rel="noreferrer noopener">{t.landingDocsLink}</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
