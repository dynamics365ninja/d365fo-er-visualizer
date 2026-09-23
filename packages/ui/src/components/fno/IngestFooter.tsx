/**
 * Footer of the F&O browser: what is selected (or what the running ingest is
 * doing) and the "Load selected" button.
 */

import React from 'react';
import { Button, Caption1, Caption2, Tooltip, tokens } from '@fluentui/react-components';
import {
  CloudArrowDownRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
} from '@fluentui/react-icons';
import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import { useFnoPanelStyles } from './styles';

export interface IngestFooterProps {
  selected: Map<string, ErConfigSummary>;
  ingesting: boolean;
  onLoadSelected: () => void;
}

export const IngestFooter: React.FC<IngestFooterProps> = ({ selected, ingesting, onLoadSelected }) => {
  const styles = useFnoPanelStyles();
  const ingestStatus = useAppStore(s => s.fnoIngestStatus);
  return (
    <div className={styles.footer}>
      <div className={styles.footerStatus}>
        {ingesting && ingestStatus ? (
          <>
            <ArrowSyncRegular fontSize={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0, color: tokens.colorBrandForeground1 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Caption2 style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '2px' }}>
                {t.fnoFooterDownloading}
              </Caption2>
              <Caption1 style={{ fontWeight: '600', color: tokens.colorNeutralForeground1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {ingestStatus}
              </Caption1>
            </div>
          </>
        ) : selected.size > 0 ? (
          <>
            <CheckmarkCircleRegular fontSize={16} style={{ color: tokens.colorBrandForeground1 }} />
            <Caption1>
              <strong>{selected.size}</strong> {t.fnoSelectedCountLabel}
            </Caption1>
            <Tooltip
              content={Array.from(selected.values()).map(c => `${c.solutionName} / ${c.configurationName} (${c.componentType})`).join('\n')}
              relationship="description"
            >
              <Caption1 style={{ color: tokens.colorNeutralForeground3, cursor: 'default' }}>
                {Array.from(selected.values()).slice(0, 2).map(c => c.configurationName).join(', ')}
                {selected.size > 2 ? ` +${selected.size - 2}` : ''}
              </Caption1>
            </Tooltip>
          </>
        ) : (
          <Tooltip content={t.fnoDownloadInfo} relationship="description">
            <Caption1 style={{ color: tokens.colorNeutralForeground3, cursor: 'help' }}>
              {t.fnoFooterIdle}
            </Caption1>
          </Tooltip>
        )}
      </div>
      <Button
        appearance="primary"
        size="large"
        icon={ingesting ? <ArrowSyncRegular style={{ animation: 'spin 1s linear infinite' }} /> : <CloudArrowDownRegular />}
        disabled={selected.size === 0 || ingesting}
        onClick={onLoadSelected}
      >
        {ingesting ? t.fnoLoading : t.fnoLoadSelected}
      </Button>
    </div>
  );
};
