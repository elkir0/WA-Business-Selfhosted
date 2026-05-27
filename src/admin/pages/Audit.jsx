import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { formatDateTime } from '../lib/format.js';

export function Audit() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/admin/api/audit?limit=200')
      .then(d => { if (!cancelled) { setRows(d.rows || []); setLoading(false); }})
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); }});
    return () => { cancelled = true; };
  }, []);

  const columns = [
    { key: 'created_at', label: 'When',
      render: r => <span className="text-slate-500 text-xs">{formatDateTime(r.created_at)}</span> },
    { key: 'admin_user', label: 'User' },
    { key: 'action',     label: 'Action',
      render: r => <span className="font-mono text-xs">{r.action}</span> },
    { key: 'target',     label: 'Target',
      render: r => <span className="text-xs">
        {r.target_type ? `${r.target_type}:` : ''}<span className="font-mono">{r.target_id || '—'}</span>
      </span> },
    { key: 'result',     label: 'Result',
      render: r => r.result === 'success'
        ? <span className="text-emerald-600 dark:text-emerald-400 text-xs">success</span>
        : <span className="text-red-600 dark:text-red-400 text-xs">{r.result}</span> },
    { key: 'ip',         label: 'IP',
      render: r => <span className="font-mono text-xs text-slate-500">{r.ip || '—'}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={`${rows.length} most recent admin actions. New entries appear after Phase 2c actions ship.`}
      />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {loading
        ? <p className="text-sm text-slate-500">Loading…</p>
        : <DataTable columns={columns} rows={rows} getRowKey={r => r.id} emptyText="No actions logged yet." />
      }
    </>
  );
}
