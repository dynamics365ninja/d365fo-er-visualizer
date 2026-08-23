import {
  Tooltip,
  CounterBadge,
  makeStyles,
  shorthands,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  HomeRegular,
  FolderRegular,
  SearchRegular,
  LinkRegular,
  AppsListDetailRegular,
  KeyboardRegular,
  EyeRegular,
  CodeRegular,
} from '@fluentui/react-icons';
import type { FluentIcon } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { ThemeSwitch } from './ThemeSwitch';
import { t } from '../i18n';

interface ActivityBarProps {
  showLeft: boolean;
  showRight: boolean;
  rightTab: 'properties' | 'search' | 'where-used';
  whereUsedActive: boolean;
  /** Optional count shown on the where-used button (e.g. number of usages). */
  whereUsedBadge?: number;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleSearch: () => void;
  onToggleWhereUsed: () => void;
  onGoHome: () => void;
  onOpenPalette: () => void;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    width: '52px',
    padding: '8px 0',
    backgroundColor: 'var(--er-surface)',
    borderRight: '1px solid var(--er-border)',
    flexShrink: 0,
  },
  sep: {
    width: '24px',
    height: '1px',
    backgroundColor: 'var(--er-border)',
    margin: '6px 0',
  },
  spacer: {
    flex: 1,
  },
  btnWrap: {
    position: 'relative',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    width: '36px',
    height: '36px',
    padding: 0,
    borderRadius: 'var(--er-radius-lg)',
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    cursor: 'pointer',
    fontFamily: tokens.fontFamilyBase,
    transitionProperty: 'background-color, color, border-color',
    transitionDuration: '140ms',
    ':hover': {
      backgroundColor: 'var(--er-surface-2)',
      color: 'var(--er-text)',
    },
  },
  btnActive: {
    color: 'var(--er-accent)',
    backgroundColor: 'var(--er-accent-soft)',
    ...shorthands.borderColor('var(--er-accent-border)'),
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
      color: 'var(--er-accent)',
    },
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: '6px',
    pointerEvents: 'none',
  },
});

/**
 * VS Code–style vertical icon rail. Hosts main navigation and panel toggles.
 * Migrated to Fluent UI v9 (`Button` + `Tooltip` + `CounterBadge`).
 */
export function ActivityBar(props: ActivityBarProps) {
  const styles = useStyles();
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);

  return (
    <nav className={styles.root} aria-label={t.activityBarLabel}>
      <ActivityButton
        Icon={HomeRegular}
        label={t.home}
        onClick={props.onGoHome}
      />

      <div className={styles.sep} />

      <ActivityButton
        Icon={FolderRegular}
        label={t.explorer}
        onClick={props.onToggleLeft}
        active={props.showLeft}
        shortcut="Ctrl+B"
      />
      <ActivityButton
        Icon={SearchRegular}
        label={t.search}
        onClick={props.onToggleSearch}
        active={props.showRight && props.rightTab === 'search'}
        shortcut="Ctrl+F"
      />
      <ActivityButton
        Icon={LinkRegular}
        label={t.whereUsedAction}
        onClick={props.onToggleWhereUsed}
        active={props.whereUsedActive}
        badge={props.whereUsedBadge}
        shortcut="Ctrl+U"
      />
      <ActivityButton
        Icon={AppsListDetailRegular}
        label={t.properties}
        onClick={props.onToggleRight}
        active={props.showRight && props.rightTab === 'properties'}
        shortcut="Ctrl+J"
      />
      <ActivityButton
        Icon={KeyboardRegular}
        label={t.commandPalette}
        onClick={props.onOpenPalette}
        shortcut="Ctrl+K"
      />

      <div className={styles.spacer} />

      <ActivityButton
        Icon={showTechnicalDetails ? CodeRegular : EyeRegular}
        label={showTechnicalDetails ? t.technicalView : t.consultantView}
        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        active={showTechnicalDetails}
      />
      {/* The shared switch rather than an `ActivityButton`: same 36px box and
          radius as the rail, and its border marks it as a mode control instead
          of one more panel toggle. */}
      <div className={styles.btnWrap}>
        <ThemeSwitch />
      </div>
    </nav>
  );
}

interface ActivityButtonProps {
  Icon: FluentIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
  badge?: number;
}

function ActivityButton({ Icon, label, onClick, active, shortcut, badge }: ActivityButtonProps) {
  const styles = useStyles();
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <div className={styles.btnWrap}>
      <Tooltip content={title} relationship="label" withArrow positioning="after">
        <button
          type="button"
          title={title}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={mergeClasses(styles.btn, active && styles.btnActive)}
        >
          <Icon fontSize={18} />
        </button>
      </Tooltip>
      {typeof badge === 'number' && badge > 0 && (
        <CounterBadge
          className={styles.badge}
          count={badge}
          size="small"
          color="danger"
          overflowCount={99}
        />
      )}
    </div>
  );
}
