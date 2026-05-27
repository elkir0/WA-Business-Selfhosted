/**
 * Database helper — PostgreSQL pool + convenience methods.
 *
 * Connection parameters come from env vars:
 *   DB_HOST     (default: 127.0.0.1)
 *   DB_PORT     (default: 5432)
 *   DB_NAME     (default: whatsapp_messages)
 *   DB_USER     (default: whatsapp)
 *   DB_PASSWORD (REQUIRED — process exits if missing)
 *
 * Schema and required SQL views/functions are defined in db/schema.sql and
 * db/migrations/. Run those before starting the server.
 */

const { Pool } = require('pg');

if (!process.env.DB_PASSWORD) {
  console.error('[DB] FATAL: DB_PASSWORD environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'whatsapp_messages',
  user: process.env.DB_USER || 'whatsapp',
  password: process.env.DB_PASSWORD,
});

pool.on('error', function (err) {
  console.error('[DB] Pool error:', err.message);
});

// ── Message storage ──

async function storeMessage(data) {
  // Upsert contact
  const contactResult = await pool.query(
    'SELECT upsert_contact($1, $2) AS id',
    [data.wa_id, data.display_name]
  );
  const contactId = contactResult.rows[0].id;

  // Upsert conversation
  const convResult = await pool.query(
    'SELECT upsert_conversation($1, $2, $3) AS id',
    [contactId, data.content, data.direction]
  );
  const conversationId = convResult.rows[0].id;

  // Insert message — recipient_phone/source/content_hash/delivery_deadline_at/fallback_eligible
  // are optional (NULL for inbound or legacy callers) and feed the SMS fallback pipeline.
  const msgResult = await pool.query(
    `INSERT INTO messages (
       conversation_id, wamid, direction, message_type, content,
       media_data, media_mime_type, media_path,
       template_data, interactive_data, raw_payload, status,
       recipient_phone, source, content_hash, delivery_deadline_at, fallback_eligible
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (wamid) DO NOTHING RETURNING id`,
    [
      conversationId,
      data.wamid,
      data.direction,
      data.type || 'text',
      data.content,
      data.media_data ? JSON.stringify(data.media_data) : null,
      data.media_mime_type || null,
      data.media_path || null,
      data.template_data ? JSON.stringify(data.template_data) : null,
      data.interactive_data ? JSON.stringify(data.interactive_data) : null,
      data.raw_payload ? JSON.stringify(data.raw_payload) : null,
      data.status || (data.direction === 'inbound' ? 'received' : 'sent'),
      data.recipient_phone || null,
      data.source || null,
      data.content_hash || null,
      data.delivery_deadline_at || null,
      typeof data.fallback_eligible === 'boolean' ? data.fallback_eligible : null,
    ]
  );

  return {
    message_id: msgResult.rows[0] ? msgResult.rows[0].id : null,
    conversation_id: conversationId,
    contact_id: contactId,
  };
}

async function updateMessageStatus(wamid, status, errorData) {
  let query;
  let params;
  if (errorData) {
    query = 'UPDATE messages SET status = $1, status_updated = NOW(), error_code = $2, error_details = $3 WHERE wamid = $4 RETURNING id, conversation_id';
    params = [status, errorData.code || null, JSON.stringify(errorData), wamid];
  } else {
    query = 'UPDATE messages SET status = $1, status_updated = NOW() WHERE wamid = $2 RETURNING id, conversation_id';
    params = [status, wamid];
  }
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// ── Customer window ──

async function getWindowStatus(waId) {
  const result = await pool.query(
    'SELECT c.id AS conversation_id, c.window_expires, (c.window_expires > NOW()) AS window_open, EXTRACT(EPOCH FROM (c.window_expires - NOW())) AS seconds_remaining FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE ct.wa_id = $1',
    [waId]
  );
  if (!result.rows[0]) {
    return { conversation_id: null, window_open: false, window_expires: null, seconds_remaining: 0 };
  }
  const row = result.rows[0];
  return {
    conversation_id: row.conversation_id,
    window_open: row.window_open || false,
    window_expires: row.window_expires,
    seconds_remaining: Math.max(0, Math.round(row.seconds_remaining || 0)),
    hours_remaining: Math.max(0, Math.round((row.seconds_remaining || 0) / 3600 * 10) / 10),
  };
}

// ── Conversations ──

async function getConversations(limit, offset, status) {
  let query = 'SELECT * FROM v_inbox';
  const params = [];
  if (status) {
    query += ' WHERE status = $1';
    params.push(status);
  }
  query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit || 50, offset || 0);
  const result = await pool.query(query, params);
  return result.rows;
}

async function getConversation(id) {
  const result = await pool.query(
    'SELECT * FROM v_inbox WHERE conversation_id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function updateConversation(id, data) {
  const sets = [];
  const params = [id];
  let idx = 2;

  if (data.assigned_to !== undefined) {
    sets.push('assigned_to = $' + idx);
    params.push(data.assigned_to);
    idx++;
  }
  if (data.ai_enabled !== undefined) {
    sets.push('ai_enabled = $' + idx);
    params.push(data.ai_enabled);
    idx++;
  }
  if (data.status !== undefined) {
    sets.push('status = $' + idx);
    params.push(data.status);
    idx++;
  }
  sets.push('updated_at = NOW()');

  const result = await pool.query(
    'UPDATE conversations SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING *',
    params
  );
  return result.rows[0] || null;
}

async function markConversationRead(id) {
  await pool.query(
    'UPDATE conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

// ── Messages ──

async function getMessages(conversationId, limit, before) {
  let query = 'SELECT * FROM messages WHERE conversation_id = $1';
  const params = [conversationId];

  if (before) {
    query += ' AND created_at < $2';
    params.push(before);
  }

  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit || 50);

  const result = await pool.query(query, params);
  return result.rows;
}

// ── Catch-up (replica resync) ──
// Returns messages created strictly after `since` (ISO timestamp), ordered
// chronologically with (id) as deterministic tiebreaker. Joined with
// conversation/contact metadata so a replica can rebuild chats without
// extra round-trips. Cap is enforced server-side.

async function getMessagesSince(since, limit, direction) {
  const params = [since];
  let where = 'm.created_at > $1';
  if (direction === 'inbound' || direction === 'outbound') {
    where += ' AND m.direction = $' + (params.length + 1);
    params.push(direction);
  }
  const capped = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  params.push(capped);
  const query =
    'SELECT m.id, m.wamid, m.conversation_id, m.direction, m.message_type, '
    + '       m.content, m.media_path, m.media_mime_type, m.media_data, '
    + '       m.template_data, m.interactive_data, m.status, m.status_updated, '
    + '       m.error_code, m.error_details, m.created_at, '
    + '       c.wa_id, c.display_name '
    + 'FROM messages m '
    + 'JOIN conversations cv ON cv.id = m.conversation_id '
    + 'JOIN contacts c ON c.id = cv.contact_id '
    + 'WHERE ' + where + ' '
    + 'ORDER BY m.created_at ASC, m.id ASC '
    + 'LIMIT $' + params.length;
  const result = await pool.query(query, params);
  return { rows: result.rows, limit: capped };
}

// ── Contacts ──

async function getContacts(limit, offset, search) {
  let query = 'SELECT * FROM contacts';
  const params = [];

  if (search) {
    query += ' WHERE display_name ILIKE $1 OR wa_id LIKE $1';
    params.push('%' + search + '%');
  }

  query += ' ORDER BY last_message_at DESC NULLS LAST';
  query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit || 50, offset || 0);

  const result = await pool.query(query, params);
  return result.rows;
}

async function getContact(waId) {
  const result = await pool.query('SELECT * FROM contacts WHERE wa_id = $1', [waId]);
  return result.rows[0] || null;
}

async function updateContact(waId, data) {
  const sets = [];
  const params = [waId];
  let idx = 2;

  if (data.display_name !== undefined) {
    sets.push('display_name = $' + idx); params.push(data.display_name); idx++;
  }
  if (data.tags !== undefined) {
    sets.push('tags = $' + idx); params.push(data.tags); idx++;
  }
  if (data.metadata !== undefined) {
    sets.push('metadata = metadata || $' + idx); params.push(JSON.stringify(data.metadata)); idx++;
  }
  sets.push('updated_at = NOW()');

  const result = await pool.query(
    'UPDATE contacts SET ' + sets.join(', ') + ' WHERE wa_id = $1 RETURNING *',
    params
  );
  return result.rows[0] || null;
}

// ── Webhook events ──

async function storeWebhookEvent(eventType, payload) {
  await pool.query(
    'INSERT INTO webhook_events (event_type, payload) VALUES ($1, $2)',
    [eventType, JSON.stringify(payload)]
  );
}

async function getWebhookEvents(limit, offset) {
  const result = await pool.query(
    'SELECT id, event_type, processed, created_at FROM webhook_events ORDER BY id DESC LIMIT $1 OFFSET $2',
    [limit || 50, offset || 0]
  );
  return result.rows;
}

// ── Stats ──

async function getStats() {
  const result = await pool.query(
    "SELECT (SELECT COUNT(*) FROM contacts) as contacts, (SELECT COUNT(*) FROM conversations) as conversations, (SELECT COUNT(*) FROM messages) as messages, (SELECT COUNT(*) FROM messages WHERE direction = 'inbound') as inbound, (SELECT COUNT(*) FROM messages WHERE direction = 'outbound') as outbound, (SELECT COUNT(*) FROM conversations WHERE status = 'active') as active_conversations"
  );
  return result.rows[0];
}

module.exports = {
  pool,
  storeMessage,
  updateMessageStatus,
  getConversations,
  getConversation,
  updateConversation,
  markConversationRead,
  getMessages,
  getMessagesSince,
  getContacts,
  getContact,
  updateContact,
  storeWebhookEvent,
  getWebhookEvents,
  getStats,
  getWindowStatus,
};
