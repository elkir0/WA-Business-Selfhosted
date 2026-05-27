import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useTheme } from '../lib/theme.js';

const NAV = [
  { href: '/admin',                label: 'Dashboard' },
  { href: '/admin/conversations',  label: 'Conversations' },
  { href: '/admin/contacts',       label: 'Contacts' },
  { href: '/admin/forwards',       label: 'Forwards' },
  { href: '/admin/system',         label: 'System' },
  { href: '/admin/audit',          label: 'Audit log' },
];

export function Layout({ children }) {
  const { url } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer when route changes.
  useEffect(() => { setMobileOpen(false); }, [url]);

  // Lock body scroll when drawer is open on mobile.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      {/* Sidebar — fixed drawer on mobile, static column on md+ */}
      <aside
        className={
          'fixed md:static inset-y-0 left-0 z-30 w-64 md:w-auto '
          + 'border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 '
          + 'flex flex-col transform transition-transform duration-200 '
          + (mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0')
        }
      >
        <div className="px-5 py-5 flex items-baseline gap-2 border-b border-slate-200 dark:border-slate-700">
          <span className="text-lg font-bold tracking-tight">wa.business</span>
          <span className="text-[10px] uppercase tracking-widest text-slate-500">admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => {
            const active = isActive(url, item.href);
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

      {/* Backdrop for mobile drawer */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex flex-col min-h-screen">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6 max-w-6xl w-full">
          {children}
        </main>
        <footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-xs text-slate-500">
          Not affiliated with Meta Platforms or WhatsApp LLC.
        </footer>
      </div>
    </div>
  );
}

function Topbar({ onMenuClick }) {
  const [theme, setTheme] = useTheme();
  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 px-4 md:px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="md:hidden text-slate-600 dark:text-slate-300 p-1 -ml-1"
        >
          {/* Hamburger glyph — pure CSS for zero asset cost */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="2" y="4"  width="16" height="2" rx="1" />
            <rect x="2" y="9"  width="16" height="2" rx="1" />
            <rect x="2" y="14" width="16" height="2" rx="1" />
          </svg>
        </button>
        <div className="text-sm text-slate-500">
          WA-Business-Selfhosted &middot; pre-alpha
        </div>
      </div>
      <ThemeToggle theme={theme} setTheme={setTheme} />
    </header>
  );
}

function ThemeToggle({ theme, setTheme }) {
  const options = [
    { value: 'light',  label: 'Light' },
    { value: 'system', label: 'System' },
    { value: 'dark',   label: 'Dark' },
  ];
  return (
    <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          className={
            'px-2 py-1 transition-colors '
            + (theme === opt.value
              ? 'bg-sky-500 text-white'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/40')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function isActive(currentPath, href) {
  if (href === '/admin') return currentPath === '/admin' || currentPath === '/admin/';
  return currentPath.startsWith(href);
}

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
