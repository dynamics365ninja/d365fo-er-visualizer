import { useAppStore } from '../state/store';
import { t } from '../i18n';

/**
 * Fixed-position toast stack. Rendered once at the App root.
 */
export function ToastHost() {
  const toasts = useAppStore(s => s.toasts);
  const dismissToast = useAppStore(s => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast__icon" aria-hidden="true">{kindIcon(toast.kind)}</span>
          <div className="toast__body">
            <p className="toast__message">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action!.onClick();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            className="toast__close"
            onClick={() => dismissToast(toast.id)}
            aria-label={t.dismiss}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'success': return '✓';
    case 'warning': return '!';
    case 'error': return '×';
    default: return 'i';
  }
}
