import React, { useLayoutEffect, useRef, useState } from 'react';
import { makeStyles, tokens, mergeClasses } from '@fluentui/react-components';
import {
  DatabaseRegular,
  TableRegular,
  CodeRegular,
  TagRegular,
  CalculatorRegular,
  LinkRegular,
  ArrowForwardRegular,
  BranchRegular,
} from '@fluentui/react-icons';

export type PathTooltipKind = 'datasource' | 'model-mapping' | 'binding';
export type PathTooltipRowIcon = 'table' | 'class' | 'enum' | 'calc' | 'link' | 'branch';

export interface PathTooltipRow {
  icon?: PathTooltipRowIcon;
  label?: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}

export interface PathTooltipData {
  kind: PathTooltipKind;
  title: string;
  subtitle?: string;
  rows: PathTooltipRow[];
  canNavigate: boolean;
}

interface PathTooltipCardProps {
  data: PathTooltipData;
  mouse: { x: number; y: number };
}

const useStyles = makeStyles({
  root: {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'none',
    minWidth: '220px',
    maxWidth: '420px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyBase,
    lineHeight: tokens.lineHeightBase200,
    overflow: 'hidden',
    opacity: 0,
    transform: 'translateY(-2px)',
    transitionProperty: 'opacity, transform',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
  },
  rootVisible: {
    opacity: 1,
    transform: 'translateY(0)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  headerIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  headerText: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  headerTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerSubtitle: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    padding: '6px 12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  rowIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  rowLabel: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    flexShrink: 0,
  },
  rowValue: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground1,
  },
  rowValueMono: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  rowValueMuted: {
    color: tokens.colorNeutralForeground3,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
});

function HeaderIcon({ kind }: { kind: PathTooltipKind }) {
  if (kind === 'datasource') return <DatabaseRegular fontSize={18} />;
  if (kind === 'model-mapping') return <LinkRegular fontSize={18} />;
  return <BranchRegular fontSize={18} />;
}

function RowIcon({ icon }: { icon?: PathTooltipRowIcon }) {
  switch (icon) {
    case 'table': return <TableRegular fontSize={14} />;
    case 'class': return <CodeRegular fontSize={14} />;
    case 'enum': return <TagRegular fontSize={14} />;
    case 'calc': return <CalculatorRegular fontSize={14} />;
    case 'link': return <LinkRegular fontSize={14} />;
    case 'branch': return <BranchRegular fontSize={14} />;
    default: return null;
  }
}

const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;
const VIEWPORT_PADDING = 8;

export function PathTooltipCard({ data, mouse }: PathTooltipCardProps) {
  const styles = useStyles();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = mouse.x + CURSOR_OFFSET_X;
    let top = mouse.y + CURSOR_OFFSET_Y;

    // Flip horizontally if overflowing right edge
    if (left + rect.width > vw - VIEWPORT_PADDING) {
      left = mouse.x - rect.width - CURSOR_OFFSET_X;
    }
    // Flip vertically if overflowing bottom edge
    if (top + rect.height > vh - VIEWPORT_PADDING) {
      top = mouse.y - rect.height - CURSOR_OFFSET_Y / 2;
    }
    // Clamp to viewport edges
    left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - rect.width - VIEWPORT_PADDING));
    top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - rect.height - VIEWPORT_PADDING));

    setPos({ left, top });
  }, [mouse.x, mouse.y, data]);

  return (
    <div
      ref={ref}
      className={mergeClasses(styles.root, pos !== null && styles.rootVisible)}
      style={{
        left: pos?.left ?? mouse.x + CURSOR_OFFSET_X,
        top: pos?.top ?? mouse.y + CURSOR_OFFSET_Y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="tooltip"
    >
      <div className={styles.header}>
        <span className={styles.headerIcon} aria-hidden>
          <HeaderIcon kind={data.kind} />
        </span>
        <div className={styles.headerText}>
          <div className={styles.headerTitle}>{data.title}</div>
          {data.subtitle && <div className={styles.headerSubtitle}>{data.subtitle}</div>}
        </div>
      </div>
      {data.rows.length > 0 && (
        <div className={styles.body}>
          {data.rows.map((row, i) => (
            <div key={i} className={styles.row}>
              {row.icon && (
                <span className={styles.rowIcon} aria-hidden>
                  <RowIcon icon={row.icon} />
                </span>
              )}
              {row.label && <span className={styles.rowLabel}>{row.label}</span>}
              <span
                className={mergeClasses(
                  styles.rowValue,
                  row.mono && styles.rowValueMono,
                  row.muted && styles.rowValueMuted,
                )}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.canNavigate && (
        <div className={styles.footer}>
          <ArrowForwardRegular fontSize={12} />
          <span>Click to navigate</span>
        </div>
      )}
    </div>
  );
}
