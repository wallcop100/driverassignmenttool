import { Component } from 'react';
import { errorId } from '../core/errorId.js';

// A crash used to unmount the app to a blank page, which tells the person
// nothing and tells whoever has to fix it less. This catches it and says what
// broke, where, and under which id - and hands over the whole report in one
// click, because a screenshot of a stack trace is not a bug report.
//
// It catches errors thrown while rendering. Something thrown later (a click
// handler, a promise) does not unmount React, so those are picked up by the
// window listeners and shown the same way.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, at: null };
    this.onError = (e) => this.take(e.error ?? e.message, null);
    this.onRejection = (e) => this.take(e.reason, null);
  }

  componentDidMount() {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  static getDerivedStateFromError(error) {
    return { error, at: new Date().toISOString() };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // still say it out loud: the console is where a developer looks first
    console.error(`[${errorId(error, this.props.where ?? '')}]`, error, info?.componentStack);
  }

  take(error, info) {
    if (this.state.error) return; // the first fault is the one worth reporting
    this.setState({ error, info, at: new Date().toISOString() });
    console.error(`[${errorId(error, this.props.where ?? '')}]`, error);
  }

  report() {
    const { error, info, at } = this.state;
    const { where, context } = this.props;
    return [
      `Error ${errorId(error, where ?? '')}`,
      `Screen: ${where ?? 'unknown'}`,
      context?.hubRef ? `Hub: ${context.hubRef}` : null,
      context?.systemSetId ? `Set: ${context.systemSetId}` : null,
      `When: ${at}`,
      `Message: ${error?.message ?? String(error)}`,
      `Where: ${(error?.stack ?? '').split('\n').slice(0, 4).join('\n')}`,
      info?.componentStack ? `Component: ${info.componentStack.split('\n').slice(0, 4).join('\n')}` : null,
      `Page: ${window.location.href}`,
    ].filter(Boolean).join('\n');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const id = errorId(error, this.props.where ?? '');
    return (
      <div className="app-error" role="alert">
        <div className="app-error-card">
          <span className="material-icons app-error-icon">error_outline</span>
          <h5 className="mb-1">Something in the tool broke</h5>
          <p className="text-secondary small mb-3">
            Your work is still saved. Send this id back and it can be traced to the exact fault.
          </p>
          <div className="app-error-id" title="Quote this when you report it">{id}</div>
          <dl className="app-error-facts">
            <dt>Screen</dt><dd>{this.props.where ?? 'unknown'}</dd>
            <dt>What</dt><dd>{error?.message ?? String(error)}</dd>
          </dl>
          <div className="app-error-acts">
            <button className="btn btn-sm btn-primary"
              onClick={() => navigator.clipboard?.writeText(this.report()).then(
                () => this.setState({ copied: true }),
                () => this.setState({ copied: false }),
              )}>
              <span className="material-icons small-icon align-middle">content_copy</span>
              {this.state.copied ? ' Copied' : ' Copy the report'}
            </button>
            <button className="btn btn-sm btn-outline-secondary"
              onClick={() => this.setState({ error: null, info: null, copied: false })}>
              Back to the tool
            </button>
            <button className="btn btn-sm btn-link" onClick={() => window.location.reload()}>Reload</button>
          </div>
          <details className="app-error-more">
            <summary>The full report</summary>
            <pre>{this.report()}</pre>
          </details>
        </div>
      </div>
    );
  }
}
