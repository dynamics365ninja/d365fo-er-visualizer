import React from 'react';
import { t } from '../i18n';
import { isChunkLoadError } from '../utils/chunk-load-error';

interface Props {
  children: React.ReactNode;
  /** Human-readable context shown above the error (e.g. "Designer"). */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Generic React error boundary. Prefer wrapping each major region of the app
 * (landing, explorer, designer, inspector) individually so a crash in one
 * region does not take down the whole UI.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info);
  }

  private reset = () => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // A chunk that failed to download stays failed: React.lazy keeps the
    // rejected import, and Vite never requests the same stylesheet twice, so a
    // retry would at best render the view unstyled. Only a reload recovers.
    const chunkFailed = isChunkLoadError(error);

    return (
      <div className="error-boundary">
        <div className="error-boundary__card" role="alert">
          <div className="error-boundary__eyebrow">{this.props.label ?? t.errorLabel}</div>
          <h2 className="error-boundary__title">{chunkFailed ? t.errorChunkTitle : t.errorTitle}</h2>
          <p className="error-boundary__text">
            {chunkFailed ? t.errorChunkDescription : t.errorDescription}
          </p>
          <pre className="error-boundary__details">{error.stack ?? error.message}</pre>
          {chunkFailed ? (
            <button type="button" className="error-boundary__btn" onClick={() => window.location.reload()}>
              {t.errorReload}
            </button>
          ) : (
            <button type="button" className="error-boundary__btn" onClick={this.reset}>
              {t.errorRetry}
            </button>
          )}
        </div>
      </div>
    );
  }
}
