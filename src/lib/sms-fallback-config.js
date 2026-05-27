/**
 * SMS Fallback configuration shim
 *
 * Adapts the generic helpers in `src/plugins/sms-fallback/helpers.js` to the
 * legacy call signatures used in server.js, sourcing defaults from env vars.
 *
 * Env vars:
 *   SMS_FALLBACK_DEADLINE_MS         — milliseconds before a message is
 *                                      considered "past deadline" and eligible
 *                                      for SMS fallback (default 300000 = 5 min)
 *   SMS_FALLBACK_ALLOWLIST_PREFIXES  — comma-separated E.164 prefixes of
 *                                      recipients eligible for fallback
 *                                      (e.g., "+1,+44"). Empty list = no
 *                                      recipients are eligible (fallback off).
 *
 * If you need per-source deadlines or smarter eligibility rules, modify
 * `calcDeliveryDeadline` and `isWhitelisted` below; this module is the single
 * place to encode that policy.
 */

const helpers = require('../plugins/sms-fallback/helpers');

const DEFAULT_DEADLINE_MS = (() => {
  const v = parseInt(process.env.SMS_FALLBACK_DEADLINE_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 5 * 60 * 1000; // 5 minutes
})();

const ALLOWLIST_PREFIXES = (process.env.SMS_FALLBACK_ALLOWLIST_PREFIXES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// eslint-disable-next-line no-unused-vars
function calcDeliveryDeadline(source) {
  // OSS default: single global deadline regardless of source. Extend this
  // function to map specific source names to custom deadlines if needed.
  return helpers.calcDeliveryDeadline(DEFAULT_DEADLINE_MS);
}

function isWhitelisted(phoneE164) {
  return helpers.isAllowlisted(phoneE164, ALLOWLIST_PREFIXES);
}

function sanitizeSource(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 50 ? s : 'unknown';
}

module.exports = {
  normalizePhoneE164: helpers.normalizePhoneE164,
  sha256Hash: helpers.sha256Hash,
  calcDeliveryDeadline,
  isWhitelisted,
  sanitizeSource,
};
