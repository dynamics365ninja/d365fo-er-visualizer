import {
  Tooltip,
  CounterBadge,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  HomeRegular,
  FolderRegular,
  SearchRegular,
  LinkRegular,
  AppsListDetailRegular,
  EyeRegular,
  CodeRegular,
} from '@fluentui/react-icons';
import type { FluentIcon } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { useCoarsePointer } from '../utils/responsive';
import { ThemeSwitch } from './ThemeSwitch';
import { setLocale, t, useLocale } from '../i18n';

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
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    width: 'var(--wb-activitybar-w)',
    padding: '4px 0',
    backgroundColor: 'var(--er-chrome)',
    borderRight: '1px solid var(--er-border)',
    flexShrink: 0,
  },
  sep: {
    width: '24px',
    height: '1px',
    flexShrink: 0,
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
  // VS Code activity bar: full-width square cells, muted icons, the active
  // view marked by a bar on the leading edge rather than a tinted tile.
  btn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 'var(--wb-activitybar-w)',
    width: 'var(--wb-activitybar-w)',
    height: 'var(--wb-activitybar-w)',
    padding: 0,
    borderRadius: 0,
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--er-text-muted)',
    cursor: 'pointer',
    fontFamily: tokens.fontFamilyBase,
    transitionProperty: 'color',
    transitionDuration: 'var(--er-duration-fast)',
    ':hover': {
      backgroundColor: 'transparent',
      color: 'var(--er-text)',
    },
  },
  btnActive: {
    color: 'var(--er-text)',
    boxShadow: 'inset 2px 0 0 var(--er-accent-fill)',
    ':hover': {
      color: 'var(--er-text)',
    },
  },
  /** Text in place of an icon (the language code), sized to the 18px icons. */
  glyph: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    lineHeight: 1,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: '6px',
    pointerEvents: 'none',
  },
});

/**
 * VS Code–style vertical icon rail. Navigation and panel toggles at the top,
 * app-wide settings (language, view mode, theme) at the bottom — every one in
 * the same 36px borderless box.
 */
export function ActivityBar(props: ActivityBarProps) {
  const styles = useStyles();
  const currentLocale = useLocale();
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);

  return (
    <nav className={mergeClasses('activity-bar', styles.root)} aria-label={t.activityBarLabel}>
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

      <div className={styles.spacer} />
      <div className={styles.sep} />

      {/* Two locales, so one button that names the current one — the same
          convention as the theme switch below. */}
      <ActivityButton
        glyph={t.languageCode}
        label={`${t.language}: ${t.languageCurrent}`}
        // eslint-disable-next-line no-restricted-syntax -- picks the other locale, not text
        onClick={() => setLocale(currentLocale === 'cs' ? 'en' : 'cs')}
      />
      <ActivityButton
        Icon={showTechnicalDetails ? CodeRegular : EyeRegular}
        label={showTechnicalDetails ? t.technicalView : t.consultantView}
        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        active={showTechnicalDetails}
      />
      {/* The switch shared with the site rather than an `ActivityButton`;
          `.activity-bar .er-theme-switch` in index.css drops its border and
          matches the rail's touch size, so it lines up with its neighbours. */}
      <div className={styles.btnWrap}>
        <ThemeSwitch />
      </div>
    </nav>
  );
}

interface ActivityButtonProps {
  /** Either an icon or a short text glyph. */
  Icon?: FluentIcon;
  glyph?: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
  badge?: number;
}

function ActivityButton({ Icon, glyph, label, onClick, active, shortcut, badge }: ActivityButtonProps) {
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
          className={mergeClasses('activity-bar__btn', styles.btn, active && styles.btnActive)}
        >
          {Icon ? <Icon fontSize={22} /> : <span className={styles.glyph} aria-hidden>{glyph}</span>}
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
