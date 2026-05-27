/**
 * Admin authentication layer.
 *
 * Two modes, selected by the `AUTH_MODE` env var:
 *
 *   AUTH_MODE=password (default)
 *     A single admin (the gateway operator) logs in with a password. The hash
 *     of the password is stored in `ADMIN_PASSWORD_HASH` (bcrypt format).
 *     Sessions are persisted in the `admin_sessions` table, keyed by a 32-byte
 *     random hex cookie set with HttpOnly + Secure + SameSite=Strict.
 *
 *   AUTH_MODE=proxy
 *     The gateway trusts an upstream reverse proxy (oauth2-proxy, Authelia,
 *     Nginx Basic Auth, …) to authenticate and to pass the user identity in
 *     `X-Forwarded-User`. No login form, no session table.
 *
 * In either mode, after the middleware runs successfully, `req.adminUser` is
 * set on the request, and the route handler can call `requireAdminSession`.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const AUTH_MODE = (process.env.AUTH_MODE || 'password').toLowerCase();
const SESSION_TTL_HOURS = parseInt(process.env.ADMIN_SESSION_TTL_HOURS, 10) || 24;
const SESSION_COOKIE_NAME = 'wa_admin_session';
const ADMIN_USER_DEFAULT = 'admin';

if (!['password', 'proxy'].includes(AUTH_MODE)) {
  console.error(`[admin-auth] FATAL: AUTH_MODE must be 'password' or 'proxy' (got '${AUTH_MODE}')`);
  process.exit(1);
}

if (AUTH_MODE === 'password' && !process.env.ADMIN_PASSWORD_HASH) {
  console.error('[admin-auth] FATAL: AUTH_MODE=password requires ADMIN_PASSWORD_HASH (run `node scripts/set-password.js` to generate one)');
  process.exit(1);
}

// ── Session helpers ─────────────────────────────────────────────────────────

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(adminUser, ip, userAgent) {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await db.pool.query(
    'INSERT INTO admin_sessions (id, admin_user, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [id, adminUser, expiresAt, ip || null, userAgent || null]
  );
  return { id, expiresAt };
}

async function findSession(id) {
  if (!id || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
  const result = await db.pool.query(
    'SELECT id, admin_user, expires_at FROM admin_sessions WHERE id = $1 AND expires_at > NOW()',
    [id]
  );
  return result.rows[0] || null;
}

async function touchSession(id) {
  await db.pool.query(
    'UPDATE admin_sessions SET last_seen = NOW() WHERE id = $1',
    [id]
  );
}

async function destroySession(id) {
  if (!id) return;
  await db.pool.query('DELETE FROM admin_sessions WHERE id = $1', [id]);
}

async function destroyExpiredSessions() {
  const result = await db.pool.query('DELETE FROM admin_sessions WHERE expires_at < NOW()');
  return result.rowCount || 0;
}

// ── Password verification ───────────────────────────────────────────────────

async function verifyPassword(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return false;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

function getSessionIdFromRequest(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    const [name, ...rest] = part.split('=');
    if (name === SESSION_COOKIE_NAME) return rest.join('=');
  }
  return null;
}

function buildSessionCookie(sessionId, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    'Path=/admin',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

function buildClearCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

// ── HTTPS enforcement (production only) ─────────────────────────────────────

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

function requireHttpsInProduction(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (isSecureRequest(req)) return next();
  res.status(400).send('HTTPS required for admin UI in production. Configure your reverse proxy to set X-Forwarded-Proto: https.');
}

// ── Middleware ──────────────────────────────────────────────────────────────

async function requireAdminSession(req, res, next) {
  try {
    if (AUTH_MODE === 'proxy') {
      const user = req.headers['x-forwarded-user'];
      if (!user || typeof user !== 'string' || user.trim().length === 0) {
        return res.status(401).json({ error: 'AUTH_MODE=proxy but X-Forwarded-User is missing — configure your reverse proxy.' });
      }
      req.adminUser = user.trim().slice(0, 64);
      return next();
    }

    const sessionId = getSessionIdFromRequest(req);
    const session = await findSession(sessionId);
    if (!session) {
      if (req.accepts('html') && !req.path.startsWith('/admin/api/')) {
        const target = encodeURIComponent(req.originalUrl);
        return res.redirect(`/admin/login?next=${target}`);
      }
      return res.status(401).json({ error: 'Authentication required.' });
    }

    req.adminUser = session.admin_user;
    req.adminSessionId = session.id;
    // Best-effort touch — don't block the request on failure.
    touchSession(session.id).catch(() => {});
    next();
  } catch (err) {
    console.error('[admin-auth] middleware error:', err.message);
    res.status(500).json({ error: 'Internal authentication error.' });
  }
}

module.exports = {
  AUTH_MODE,
  ADMIN_USER_DEFAULT,
  SESSION_COOKIE_NAME,
  verifyPassword,
  createSession,
  findSession,
  destroySession,
  destroyExpiredSessions,
  getSessionIdFromRequest,
  buildSessionCookie,
  buildClearCookie,
  requireHttpsInProduction,
  requireAdminSession,
};
