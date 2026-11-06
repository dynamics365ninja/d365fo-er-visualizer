import {
  Tooltip,
  CounterBadge,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  FolderRegular,
  SearchRegular,
  LinkRegular,
  AppsListDetailRegular,
} from '@fluentui/react-icons';
import type { FluentIcon } from '@fluentui/react-icons';
import { useCoarsePointer } from '../utils/responsive';
import { BrandMark } from './BrandWordmark';
import { t, useLocale } from '../i18n';

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
}

const useStyles = makeStyles({
  // Slightly distinguish the rail from the header in light mode.
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    width: 'var(--wb-activitybar-w)',
    height: '100%',
    boxSizing: 'border-box',
    padding: '10px 0',
    backgroundColor: 'var(--er-activitybar-bg)',
    flexShrink: 0,
  },
  sep: {
    width: '24px',
    height: '1px',
    flexShrink: 0,
    backgroundColor: 'var(--er-border)',
    margin: '6px 0',
  },
  btnWrap: {
    position: 'relative',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },
  // Rounded tiles use the same neutral surfaces and accent as the workspace.
  btn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '40px',
    width: '40px',
    height: '40px',
    padding: 0,
    borderRadius: '10px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    cursor: 'pointer',
    fontFamily: tokens.fontFamilyBase,
    transitionProperty: 'color, background-color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
      color: 'var(--er-text)',
    },
    ':focus-visible': {
      outline: '2px solid var(--er-accent)',
      outlineOffset: '1px',
    },
  },
  btnActive: {
    backgroundColor: 'var(--er-accent-soft)',
    color: 'var(--er-accent)',
    ':hover': {
      backgroundColor: 'var(--er-accent-soft)',
      color: 'var(--er-accent)',
    },
  },
  /** The home button is the brand: the "ER" mark on a lifted tile. */
  brandBtn: {
    backgroundColor: 'var(--er-accent-soft)',
    marginBottom: '2px',
    ':hover': {
      backgroundColor: 'var(--er-hover)',
    },
  },
  brandMark: {
    width: '22px',
    height: '22px',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: '6px',
    pointerEvents: 'none',
  },
});

/**
 * The icon rail: the brand mark (home), then the explorer and the panels as
 * icons, each in the same 40px rounded tile. The language, view mode and theme
 * are in the header.
 */
export function ActivityBar(props: ActivityBarProps) {
  const styles = useStyles();
  useLocale(); // the labels and tooltips follow the language switch

  return (
    <nav className={mergeClasses('activity-bar', styles.root)} aria-label={t.activityBarLabel}>
      <ActivityButton
        brand
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

    </nav>
  );
}

interface ActivityButtonProps {
  /** An icon, or the brand mark. */
  Icon?: FluentIcon;
  brand?: boolean;
  label: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
  badge?: number;
}

function ActivityButton({ Icon, brand, label, onClick, active, shortcut, badge }: ActivityButtonProps) {
  const styles = useStyles();
  const coarse = useCoarsePointer();
  // A "(Ctrl+B)" hint is noise on a tablet with no keyboard attached.
  const title = shortcut && !coarse ? `${label} (${shortcut})` : label;
  return (
    <div className={styles.btnWrap}>
      <Tooltip content={title} relationship="label" withArrow positioning="after">
        <button
          type="button"
          title={title}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={mergeClasses('activity-bar__btn', styles.btn, brand && styles.brandBtn, active && styles.btnActive)}
        >
          {brand
            ? <BrandMark className={styles.brandMark} />
            : Icon && <Icon fontSize={20} />}
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
