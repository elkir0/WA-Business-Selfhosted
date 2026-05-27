import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { formatDateTime } from '../lib/format.js';

export function ConversationDetail({ params }) {
  const id = params?.id;
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      api.get(`/admin/api/conversations/${id}`),
      api.get(`/admin/api/conversations/${id}/messages?limit=200`),
    ])
      .then(([c, m]) => {
        if (cancelled) return;
        setConv(c);
        setMessages((m.rows || []).slice().reverse()); // oldest first
      })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!conv) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <>
      <PageHeader
        title={conv.display_name || conv.wa_id}
        subtitle={`${conv.wa_id} · status: ${conv.status}`}
        actions={
          <a href="/admin/conversations" className="text-sm text-sky-600 hover:underline">← Back to list</a>
        }
      />

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-widest text-slate-500">
          Messages — {messages.length} loaded
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {messages.map(m => <MessageBubble key={m.id} m={m} />)}
        </div>
      </div>
    </>
  );
}

function MessageBubble({ m }) {
  const outbound = m.direction === 'outbound';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-lg px-3 py-2 rounded-lg text-sm ${
        outbound
          ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-900 dark:text-sky-100'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
      }`}>
        <div className="text-xs text-slate-500 mb-1 flex items-center gap-2">
          <span>{outbound ? 'sent' : 'received'}</span>
          <span>·</span>
          <span>{m.message_type}</span>
          {m.status && <span className="font-mono text-[10px] bg-slate-200 dark:bg-slate-600 px-1 rounded">{m.status}</span>}
        </div>
        <div className="whitespace-pre-wrap break-words">
          {m.content || <span className="text-slate-400 italic">[{m.message_type}]</span>}
        </div>
        <div className="text-[10px] text-slate-500 mt-1">{formatDateTime(m.created_at)}</div>
      </div>
    </div>
  );
}
