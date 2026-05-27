'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The plugin reads WEBHOOK_FORWARD_URL at call time via getUrl(), so we can
// toggle the env between tests as needed. We also need to reset the failed
// buffer between tests — clearFailed() handles that.

let plugin;

function reload() {
  delete require.cache[require.resolve('../src/plugins/webhook-forward')];
  plugin = require('../src/plugins/webhook-forward');
  plugin.clearFailed();
}

test('isEnabled — false without WEBHOOK_FORWARD_URL', () => {
  delete process.env.WEBHOOK_FORWARD_URL;
  reload();
  assert.equal(plugin.isEnabled(), false);
});

test('isEnabled — true when WEBHOOK_FORWARD_URL is set', () => {
  process.env.WEBHOOK_FORWARD_URL = 'https://example.invalid/wa';
  reload();
  assert.equal(plugin.isEnabled(), true);
  delete process.env.WEBHOOK_FORWARD_URL;
});

test('recordFailure — stores entry with id, body, and bodyPreview', () => {
  reload();
  plugin._internal.recordFailure({ msg: 'hello' }, 'HTTP 500');
  const list = plugin.getFailed();
  assert.equal(list.length, 1);
  assert.match(list[0].id, /^[a-f0-9-]{36}$/);
  assert.equal(list[0].error, 'HTTP 500');
  assert.equal(list[0].bodyTruncated, false);
  assert.match(list[0].bodyPreview, /hello/);
});

test('recordFailure — truncates oversized bodies', () => {
  reload();
  // Build a body that serializes to > 64KB.
  const big = { huge: 'x'.repeat(70 * 1024) };
  plugin._internal.recordFailure(big, 'too big');
  const list = plugin.getFailed();
  assert.equal(list.length, 1);
  assert.equal(list[0].bodyTruncated, true);
  assert.ok(list[0].bodyBytes > 64 * 1024);
});

test('recordFailure — ring buffer caps at 100', () => {
  reload();
  for (let i = 0; i < 105; i++) {
    plugin._internal.recordFailure({ i }, 'err');
  }
  assert.equal(plugin.getFailed().length, 100);
});

test('clearFailed — empties the buffer', () => {
  reload();
  plugin._internal.recordFailure({ a: 1 }, 'err');
  plugin._internal.recordFailure({ a: 2 }, 'err');
  assert.equal(plugin.getFailed().length, 2);
  plugin.clearFailed();
  assert.equal(plugin.getFailed().length, 0);
});

test('retryFailed — rejects when plugin disabled', async () => {
  delete process.env.WEBHOOK_FORWARD_URL;
  reload();
  plugin._internal.recordFailure({ a: 1 }, 'err');
  const list = plugin.getFailed();
  const r = await plugin.retryFailed(list[0].id);
  assert.equal(r.ok, false);
  assert.match(r.error, /not enabled/i);
});

test('retryFailed — rejects unknown id', async () => {
  process.env.WEBHOOK_FORWARD_URL = 'https://example.invalid/wa';
  reload();
  const r = await plugin.retryFailed('no-such-id');
  assert.equal(r.ok, false);
  assert.match(r.error, /No failure/);
  delete process.env.WEBHOOK_FORWARD_URL;
});

test('retryFailed — rejects truncated entries', async () => {
  process.env.WEBHOOK_FORWARD_URL = 'https://example.invalid/wa';
  reload();
  plugin._internal.recordFailure({ huge: 'x'.repeat(70 * 1024) }, 'err');
  const id = plugin.getFailed()[0].id;
  const r = await plugin.retryFailed(id);
  assert.equal(r.ok, false);
  assert.match(r.error, /too large/i);
  delete process.env.WEBHOOK_FORWARD_URL;
});

test('retryAll — disabled plugin returns ok:false', async () => {
  delete process.env.WEBHOOK_FORWARD_URL;
  reload();
  plugin._internal.recordFailure({ a: 1 }, 'err');
  const r = await plugin.retryAll();
  assert.equal(r.ok, false);
});

test('retryAll — counts truncated entries as skipped, attempts retryable', async () => {
  // We can't easily mock fetch from inside a test without external deps, but
  // we can verify the counting logic by pointing at a non-routable URL — the
  // attempt will fail and the entries will stay (with updated timestamps).
  process.env.WEBHOOK_FORWARD_URL = 'http://127.0.0.1:1';      // refused
  process.env.WEBHOOK_FORWARD_TIMEOUT_MS = '500';
  reload();
  plugin._internal.recordFailure({ a: 1 }, 'first');           // retryable
  plugin._internal.recordFailure({ huge: 'x'.repeat(70_000) }, 'too big'); // truncated, skipped
  const r = await plugin.retryAll();
  assert.equal(r.ok, true);
  assert.equal(r.skippedTruncated, 1);
  // Both entries should still be in the buffer (the retryable one failed again,
  // the truncated one was skipped).
  assert.equal(plugin.getFailed().length, 2);
  delete process.env.WEBHOOK_FORWARD_URL;
  delete process.env.WEBHOOK_FORWARD_TIMEOUT_MS;
});
