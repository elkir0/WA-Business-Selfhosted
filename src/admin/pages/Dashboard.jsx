import { useEffect, useRef, useState } from 'preact/hooks';
import Chart from 'chart.js/auto';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { StatCard } from '../components/StatCard.jsx';

export function Dashboard() {
  const [stats, setStats] = useState(null);
  const [series, setSeries] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [a, b, c] = await Promise.all([
          api.get('/admin/api/dashboard/stats'),
          api.get('/admin/api/dashboard/messages-by-hour'),
          api.get('/admin/api/dashboard/status-breakdown'),
        ]);
        if (cancelled) return;
        setStats(a);
        setSeries(b);
        setBreakdown(c);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    }
    load();
    const tid = setInterval(load, 30_000); // poll every 30s
    return () => { cancelled = true; clearInterval(tid); };
  }, []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Last 24h activity. Auto-refreshes every 30 seconds."
      />

      {err && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 px-4 py-3 rounded-md text-sm">
          {err}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Sent (24h)"      value={stats?.sent_24h}     />
        <StatCard label="Received (24h)"  value={stats?.received_24h} />
        <StatCard label="Active convs"    value={stats?.active_conversations} hint="window open" />
        <StatCard label="Failed forwards" value={stats?.failed_forwards} tone={stats?.failed_forwards > 0 ? 'warning' : 'default'} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Card title="Messages per hour (24h)">
          <MessagesPerHourChart data={series} />
        </Card>
        <Card title="Outbound status breakdown (24h)">
          <StatusBreakdownChart data={breakdown} />
        </Card>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Delivered (24h)" value={stats?.delivered_24h} tone="success" />
        <StatCard label="Read (24h)"      value={stats?.read_24h}      tone="success" />
        <StatCard label="Failed (24h)"    value={stats?.failed_24h}    tone={stats?.failed_24h > 0 ? 'danger' : 'default'} />
        <StatCard label="Total contacts"  value={stats?.total_contacts} />
      </section>
    </>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5">
      <h2 className="text-sm uppercase tracking-widest text-slate-500 mb-4">{title}</h2>
      <div className="h-64">{children}</div>
    </div>
  );
}

function MessagesPerHourChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // Build a per-hour time axis with separate inbound/outbound series.
    const hours = new Set();
    data.rows.forEach(r => hours.add(new Date(r.hour).toISOString()));
    const sortedHours = [...hours].sort();
    const labels = sortedHours.map(h => new Date(h).toLocaleTimeString([], { hour: '2-digit' }));
    const inbound = sortedHours.map(h => {
      const row = data.rows.find(r => new Date(r.hour).toISOString() === h && r.direction === 'inbound');
      return row ? parseInt(row.count, 10) : 0;
    });
    const outbound = sortedHours.map(h => {
      const row = data.rows.find(r => new Date(r.hour).toISOString() === h && r.direction === 'outbound');
      return row ? parseInt(row.count, 10) : 0;
    });

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Outbound', data: outbound, backgroundColor: '#0EA5E9' },
          { label: 'Inbound',  data: inbound,  backgroundColor: '#10B981' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });

    return () => chartRef.current && chartRef.current.destroy();
  }, [data]);

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return <canvas ref={canvasRef} />;
}

function StatusBreakdownChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const colorByStatus = {
      sent:      '#94A3B8',
      delivered: '#10B981',
      read:      '#0EA5E9',
      failed:    '#EF4444',
      pending:   '#F59E0B',
      fallback_sent: '#6366F1',
    };

    const rows = data.rows || [];
    const labels = rows.map(r => r.status);
    const counts = rows.map(r => parseInt(r.count, 10));
    const colors = labels.map(s => colorByStatus[s] || '#CBD5E1');

    chartRef.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });

    return () => chartRef.current && chartRef.current.destroy();
  }, [data]);

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (data.rows.length === 0) return <p className="text-sm text-slate-500">No outbound messages in the last 24h.</p>;
  return <canvas ref={canvasRef} />;
}
