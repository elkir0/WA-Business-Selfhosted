/**
 * WhatsApp Business Cloud API Gateway — main HTTP server.
 *
 * Exposes an Express app that:
 *   - receives Meta WhatsApp Cloud API webhooks (verified via HMAC-SHA256)
 *   - sends all message types via the Cloud API
 *   - stores conversations, contacts, and messages in PostgreSQL
 *   - broadcasts realtime events over Server-Sent Events
 *   - auto-downloads inbound media (with retention) and serves it back behind auth
 *   - forwards inbound payloads to an optional external webhook (see
 *     src/plugins/webhook-forward) so downstream automation can react
 *   - tracks SMS-fallback eligibility (see src/plugins/sms-fallback) for
 *     deliveries that miss the 24h customer window
 *
 * Configuration is entirely via environment variables — no hardcoded
 * credentials, no hardcoded URLs. See .env.example for the full list.
 */

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const MetaWhatsAppAPI = require('./lib/meta-api');
const db = require('./lib/db');
const {
  normalizePhoneE164,
  sha256Hash,
  calcDeliveryDeadline,
  isWhitelisted,
  sanitizeSource,
} = require('./lib/sms-fallback-config');

// ── Media storage config ──
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/var/lib/whatsapp-media';
const MEDIA_RETENTION_DAYS = parseInt(process.env.MEDIA_RETENTION_DAYS) || 365;

var MIME_EXT = {
  'audio/ogg': '.ogg', 'audio/ogg; codecs=opus': '.ogg', 'audio/mpeg': '.mp3',
  'audio/amr': '.amr', 'audio/aac': '.aac',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/webp; animated=true': '.webp'
};

function getExtFromMime(mime) {
  if (!mime) return '.bin';
  var base = mime.split(';')[0].trim();
  return MIME_EXT[mime] || MIME_EXT[base] || '.' + base.split('/')[1] || '.bin';
}

async function downloadAndStoreMedia(mediaId, waId, msgType, mimeType, wamid, docFilename) {
  try {
    var urlData = await meta.getMediaUrl(mediaId);
    var media = await meta.downloadMedia(urlData.url);

    var ext = getExtFromMime(mimeType);
    var typeDir = msgType === 'sticker' ? 'sticker' : msgType;
    var dir = path.join(MEDIA_ROOT, waId, typeDir);
    fs.mkdirSync(dir, { recursive: true });

    var filename;
    if (docFilename) {
      filename = wamid.replace(/[^a-zA-Z0-9]/g, '_') + '_' + docFilename;
    } else {
      filename = wamid.replace(/[^a-zA-Z0-9]/g, '_') + ext;
    }

    var filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, media.buffer);

    // Relative path for DB (from MEDIA_ROOT)
    var relativePath = path.join(waId, typeDir, filename);

    // Update message in DB
    await db.pool.query(
      'UPDATE messages SET media_path = $1 WHERE wamid = $2',
      [relativePath, wamid]
    );

    console.log('[MEDIA] Saved: ' + relativePath + ' (' + media.buffer.length + ' bytes)');

    // Notify SSE clients that media is now available
    broadcastSSE('message_update', {
      wamid: wamid,
      media_path: relativePath,
      media_mime_type: mimeType
    });
    return relativePath;
  } catch (e) {
    console.error('[MEDIA] Download error for ' + mediaId + ':', e.message);
    return null;
  }
}


// H4: Failed webhook forwards tracking
const failedWebhookForwards = [];
const MAX_FAILED_FORWARDS = 100;

async function forwardWebhook(body, maxRetries) {
  if (maxRetries === undefined) maxRetries = 3;
  var url = CONFIG.webhookForwardUrl;
  if (!url) return;
  var lastError;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        var delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(function(r) { setTimeout(r, delay); });
      }
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      console.log('[webhook-forward] Forwarded OK' + (attempt > 0 ? ' (retry ' + attempt + ')' : ''));
      return;
    } catch (e) {
      lastError = e;
      console.error('[webhook-forward] Forward attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ' failed: ' + e.message);
    }
  }
  // All retries exhausted — store for manual retry
  failedWebhookForwards.push({
    timestamp: new Date().toISOString(),
    error: lastError ? lastError.message : 'unknown',
    bodyPreview: JSON.stringify(body).substring(0, 200)
  });
  if (failedWebhookForwards.length > MAX_FAILED_FORWARDS) failedWebhookForwards.shift();
  console.error('[webhook-forward] All retries exhausted, stored in failed-forwards');
}

const app = express();
app.set('trust proxy', 1); // Trust Nginx reverse proxy (X-Forwarded-For)
app.use(helmet());
// CORS - Restricted to allowed origins (no wildcard fallback)
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.error('[CONFIG] FATAL: CORS_ORIGIN environment variable is required');
  process.exit(1);
}

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (server-to-server, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn('[SECURITY] CORS blocked origin:', origin);
    callback(new Error('CORS not allowed'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


// =============================================================================
// SECURITY H2: Input Validation Helpers
// =============================================================================
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 7 && cleaned.length <= 15;
}

function validateMessageContent(content, maxLength = 4096) {
  if (typeof content !== 'string') return false;
  if (content.length > maxLength) return false;
  return true;
}

function sanitizeFilename(filename) {
  if (!filename) return null;
  // Remove path traversal attempts and dangerous characters
  return filename
    .replace(/\.\.\//g, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .substring(0, 255);
}

// Capture raw body for webhook signature verification
app.use('/webhook', express.json({
  limit: '10mb',
  verify: function(req, res, buf) {
    req.rawBody = buf;
  }
}));
app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ──
var apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

var webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100, // Reduced from 300 for security (H1)
  standardHeaders: true,
  legacyHeaders: false
});

var sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 outbound messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Message rate limit exceeded' }
});

app.use('/api', apiLimiter);
app.use('/webhook', webhookLimiter);

// ── META webhook signature verification ──
function verifyWebhookSignature(req, res, next) {
  // META_APP_SECRET is now mandatory at startup, so this should never happen
  // But keep as safety check
  if (!CONFIG.metaAppSecret) {
    console.error('[SECURITY] META_APP_SECRET missing - rejecting webhook');
    return res.status(500).send('Server misconfiguration');
  }

  var signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    console.warn('[SECURITY] Webhook request missing X-Hub-Signature-256 header');
    return res.status(401).send('Missing signature');
  }

  var expectedSig = 'sha256=' + crypto
    .createHmac('sha256', CONFIG.metaAppSecret)
    .update(req.rawBody)
    .digest('hex');

  if (!safeCompare(signature, expectedSig)) {
    console.warn('[SECURITY] Webhook signature mismatch');
    return res.status(401).send('Invalid signature');
  }

  next();
}

// ── Configuration ──
const CONFIG = {
  port: process.env.PORT || 3100,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  wabaId: process.env.WHATSAPP_WABA_ID || '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  webhookForwardUrl: process.env.WEBHOOK_FORWARD_URL || '',
  apiToken: process.env.API_TOKEN || '',
  metaAppSecret: process.env.META_APP_SECRET || ''
};

// ── Validate required config at startup ──
if (!CONFIG.apiToken) {
  console.error('[CONFIG] FATAL: API_TOKEN environment variable is required');
  process.exit(1);
}

if (!CONFIG.metaAppSecret) {
  console.error('[CONFIG] FATAL: META_APP_SECRET environment variable is required');
  console.error('[CONFIG] Get it from: Facebook App Dashboard → Settings → Basic → App Secret');
  process.exit(1);
}
if (!CONFIG.verifyToken) {
  console.error('[CONFIG] FATAL: WHATSAPP_VERIFY_TOKEN environment variable is required');
  process.exit(1);
}

// ── Timing-safe comparison ──
function safeCompare(a, b) {
  if (!a || !b) return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Auth middleware for /api/* routes ──
function requireAuth(req, res, next) {
  var auth = req.headers.authorization;
  if (auth) {
    var token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (safeCompare(token, CONFIG.apiToken)) return next();
  }

  // SECURITY: Query param tokens REMOVED (leak in logs/history)
  // Use signed URLs for media access instead
  if (req.query.token) {
    console.warn('[SECURITY] Query param token rejected - use Authorization header');
    return res.status(401).json({ error: 'Query param tokens not supported. Use Authorization header.' });
  }

  res.status(401).json({ error: 'Unauthorized' });
}

// ── META API Client ──
const meta = new MetaWhatsAppAPI(CONFIG.phoneNumberId, CONFIG.accessToken);

// ── Template cache (name → BODY text + placeholders) ──
// Used to render a readable `content` for template messages so the PWA shows
// the actual body instead of "[template:NAME]". Refreshed hourly.
const templateCache = new Map();
let templateCacheLastRefresh = 0;

async function loadTemplatesCache() {
  if (!CONFIG.wabaId) return;
  try {
    const res = await meta.listTemplates(CONFIG.wabaId, 100);
    const data = (res && res.data) || [];
    templateCache.clear();
    for (const t of data) {
      const body = (t.components || []).find(c => c.type === 'BODY');
      if (body && body.text) {
        templateCache.set(t.name + '|' + (t.language || ''), body.text);
        // also key by name-only as fallback for missing language match
        if (!templateCache.has(t.name)) templateCache.set(t.name, body.text);
      }
    }
    templateCacheLastRefresh = Date.now();
    console.log('[TEMPLATES] cache loaded: ' + templateCache.size + ' entries');
  } catch (e) {
    console.error('[TEMPLATES] cache load failed:', e.message);
  }
}

function renderTemplateBody(name, language, components) {
  const tpl = templateCache.get(name + '|' + (language || '')) || templateCache.get(name);
  if (!tpl) return '[template:' + name + ']'; // fallback
  // Extract BODY parameters (META structure)
  const body = (components || []).find(c => c.type === 'body');
  const params = (body && body.parameters) || [];
  return tpl.replace(/\{\{(\d+)\}\}/g, function(_, idx) {
    const i = parseInt(idx, 10) - 1;
    return (params[i] && params[i].text) ? String(params[i].text) : '{{' + idx + '}}';
  });
}

// Refresh templates every hour. First load deferred to after app startup.
setTimeout(loadTemplatesCache, 5000);
setInterval(loadTemplatesCache, 60 * 60 * 1000);

// ── SSE clients for real-time updates ──
const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const client of sseClients) {
    client.write(msg);
  }
}

// ── Apply auth to all /api/* routes ──
app.use('/api', requireAuth);

// ── Admin UI (bundled) ──
const adminRouter = require('./routes/admin');
app.use('/admin', adminRouter);

// ══════════════════════════════════════════════════════════════
// HEALTH & CONFIG
// ══════════════════════════════════════════════════════════════

// Public health check — minimal info only
app.get('/health', function(req, res) {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

// Detailed health — behind auth
app.get('/api/health', async function(req, res) {
  try {
    const stats = await db.getStats();
    res.json({
      status: 'ok',
      db: 'connected',
      stats: stats,
      config: {
        phoneNumberId: CONFIG.phoneNumberId ? 'SET' : 'NOT SET',
        wabaId: CONFIG.wabaId ? 'SET' : 'NOT SET',
        accessToken: CONFIG.accessToken ? 'SET' : 'NOT SET',
        metaAppSecret: CONFIG.metaAppSecret ? 'SET' : 'NOT SET'
      },
      sseClients: sseClients.size,
      uptime: Math.round(process.uptime())
    });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

// ══════════════════════════════════════════════════════════════
// META STATUSES → fallback correlation
// ══════════════════════════════════════════════════════════════

// Meta error codes that should NOT trigger SMS fallback (template-level issues, not delivery failures)
const NON_FALLBACK_META_ERROR_CODES = [132000, 132001, 132005, 132007, 132012, 132015, 132016];

/**
 * Process one Meta webhook status entry. Correlates with outbound `messages` row,
 * updates status + error info, optionally triggers external fallback watcher workflow.
 * Returns { matched: bool, message_id?, forward_triggered: bool }
 */
async function handleStatusEvent(statusEntry) {
  const { id: wamid, status, recipient_id, timestamp, errors } = statusEntry || {};
  if (!wamid || !status || !recipient_id) {
    return { matched: false, forward_triggered: false };
  }
  const errCode = errors && errors[0] ? errors[0].code : null;
  const errData = errors && errors[0] ? JSON.stringify(errors) : null;

  let recipientPhone;
  try {
    recipientPhone = normalizePhoneE164(recipient_id);
  } catch (e) {
    console.error('[handleStatusEvent] phone normalization failed:', recipient_id, e.message);
    return { matched: false, forward_triggered: false };
  }

  const tsNum = parseInt(timestamp, 10);

  // Correlation : look for an outbound row matching by phone, in a temporal window if no wamid yet
  const matched = await db.pool.query(
    `UPDATE messages
     SET status = $1, status_updated = NOW(),
         wamid = COALESCE(wamid, $2),
         error_code = $3, error_details = $4
     WHERE id = (
       SELECT id FROM messages
       WHERE recipient_phone = $5 AND direction = 'outbound'
         AND status NOT IN ('delivered','read','fallback_sent','fallback_skipped','failed')
         AND created_at > NOW() - INTERVAL '24 hours'
         AND (
           wamid = $2
           OR (wamid IS NULL AND ABS(EXTRACT(EPOCH FROM (created_at - to_timestamp($6)))) <= 30)
         )
       ORDER BY
         CASE WHEN wamid = $2 THEN 0 ELSE 1 END,
         ABS(EXTRACT(EPOCH FROM (created_at - to_timestamp($6))))
       LIMIT 1
     )
     RETURNING id, recipient_phone, content, source, fallback_eligible, content_hash, raw_payload`,
    [status, wamid, errCode, errData, recipientPhone, tsNum]
  );

  if (!matched.rows.length) {
    try {
      await db.pool.query(
        `INSERT INTO webhook_events_unmatched
           (meta_wamid, recipient, status, meta_ts, payload, marker)
         VALUES ($1, $2, $3, to_timestamp($4), $5, 'no_match')`,
        [wamid, recipientPhone, status, tsNum, JSON.stringify(statusEntry)]
      );
    } catch (e) {
      console.error('[handleStatusEvent] unmatched insert failed:', e.message);
    }
    return { matched: false, forward_triggered: false };
  }

  const row = matched.rows[0];

  // Decide if we trigger the fallback watcher
  const shouldTrigger =
    status === 'failed' &&
    row.fallback_eligible === true &&
    !NON_FALLBACK_META_ERROR_CODES.includes(errCode);

  if (!shouldTrigger) {
    return { matched: true, message_id: row.id, forward_triggered: false };
  }

  // Trigger fallback watcher workflow (fire-and-forget but log result)
  const url = process.env.FALLBACK_WATCHER_URL;
  const token = process.env.FALLBACK_WATCHER_TOKEN;
  if (!url || !token) {
    console.warn('[handleStatusEvent] fallback-watcher_WATCHER_* env not set, skipping trigger');
    return { matched: true, message_id: row.id, forward_triggered: false };
  }

  try {
    const fetchRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message_id: row.id,
        phone: row.recipient_phone,
        content: row.content,
        source: row.source,
        content_hash: row.content_hash,
        raw_payload: row.raw_payload,
        trigger_reason: `failed_meta_${errCode}`,
        meta_error: errors && errors[0] ? errors[0] : null,
      }),
      // 5s timeout via AbortController
      signal: AbortSignal.timeout(5000),
    });
    if (!fetchRes.ok) {
      console.error('[handleStatusEvent] fallback-watcher trigger HTTP', fetchRes.status);
    }
    return { matched: true, message_id: row.id, forward_triggered: true };
  } catch (e) {
    console.error('[handleStatusEvent] fallback-watcher trigger failed:', e.message);
    // We still consider the trigger "attempted" for telemetry, but flag as not delivered
    return { matched: true, message_id: row.id, forward_triggered: true, forward_error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// WEBHOOK (META → this gateway)
// ══════════════════════════════════════════════════════════════

// GET = challenge verification
app.get('/webhook/whatsapp-meta', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];

  console.log('[WEBHOOK] GET challenge: mode=' + mode);

  if (mode === 'subscribe' && token === CONFIG.verifyToken) {
    console.log('[WEBHOOK] Challenge verified OK');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

// POST = incoming messages & status updates
app.post('/webhook/whatsapp-meta', verifyWebhookSignature, async function(req, res) {
  res.status(200).send('OK');

  var body = req.body;
  var entry = body && body.entry && body.entry[0];
  var changes = entry && entry.changes && entry.changes[0];
  var value = changes && changes.value;

  if (!value) return;

  var eventType = value.statuses ? 'statuses' : (value.messages ? 'messages' : 'other');

  // Store raw event
  try {
    await db.storeWebhookEvent(eventType, body);
  } catch (e) {
    console.error('[DB] webhook event store error:', e.message);
  }

  // Process messages
  if (value.messages) {
    for (var i = 0; i < value.messages.length; i++) {
      var msg = value.messages[i];
      var contact = value.contacts && value.contacts[i];

      try {
        var content = '';
        var mediaData = null;
        var mimeType = null;

        switch (msg.type) {
          case 'text':
            content = msg.text ? msg.text.body : '';
            break;
          case 'audio':
            mediaData = { media_id: msg.audio.id, voice: msg.audio.voice || false };
            mimeType = msg.audio.mime_type;
            break;
          case 'image':
            mediaData = { media_id: msg.image.id };
            mimeType = msg.image.mime_type;
            content = msg.image.caption || '';
            break;
          case 'video':
            mediaData = { media_id: msg.video.id };
            mimeType = msg.video.mime_type;
            content = msg.video.caption || '';
            break;
          case 'document':
            mediaData = { media_id: msg.document.id, filename: msg.document.filename };
            mimeType = msg.document.mime_type;
            content = msg.document.caption || '';
            break;
          case 'sticker':
            mediaData = { media_id: msg.sticker.id, animated: msg.sticker.animated || false };
            mimeType = msg.sticker.mime_type;
            break;
          case 'location':
            content = JSON.stringify(msg.location);
            break;
          case 'contacts':
            content = JSON.stringify(msg.contacts);
            break;
          case 'interactive':
            if (msg.interactive.type === 'button_reply') {
              content = msg.interactive.button_reply.title;
            } else if (msg.interactive.type === 'list_reply') {
              content = msg.interactive.list_reply.title;
            }
            break;
          case 'button':
            content = msg.button ? msg.button.text : '';
            break;
          default:
            content = '[' + msg.type + ']';
        }

        var stored = await db.storeMessage({
          wa_id: msg.from,
          display_name: contact && contact.profile ? contact.profile.name : null,
          direction: 'inbound',
          type: msg.type,
          content: content,
          wamid: msg.id,
          media_data: mediaData,
          media_mime_type: mimeType,
          raw_payload: msg
        });

        // Broadcast to SSE clients
        broadcastSSE('message', {
          id: stored.message_id,
          conversation_id: stored.conversation_id,
          direction: 'inbound',
          type: msg.type,
          content: content,
          from: msg.from,
          contact_name: contact && contact.profile ? contact.profile.name : null,
          timestamp: msg.timestamp
        });

        // Auto-download media (non-blocking)
        if (mediaData && mediaData.media_id) {
          downloadAndStoreMedia(
            mediaData.media_id, msg.from, msg.type, mimeType, msg.id,
            mediaData.filename || null
          );
        }
      } catch (e) {
        console.error('[DB] message store error:', e.message);
      }
    }
  }

  // Process status updates (refactored — see handleStatusEvent above)
  if (value.statuses) {
    for (var j = 0; j < value.statuses.length; j++) {
      var st = value.statuses[j];
      try {
        if (st.errors && st.errors.length > 0) {
          var err = st.errors[0];
          console.error('[STATUS] Message FAILED wamid=' + st.id + ' code=' + err.code + ' title=' + (err.title || '?') + ' recipient=' + st.recipient_id);
        }
        // Correlation + fallback-watcher trigger logic
        var result = await handleStatusEvent(st);
        // SSE broadcast (UI realtime update)
        var errorDataSSE = null;
        if (st.errors && st.errors.length > 0) {
          var e0 = st.errors[0];
          errorDataSSE = {
            code: e0.code,
            title: e0.title || null,
            message: e0.message || null,
            details: e0.error_data ? e0.error_data.details : null
          };
        }
        // Lookup conversation_id for SSE (best-effort, non-fatal)
        var conversationId = null;
        if (result && result.matched && result.message_id) {
          try {
            var convRes = await db.pool.query(
              'SELECT conversation_id FROM messages WHERE id = $1',
              [result.message_id]
            );
            if (convRes.rows[0]) conversationId = convRes.rows[0].conversation_id;
          } catch (e) {
            // Non-fatal
          }
        }
        broadcastSSE('status', {
          wamid: st.id,
          status: st.status,
          conversation_id: conversationId,
          recipient: st.recipient_id,
          timestamp: st.timestamp,
          error: errorDataSSE
        });
      } catch (e) {
        console.error('[DB] status update error:', e.message);
      }
    }
  }
  // Forward to external webhook (for downstream processing) — skip if human takeover active
  if (value.messages) {
    var firstMsg = value.messages[0];
    var senderWaId = firstMsg ? firstMsg.from : null;
    var skipForward = false;

    if (senderWaId) {
      try {
        var tkStatus = await db.getWindowStatus(senderWaId);
        if (tkStatus.conversation_id) {
          var tkResult = await db.pool.query(
            'SELECT human_takeover_until, (human_takeover_until > NOW()) AS active FROM conversations WHERE id = $1',
            [tkStatus.conversation_id]
          );
          if (tkResult.rows[0] && tkResult.rows[0].active) {
            skipForward = true;
            var remaining = Math.round((new Date(tkResult.rows[0].human_takeover_until) - Date.now()) / 60000);
            console.log('[TAKEOVER] Bot paused for ' + senderWaId + ' (' + remaining + ' min remaining) → skipping forward');
          }
        }
      } catch (e) {
        console.error('[TAKEOVER] Check error:', e.message);
      }
    }

    if (!skipForward) {
      // H4: Use retry with exponential backoff
      await forwardWebhook(body);
    }
  }
});

// ══════════════════════════════════════════════════════════════
// SEND MESSAGES
// ══════════════════════════════════════════════════════════════

// ── Human takeover detection ──
// Bot messages start with 🤖, human messages don't
var BOT_PREFIX = '\u{1F916}'; // 🤖

async function detectHumanTakeover(to, content) {
  // Skip detection for non-text or empty content
  if (!content || typeof content !== 'string') return;
  // If message starts with robot emoji → it's the bot, no takeover
  if (content.startsWith(BOT_PREFIX)) return;
  // Human message detected → activate 1h takeover
  try {
    var window = await db.getWindowStatus(to);
    if (window.conversation_id) {
      await db.pool.query(
        'UPDATE conversations SET human_takeover_until = NOW() + INTERVAL \'1 hour\', updated_at = NOW() WHERE id = $1',
        [window.conversation_id]
      );
      console.log('[TAKEOVER] Human message detected for ' + to + ' → bot paused 1h');
      broadcastSSE('takeover', {
        conversation_id: window.conversation_id,
        wa_id: to,
        active: true,
        until: new Date(Date.now() + 3600000).toISOString(),
        reason: 'human_message'
      });
    }
  } catch (e) {
    console.error('[TAKEOVER] Error:', e.message);
  }
}

// Canonical META wa_id is digits-only (no leading '+'). Without this, an API
// caller passing '+590...' creates a duplicate contact alongside the existing
// '590...' record populated from META webhooks.
function normalizeWaId(p) {
  if (p == null) return p;
  return String(p).replace(/^\++/, '');
}

// Wrapper: envoie + stocke en DB
async function sendAndStore(type, to, metaResponse, content, extra, sourceHint) {
  var waId = normalizeWaId(to);
  if (metaResponse.messages && metaResponse.messages[0]) {
    var wamid = metaResponse.messages[0].id;

    // Enrich the row for SMS fallback pipeline. Best-effort: on any helper
    // failure, the row still inserts (without fallback fields) so the user-facing
    // send is never broken by tracking metadata.
    var fbFields = {};
    try {
      var src = sanitizeSource(sourceHint);
      var phoneNorm = normalizePhoneE164(to);
      fbFields = {
        recipient_phone: phoneNorm,
        source: src,
        content_hash: sha256Hash(content || ''),
        delivery_deadline_at: calcDeliveryDeadline(src),
        fallback_eligible: isWhitelisted(phoneNorm)
      };
    } catch (e) {
      console.warn('[sendAndStore] fallback enrichment skipped:', e.message);
    }

    await db.storeMessage(Object.assign({
      wa_id: waId,
      direction: 'outbound',
      type: type,
      content: content,
      wamid: wamid,
      status: 'sent'
    }, extra || {}, fbFields));
    broadcastSSE('message', {
      wamid: wamid,
      direction: 'outbound',
      type: type,
      content: content,
      to: waId
    });
    // Detect human takeover on outbound messages
    await detectHumanTakeover(waId, content);
  }
  return metaResponse;
}

// ── Input validation ──
function validatePhoneNumber(to) {
  if (!to || typeof to !== 'string') return false;
  // E.164 format: digits only, 7-15 chars
  return /^\d{7,15}$/.test(to);
}

// ── Customer window check ──
// Bloque les envois hors fenêtre 24h sauf templates
async function checkWindow(to, messageType) {
  if (messageType === 'template') return { allowed: true }; // templates toujours autorisés
  var window = await db.getWindowStatus(to);
  if (!window.conversation_id) {
    // Nouveau contact, pas de fenêtre ouverte → template obligatoire
    return {
      allowed: false,
      reason: 'no_conversation',
      message: 'Aucune conversation avec ce contact. Envoyez un template pour initier.',
      window: window
    };
  }
  if (!window.window_open) {
    return {
      allowed: false,
      reason: 'window_closed',
      message: 'Fenêtre 24h expirée. Seuls les templates sont autorisés.',
      window: window
    };
  }
  return { allowed: true, window: window };
}

// ── Window status endpoint ──
app.get('/api/window/:waId', async function(req, res) {
  try {
    var window = await db.getWindowStatus(req.params.waId);
    res.json(window);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── POST /api/messages/outbound ──
// Log a sent WhatsApp message for fallback SMS monitoring.
// Called externally to log a sent message (e.g., dual-write during a migration from another BSP).
// Called natively when the gateway sends via Meta directly.
// Spec: docs/superpowers/specs/2026-05-22-whatsapp-fallback-sms-design.md
app.post('/api/messages/outbound', async (req, res) => {
  try {
    const {
      external_msg_id, phone, content, source,
      message_type = 'text', raw_payload, wamid = null,
    } = req.body;

    if (!phone || !content || !source) {
      return res.status(400).json({ success: false, error: 'phone, content, source required' });
    }
    if (!['bot_wa','reminder_j2','adhoc_secretariat','ct120_direct'].includes(source)) {
      return res.status(400).json({ success: false, error: 'invalid source' });
    }

    let phoneNorm;
    try {
      phoneNorm = normalizePhoneE164(phone);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'phone normalization failed: ' + e.message });
    }
    const eligible = isWhitelisted(phoneNorm);
    const hash = sha256Hash(content);
    const deadline = calcDeliveryDeadline(source);

    // Upsert contact + conversation via existing SQL functions
    const waId = phoneNorm.replace(/^\+/, '');
    const contactRes = await db.pool.query(
      'SELECT upsert_contact($1, $2) AS id',
      [waId, null]
    );
    const contactId = contactRes.rows[0].id;
    const convRes = await db.pool.query(
      'SELECT upsert_conversation($1, $2, $3) AS id',
      [contactId, content, 'outbound']
    );
    const convId = convRes.rows[0].id;

    const result = await db.pool.query(
      `INSERT INTO messages (
         conversation_id, wamid, direction, message_type, content,
         status, external_msg_id, source, content_hash, recipient_phone,
         delivery_deadline_at, fallback_eligible, raw_payload, created_at
       ) VALUES ($1, $2, 'outbound', $3, $4, 'sent', $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (external_msg_id) WHERE external_msg_id IS NOT NULL
       DO UPDATE SET status_updated = NOW()
       RETURNING id, (xmax = 0) AS is_new`,
      [convId, wamid, message_type, content, external_msg_id, source, hash,
       phoneNorm, deadline, eligible, raw_payload ? JSON.stringify(raw_payload) : null]
    );

    const row = result.rows[0];
    res.json({
      success: true,
      message_id: row.id,
      duplicate: !row.is_new,
      delivery_deadline_at: deadline.toISOString(),
      fallback_eligible: eligible,
      content_hash: hash,
    });
  } catch (err) {
    console.error('[outbound] error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

app.post('/api/messages/send/text', sendLimiter, async function(req, res) {
  try {
    if (!validatePhoneNumber(req.body.to)) return res.status(400).json({ error: 'Invalid phone number' });
    if (!req.body.body || typeof req.body.body !== 'string') return res.status(400).json({ error: 'Message body required' });
    var wcheck = await checkWindow(req.body.to, 'text');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result = await meta.sendText(req.body.to, req.body.body, req.body.preview_url);
    result = await sendAndStore('text', req.body.to, result, req.body.body, null, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: 'Send failed' });
  }
});

app.post('/api/messages/send/image', sendLimiter, async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'image');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result;
    if (req.body.url) {
      result = await meta.sendImageUrl(req.body.to, req.body.url, req.body.caption);
    } else {
      result = await meta.sendImage(req.body.to, req.body.media_id, req.body.caption);
    }
    result = await sendAndStore('image', req.body.to, result, req.body.caption || '[image]', { media_data: { url: req.body.url, media_id: req.body.media_id } }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/video', sendLimiter, async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'video');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result;
    if (req.body.url) {
      result = await meta.sendVideoUrl(req.body.to, req.body.url, req.body.caption);
    } else {
      result = await meta.sendVideo(req.body.to, req.body.media_id, req.body.caption);
    }
    result = await sendAndStore('video', req.body.to, result, req.body.caption || '[video]', { media_data: { url: req.body.url, media_id: req.body.media_id } }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/document', sendLimiter, async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'document');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result;
    if (req.body.url) {
      result = await meta.sendDocumentUrl(req.body.to, req.body.url, req.body.caption, req.body.filename);
    } else {
      result = await meta.sendDocument(req.body.to, req.body.media_id, req.body.caption, req.body.filename);
    }
    result = await sendAndStore('document', req.body.to, result, req.body.filename || '[document]', { media_data: { url: req.body.url, media_id: req.body.media_id } }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/audio', sendLimiter, async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'audio');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result;
    if (req.body.url) {
      result = await meta.sendAudioUrl(req.body.to, req.body.url);
    } else {
      result = await meta.sendAudio(req.body.to, req.body.media_id);
    }
    result = await sendAndStore('audio', req.body.to, result, '[audio]', { media_data: { url: req.body.url, media_id: req.body.media_id } }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/location', async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'location');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var b = req.body;
    var result = await meta.sendLocation(b.to, b.latitude, b.longitude, b.name, b.address);
    result = await sendAndStore('location', b.to, result, b.name || '[location]', null, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/contacts', async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'contacts');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result = await meta.sendContacts(req.body.to, req.body.contacts);
    result = await sendAndStore('contacts', req.body.to, result, '[contacts]', null, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/sticker', async function(req, res) {
  try {
    var wcheck = await checkWindow(req.body.to, 'sticker');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result = await meta.sendSticker(req.body.to, req.body.media_id);
    result = await sendAndStore('sticker', req.body.to, result, '[sticker]', null, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/template', sendLimiter, async function(req, res) {
  try {
    var b = req.body;
    var result = await meta.sendTemplate(b.to, b.template_name, b.language, b.components);
    var renderedContent = renderTemplateBody(b.template_name, b.language, b.components);
    result = await sendAndStore('template', b.to, result, renderedContent, {
      template_data: { name: b.template_name, language: b.language, components: b.components }
    }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/interactive', sendLimiter, async function(req, res) {
  try {
    var b = req.body;
    var wcheck = await checkWindow(b.to, 'interactive');
    if (!wcheck.allowed) return res.status(403).json(wcheck);
    var result;
    if (b.type === 'buttons') {
      result = await meta.sendButtons(b.to, b.body, b.buttons, b.header, b.footer);
    } else if (b.type === 'list') {
      result = await meta.sendList(b.to, b.body, b.button_text, b.sections, b.header, b.footer);
    } else {
      return res.status(400).json({ error: 'type must be "buttons" or "list"' });
    }
    result = await sendAndStore('interactive', b.to, result, b.body, {
      interactive_data: { type: b.type, buttons: b.buttons, sections: b.sections }
    }, req.headers['x-source']);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/messages/send/reaction', async function(req, res) {
  try {
    var result;
    if (req.body.emoji) {
      result = await meta.sendReaction(req.body.to, req.body.message_id, req.body.emoji);
    } else {
      result = await meta.removeReaction(req.body.to, req.body.message_id);
    }
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// Mark as read (send read receipt to user)
app.post('/api/messages/:wamid/read', async function(req, res) {
  try {
    var result = await meta.markAsRead(req.params.wamid);
    await db.updateMessageStatus(req.params.wamid, 'read');
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// Typing indicator (shows "typing..." to user, auto-dismisses after 25s or on reply)
app.post('/api/messages/:wamid/typing', async function(req, res) {
  try {
    var result = await meta.sendTypingIndicator(req.params.wamid);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// ══════════════════════════════════════════════════════════════
// MEDIA
// ══════════════════════════════════════════════════════════════

// Static routes FIRST (before :mediaId param catches "local" or "stats")

// Serve locally stored media files
app.get('/api/media/local/:waId/:type/:filename', function(req, res) {
  var p = req.params;
  // Validate path components: only allow alphanumeric, dots, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(p.waId) || !/^[a-zA-Z0-9_-]+$/.test(p.type)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!/^[a-zA-Z0-9_.\-]+$/.test(p.filename) || p.filename.startsWith('.')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  // Resolve and verify path is within MEDIA_ROOT
  var filePath = path.resolve(MEDIA_ROOT, p.waId, p.type, p.filename);
  if (!filePath.startsWith(path.resolve(MEDIA_ROOT) + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});

// Media storage stats
app.get('/api/media/stats', async function(req, res) {
  try {
    var stats = { total_files: 0, total_bytes: 0, by_type: {} };
    if (fs.existsSync(MEDIA_ROOT)) {
      var contacts = fs.readdirSync(MEDIA_ROOT);
      for (var c = 0; c < contacts.length; c++) {
        var contactDir = path.join(MEDIA_ROOT, contacts[c]);
        if (!fs.statSync(contactDir).isDirectory()) continue;
        var types = fs.readdirSync(contactDir);
        for (var t = 0; t < types.length; t++) {
          var typeDir = path.join(contactDir, types[t]);
          if (!fs.statSync(typeDir).isDirectory()) continue;
          if (!stats.by_type[types[t]]) stats.by_type[types[t]] = { files: 0, bytes: 0 };
          var files = fs.readdirSync(typeDir);
          for (var f = 0; f < files.length; f++) {
            var st = fs.statSync(path.join(typeDir, files[f]));
            stats.total_files++;
            stats.total_bytes += st.size;
            stats.by_type[types[t]].files++;
            stats.by_type[types[t]].bytes += st.size;
          }
        }
      }
    }
    stats.total_mb = Math.round(stats.total_bytes / 1048576 * 100) / 100;
    stats.retention_days = MEDIA_RETENTION_DAYS;
    res.json(stats);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// META API media routes (parameterized, after static routes)
app.get('/api/media/:mediaId', async function(req, res) {
  try {
    var result = await meta.getMediaUrl(req.params.mediaId);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.get('/api/media/:mediaId/download', async function(req, res) {
  try {
    var urlData = await meta.getMediaUrl(req.params.mediaId);
    var media = await meta.downloadMedia(urlData.url);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(media.buffer);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.delete('/api/media/:mediaId', async function(req, res) {
  try {
    var result = await meta.deleteMedia(req.params.mediaId);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// ══════════════════════════════════════════════════════════════
// CONVERSATIONS (DB)
// ══════════════════════════════════════════════════════════════

app.get('/api/conversations', async function(req, res) {
  try {
    var q = req.query;
    var result = await db.getConversations(parseInt(q.limit) || 50, parseInt(q.offset) || 0, q.status);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/conversations/:id', async function(req, res) {
  try {
    var result = await db.getConversation(req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/api/conversations/:id', async function(req, res) {
  try {
    var result = await db.updateConversation(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/conversations/:id/messages', async function(req, res) {
  try {
    var q = req.query;
    var result = await db.getMessages(req.params.id, parseInt(q.limit) || 50, q.before);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/conversations/:id/read', async function(req, res) {
  try {
    await db.markConversationRead(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Human takeover management ──

app.get('/api/conversations/:id/takeover', async function(req, res) {
  try {
    var result = await db.pool.query(
      'SELECT human_takeover_until, (human_takeover_until > NOW()) AS active, EXTRACT(EPOCH FROM (human_takeover_until - NOW())) AS seconds_remaining FROM conversations WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    var row = result.rows[0];
    res.json({
      active: row.active || false,
      human_takeover_until: row.human_takeover_until,
      minutes_remaining: row.active ? Math.max(0, Math.round((row.seconds_remaining || 0) / 60)) : 0
    });
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/conversations/:id/ai-resume', async function(req, res) {
  try {
    await db.pool.query(
      'UPDATE conversations SET human_takeover_until = NULL, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    console.log('[TAKEOVER] AI resumed manually for conversation ' + req.params.id);
    broadcastSSE('takeover', {
      conversation_id: parseInt(req.params.id),
      active: false,
      reason: 'manual_resume'
    });
    res.json({ success: true, ai_resumed: true });
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/conversations/:id/ai-pause', async function(req, res) {
  try {
    var duration = parseInt(req.body.minutes) || 60;
    await db.pool.query(
      'UPDATE conversations SET human_takeover_until = NOW() + ($1 || \' minutes\')::INTERVAL, updated_at = NOW() WHERE id = $2',
      [duration.toString(), req.params.id]
    );
    var until = new Date(Date.now() + duration * 60000).toISOString();
    console.log('[TAKEOVER] AI paused manually for conversation ' + req.params.id + ' (' + duration + ' min)');
    broadcastSSE('takeover', {
      conversation_id: parseInt(req.params.id),
      active: true,
      until: until,
      minutes: duration,
      reason: 'manual_pause'
    });
    res.json({ success: true, ai_paused: true, until: until, minutes: duration });
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ══════════════════════════════════════════════════════════════
// CONTACTS (DB)
// ══════════════════════════════════════════════════════════════

app.get('/api/contacts', async function(req, res) {
  try {
    var q = req.query;
    var result = await db.getContacts(parseInt(q.limit) || 50, parseInt(q.offset) || 0, q.search);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/contacts/:waId', async function(req, res) {
  try {
    var result = await db.getContact(req.params.waId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.patch('/api/contacts/:waId', async function(req, res) {
  try {
    var result = await db.updateContact(req.params.waId, req.body);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ══════════════════════════════════════════════════════════════
// TEMPLATES (META)
// ══════════════════════════════════════════════════════════════

app.get('/api/templates', async function(req, res) {
  try {
    if (!CONFIG.wabaId) return res.status(400).json({ error: 'WABA ID not configured' });
    var result = await meta.listTemplates(CONFIG.wabaId, parseInt(req.query.limit) || 100);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.post('/api/templates', async function(req, res) {
  try {
    if (!CONFIG.wabaId) return res.status(400).json({ error: 'WHATSAPP_WABA_ID not configured' });
    var result = await meta.createTemplate(CONFIG.wabaId, req.body);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.delete('/api/templates/:name', async function(req, res) {
  try {
    if (!CONFIG.wabaId) return res.status(400).json({ error: 'WABA ID not configured' });
    var result = await meta.deleteTemplate(CONFIG.wabaId, req.params.name);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// ══════════════════════════════════════════════════════════════
// BUSINESS PROFILE
// ══════════════════════════════════════════════════════════════

app.get('/api/profile', async function(req, res) {
  try {
    var result = await meta.getProfile();
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

app.patch('/api/profile', async function(req, res) {
  try {
    var result = await meta.updateProfile(req.body);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(e.status || 500).json({ error: 'Operation failed' });
  }
});

// ══════════════════════════════════════════════════════════════
// SSE - REAL-TIME EVENTS (pour PWA)
// ══════════════════════════════════════════════════════════════

var MAX_SSE_CLIENTS = parseInt(process.env.MAX_SSE_CLIENTS) || 10;

app.get('/api/events', function(req, res) {
  // Cap SSE connections to prevent resource exhaustion
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return res.status(503).json({ error: 'Too many SSE connections' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: pas de buffering
  res.flushHeaders(); // Envoyer headers immédiatement

  // Heartbeat every 15s (keeps nginx proxy + client alive)
  var heartbeat = setInterval(function() {
    res.write(': ping\n\n');
  }, 15000);

  sseClients.add(res);
  console.log('[SSE] Client connected (' + sseClients.size + '/' + MAX_SSE_CLIENTS + ')');

  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  req.on('close', function() {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log('[SSE] Client disconnected (' + sseClients.size + '/' + MAX_SSE_CLIENTS + ')');
  });
});

// ══════════════════════════════════════════════════════════════
// WEBHOOK EVENTS (debug)
// ══════════════════════════════════════════════════════════════

app.get('/api/webhook-events', async function(req, res) {
  try {
    var result = await db.getWebhookEvents(parseInt(req.query.limit) || 50, parseInt(req.query.offset) || 0);
    res.json(result);
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ══════════════════════════════════════════════════════════════
// Compatibility helper for downstream automation pipelines
// ══════════════════════════════════════════════════════════════

app.post('/api/messages', async function(req, res) {
  try {
    var result = await db.storeMessage(req.body);
    res.json(Object.assign({ success: true }, result));
  } catch (e) {
    console.error('[API]', e.message);
    res.status(500).json({ success: false, error: 'Store failed' });
  }
});

// ══════════════════════════════════════════════════════════════
// MEDIA CLEANUP CRON (daily at 3am)
// ══════════════════════════════════════════════════════════════

function cleanupOldMedia() {
  if (!fs.existsSync(MEDIA_ROOT)) return;
  var cutoff = Date.now() - (MEDIA_RETENTION_DAYS * 86400000);
  var deleted = 0;
  var freedBytes = 0;

  try {
    var contacts = fs.readdirSync(MEDIA_ROOT);
    for (var c = 0; c < contacts.length; c++) {
      var contactDir = path.join(MEDIA_ROOT, contacts[c]);
      if (!fs.statSync(contactDir).isDirectory()) continue;
      var types = fs.readdirSync(contactDir);
      for (var t = 0; t < types.length; t++) {
        var typeDir = path.join(contactDir, types[t]);
        if (!fs.statSync(typeDir).isDirectory()) continue;
        var files = fs.readdirSync(typeDir);
        for (var f = 0; f < files.length; f++) {
          var filePath = path.join(typeDir, files[f]);
          var st = fs.statSync(filePath);
          if (st.mtimeMs < cutoff) {
            freedBytes += st.size;
            fs.unlinkSync(filePath);
            deleted++;
          }
        }
        // Remove empty type dirs
        if (fs.readdirSync(typeDir).length === 0) fs.rmdirSync(typeDir);
      }
      // Remove empty contact dirs
      if (fs.readdirSync(contactDir).length === 0) fs.rmdirSync(contactDir);
    }
  } catch (e) {
    console.error('[CLEANUP] Error:', e.message);
  }

  if (deleted > 0) {
    console.log('[CLEANUP] Deleted ' + deleted + ' files (' + Math.round(freedBytes / 1048576) + ' MB), retention: ' + MEDIA_RETENTION_DAYS + ' days');
  }
}

// Run cleanup daily at 3am
function scheduleDailyCleanup() {
  var now = new Date();
  var next3am = new Date(now);
  next3am.setHours(3, 0, 0, 0);
  if (next3am <= now) next3am.setDate(next3am.getDate() + 1);
  var msUntil = next3am - now;

  setTimeout(function() {
    cleanupOldMedia();
    setInterval(cleanupOldMedia, 86400000); // every 24h
  }, msUntil);

  console.log('[CLEANUP] Scheduled daily at 03:00 (retention: ' + MEDIA_RETENTION_DAYS + ' days)');
}

// ══════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════

// Ensure media root exists
fs.mkdirSync(MEDIA_ROOT, { recursive: true });


// Admin endpoint to view failed webhook forwards
app.get('/api/admin/failed-forwards', requireAuth, (req, res) => {
  res.json({
    count: failedWebhookForwards.length,
    maxStored: MAX_FAILED_FORWARDS,
    failures: failedWebhookForwards
  });
});

// ── GET /api/admin/messages/pending-fallback ──
// Polled by an external watcher (cron, queue, etc.) to find outbound messages past deadline
// without delivery confirmation. Returns rows ready for SMS fallback evaluation.
app.get('/api/admin/messages/pending-fallback', async (req, res) => {
  try {
    const sinceMinutes = parseInt(req.query.since_minutes, 10) || 360;
    if (!Number.isFinite(sinceMinutes) || sinceMinutes <= 0 || sinceMinutes > 10080) {
      return res.status(400).json({ success: false, error: 'since_minutes must be 1..10080' });
    }
    const result = await db.pool.query(
      `SELECT id, recipient_phone AS phone, content, source, content_hash,
              created_at AS sent_at, delivery_deadline_at, raw_payload
       FROM messages
       WHERE direction = 'outbound'
         AND fallback_eligible = TRUE
         AND status NOT IN ('delivered','read','fallback_sent','fallback_skipped','failed')
         AND delivery_deadline_at < NOW()
         AND delivery_deadline_at > NOW() - ($1 || ' minutes')::INTERVAL
       ORDER BY recipient_phone, created_at`,
      [String(sinceMinutes)]
    );
    res.json({ success: true, count: result.rows.length, messages: result.rows });
  } catch (err) {
    console.error('[pending-fallback] error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── POST /api/admin/fallback-log ──
// Called externally after attempting an SMS fallback (e.g., by the fallback watcher or batch scanner).
// Transactional : INSERT fallback_sms_log + UPDATE messages.status='fallback_sent' (only if status='sent').
// For any non-'sent' status (e.g., 'skipped_cooldown', 'skipped_duplicate',
// 'failed_*'), the log is recorded but the messages row is not updated.
app.post('/api/admin/fallback-log', async (req, res) => {
  const {
    phone, content, source_type, source_msg_ids,
    trigger_reason, sms_message_id, status, error_details,
  } = req.body || {};

  if (!phone || !content || !source_type || !Array.isArray(source_msg_ids) ||
      !trigger_reason || !status) {
    return res.status(400).json({
      success: false,
      error: 'phone, content, source_type, source_msg_ids[], trigger_reason, status required'
    });
  }

  // sha256 of the SMS content (not the original WA content) for cooldown dedup
  const contentHash = sha256Hash(content);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const logInsert = await client.query(
      `INSERT INTO fallback_sms_log
        (phone, content, content_hash, source_type, source_msg_ids, trigger_reason,
         sms_message_id, status, error_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [phone, content, contentHash, source_type, source_msg_ids, trigger_reason,
       sms_message_id || null, status,
       error_details ? JSON.stringify(error_details) : null]
    );
    const fallback_log_id = logInsert.rows[0].id;

    let updated_message_ids = [];
    if (source_msg_ids.length && status === 'sent') {
      const upd = await client.query(
        `UPDATE messages
         SET status = 'fallback_sent', status_updated = NOW(), fallback_sms_log_id = $1
         WHERE id = ANY($2::int[])
         RETURNING id`,
        [fallback_log_id, source_msg_ids]
      );
      updated_message_ids = upd.rows.map(r => r.id);
    }

    await client.query('COMMIT');
    res.json({ success: true, fallback_log_id, updated_message_ids });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[fallback-log] error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  } finally {
    client.release();
  }
});

// ── GET /api/admin/digest-yesterday ──
// Polled externally (e.g., daily cron) for a digest of yesterday's fallback activity.
// Returns counters + masked fallback details for the previous calendar day.
app.get('/api/admin/digest-yesterday', async (req, res) => {
  try {
    // The "calendar day" is computed in the timezone configured by
    // DIGEST_TIMEZONE (default UTC). Set to a region (e.g., 'Europe/Paris',
    // 'America/New_York') to align "yesterday" with your local business day.
    const tz = process.env.DIGEST_TIMEZONE || 'UTC';
    const counters = await db.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE direction='outbound')                            AS outbound_total,
         COUNT(*) FILTER (WHERE direction='outbound' AND status='delivered')     AS delivered,
         COUNT(*) FILTER (WHERE direction='outbound' AND status='read')          AS read_count,
         COUNT(*) FILTER (WHERE direction='outbound' AND status='failed')        AS failed
       FROM messages
       WHERE created_at::date = (NOW() AT TIME ZONE $1 - INTERVAL '1 day')::date`,
      [tz]
    );
    const fallback = await db.pool.query(
      `SELECT phone, source_type, trigger_reason, sent_at, status
       FROM fallback_sms_log
       WHERE sent_at::date = (NOW() AT TIME ZONE $1 - INTERVAL '1 day')::date
       ORDER BY sent_at`,
      [tz]
    );

    // A fallback row counts as "failed" if its status begins with "failed".
    // Drivers are free to use granular statuses like 'failed_intl',
    // 'failed_provider_down', etc.
    const sentCount = fallback.rows.filter(r => r.status === 'sent').length;
    const failedCount = fallback.rows.filter(r =>
      typeof r.status === 'string' && r.status.startsWith('failed')
    ).length;

    const details = fallback.rows.map(r => ({
      phone: r.phone,
      phone_masked: r.phone.length >= 8
        ? r.phone.slice(0,4) + '***' + r.phone.slice(-4)
        : '***',
      source_type: r.source_type,
      trigger_reason: r.trigger_reason,
      sent_at: r.sent_at,
      status: r.status,
    }));

    const c = counters.rows[0];
    // Compute "yesterday" in the configured timezone (matches the SQL above)
    const yesterday = new Date(Date.now() - 86400000)
      .toLocaleDateString('en-CA', { timeZone: tz });

    res.json({
      date: yesterday,                            // 'YYYY-MM-DD' in DIGEST_TIMEZONE
      outbound_total: parseInt(c.outbound_total, 10),
      delivered: parseInt(c.delivered, 10),
      read_count: parseInt(c.read_count, 10),
      failed: parseInt(c.failed, 10),
      fallback_sms_sent: sentCount,
      fallback_sms_failed: failedCount,
      fallback_details: details,
    });
  } catch (err) {
    console.error('[digest-yesterday] error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── GET /api/admin/cooldown-check ──
// Polled externally before sending an SMS fallback, to check cooldown and avoid duplicates.
// Returns { skip: bool, reason?: string } based on cooldown (5min) + hash dedup (30min).
app.get('/api/admin/cooldown-check', async (req, res) => {
  try {
    const phone = req.query.phone;
    const contentHash = req.query.content_hash; // optional
    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone required' });
    }

    const cooldown = await db.pool.query(
      `SELECT id FROM fallback_sms_log
       WHERE phone = $1 AND sent_at > NOW() - INTERVAL '5 minutes' AND status='sent'
       LIMIT 1`,
      [phone]
    );
    if (cooldown.rows.length) {
      return res.json({ skip: true, reason: 'cooldown_5min' });
    }

    if (contentHash) {
      const dedup = await db.pool.query(
        `SELECT id FROM fallback_sms_log
         WHERE phone = $1 AND content_hash = $2 AND sent_at > NOW() - INTERVAL '30 minutes'
         LIMIT 1`,
        [phone, contentHash]
      );
      if (dedup.rows.length) {
        return res.json({ skip: true, reason: 'duplicate_30min' });
      }
    }
    res.json({ skip: false });
  } catch (err) {
    console.error('[cooldown-check] error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// ── Test helpers (gated by ENABLE_TEST_HELPERS) ──
if (process.env.ENABLE_TEST_HELPERS === 'true') {
  // Backdate a message so its delivery_deadline_at is in the past
  app.post('/api/admin/_test/backdate', async (req, res) => {
    try {
      const id = parseInt(req.query.id, 10);
      const minutes = parseInt(req.query.minutes, 10) || 10;
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'invalid id' });
      }
      const result = await db.pool.query(
        `UPDATE messages
         SET created_at = NOW() - ($1 || ' minutes')::INTERVAL,
             delivery_deadline_at = NOW() - INTERVAL '5 minutes'
         WHERE id = $2
         RETURNING id`,
        [String(minutes), id]
      );
      res.json({ success: true, affected: result.rowCount });
    } catch (err) {
      console.error('[_test/backdate] error:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // Delete a message (for test cleanup)
  app.post('/api/admin/_test/delete-message', async (req, res) => {
    try {
      const id = parseInt(req.query.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'invalid id' });
      }
      const result = await db.pool.query(
        `DELETE FROM messages WHERE id = $1 RETURNING id`,
        [id]
      );
      res.json({ success: true, affected: result.rowCount });
    } catch (err) {
      console.error('[_test/delete-message] error:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // Simulate a Meta status webhook entry — invokes handleStatusEvent directly
  app.post('/api/admin/_test/simulate-status', async (req, res) => {
    try {
      const result = await handleStatusEvent(req.body);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[_test/simulate-status] error:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // Read a message's status fields (for test assertions)
  app.get('/api/admin/_test/message-status', async (req, res) => {
    try {
      const id = parseInt(req.query.id, 10);
      const r = await db.pool.query(
        `SELECT id, status, error_code, wamid FROM messages WHERE id = $1`,
        [id]
      );
      res.json(r.rows[0] || {});
    } catch (err) {
      console.error('[_test/message-status] error:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });
}

// Admin endpoint: messages with delivery errors
app.get('/api/admin/failed-messages', requireAuth, async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var result = await db.pool.query(
      'SELECT m.id, m.wamid, m.conversation_id, m.direction, m.message_type, LEFT(m.content, 100) AS content_preview, m.status, m.error_code, m.error_details, m.created_at, m.status_updated, c.wa_id AS recipient FROM messages m LEFT JOIN conversations conv ON conv.id = m.conversation_id LEFT JOIN contacts c ON c.id = conv.contact_id WHERE m.error_code IS NOT NULL ORDER BY m.status_updated DESC LIMIT $1',
      [limit]
    );
    res.json({ count: result.rows.length, messages: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-up endpoint for replicas (PWA local mirror, etc.). Returns every
// message strictly after `since` so a client can advance a watermark
// without iterating conversation-by-conversation. See PWA MetaBridgeProvider.
app.get('/api/messages/since', async function(req, res) {
  try {
    var since = req.query.since;
    if (!since) {
      return res.status(400).json({ error: 'Missing required query parameter: since (ISO 8601 timestamp)' });
    }
    var parsed = new Date(since);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Invalid since value (must be ISO 8601)' });
    }
    var limit = req.query.limit;
    var direction = req.query.direction;
    if (direction && direction !== 'inbound' && direction !== 'outbound') {
      return res.status(400).json({ error: "direction must be 'inbound' or 'outbound'" });
    }
    var out = await db.getMessagesSince(parsed.toISOString(), limit, direction);
    var rows = out.rows;
    var nextSince = rows.length ? rows[rows.length - 1].created_at : parsed.toISOString();
    res.json({
      count: rows.length,
      has_more: rows.length >= out.limit,
      next_since: nextSince,
      server_time: new Date().toISOString(),
      messages: rows
    });
  } catch (e) {
    console.error('[/api/messages/since] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(CONFIG.port, '0.0.0.0', function() {
  console.log('[WhatsApp API] v2.1 listening on :' + CONFIG.port);
  console.log('[WhatsApp API] Phone Number ID: ' + (CONFIG.phoneNumberId || 'NOT SET'));
  console.log('[WhatsApp API] WABA ID: ' + (CONFIG.wabaId || 'NOT SET'));
  console.log('[WhatsApp API] Token: ' + (CONFIG.accessToken ? 'SET' : 'NOT SET'));
  console.log('[WhatsApp API] Media root: ' + MEDIA_ROOT);
  console.log('[WhatsApp API] webhook forward: ' + (CONFIG.webhookForwardUrl || '(disabled)'));
  scheduleDailyCleanup();
});
