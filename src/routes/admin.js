/**
 * Admin UI routes
 *
 * Public surface:
 *   GET  /admin/login            login form (only when AUTH_MODE=password)
 *   POST /admin/login            verify password, set session cookie
 *   POST /admin/logout           destroy session
 *   GET  /admin/csrf-token       return current CSRF token (for XHR clients)
 *   GET  /admin/*                serve the Preact SPA (auth-required)
 *
 * Auth model is in src/lib/admin-auth.js, CSRF in src/lib/csrf.js.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const {
  AUTH_MODE,
  ADMIN_USER_DEFAULT,
  verifyPassword,
  createSession,
  destroySession,
  getSessionIdFromRequest,
  buildSessionCookie,
  buildClearCookie,
  requireHttpsInProduction,
  requireAdminSession,
} = require('../lib/admin-auth');
const { issueCsrfToken, verifyCsrf } = require('../lib/csrf');

const router = express.Router();

// Five login attempts per IP per 15 minutes. Trust-proxy must already be set.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

router.use(requireHttpsInProduction);

// ── Login page (server-rendered) ─────────────────────────────────────────────

router.get('/login', issueCsrfToken, (req, res) => {
  if (AUTH_MODE === 'proxy') {
    return res.status(404).send('Login not used in AUTH_MODE=proxy.');
  }
  res.type('html').send(renderLoginPage({
    csrfToken: req.csrfToken,
    error: null,
    next: typeof req.query.next === 'string' ? req.query.next : '/admin',
  }));
});

router.post('/login', loginLimiter, express.urlencoded({ extended: false, limit: '4kb' }), issueCsrfToken, verifyCsrf, async (req, res) => {
  if (AUTH_MODE === 'proxy') {
    return res.status(404).send('Login not used in AUTH_MODE=proxy.');
  }

  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nextUrl = typeof req.body.next === 'string' && req.body.next.startsWith('/admin')
    ? req.body.next
    : '/admin';

  const ok = await verifyPassword(password);
  if (!ok) {
    return res.status(401).type('html').send(renderLoginPage({
      csrfToken: req.csrfToken,
      error: 'Invalid password.',
      next: nextUrl,
    }));
  }

  const { id, expiresAt } = await createSession(ADMIN_USER_DEFAULT, req.ip, req.headers['user-agent']);
  res.setHeader('Set-Cookie', buildSessionCookie(id, expiresAt));
  res.redirect(nextUrl);
});

// ── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', express.urlencoded({ extended: false, limit: '4kb' }), verifyCsrf, async (req, res) => {
  const sid = getSessionIdFromRequest(req);
  await destroySession(sid).catch(() => {});
  res.setHeader('Set-Cookie', buildClearCookie());
  if (req.accepts('html')) return res.redirect('/admin/login');
  res.json({ ok: true });
});

// ── CSRF token for XHR clients (must be auth'd) ──────────────────────────────

router.get('/csrf-token', requireAdminSession, issueCsrfToken, (req, res) => {
  res.json({ token: req.csrfToken });
});

// ── /admin/api/* — internal endpoints for the bundled SPA ────────────────────
router.use('/api', require('./api-admin'));

// ── SPA catch-all (auth-required) ────────────────────────────────────────────
// Serves the Preact bundle compiled by Vite into `dist/admin/`.

const SPA_DIR = path.join(__dirname, '..', '..', 'dist', 'admin');
const SPA_INDEX = path.join(SPA_DIR, 'index.html');

router.use(requireAdminSession);
router.use(express.static(SPA_DIR, { index: false, fallthrough: true }));

router.get(/.*/, (req, res) => {
  // For HTML navigation, issue a CSRF token cookie so the SPA can read it
  // via /admin/csrf-token and submit on POSTs.
  issueCsrfToken(req, res, () => {
    if (fs.existsSync(SPA_INDEX)) {
      res.sendFile(SPA_INDEX);
    } else {
      res.status(503).type('text').send(
        'Admin UI bundle not built yet.\n' +
        'Run `npm run build` (or `npm install` which triggers it via postinstall).\n'
      );
    }
  });
});

// ── HTML helpers ─────────────────────────────────────────────────────────────

function renderLoginPage({ csrfToken, error, next }) {
  const errBlock = error
    ? `<div class="error" role="alert">${escapeHtml(error)}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin login — WA-Business-Selfhosted</title>
  <link rel="icon" type="image/svg+xml" href="/admin/assets/favicon.svg">
  <style>
    :root {
      --primary: #0EA5E9;
      --primary-dark: #0369A1;
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --text: #0F172A;
      --muted: #475569;
      --border: #E2E8F0;
      --danger: #EF4444;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0F172A; --surface: #1E293B; --text: #F1F5F9; --muted: #94A3B8; --border: #1E293B; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: 'Inter', system-ui, -apple-system, sans-serif;
           background: var(--bg); color: var(--text); display: grid; place-items: center; padding: 2rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
            padding: 2rem; width: 100%; max-width: 360px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    h1 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
    .subtitle { margin: 0 0 1.5rem; color: var(--muted); font-size: 0.875rem; }
    label { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; color: var(--muted); }
    input[type=password] { width: 100%; padding: 0.625rem 0.75rem; border: 1px solid var(--border);
                           border-radius: 8px; font-size: 1rem; background: var(--bg); color: var(--text); }
    input[type=password]:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgb(14 165 233 / 0.15); }
    button { margin-top: 1rem; width: 100%; padding: 0.625rem; border: 0; border-radius: 8px;
             background: var(--primary); color: white; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: var(--primary-dark); }
    .error { background: rgb(239 68 68 / 0.1); color: var(--danger);
             padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/admin/login" autocomplete="off">
    <h1>wa.business</h1>
    <p class="subtitle">admin login</p>
    ${errBlock}
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

module.exports = router;
