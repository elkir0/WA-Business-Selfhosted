/**
 * CSRF protection for admin routes (double-submit cookie pattern).
 *
 * On every authenticated GET, we set a `wa_csrf` cookie containing an HMAC-
 * signed token. The browser is expected to send that token back on any state-
 * changing request, either as the form field `_csrf` or the header
 * `X-CSRF-Token`. The middleware compares the cookie value to the submitted
 * value, both of which are signed with the server-side secret — preventing
 * forgery from third-party origins.
 *
 * The secret comes from `SESSION_COOKIE_SECRET`. If unset, a random one is
 * generated at boot — restarts will invalidate existing CSRF tokens (which
 * also coincide with session restarts on the same boot, so it's fine).
 */

const crypto = require('crypto');

const COOKIE_NAME = 'wa_csrf';
const HEADER_NAME = 'x-csrf-token';
const FIELD_NAME = '_csrf';
const SECRET = process.env.SESSION_COOKIE_SECRET || crypto.randomBytes(32).toString('hex');

function sign(token) {
  return crypto.createHmac('sha256', SECRET).update(token).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildCookieValue(token) {
  return `${token}.${sign(token)}`;
}

function parseCookieValue(value) {
  if (typeof value !== 'string') return null;
  const idx = value.lastIndexOf('.');
  if (idx < 0) return null;
  const token = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(sig)) return null;
  const expectedSig = sign(token);
  // Constant-time compare to avoid timing side channels.
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }
  return token;
}

function getCsrfCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const [name, ...rest] = part.split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

function buildSetCookie(token) {
  return [
    `${COOKIE_NAME}=${buildCookieValue(token)}`,
    'Path=/admin',
    'HttpOnly',           // Even though JS reads via the header endpoint, we keep it HttpOnly to thwart XSS scraping.
    'Secure',
    'SameSite=Strict',
    'Max-Age=86400',
  ].join('; ');
}

/**
 * Middleware: ensures a fresh CSRF token cookie is set on safe requests.
 * Use on every GET that renders a page or returns the token via JSON.
 */
function issueCsrfToken(req, res, next) {
  const existing = parseCookieValue(getCsrfCookie(req));
  if (!existing) {
    const token = generateToken();
    const prev = res.getHeader('Set-Cookie');
    const cookie = buildSetCookie(token);
    if (Array.isArray(prev)) {
      res.setHeader('Set-Cookie', [...prev, cookie]);
    } else if (prev) {
      res.setHeader('Set-Cookie', [prev, cookie]);
    } else {
      res.setHeader('Set-Cookie', cookie);
    }
    req.csrfToken = token;
  } else {
    req.csrfToken = existing;
  }
  next();
}

/**
 * Middleware: rejects state-changing requests whose submitted CSRF token
 * doesn't match the signed cookie. Skipped for GET/HEAD/OPTIONS.
 */
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookieToken = parseCookieValue(getCsrfCookie(req));
  if (!cookieToken) {
    return res.status(403).json({ error: 'CSRF cookie missing or invalid.' });
  }

  const submitted = req.headers[HEADER_NAME]
    || (req.body && req.body[FIELD_NAME])
    || null;
  if (!submitted || typeof submitted !== 'string') {
    return res.status(403).json({ error: 'CSRF token missing in request.' });
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(cookieToken))) {
      return res.status(403).json({ error: 'CSRF token mismatch.' });
    }
  } catch {
    return res.status(403).json({ error: 'CSRF token format invalid.' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  HEADER_NAME,
  FIELD_NAME,
  generateToken,
  buildSetCookie,
  parseCookieValue,
  buildCookieValue,
  issueCsrfToken,
  verifyCsrf,
};
