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

/**
 * VS Code-style vertical icon rail on the far left side of the app. Hosts the
 * main navigation/panel-toggle actions so the top toolbar can focus on
 * file/history operations.
 */
export function ActivityBar(props: ActivityBarProps) {
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const setShowTechnicalDetails = useAppStore(s => s.setShowTechnicalDetails);
  const warnings = useAppStore(s => s.warnings);

  return (
    <nav className="activity-bar" aria-label="Activity Bar">
      <button
        type="button"
        className="activity-bar__brand"
        onClick={props.onGoHome}
        title={t.home}
        aria-label={t.home}
      >
        <span className="activity-bar__brand-mark" aria-hidden="true">⚡</span>
      </button>

      <div className="activity-bar__sep" />

      <ActivityButton
        icon="📁"
        label={t.explorer}
        onClick={props.onToggleLeft}
        active={props.showLeft}
        shortcut="Ctrl+B"
      />
      <ActivityButton
        icon="🔍"
        label={t.search}
        onClick={props.onToggleSearch}
        active={props.showSearch}
        shortcut="Ctrl+F"
      />
      <ActivityButton
        icon="📋"
        label={t.properties}
        onClick={props.onToggleRight}
        active={props.showRight}
        shortcut="Ctrl+J"
      />
      <ActivityButton
        icon="⌘"
        label={t.commandPalette}
        onClick={props.onOpenPalette}
        shortcut="Ctrl+K"
      />
      <ActivityButton
        icon={warnings.length > 0 ? '⚠' : '✓'}
        label={warnings.length === 0 ? t.validatorOk : t.validatorIssues(warnings.length)}
        onClick={props.onToggleWarnings}
        active={props.warningsOpen}
        badge={warnings.length > 0 ? warnings.length : undefined}
        kind={warnings.length > 0 ? 'warning' : 'success'}
      />

      <div className="activity-bar__spacer" />

      <ActivityButton
        icon={showTechnicalDetails ? '</>' : '👁'}
        label={showTechnicalDetails ? t.technicalView : t.consultantView}
        onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        active={showTechnicalDetails}
      />
      <ActivityButton
        icon={themeMode === 'dark' ? '☀' : '🌙'}
        label={themeMode === 'dark' ? t.lightTheme : t.darkTheme}
        onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
      />
    </nav>
  );
}

interface ActivityButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  shortcut?: string;
  badge?: number;
  kind?: 'brand' | 'warning' | 'success';
}

function ActivityButton({ icon, label, onClick, active, shortcut, badge, kind }: ActivityButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  const cls = [
    'activity-bar__btn',
    active && 'activity-bar__btn--active',
    kind && `activity-bar__btn--${kind}`,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} title={title} aria-label={label} aria-pressed={active}>
      <span className="activity-bar__icon" aria-hidden="true">{icon}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="activity-bar__badge">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}
