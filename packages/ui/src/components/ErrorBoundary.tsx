import React from 'react';

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

    return (
      <div className="error-boundary">
        <div className="error-boundary__card" role="alert">
          <div className="error-boundary__eyebrow">{this.props.label ?? 'Error'}</div>
          <h2 className="error-boundary__title">Něco se pokazilo.</h2>
          <p className="error-boundary__text">
            Tato část aplikace narazila na neočekávanou chybu. Zbytek aplikace by měl fungovat dál.
          </p>
          <pre className="error-boundary__details">{error.stack ?? error.message}</pre>
          <button type="button" className="error-boundary__btn" onClick={this.reset}>
            Zkusit znovu
          </button>
        </div>
      </div>
    );
  }
}
