'use strict';

// admin-auth.js does environment validation at module load. We must set the
// required env vars (and not have DB_PASSWORD trigger db.js process.exit)
// before we require anything.
//
// db.js refuses to boot without DB_PASSWORD. We set a placeholder so the
// module can load — these tests don't actually open a connection.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'placeholder-for-tests';
process.env.AUTH_MODE = 'password';
// Pre-computed bcrypt hash of the string "correct-horse-battery-staple", cost 4
// (low cost = fast tests; production uses 12).
process.env.ADMIN_PASSWORD_HASH = '$2a$04$CMFjc.1HH2MteYS7I3pIKOHp8ueq/tk/phEH7HfKJgQ/QbPOyO6U6';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTH_MODE,
  ADMIN_USER_DEFAULT,
  verifyPassword,
  getSessionIdFromRequest,
  buildSessionCookie,
  buildClearCookie,
} = require('../src/lib/admin-auth');

test('AUTH_MODE — defaults to password', () => {
  assert.equal(AUTH_MODE, 'password');
});

test('ADMIN_USER_DEFAULT — is "admin"', () => {
  assert.equal(ADMIN_USER_DEFAULT, 'admin');
});

test('verifyPassword — accepts the known password against its bcrypt hash', async () => {
  const ok = await verifyPassword('correct-horse-battery-staple');
  assert.equal(ok, true);
});

test('verifyPassword — rejects wrong password', async () => {
  const ok = await verifyPassword('wrong-password');
  assert.equal(ok, false);
});

test('verifyPassword — rejects empty / non-string input', async () => {
  assert.equal(await verifyPassword(''), false);
  assert.equal(await verifyPassword(null), false);
  assert.equal(await verifyPassword(12345), false);
});

test('getSessionIdFromRequest — extracts cookie value', () => {
  const req = {
    headers: { cookie: 'foo=bar; wa_admin_session=abcdef0123456789; baz=qux' },
  };
  assert.equal(getSessionIdFromRequest(req), 'abcdef0123456789');
});

test('getSessionIdFromRequest — returns null without cookie', () => {
  assert.equal(getSessionIdFromRequest({ headers: {} }), null);
  assert.equal(getSessionIdFromRequest({ headers: { cookie: 'unrelated=1' } }), null);
});

test('buildSessionCookie — sets HttpOnly + Secure + SameSite=Strict', () => {
  const cookie = buildSessionCookie('a'.repeat(64), new Date(Date.now() + 3600_000));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/admin/);
  assert.match(cookie, /Max-Age=\d+/);
});

test('buildClearCookie — sets Max-Age=0', () => {
  const cookie = buildClearCookie();
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
});
