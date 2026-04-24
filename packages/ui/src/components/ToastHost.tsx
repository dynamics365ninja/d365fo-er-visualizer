import {
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  MessageBarIntent,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t } from '../i18n';

const useStyles = makeStyles({
  host: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 10000,
    maxWidth: '420px',
    pointerEvents: 'none',
  },
  item: {
    pointerEvents: 'auto',
    boxShadow: tokens.shadow16,
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  body: {
    minWidth: 0,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    maxHeight: '40vh',
    overflowY: 'auto',
  },
});

function kindToIntent(kind: string): MessageBarIntent {
  switch (kind) {
    case 'success': return 'success';
    case 'warning': return 'warning';
    case 'error': return 'error';
    default: return 'info';
  }
}

/**
 * Fixed-position toast stack rendered once at the App root.
 * Migrated to Fluent UI v9 `MessageBar` for visuals.
 */
export function ToastHost() {
  const styles = useStyles();
  const toasts = useAppStore(s => s.toasts);
  const dismissToast = useAppStore(s => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.host} role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <MessageBar
          key={toast.id}
          intent={kindToIntent(toast.kind)}
          className={styles.item}
          layout="multiline"
        >
          <MessageBarBody className={styles.body}>{toast.message}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                aria-label={t.dismiss}
                icon={<DismissRegular />}
                size="small"
                onClick={() => dismissToast(toast.id)}
              />
            }
          >
            {toast.action && (
              <Button
                size="small"
                onClick={() => {
                  toast.action!.onClick();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </MessageBarActions>
        </MessageBar>
      ))}
    </div>
  );
}
