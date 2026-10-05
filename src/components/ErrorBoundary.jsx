import React from 'react';
import { reportError, APP_VERSION, BUILD_STAMP } from '../lib/telemetry.js';

/* Global error boundary: a render error can no longer blank the app.
 * Shows a recovery UI, reports the error to telemetry, and lets the user
 * copy a diagnostic report. */

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, { kind: 'react.render', componentStack: info?.componentStack || '', boundary: this.props.label || 'root' });
    this.setState({ info });
  }

  reset = () => this.setState({ error: null, info: null, showDetails: false, copied: false });

  report = () => {
    const { error, info } = this.state;
    const text = [
      `CryptoX diagnostic report`,
      `version: ${APP_VERSION} (${BUILD_STAMP})`,
      `time: ${new Date().toISOString()}`,
      `url: ${typeof location !== 'undefined' ? location.href : ''}`,
      `error: ${error?.name}: ${error?.message}`,
      `stack:\n${error?.stack || '(none)'}`,
      `component stack:${info?.componentStack || '(none)'}`
    ].join('\n');
    try {
      navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      /* clipboard unavailable */
    }
  };

  render() {
    const { error, info, copied, showDetails } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div role="alert" className="w-full max-w-lg rounded-2xl border border-down/40 bg-card p-6 shadow-xl">
          <h1 className="text-lg font-bold text-foreground">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The rest of CryptoX is still available. You can retry this view, or reload the app if the problem persists.
          </p>
          <p className="num mt-3 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-down">
            {error.name}: {error.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={this.reset} className="btn-primary !h-10">Try again</button>
            <button onClick={() => window.location.reload()} className="btn-ghost !h-10">Reload app</button>
            <button onClick={this.report} className="btn-sm-dark !h-10">{copied ? 'Copied ✓' : 'Copy diagnostics'}</button>
            <button onClick={() => this.setState({ showDetails: !showDetails })} className="btn-sm-dark !h-10" aria-expanded={showDetails}>
              {showDetails ? 'Hide details' : 'Details'}
            </button>
          </div>
          {showDetails ? (
            <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-background/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
{`version: ${APP_VERSION} (${BUILD_STAMP})
${error.stack || ''}
${info?.componentStack || ''}`}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }
}
