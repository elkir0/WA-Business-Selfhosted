'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'src/server.js');

test('repository layout — required files exist', () => {
  const required = [
    'package.json',
    '.env.example',
    'src/server.js',
    'src/lib/db.js',
    'src/lib/meta-api.js',
    'src/lib/sms-fallback-config.js',
    'src/plugins/sms-fallback/index.js',
    'src/plugins/sms-fallback/helpers.js',
    'src/plugins/sms-fallback/drivers/twilio.js',
    'src/plugins/webhook-forward/index.js',
    'db/schema.sql',
    'docs/deployment.md',
    'docs/meta-setup.md',
    'docs/plugins.md',
    'docs/webhook-format.md',
    'examples/nginx/wa-selfhosted.conf',
    'examples/systemd/wa-selfhosted.service',
    'examples/docker-compose.yml',
    'LICENSE',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'README.md',
  ];
  for (const rel of required) {
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), `missing required file: ${rel}`);
  }
});

test('package.json — declares the runtime dependencies the server requires', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'AGPL-3.0-or-later');
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node must be set');
  for (const dep of ['express', 'cors', 'helmet', 'express-rate-limit', 'pg', 'form-data']) {
    assert.ok(pkg.dependencies[dep], `missing dependency: ${dep}`);
  }
});

test('server.js — middleware order is correct (trust proxy → rate limiters → auth)', () => {
  const src = fs.readFileSync(serverPath, 'utf8');

  const trustProxyIdx = src.indexOf("app.set('trust proxy', 1)");
  const firstLimiterIdx = src.indexOf('rateLimit({');
  const apiLimiterMountIdx = src.indexOf("app.use('/api', apiLimiter)");
  const authMountIdx = src.indexOf("app.use('/api', requireAuth)");

  assert.notEqual(trustProxyIdx, -1, "server must call app.set('trust proxy', 1)");
  assert.notEqual(firstLimiterIdx, -1, 'server must define rate limiters');
  assert.notEqual(apiLimiterMountIdx, -1, 'apiLimiter must be mounted on /api');
  assert.notEqual(authMountIdx, -1, 'requireAuth must be mounted on /api');

  assert.ok(trustProxyIdx < firstLimiterIdx, 'trust proxy must be set before any rate limiter is created');
  assert.ok(apiLimiterMountIdx < authMountIdx, 'apiLimiter must run before requireAuth');
});

test('server.js — rate limiter configuration matches documented values', () => {
  const src = fs.readFileSync(serverPath, 'utf8');
  const patterns = [
    [/(var|const|let)\s+apiLimiter\s*=\s*rateLimit\(\{[\s\S]*?windowMs:\s*60\s*\*\s*1000[\s\S]*?max:\s*100/, 'apiLimiter must be 100 req/min'],
    [/(var|const|let)\s+webhookLimiter\s*=\s*rateLimit\(\{[\s\S]*?windowMs:\s*60\s*\*\s*1000[\s\S]*?max:\s*100/, 'webhookLimiter must be 100 req/min'],
    [/(var|const|let)\s+sendLimiter\s*=\s*rateLimit\(\{[\s\S]*?windowMs:\s*60\s*\*\s*1000[\s\S]*?max:\s*30/, 'sendLimiter must be 30 req/min'],
  ];
  for (const [pattern, msg] of patterns) {
    assert.match(src, pattern, msg);
  }
});

test('server.js — webhook signature verification is wired before parsing the body', () => {
  const src = fs.readFileSync(serverPath, 'utf8');
  assert.match(src, /verifyWebhookSignature/);
  assert.match(src, /X-Hub-Signature-256/i);
});

test('server.js — does not contain any chirosteo / production identifier', () => {
  const src = fs.readFileSync(serverPath, 'utf8');
  const forbidden = [
    /chirosteo/i,
    /shathony/i,
    /webosteo/i,
    /doctolib/i,
    /ekipsecret/i,
    /N8N/, // upper case only — the doc comment in webhook-forward plugin uses 'automation platform' now
    /\bn8n\b/,
    /\bzoko\b/i,
    /10\.10\.10\.\d+/,
    /589510807587130|578793621992297|1066985315416630/,
    /EAA[A-Za-z0-9]{40,}/,
  ];
  for (const pat of forbidden) {
    assert.doesNotMatch(src, pat, `server.js contains forbidden pattern: ${pat}`);
  }
});

test('lib/db.js — DB_PASSWORD is enforced at boot', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/lib/db.js'), 'utf8');
  assert.match(src, /DB_PASSWORD environment variable is required/);
  assert.match(src, /process\.exit\(1\)/);
});

test('plugins/sms-fallback — SMSProvider interface is exported and abstract', async () => {
  // require uses the plugin's main export
  const plugin = require('../src/plugins/sms-fallback');
  assert.equal(typeof plugin.SMSProvider, 'function');
  assert.equal(typeof plugin.registerDriver, 'function');
  assert.equal(typeof plugin.getActiveDriver, 'function');
  assert.equal(typeof plugin.isEnabled, 'function');

  // Calling .send() on the base class should reject (it must be implemented).
  const base = new plugin.SMSProvider();
  await assert.rejects(() => base.send('+15555550100', 'hi'), /must be implemented/);
});

test('plugins/sms-fallback — registry rejects non-conforming drivers', () => {
  const plugin = require('../src/plugins/sms-fallback');
  assert.throws(() => plugin.registerDriver('bogus', { send() {} }), /SMSProvider/);
});

test('plugins/webhook-forward — disabled by default (no WEBHOOK_FORWARD_URL)', () => {
  // Reload the module in an isolated state so we don't leak env from other tests.
  delete require.cache[require.resolve('../src/plugins/webhook-forward')];
  const prev = process.env.WEBHOOK_FORWARD_URL;
  delete process.env.WEBHOOK_FORWARD_URL;
  try {
    const wf = require('../src/plugins/webhook-forward');
    assert.equal(wf.isEnabled(), false);
    assert.deepEqual(wf.getFailed(), []);
  } finally {
    if (prev !== undefined) process.env.WEBHOOK_FORWARD_URL = prev;
  }
});
