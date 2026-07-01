import React, { useCallback, useRef } from 'react';
import {
  Button,
  Tooltip,
  Divider,
  makeStyles,
  tokens,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { setLocale, t, useLocale } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

interface ToolbarProps {
  breadcrumb?: React.ReactNode;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    height: '44px',
    minHeight: '44px',
    flexShrink: 0,
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
    gap: '6px',
    marginLeft: 'auto',
    flexShrink: 0,
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
  breadcrumb: {
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    paddingLeft: '4px',
  },
  chip: {
    fontFamily: tokens.fontFamilyBase,
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.02em',
    padding: '2px 8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
  },
  chipTech: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    ...shorthands.borderColor(tokens.colorBrandStroke2),
  },
  hiddenInput: {
    display: 'none',
  },
  langSwitch: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
  },
  langButton: {
    minWidth: '34px',
    paddingLeft: '8px',
    paddingRight: '8px',
  },
});

/**
 * Slim top toolbar — file/history operations + breadcrumb. View toggles,
 * theme, and the command palette live on the left ActivityBar.
 */
export function Toolbar({ breadcrumb }: ToolbarProps) {
  const styles = useStyles();
  const currentLocale = useLocale();
  const loadXmlFile = useAppStore(s => s.loadXmlFile);
  const canNavigateBack = useAppStore(s => s.canNavigateBack);
  const canNavigateForward = useAppStore(s => s.canNavigateForward);
  const navigateBack = useAppStore(s => s.navigateBack);
  const navigateForward = useAppStore(s => s.navigateForward);
  const pushToast = useAppStore(s => s.pushToast);
  const configs = useAppStore(s => s.configurations);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
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

        {breadcrumb && <Divider vertical className={styles.sep} />}
        <div className={styles.breadcrumb}>{breadcrumb}</div>
      </div>

      <div className={styles.rightGroup}>
        <Tooltip content={t.language} relationship="label" withArrow>
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
        </Tooltip>
      </div>
    </div>
  );
}
