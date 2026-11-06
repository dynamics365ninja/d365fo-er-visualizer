import React, { useCallback, useRef } from 'react';
import {
  Button,
  Tooltip,
  Divider,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { setLocale, t, useLocale } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';
import { ThemeSwitch } from './ThemeSwitch';

const useStyles = makeStyles({
  // The workspace header, light like the landing page's top bar: what you do
  // with files and history on the left, how the app looks on the right.
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 12px',
    backgroundColor: 'var(--er-surface)',
    borderBottom: '1px solid var(--er-border)',
    height: 'var(--wb-titlebar-h)',
    minHeight: 'var(--wb-titlebar-h)',
    flexShrink: 0,
    boxSizing: 'border-box',
    // The bar spans the work area beside the explorer, not the window: what
    // gives way below is decided by its own width.
    containerType: 'inline-size',
  },
  leftGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    flexShrink: 1,
  },
  rightGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  sep: {
    height: '16px',
    margin: '0 2px',
  },
  hiddenInput: {
    display: 'none',
  },
  // In a narrow bar the button keeps its icon and tooltip; the words would
  // wrap inside it.
  loadLabel: {
    whiteSpace: 'nowrap',
    '@container (max-width: 560px)': {
      display: 'none',
    },
  },
  // Segmented switches of the License Hub: a sunken track, the pressed
  // segment lifted.
  segmented: {
    display: 'inline-flex',
    gap: '2px',
    height: '32px',
    boxSizing: 'border-box',
    padding: '3px',
    borderRadius: 'var(--er-radius-lg)',
    backgroundColor: 'var(--er-surface-3)',
  },
  segment: {
    minWidth: '34px',
    padding: '0 10px',
    border: 'none',
    borderRadius: 'var(--er-radius-md)',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 550,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    ':hover': {
      color: 'var(--er-text)',
    },
    ':focus-visible': {
      outline: '2px solid var(--er-accent)',
      outlineOffset: '1px',
    },
  },
  segmentOn: {
    backgroundColor: 'var(--er-surface)',
    color: 'var(--er-text)',
    boxShadow: '0 1px 2px var(--er-shadow-color)',
  },
  // In a narrower bar still the view mode gives way; it is in the explorer too.
  viewMode: {
    '@container (max-width: 460px)': {
      display: 'none',
    },
  },
  theme: {
    // The shared switch is 36px; the header's controls are 32px.
    '& .er-theme-switch': {
      width: '32px',
      minWidth: '32px',
      height: '32px',
    },
  },
});

/**
 * The workspace header — history and loading files on the left; the view mode,
 * the language and the theme on the right. The explorer and the panels are
 * toggled from the rail.
 */
export function Toolbar() {
  const styles = useStyles();
  const currentLocale = useLocale();
  // eslint-disable-next-line no-restricted-syntax -- which language button is pressed, not text
  const isCs = currentLocale === 'cs';
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const canNavigateBack = useAppStore(s => s.canNavigateBack);
  const canNavigateForward = useAppStore(s => s.canNavigateForward);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const pushToast = useAppStore(s => s.pushToast);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reportLoadErrors = useCallback((errors: string[]) => {
    for (const err of errors) {
      pushToast({ kind: 'error', message: err });
    }
  }, [pushToast]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const result = await loadBrowserFiles(e.target.files, loadXmlFile);
    if (result.errors.length > 0) reportLoadErrors(result.errors);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [loadXmlFile, reportLoadErrors]);

  const handleOpenFiles = useCallback(async () => {
    const result = await openFilesWithSystemDialog(loadXmlFile);
    if (result == null) {
      fileInputRef.current?.click();
      return;
    }
    if (result.errors.length > 0) reportLoadErrors(result.errors);
  }, [loadXmlFile, reportLoadErrors]);


  return (
    <div className={mergeClasses('wb-titlebar', styles.root)}>
      <div className={styles.leftGroup}>
        <div className={styles.nav}>
          <Tooltip content={`${t.back} (Alt+←)`} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowLeftRegular />}
              disabled={!canNavigateBack}
              onClick={navigateBack}
              aria-label={t.back}
            />
          </Tooltip>
          <Tooltip content={`${t.forward} (Alt+→)`} relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowRightRegular />}
              disabled={!canNavigateForward}
              onClick={navigateForward}
              aria-label={t.forward}
            />
          </Tooltip>
        </div>

        <Divider vertical className={styles.sep} />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xml"
          onChange={handleFileSelect}
          className={styles.hiddenInput}
          id="file-input"
        />
        <Tooltip content={t.loadXml} relationship="label" withArrow>
          <Button
            appearance="subtle"
            size="small"
            icon={<FolderOpenRegular />}
            onClick={handleOpenFiles}
          >
            <span className={styles.loadLabel}>{t.loadXml}</span>
          </Button>
        </Tooltip>
      </div>

      <div className={styles.rightGroup}>
        <div className={mergeClasses('wb-segmented', styles.segmented, styles.viewMode)} role="group" aria-label={t.viewModeLabel}>
          <button
            type="button"
            className={mergeClasses(styles.segment, !showTechnicalDetails && styles.segmentOn)}
            aria-pressed={!showTechnicalDetails}
            title={t.consultantView}
            onClick={() => setShowTechnicalDetails(false)}
          >
            {t.viewConsultantShort}
          </button>
          <button
            type="button"
            className={mergeClasses(styles.segment, showTechnicalDetails && styles.segmentOn)}
            aria-pressed={showTechnicalDetails}
            title={t.technicalView}
            onClick={() => setShowTechnicalDetails(true)}
          >
            {t.viewTechnicalShort}
          </button>
        </div>
        <div className={mergeClasses('wb-segmented', styles.segmented)} role="group" aria-label={t.language}>
          <button
            type="button"
            className={mergeClasses(styles.segment, isCs && styles.segmentOn)}
            aria-pressed={isCs}
            title={t.languageCzech}
            onClick={() => setLocale('cs')}
          >
            CZ
          </button>
          <button
            type="button"
            className={mergeClasses(styles.segment, !isCs && styles.segmentOn)}
            aria-pressed={!isCs}
            title={t.languageEnglish}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
        </div>
        <span className={styles.theme}><ThemeSwitch /></span>
      </div>
    </div>
  );
}
