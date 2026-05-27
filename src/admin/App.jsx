import { useEffect, useState } from 'preact/hooks';

export function App() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    fetch('/api/health', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => setHealth({ state: 'ok', data }))
      .catch(err => setHealth({ state: 'error', message: err.message }));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-tight">wa.business</span>
            <span className="text-xs uppercase tracking-widest text-slate-500">admin</span>
          </div>
          <form method="POST" action="/admin/logout" className="text-sm">
            <CsrfField />
            <button
              type="submit"
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <h1 className="text-2xl font-semibold mb-2">Dashboard</h1>
        <p className="text-slate-500 mb-8">
          Phase 2a scaffold. KPI cards, conversations, contacts, audit log,
          and actions land in subsequent phases.
        </p>

        <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-widest text-slate-500 mb-3">Gateway health</h2>
          {health.state === 'loading' && <p>Checking…</p>}
          {health.state === 'error' && (
            <p className="text-red-500">Failed to reach /api/health: {health.message}</p>
          )}
          {health.state === 'ok' && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {Object.entries(health.data).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-mono">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-4 text-center text-xs text-slate-500">
        WA-Business-Selfhosted &middot; Not affiliated with Meta Platforms or WhatsApp LLC.
      </footer>
    </div>
  );
}

// Reads the CSRF token from /admin/csrf-token and injects it as a hidden input.
function CsrfField() {
  const [token, setToken] = useState('');
  useEffect(() => {
    fetch('/admin/csrf-token', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => setToken(data.token || ''))
      .catch(() => setToken(''));
  }, []);
  return <input type="hidden" name="_csrf" value={token} />;
}
