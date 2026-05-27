import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { formatBytes, formatDuration } from '../lib/format.js';

export function System() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.get('/admin/api/system')
        .then(d => { if (!cancelled) setData(d); })
        .catch(e => { if (!cancelled) setErr(e.message); });
    }
    load();
    const tid = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(tid); };
  }, []);

  return (
    <>
      <PageHeader title="System health" subtitle="Refreshed every 10 seconds." />
      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}
      {!data && <p className="text-sm text-slate-500">Loading…</p>}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Process">
            <KV k="Node version" v={data.node_version} />
            <KV k="PID"          v={data.pid} mono />
            <KV k="Uptime"       v={formatDuration(data.uptime_seconds)} />
            <KV k="Hostname"     v={data.hostname} mono />
            <KV k="Platform"     v={`${data.platform} (${data.arch})`} />
          </Card>

          <Card title="Memory">
            <KV k="RSS"          v={formatBytes(data.memory.rss)} />
            <KV k="Heap used"    v={formatBytes(data.memory.heapUsed)} />
            <KV k="Heap total"   v={formatBytes(data.memory.heapTotal)} />
            <KV k="External"     v={formatBytes(data.memory.external)} />
          </Card>

          <Card title="Database">
            <KV k="Reachable" v={<Pill ok={data.db.ok} />} />
            {data.db.now   && <KV k="Server time" v={new Date(data.db.now).toLocaleString()} />}
            {data.db.error && <KV k="Error" v={<span className="text-red-600 font-mono text-xs">{data.db.error}</span>} />}
          </Card>

          <Card title="Media storage">
            <KV k="Root"     v={<span className="font-mono text-xs">{data.media.root}</span>} />
            <KV k="Writable" v={<Pill ok={data.media.writable} />} />
          </Card>

          <Card title="Plugins">
            <KV k="webhook-forward" v={<Pill ok={data.plugins.webhook_forward.enabled} okLabel="enabled" badLabel="disabled" />} />
            <KV k="sms-fallback"    v={<Pill ok={data.plugins.sms_fallback.enabled}    okLabel="enabled" badLabel="disabled" />} />
          </Card>

          <Card title="Load average">
            <KV k="1m"  v={data.load_average[0]?.toFixed(2)}  />
            <KV k="5m"  v={data.load_average[1]?.toFixed(2)}  />
            <KV k="15m" v={data.load_average[2]?.toFixed(2)}  />
          </Card>
        </div>
      )}
    </>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
      <h2 className="text-xs uppercase tracking-widest text-slate-500 mb-4">{title}</h2>
      <dl className="text-sm space-y-2">{children}</dl>
    </div>
  );
}

function KV({ k, v, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{v ?? '—'}</dd>
    </div>
  );
}

function Pill({ ok, okLabel = 'ok', badLabel = 'down' }) {
  return ok
    ? <span className="text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 text-xs px-2 py-0.5 rounded">{okLabel}</span>
    : <span className="text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 text-xs px-2 py-0.5 rounded">{badLabel}</span>;
}
