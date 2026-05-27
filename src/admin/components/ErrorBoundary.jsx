import { Component } from 'preact';

/**
 * Top-level error boundary — catches render errors so a bad page doesn't blank
 * the whole admin UI. Logs to the console and offers a reload button.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        <div className="max-w-lg w-full bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700/40 rounded-lg p-6">
          <h1 className="text-lg font-semibold mb-2">Something broke.</h1>
          <p className="text-sm text-slate-500 mb-4">
            The admin UI hit an unexpected error while rendering. The original
            page details are in the browser console.
          </p>
          <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-3 text-xs font-mono text-red-700 dark:text-red-300 overflow-x-auto whitespace-pre-wrap break-all">
            {String(this.state.error && this.state.error.message || this.state.error)}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-sm px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-600 text-white"
            >
              Reload
            </button>
            <a
              href="/admin"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
