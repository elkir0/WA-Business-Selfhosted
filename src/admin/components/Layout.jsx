import { useLocation } from 'preact-iso';

const NAV = [
  { href: '/admin',                label: 'Dashboard',  icon: 'home' },
  { href: '/admin/conversations',  label: 'Conversations', icon: 'chat' },
  { href: '/admin/contacts',       label: 'Contacts',   icon: 'users' },
  { href: '/admin/forwards',       label: 'Forwards',   icon: 'arrow' },
  { href: '/admin/system',         label: 'System',     icon: 'server' },
  { href: '/admin/audit',          label: 'Audit log',  icon: 'log' },
];

export function Layout({ children }) {
  const { url } = useLocation();
  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr]">
      <Sidebar currentPath={url} />
      <div className="flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 p-6 max-w-6xl w-full">
          {children}
        </main>
        <footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-xs text-slate-500">
          Not affiliated with Meta Platforms or WhatsApp LLC.
        </footer>
      </div>
    </div>
  );
}

function Sidebar({ currentPath }) {
  return (
    <aside className="border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 flex flex-col">
      <div className="px-5 py-5 flex items-baseline gap-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-lg font-bold tracking-tight">wa.business</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">admin</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(item => {
          const active = isActive(currentPath, item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={
                'block rounded-md px-3 py-2 text-sm transition-colors '
                + (active
                  ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-medium'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/40'
                )
              }
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-200 dark:border-slate-700">
        <form method="POST" action="/admin/logout">
          <CsrfField />
          <button
            type="submit"
            className="w-full text-left text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/40"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-6 py-3 flex items-center justify-between">
      <div className="text-sm text-slate-500">
        WA-Business-Selfhosted &middot; pre-alpha
      </div>
      <div className="text-xs text-slate-400">
        {/* placeholder for live connection status badge */}
      </div>
    </header>
  );
}

function isActive(currentPath, href) {
  if (href === '/admin') return currentPath === '/admin' || currentPath === '/admin/';
  return currentPath.startsWith(href);
}

import { useEffect, useState } from 'preact/hooks';

function CsrfField() {
  const [token, setToken] = useState('');
  useEffect(() => {
    fetch('/admin/csrf-token', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => setToken(d.token || ''))
      .catch(() => setToken(''));
  }, []);
  return <input type="hidden" name="_csrf" value={token} />;
}
