import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { formatRelativeTime } from '../lib/format.js';

export function FailedForwards() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.get('/admin/api/forwards/failed')
        .then(d => { if (!cancelled) setData(d); })
        .catch(e => { if (!cancelled) setErr(e.message); });
    }
    load();
    const tid = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(tid); };
  }, []);

  const columns = [
    {
      key: 'timestamp',
      label: 'When',
      render: r => <span className="text-slate-500 text-xs">{formatRelativeTime(r.timestamp)}</span>,
    },
    {
      key: 'error',
      label: 'Error',
      render: r => <span className="font-mono text-xs text-red-600 dark:text-red-400">{r.error}</span>,
    },
    {
      key: 'bodyPreview',
      label: 'Body preview',
      render: r => <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all">{r.bodyPreview}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Failed webhook forwards"
        subtitle={
          data?.enabled
            ? `Plugin enabled · ${data?.count ?? 0} failures kept in memory (max 100)`
            : 'Plugin disabled (set WEBHOOK_FORWARD_URL to enable)'
        }
      />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {!data && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <>
          <div className="mb-4 text-sm text-slate-500">
            Retrying failures (single + bulk) lands in Phase 2c.
          </div>
          <DataTable
            columns={columns}
            rows={data.failures || []}
            emptyText={data.enabled ? 'No failures yet.' : 'Plugin is disabled.'}
          />
        </>
      )}
    </>
  );
}
