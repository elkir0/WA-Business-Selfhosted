import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { formatRelativeTime, formatBytes } from '../lib/format.js';

export function FailedForwards() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null); // 'retry-all' | 'clear-all' | id of single retry
  const [flash, setFlash] = useState(null);

  function load() {
    return api.get('/admin/api/forwards/failed')
      .then(setData)
      .catch(e => setErr(e.message));
  }

  useEffect(() => {
    load();
    const tid = setInterval(load, 15_000);
    return () => clearInterval(tid);
  }, []);

  async function onRetry(id) {
    setBusy(id);
    setFlash(null);
    try {
      const r = await api.post(`/admin/api/forwards/${id}/retry`);
      setFlash({ tone: 'success', text: r.ok ? 'Retried successfully.' : r.error });
    } catch (e) {
      setFlash({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function onRetryAll() {
    setBusy('retry-all');
    setFlash(null);
    try {
      const r = await api.post('/admin/api/forwards/retry-all');
      setFlash({
        tone: r.stillFailed > 0 ? 'warning' : 'success',
        text: `Succeeded: ${r.succeeded ?? 0} · Still failed: ${r.stillFailed ?? 0} · Skipped (truncated): ${r.skippedTruncated ?? 0}`,
      });
    } catch (e) {
      setFlash({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function onClearAll() {
    if (!confirm('Clear all failed forwards? This cannot be undone.')) return;
    setBusy('clear-all');
    setFlash(null);
    try {
      const r = await api.del('/admin/api/forwards');
      setFlash({ tone: 'success', text: `Cleared ${r.cleared} entries.` });
    } catch (e) {
      setFlash({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
      await load();
    }
  }

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
      render: r => (
        <div className="space-y-0.5">
          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all">
            {r.bodyPreview}
          </span>
          <div className="text-[10px] text-slate-500">
            {formatBytes(r.bodyBytes)}
            {r.bodyTruncated && <span className="text-amber-600 ml-2">truncated — cannot retry</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: r => (
        <button
          type="button"
          onClick={() => onRetry(r.id)}
          disabled={!!busy || r.bodyTruncated || !data?.enabled}
          className="text-xs px-3 py-1 rounded-md bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === r.id ? 'Retrying…' : 'Retry'}
        </button>
      ),
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
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRetryAll}
              disabled={!!busy || !data?.enabled || (data?.count ?? 0) === 0}
              className="text-sm px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'retry-all' ? 'Retrying all…' : 'Retry all'}
            </button>
            <button
              type="button"
              onClick={onClearAll}
              disabled={!!busy || (data?.count ?? 0) === 0}
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'clear-all' ? 'Clearing…' : 'Clear all'}
            </button>
          </div>
        }
      />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {flash && (
        <div className={
          'mb-4 px-4 py-2 rounded-md text-sm '
          + (flash.tone === 'success' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
            : flash.tone === 'warning' ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
            : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200')
        }>
          {flash.text}
        </div>
      )}
      {!data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.failures || []}
          getRowKey={r => r.id}
          emptyText={data.enabled ? 'No failures.' : 'Plugin is disabled.'}
        />
      )}
    </>
  );
}
