import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { formatRelativeTime, formatNumber } from '../lib/format.js';

export function Conversations() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    api.get('/admin/api/conversations' + qs)
      .then(d => { if (!cancelled) { setRows(d.rows || []); setLoading(false); }})
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); }});
    return () => { cancelled = true; };
  }, [statusFilter]);

  const columns = [
    {
      key: 'display_name',
      label: 'Contact',
      render: r => (
        <a href={`/admin/conversations/${r.conversation_id}`} className="text-sky-600 dark:text-sky-400 hover:underline">
          <div className="font-medium">{r.display_name || r.wa_id}</div>
          <div className="text-xs text-slate-500">{r.wa_id}</div>
        </a>
      ),
    },
    {
      key: 'last_message_preview',
      label: 'Last message',
      render: r => (
        <div className="text-sm text-slate-600 dark:text-slate-300 max-w-md truncate">
          {r.last_message_preview || <span className="text-slate-400">—</span>}
        </div>
      ),
    },
    { key: 'unread_count', label: 'Unread', render: r => formatNumber(r.unread_count) },
    { key: 'status',       label: 'Status' },
    {
      key: 'last_message_at',
      label: 'Last activity',
      render: r => <span className="text-slate-500 text-xs">{formatRelativeTime(r.last_message_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Conversations"
        subtitle={`${rows.length} loaded`}
        actions={
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.currentTarget.value)}
            className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 bg-white dark:bg-slate-800"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="closed">Closed</option>
          </select>
        }
      />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable columns={columns} rows={rows} getRowKey={r => r.conversation_id} emptyText="No conversations match the filters." />
      )}
    </>
  );
}
