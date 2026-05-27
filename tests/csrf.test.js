'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// We need SESSION_COOKIE_SECRET to be set BEFORE requiring the module — the
// secret is captured at module load. Set a deterministic value so the signature
// is reproducible across runs.
process.env.SESSION_COOKIE_SECRET = 'deadbeef'.repeat(8);

const {
  generateToken,
  buildCookieValue,
  parseCookieValue,
} = require('../src/lib/csrf');

test('generateToken — 64 hex chars (32 bytes)', () => {
  const t = generateToken();
  assert.equal(typeof t, 'string');
  assert.match(t, /^[a-f0-9]{64}$/);
});

test('buildCookieValue / parseCookieValue — round-trip', () => {
  const t = generateToken();
  const cookie = buildCookieValue(t);
  assert.equal(parseCookieValue(cookie), t);
});

test('parseCookieValue — rejects malformed value', () => {
  assert.equal(parseCookieValue(''), null);
  assert.equal(parseCookieValue('no-dot'), null);
  assert.equal(parseCookieValue('xxx.yyy'), null);              // non-hex
  assert.equal(parseCookieValue('a'.repeat(64) + '.bad'), null); // sig wrong length
});

test('parseCookieValue — rejects forged signature', () => {
  const t = generateToken();
  const cookie = buildCookieValue(t);
  // Flip the last character of the signature.
  const tampered = cookie.slice(0, -1) + (cookie.slice(-1) === '0' ? '1' : '0');
  assert.equal(parseCookieValue(tampered), null);
});

test('parseCookieValue — rejects null / non-string', () => {
  assert.equal(parseCookieValue(null), null);
  assert.equal(parseCookieValue(undefined), null);
  assert.equal(parseCookieValue(12345), null);
});
