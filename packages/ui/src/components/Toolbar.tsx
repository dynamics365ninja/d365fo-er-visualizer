import React, { useCallback, useRef } from 'react';
import {
  Button,
  Tooltip,
  Divider,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t } from '../i18n';
import { loadBrowserFiles, openFilesWithSystemDialog } from '../utils/file-loading';

interface ToolbarProps {
  breadcrumb?: React.ReactNode;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    background: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    minHeight: '36px',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  sep: {
    height: '20px',
    margin: '0 4px',
  },
  breadcrumb: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  chip: {
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
  },
  chipTech: {
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  hiddenInput: {
    display: 'none',
  },
});

/**
 * Slim top toolbar — file/history operations + breadcrumb. View toggles,
 * theme, and the command palette live on the left ActivityBar.
 */
export function Toolbar({ breadcrumb }: ToolbarProps) {
  const styles = useStyles();
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

      <Divider vertical className={styles.sep} />

      <div className={styles.breadcrumb}>{breadcrumb}</div>

      <div className={styles.right}>
        {configs.length > 0 && (
          <span className={styles.chip} title={t.statusConfigs(configs.length)}>
            {configs.length} {t.statusConfigsWord}
          </span>
        )}
        <span className={mergeClasses(styles.chip, showTechnicalDetails && styles.chipTech)}>
          {showTechnicalDetails ? t.technicalView : t.consultantView}
        </span>
      </div>
    </div>
  );
}
