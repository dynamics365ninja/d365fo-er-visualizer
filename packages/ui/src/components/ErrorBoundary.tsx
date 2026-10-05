import React from 'react';
import { t } from '../i18n';
import { isChunkLoadError, reloadOnceForChunkError } from '../utils/chunk-load-error';

interface Props {
  children: React.ReactNode;
  /** Human-readable context shown above the error (e.g. "Designer"). */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
  /** A chunk failed and the page is already reloading to fetch the new build. */
  reloading: boolean;
}

/**
 * Generic React error boundary. Prefer wrapping each major region of the app
 * (landing, explorer, designer, inspector) individually so a crash in one
 * region does not take down the whole UI.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Usually a deploy replaced the hashed files under an open tab: a reload
    // fetches the new build, so do it rather than make the user click.
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      this.setState({ reloading: true });
      return;
    }
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info);
  }

  private reset = () => this.setState({ error: null, reloading: false });

  render(): React.ReactNode {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading) return null;
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
