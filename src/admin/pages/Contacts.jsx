import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { formatRelativeTime } from '../lib/format.js';

export function Contacts() {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const timer = setTimeout(() => {
      api.get('/admin/api/contacts' + qs)
        .then(d => { if (!cancelled) { setRows(d.rows || []); setLoading(false); }})
        .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); }});
    }, 200); // debounce
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  const columns = [
    { key: 'display_name', label: 'Name', render: r => r.display_name || <span className="text-slate-400">—</span> },
    { key: 'wa_id',        label: 'WhatsApp ID', render: r => <span className="font-mono text-xs">{r.wa_id}</span> },
    {
      key: 'last_message_at',
      label: 'Last activity',
      render: r => <span className="text-slate-500 text-xs">{formatRelativeTime(r.last_message_at)}</span>,
    },
    {
      key: 'tags',
      label: 'Tags',
      render: r => (Array.isArray(r.tags) && r.tags.length > 0)
        ? r.tags.map(t => <span key={t} className="inline-block bg-slate-100 dark:bg-slate-700 text-xs px-2 py-0.5 rounded mr-1">{t}</span>)
        : <span className="text-slate-400 text-xs">—</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${rows.length} loaded`}
        actions={
          <input
            type="search"
            placeholder="Search name or wa_id…"
            value={search}
            onInput={e => setSearch(e.currentTarget.value)}
            className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 bg-white dark:bg-slate-800 w-64"
          />
        }
      />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={rows} getRowKey={r => r.wa_id} emptyText={search ? 'No contacts match the search.' : 'No contacts yet.'} />
      )}
    </>
  );
}
