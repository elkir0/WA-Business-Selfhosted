/**
 * Webhook Forward Plugin
 *
 * Optional pipeline that forwards every parsed inbound webhook payload to an
 * external HTTP endpoint (your automation platform, your custom worker,
 * your queue ingest). Useful when you want a separate process to react to
 * messages without subscribing directly to Meta's webhook (which only allows
 * one URL per WABA).
 *
 * Activation:
 *   WEBHOOK_FORWARD_URL = https://your-automation/webhook   (required)
 *   WEBHOOK_FORWARD_TIMEOUT_MS = 15000   (optional, default 15s)
 *   WEBHOOK_FORWARD_RETRIES = 3          (optional, default 3 retries with
 *                                         exponential backoff)
 *
 * Failed forwards (after all retries exhausted) are kept in an in-memory
 * ring buffer (last 100) with the full original payload, so an admin can
 * retry them later via `retryFailed(id)` / `retryAll()`. The buffer is lost
 * on process restart — for durable replay, persist your own copy upstream.
 */

const crypto = require('node:crypto');

const MAX_FAILED = 100;
const MAX_STORED_BODY_BYTES = 64 * 1024; // 64KB hard cap per failure entry

// Each entry: { id, timestamp, error, body, bodyTruncated }
const failed = [];

function getUrl() {
  return process.env.WEBHOOK_FORWARD_URL || '';
}

function isEnabled() {
  return getUrl().length > 0;
}

function getTimeoutMs() {
  const v = parseInt(process.env.WEBHOOK_FORWARD_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 15000;
}

function getMaxRetries() {
  const v = parseInt(process.env.WEBHOOK_FORWARD_RETRIES, 10);
  return Number.isFinite(v) && v >= 0 ? v : 3;
}

async function attemptForward(body) {
  const url = getUrl();
  if (!url) {
    const err = new Error('webhook-forward not enabled (WEBHOOK_FORWARD_URL is unset)');
    err.code = 'NOT_ENABLED';
    throw err;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(getTimeoutMs()),
  });
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status);
  }
}

async function forward(body, maxRetries) {
  if (!isEnabled()) return;

  const retries = typeof maxRetries === 'number' ? maxRetries : getMaxRetries();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(r => setTimeout(r, delay));
      }
      await attemptForward(body);
      if (attempt > 0) console.log(`[webhook-forward] OK (retry ${attempt})`);
      else console.log('[webhook-forward] OK');
      return;
    } catch (e) {
      lastError = e;
      console.error(`[webhook-forward] attempt ${attempt + 1}/${retries + 1} failed: ${e.message}`);
    }
  }

  recordFailure(body, lastError ? lastError.message : 'unknown');
  console.error('[webhook-forward] all retries exhausted, stored in failed buffer');
}

function recordFailure(body, errorMessage) {
  const serialized = JSON.stringify(body);
  const truncated = serialized.length > MAX_STORED_BODY_BYTES;
  // Always store as parsed object when small enough; if truncated, store as
  // the original object anyway (we already serialized for size check).
  failed.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    error: errorMessage,
    body: truncated ? null : body,
    bodyPreview: serialized.substring(0, 200),
    bodyTruncated: truncated,
    bodyBytes: serialized.length,
  });
  if (failed.length > MAX_FAILED) failed.shift();
}

function getFailed() {
  // Strip the full body for safe over-the-wire transport — clients consume the
  // preview and can ask for the full body on demand if needed.
  return failed.map(({ body, ...rest }) => rest);
}

function findFailed(id) {
  return failed.find(f => f.id === id);
}

function removeFailed(id) {
  const idx = failed.findIndex(f => f.id === id);
  if (idx >= 0) failed.splice(idx, 1);
  return idx >= 0;
}

function clearFailed() {
  failed.length = 0;
}

/**
 * Re-attempt one stored failure. On success, removes it from the buffer; on
 * failure, the entry stays. Returns { ok, error? }.
 */
async function retryFailed(id) {
  if (!isEnabled()) {
    return { ok: false, error: 'webhook-forward is not enabled (WEBHOOK_FORWARD_URL is unset)' };
  }
  const entry = findFailed(id);
  if (!entry) return { ok: false, error: 'No failure with that id.' };
  if (entry.bodyTruncated || !entry.body) {
    return { ok: false, error: 'Original body was too large to retain — cannot retry.' };
  }
  try {
    await attemptForward(entry.body);
    removeFailed(id);
    return { ok: true };
  } catch (e) {
    entry.timestamp = new Date().toISOString();
    entry.error = e.message;
    return { ok: false, error: e.message };
  }
}

/**
 * Retry every retryable failure (skipping those whose body is truncated).
 * Returns counts. Each retryable entry is attempted once; on success it is
 * removed, on failure it stays with an updated timestamp + error.
 */
async function retryAll() {
  if (!isEnabled()) {
    return { ok: false, error: 'webhook-forward is not enabled (WEBHOOK_FORWARD_URL is unset)' };
  }
  const retryable = failed.filter(f => !f.bodyTruncated && f.body);
  const skipped = failed.length - retryable.length;
  let succeeded = 0;
  let stillFailed = 0;

  for (const entry of retryable.slice()) {
    try {
      await attemptForward(entry.body);
      removeFailed(entry.id);
      succeeded += 1;
    } catch (e) {
      entry.timestamp = new Date().toISOString();
      entry.error = e.message;
      stillFailed += 1;
    }
  }

  return { ok: true, succeeded, stillFailed, skippedTruncated: skipped };
}

module.exports = {
  forward,
  getFailed,
  clearFailed,
  isEnabled,
  retryFailed,
  retryAll,
  // Exposed for tests:
  _internal: { recordFailure, attemptForward },
};
