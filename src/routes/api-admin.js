/**
 * /admin/api/* endpoints — internal API consumed by the bundled admin UI.
 *
 * All routes here require an admin session (cookie-based) — NOT the Bearer
 * token used by the public /api/*. A leak of the Bearer token cannot give
 * admin control.
 *
 * Phase 2b shipping read-only endpoints. State-changing actions land in
 * Phase 2c (retry forwards, pause bot, send template, etc.) gated by CSRF.
 */

const express = require('express');
const os = require('node:os');
const fs = require('node:fs');
const { requireAdminSession } = require('../lib/admin-auth');
const { listRecentAudit, audit } = require('../lib/admin-audit');
const { verifyCsrf } = require('../lib/csrf');
const webhookForward = require('../plugins/webhook-forward');
const db = require('../lib/db');

const router = express.Router();
router.use(requireAdminSession);
// CSRF is checked on state-changing verbs; safe verbs are passed through.
router.use(verifyCsrf);

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard/stats', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours' AND direction='outbound') AS sent_24h,
        (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours' AND direction='inbound')  AS received_24h,
        (SELECT COUNT(*) FROM conversations WHERE window_expires > NOW())                                       AS active_conversations,
        (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours' AND status='delivered')   AS delivered_24h,
        (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours' AND status='read')        AS read_24h,
        (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours' AND status='failed')      AS failed_24h,
        (SELECT COUNT(*) FROM contacts)                                                                         AS total_contacts
    `);
    const row = result.rows[0];
    res.json({
      sent_24h:               parseInt(row.sent_24h, 10),
      received_24h:           parseInt(row.received_24h, 10),
      active_conversations:   parseInt(row.active_conversations, 10),
      delivered_24h:          parseInt(row.delivered_24h, 10),
      read_24h:               parseInt(row.read_24h, 10),
      failed_24h:             parseInt(row.failed_24h, 10),
      total_contacts:         parseInt(row.total_contacts, 10),
      failed_forwards:        webhookForward.getFailed().length,
    });
  } catch (err) {
    console.error('[admin-api] dashboard/stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

router.get('/dashboard/messages-by-hour', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT
        date_trunc('hour', created_at) AS hour,
        direction,
        COUNT(*) AS count
      FROM messages
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY hour, direction
      ORDER BY hour ASC
    `);
    res.json({ rows: result.rows });
  } catch (err) {
    console.error('[admin-api] messages-by-hour error:', err.message);
    res.status(500).json({ error: 'Failed to fetch series.' });
  }
});

router.get('/dashboard/status-breakdown', async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT status, COUNT(*) AS count
      FROM messages
      WHERE direction='outbound'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY count DESC
    `);
    res.json({ rows: result.rows });
  } catch (err) {
    console.error('[admin-api] status-breakdown error:', err.message);
    res.status(500).json({ error: 'Failed to fetch breakdown.' });
  }
});

// ── Conversations ────────────────────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = await db.getConversations(limit, offset, status);
    res.json({ rows });
  } catch (err) {
    console.error('[admin-api] conversations error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const conv = await db.getConversation(parseInt(req.params.id, 10));
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  } catch (err) {
    console.error('[admin-api] conversation detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch conversation.' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const rows = await db.getMessages(parseInt(req.params.id, 10), limit, before);
    res.json({ rows });
  } catch (err) {
    console.error('[admin-api] conversation messages error:', err.message);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// ── Contacts ─────────────────────────────────────────────────────────────────

router.get('/contacts', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : null;
    const rows = await db.getContacts(limit, offset, search);
    res.json({ rows });
  } catch (err) {
    console.error('[admin-api] contacts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts.' });
  }
});

router.get('/contacts/:waId', async (req, res) => {
  try {
    const contact = await db.getContact(req.params.waId);
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    res.json(contact);
  } catch (err) {
    console.error('[admin-api] contact detail error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contact.' });
  }
});

// ── Failed webhook forwards ──────────────────────────────────────────────────

router.get('/forwards/failed', (req, res) => {
  res.json({
    count: webhookForward.getFailed().length,
    enabled: webhookForward.isEnabled(),
    failures: webhookForward.getFailed(),
  });
});

// ── System health (live) ─────────────────────────────────────────────────────

router.get('/system', async (req, res) => {
  const out = {
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    pid: process.pid,
    memory: process.memoryUsage(),
    load_average: os.loadavg(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    db: { ok: false },
    media: { root: process.env.MEDIA_ROOT || '/var/lib/whatsapp-media', writable: false },
    plugins: {
      webhook_forward: { enabled: webhookForward.isEnabled() },
      sms_fallback:    { enabled: !!process.env.SMS_FALLBACK_DRIVER && process.env.SMS_FALLBACK_DRIVER !== 'disabled' },
    },
  };

  try {
    const r = await db.pool.query('SELECT NOW() AS now');
    out.db.ok = true;
    out.db.now = r.rows[0].now;
  } catch (err) {
    out.db.error = err.message;
  }

  try {
    fs.accessSync(out.media.root, fs.constants.W_OK);
    out.media.writable = true;
  } catch {
    // not writable / does not exist
  }

  res.json(out);
});

// ── Audit log ────────────────────────────────────────────────────────────────

router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const rows = await listRecentAudit(limit, offset);
    res.json({ rows });
  } catch (err) {
    console.error('[admin-api] audit error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ACTIONS — state-changing operations (CSRF + audit + session-auth)
// ════════════════════════════════════════════════════════════════════════════

// ── Failed forwards: retry one / retry all / clear ──────────────────────────

router.post('/forwards/:id/retry',
  audit('forward_retry', 'forward', r => r.params.id),
  async (req, res) => {
    const result = await webhookForward.retryFailed(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

router.post('/forwards/retry-all',
  audit('forward_retry_all', 'forward'),
  async (req, res) => {
    const result = await webhookForward.retryAll();
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }
);

router.delete('/forwards',
  audit('forward_clear_all', 'forward'),
  (req, res) => {
    const before = webhookForward.getFailed().length;
    webhookForward.clearFailed();
    res.json({ ok: true, cleared: before });
  }
);

// ── Conversation actions ────────────────────────────────────────────────────

router.post('/conversations/:id/pause-bot',
  audit('bot_pause', 'conversation', r => r.params.id),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const conv = await db.updateConversation(id, { ai_enabled: false });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  }
);

router.post('/conversations/:id/resume-bot',
  audit('bot_resume', 'conversation', r => r.params.id),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const conv = await db.updateConversation(id, { ai_enabled: true });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  }
);

router.post('/conversations/:id/close',
  audit('conversation_close', 'conversation', r => r.params.id),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const conv = await db.updateConversation(id, { status: 'closed' });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  }
);

router.post('/conversations/:id/reopen',
  audit('conversation_reopen', 'conversation', r => r.params.id),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const conv = await db.updateConversation(id, { status: 'active' });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    res.json(conv);
  }
);

router.post('/conversations/:id/mark-read',
  audit('conversation_mark_read', 'conversation', r => r.params.id),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    await db.markConversationRead(id);
    res.json({ ok: true });
  }
);

module.exports = router;
