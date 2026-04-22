import {
  Button,
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
  AppsListDetailRegular,
  KeyboardRegular,
  WarningRegular,
  CheckmarkCircleRegular,
  EyeRegular,
  CodeRegular,
  WeatherSunnyRegular,
  WeatherMoonRegular,
} from '@fluentui/react-icons';
import type { FluentIcon } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t } from '../i18n';

interface ActivityBarProps {
  showLeft: boolean;
  showRight: boolean;
  showSearch: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleSearch: () => void;
  onGoHome: () => void;
  onOpenPalette: () => void;
  onToggleWarnings: () => void;
  warningsOpen: boolean;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    width: '48px',
    padding: '6px 0',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  sep: {
    width: '28px',
    height: '1px',
    backgroundColor: tokens.colorNeutralStroke2,
    margin: '4px 0',
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
    minWidth: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: 'transform, background-color',
    transitionDuration: '160ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    ':hover': {
      transform: 'scale(1.08)',
    },
    ':active': {
      transform: 'scale(0.96)',
    },
  },
  btnActive: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    borderLeft: `2px solid ${tokens.colorBrandBackground}`,
  },
  badge: {
    position: 'absolute',
    top: '2px',
    right: '4px',
    pointerEvents: 'none',
  },
});

/**
 * VS Code–style vertical icon rail. Hosts main navigation and panel toggles.
 * Migrated to Fluent UI v9 (`Button` + `Tooltip` + `CounterBadge`).
 */
export function ActivityBar(props: ActivityBarProps) {
  const styles = useStyles();
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const warnings = useAppStore(s => s.warnings);

  return (
    <nav className={styles.root} aria-label="Activity Bar">
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
        active={props.showSearch}
        shortcut="Ctrl+F"
      />
      <ActivityButton
        Icon={AppsListDetailRegular}
        label={t.properties}
        onClick={props.onToggleRight}
        active={props.showRight}
        shortcut="Ctrl+J"
      />
      <ActivityButton
        Icon={KeyboardRegular}
        label={t.commandPalette}
        onClick={props.onOpenPalette}
        shortcut="Ctrl+K"
      />
      <ActivityButton
        Icon={warnings.length > 0 ? WarningRegular : CheckmarkCircleRegular}
        label={warnings.length === 0 ? t.validatorOk : t.validatorIssues(warnings.length)}
        onClick={props.onToggleWarnings}
        active={props.warningsOpen}
        badge={warnings.length > 0 ? warnings.length : undefined}
      />

      <div className={styles.spacer} />

      <ActivityButton
        Icon={showTechnicalDetails ? CodeRegular : EyeRegular}
        label={showTechnicalDetails ? t.technicalView : t.consultantView}
        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        active={showTechnicalDetails}
      />
      <ActivityButton
        Icon={themeMode === 'dark' ? WeatherSunnyRegular : WeatherMoonRegular}
        label={themeMode === 'dark' ? t.lightTheme : t.darkTheme}
        onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
      />
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
        <Button
          appearance="subtle"
          icon={<Icon />}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={mergeClasses(styles.btn, active && styles.btnActive)}
        />
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
