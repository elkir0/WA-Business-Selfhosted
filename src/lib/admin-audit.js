/**
 * Admin action audit log helper.
 *
 * Wraps Express route handlers so that every action attempt — successful or
 * failed — gets a row in `admin_audit_log`. Logging is best-effort: a database
 * failure must NOT mask the original handler error, so we log to console and
 * continue.
 *
 * Usage:
 *
 *   const { audit } = require('./lib/admin-audit');
 *
 *   app.post('/admin/api/conversations/:id/close',
 *     audit('conversation_close', 'conversation', req => req.params.id),
 *     async (req, res) => { ... });
 *
 * The middleware wraps the response: after the next handler finishes (or
 * throws), it inserts a row reflecting what happened.
 */

const db = require('./db');

function clientIp(req) {
  // Express sets req.ip when `trust proxy` is enabled (it is, see server.js).
  return req.ip || null;
}

function clientUa(req) {
  return req.headers['user-agent'] || null;
}

function audit(action, targetType, targetIdFn) {
  return function auditMiddleware(req, res, next) {
    const start = Date.now();
    const originalEnd = res.end;
    const originalJson = res.json;

    let finished = false;
    function logOutcome() {
      if (finished) return;
      finished = true;
      const result = res.statusCode >= 400 ? 'error' : 'success';
      let targetId = null;
      try {
        targetId = typeof targetIdFn === 'function' ? targetIdFn(req) : null;
      } catch {
        targetId = null;
      }
      const payload = sanitizeBody(req.body);
      payload.duration_ms = Date.now() - start;
      payload.status_code = res.statusCode;

      db.pool.query(
        `INSERT INTO admin_audit_log
           (admin_user, action, target_type, target_id, payload, ip, user_agent, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.adminUser || 'unknown',
          action,
          targetType,
          targetId ? String(targetId).slice(0, 128) : null,
          payload,
          clientIp(req),
          clientUa(req),
          result,
        ]
      ).catch(err => {
        console.error('[admin-audit] insert failed:', err.message);
      });
    }

    res.end = function patchedEnd(...args) {
      logOutcome();
      return originalEnd.apply(this, args);
    };
    res.json = function patchedJson(...args) {
      logOutcome();
      return originalJson.apply(this, args);
    };

    next();
  };
}

/**
 * Strip secrets from arbitrary body payloads before storing them. The list
 * of keys is intentionally broad — better over-redact than leak.
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  const REDACT = /(password|token|secret|hash|authorization|cookie|api[_-]?key)/i;
  for (const [key, value] of Object.entries(body)) {
    if (REDACT.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      out[key] = value.slice(0, 500) + '… [truncated]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function listRecentAudit(limit, offset) {
  const capped = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const result = await db.pool.query(
    `SELECT id, created_at, admin_user, action, target_type, target_id, payload, ip, user_agent, result
     FROM admin_audit_log
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [capped, off]
  );
  return result.rows;
}

module.exports = {
  audit,
  listRecentAudit,
};
