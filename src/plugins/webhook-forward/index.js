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
 * Failed forwards (after all retries exhausted) are kept in an in-memory ring
 * buffer so an admin can retry them later via the /api/admin/failed-forwards
 * endpoint.
 */

const MAX_FAILED = 100;
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

async function forward(body, maxRetries) {
  const url = getUrl();
  if (!url) return;

  const retries = typeof maxRetries === 'number' ? maxRetries : getMaxRetries();
  const timeoutMs = getTimeoutMs();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(r => setTimeout(r, delay));
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      console.log('[webhook-forward] OK' + (attempt > 0 ? ` (retry ${attempt})` : ''));
      return;
    } catch (e) {
      lastError = e;
      console.error(`[webhook-forward] attempt ${attempt + 1}/${retries + 1} failed: ${e.message}`);
    }
  }

  failed.push({
    timestamp: new Date().toISOString(),
    error: lastError ? lastError.message : 'unknown',
    bodyPreview: JSON.stringify(body).substring(0, 200),
  });
  if (failed.length > MAX_FAILED) failed.shift();
  console.error('[webhook-forward] all retries exhausted, stored in failed buffer');
}

function getFailed() {
  return failed.slice();
}

function clearFailed() {
  failed.length = 0;
}

module.exports = {
  forward,
  getFailed,
  clearFailed,
  isEnabled,
};
