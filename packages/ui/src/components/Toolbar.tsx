import React, { useCallback, useRef } from 'react';
import {
  Button,
  Tooltip,
  Divider,
  makeStyles,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

const useStyles = makeStyles({
  root: {
    // The wordmark is centred on the bar itself, not on what is left beside
    // the button group — that changes width with the locale and with whether
    // the history buttons are live.
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px',
    backgroundColor: 'var(--er-surface)',
    borderBottom: '1px solid var(--er-border)',
    height: '48px',
    minHeight: '48px',
    flexShrink: 0,
  },
  brand: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    // Decoration, not a control: never take a click meant for the toolbar.
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    // Below this the load button claims the middle.
    '@media (max-width: 860px)': {
      display: 'none',
    },
  },
  brandVendor: {
    fontSize: '9.5px',
    fontWeight: 700,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'var(--er-text-subtle)',
  },
  brandRule: {
    width: '1px',
    height: '14px',
    backgroundColor: 'var(--er-border-strong)',
  },
  brandName: {
    fontFamily: 'var(--er-font-display)',
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    // The three configuration hues the whole app is colour-coded by, read
    // left to right the way a configuration flows: model → mapping → format.
    backgroundImage: 'linear-gradient(100deg, var(--er-model), var(--er-mapping) 55%, var(--er-format))',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
  },
  leftGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
    flexShrink: 1,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  sep: {
    height: '20px',
    margin: '0 2px',
  },
  hiddenInput: {
    display: 'none',
  },
});

/**
 * Slim top toolbar — file/history operations. View toggles, the language and
 * the theme live on the left ActivityBar.
 */
export function Toolbar() {
  const styles = useStyles();
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const canNavigateBack = useAppStore(s => s.canNavigateBack);
  const canNavigateForward = useAppStore(s => s.canNavigateForward);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const pushToast = useAppStore(s => s.pushToast);
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
    <div className={styles.root}>
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
            appearance="primary"
            size="small"
            icon={<FolderOpenRegular />}
            onClick={handleOpenFiles}
          >
            {t.loadXml}
          </Button>
        </Tooltip>
      </div>

      <div className={styles.brand} aria-hidden="true">
        <span className={styles.brandVendor}>D365FO</span>
        <span className={styles.brandRule} />
        <span className={styles.brandName}>{t.appName}</span>
      </div>
    </div>
  );
}
