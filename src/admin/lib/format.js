/**
 * Small formatting helpers used across pages.
 */

export function formatNumber(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat().format(n);
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const delta = (Date.now() - d.getTime()) / 1000;
  if (delta < 60)     return `${Math.floor(delta)}s ago`;
  if (delta < 3600)   return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400)  return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function formatBytes(n) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function maskPhone(p) {
  if (!p || typeof p !== 'string') return '—';
  if (p.length <= 6) return p;
  return p.slice(0, 4) + '***' + p.slice(-4);
}
