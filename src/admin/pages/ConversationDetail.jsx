import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/PageHeader.jsx';
import { formatDateTime } from '../lib/format.js';

export function ConversationDetail({ params }) {
  const id = params?.id;
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null);

  async function load() {
    if (!id) return;
    try {
      const [c, m] = await Promise.all([
        api.get(`/admin/api/conversations/${id}`),
        api.get(`/admin/api/conversations/${id}/messages?limit=200`),
      ]);
      setConv(c);
      setMessages((m.rows || []).slice().reverse());
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function callAction(actionPath, label) {
    setBusy(actionPath);
    setFlash(null);
    try {
      await api.post(`/admin/api/conversations/${id}/${actionPath}`);
      setFlash({ tone: 'success', text: `${label} — done.` });
      await load();
    } catch (e) {
      setFlash({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!conv) return <p className="text-sm text-slate-500">Loading…</p>;

  const botEnabled = conv.ai_enabled !== false;
  const isClosed = conv.status === 'closed';

  return (
    <>
      <PageHeader
        title={conv.display_name || conv.wa_id}
        subtitle={
          <>
            <span className="font-mono">{conv.wa_id}</span>
            <span className="mx-2">·</span>
            <span>status: <code className="font-mono">{conv.status}</code></span>
            <span className="mx-2">·</span>
            <span>bot: <code className="font-mono">{botEnabled ? 'enabled' : 'paused'}</code></span>
            {conv.unread_count > 0 && (
              <>
                <span className="mx-2">·</span>
                <span className="text-amber-600">{conv.unread_count} unread</span>
              </>
            )}
          </>
        }
        actions={
          <a href="/admin/conversations" className="text-sm text-sky-600 hover:underline">← Back</a>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {botEnabled ? (
          <ActionButton onClick={() => callAction('pause-bot', 'Bot paused')} busy={busy === 'pause-bot'} disabled={!!busy}>
            Pause bot
          </ActionButton>
        ) : (
          <ActionButton onClick={() => callAction('resume-bot', 'Bot resumed')} busy={busy === 'resume-bot'} disabled={!!busy} tone="primary">
            Resume bot
          </ActionButton>
        )}

        {isClosed ? (
          <ActionButton onClick={() => callAction('reopen', 'Conversation reopened')} busy={busy === 'reopen'} disabled={!!busy}>
            Reopen
          </ActionButton>
        ) : (
          <ActionButton onClick={() => callAction('close', 'Conversation closed')} busy={busy === 'close'} disabled={!!busy} tone="danger">
            Close conversation
          </ActionButton>
        )}

        <ActionButton
          onClick={() => callAction('mark-read', 'Marked as read')}
          busy={busy === 'mark-read'}
          disabled={!!busy || conv.unread_count === 0}
        >
          Mark as read
        </ActionButton>
      </div>

      {flash && (
        <div className={
          'mb-4 px-4 py-2 rounded-md text-sm '
          + (flash.tone === 'success'
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
            : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200')
        }>
          {flash.text}
        </div>
      )}

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

function ActionButton({ children, onClick, busy, disabled, tone = 'neutral' }) {
  const base = 'text-sm px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const toneClass = {
    neutral: 'border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700',
    primary: 'bg-sky-500 hover:bg-sky-600 text-white',
    danger:  'border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20',
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${toneClass}`}>
      {busy ? '…' : children}
    </button>
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
