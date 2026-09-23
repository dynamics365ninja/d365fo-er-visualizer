/**
 * Small presentational pieces shared by the F&O connector panel.
 */

import React from 'react';
import { Badge } from '@fluentui/react-components';
import type { ErComponentType } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useFnoPanelStyles } from './styles';

/** Short label for an ER component type in the F&O configuration browser. */
export function fnoComponentTypeLabel(type: string): string {
  if (type === 'ModelMapping') return t.fnoTypeMapping;
  if (type === 'Format') return t.kindFormat;
  if (type === 'DataModel') return t.fnoTypeModel;
  return type;
}

// ── Helper: type badge ──────────────────────────────────────────────────
export const TypeBadge: React.FC<{ type: ErComponentType }> = ({ type }) => {
  const styles = useFnoPanelStyles();
  const color =
    type === 'ModelMapping' ? 'success' :
    type === 'Format' ? 'informative' :
    type === 'DataModel' ? 'important' : 'subtle';
  const label = fnoComponentTypeLabel(type);
  return (
    <Badge appearance="tint" color={color} size="small" className={styles.typeBadge}>
      {label}
    </Badge>
  );
};

// ── Helper: skeleton list item for loading states ─────────────────────
export const SkeletonListItem: React.FC<{ wide?: boolean; delay?: number }> = ({ wide = false, delay = 0 }) => (
  <div className="fno-skeleton-row" style={{ animationDelay: `${delay}ms` }}>
    <div className="fno-skeleton-block fno-skeleton-icon" />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="fno-skeleton-block fno-skeleton-line-main" style={{ width: wide ? '75%' : '60%' }} />
      <div className="fno-skeleton-block fno-skeleton-line-sub" style={{ width: wide ? '50%' : '38%' }} />
    </div>
  </div>
);
