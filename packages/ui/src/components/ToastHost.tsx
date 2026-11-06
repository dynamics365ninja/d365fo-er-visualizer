import {
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  MessageBarIntent,
  Button,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import { t } from '../i18n';
import { IndigoScope } from './IndigoScope';

// Toasts are indigo in both themes, like the sidebar: the stack sits in the
// indigo scope, so the dismiss and action buttons and the intent icons paint
// from the palette on indigo (light ink, gold focus, soft state colours).
const useStyles = makeStyles({
  host: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: 10000,
    maxWidth: '420px',
    pointerEvents: 'none',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  item: {
    pointerEvents: 'auto',
    minWidth: 0,
    maxWidth: '100%',
    minHeight: '44px',
    overflow: 'hidden',
    paddingLeft: '14px',
    backgroundColor: 'var(--er-side-bg)',
    color: 'var(--er-side-strong)',
    ...shorthands.border('1px', 'solid', 'var(--er-side-line)'),
    borderRadius: 'var(--er-radius-lg)',
    boxShadow: 'var(--er-shadow-3)',
  },
  // Information carries the indigo accent; the other intents keep the
  // state colour of their icon.
  info: {
    '& .fui-MessageBar__icon': { color: 'var(--er-accent)' },
  },
  // An error stays an indigo toast with a danger accent: a red edge, a faint
  // red cast and the red icon — no full red block.
  error: {
    backgroundColor: 'color-mix(in srgb, var(--er-danger) 12%, var(--er-side-bg))',
    ...shorthands.borderColor('color-mix(in srgb, var(--er-danger) 55%, transparent)'),
  },
  body: {
    minWidth: 0,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    maxHeight: '40vh',
    overflowY: 'auto',
    color: 'inherit',
    fontSize: 'var(--er-text-md)',
    lineHeight: '1.45',
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
    <div className={styles.host} role="region" aria-live="polite" aria-label={t.notificationsLabel}>
      <IndigoScope className={styles.stack}>
        {toasts.map(toast => {
          const intent = kindToIntent(toast.kind);
          return (
            <MessageBar
              key={toast.id}
              intent={intent}
              className={mergeClasses(styles.item, intent === 'info' && styles.info, intent === 'error' && styles.error)}
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
          );
        })}
      </IndigoScope>
    </div>
  );
}
