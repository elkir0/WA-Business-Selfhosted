/**
 * Generic helpers for the SMS fallback plugin.
 *
 * Helpers here are intentionally region-agnostic. If you need region-specific
 * phone normalization (e.g., turning local-format French "06xx" into "+33..."),
 * wrap these helpers with a library like `libphonenumber-js` in your own
 * orchestration layer.
 */

const crypto = require('crypto');

/**
 * Normalize a phone number to E.164.
 *
 * Accepts:
 *   "+15551234567"       → "+15551234567"
 *   " +1 (555) 123-4567" → "+15551234567"
 *   "001 555 123 4567"   → "+15551234567"   (00 prefix converted to +)
 *
 * Rejects:
 *   "5551234567"         (no country code / no leading +)
 *   "06 12 34 56 78"     (local format — caller must add country code)
 *
 * For local-format input, normalize on the caller side with a region-aware
 * library before calling this function.
 *
 * @param {string} input — phone number string
 * @returns {string} E.164 phone number (+ followed by 7–15 digits)
 * @throws {Error} if input cannot be parsed as E.164
 */
function normalizePhoneE164(input) {
  if (input == null || typeof input !== 'string') {
    throw new Error('phone must be a string');
  }
  let s = input.replace(/[^\d+]/g, '');
  if (s.length === 0) {
    throw new Error('phone contains no digits');
  }
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    throw new Error('phone must be in E.164 format (start with + and include country code)');
  }
  if (!/^\+\d{7,15}$/.test(s)) {
    throw new Error('phone is not a valid E.164 number (expected + followed by 7–15 digits)');
  }
  return s;
}

/**
 * SHA-256 hash of arbitrary content, returned as lowercase hex.
 * Used to deduplicate fallback SMS — sending the same content twice for the
 * same recipient within a deadline window should be a no-op.
 */
function sha256Hash(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

/**
 * Compute a delivery deadline timestamp.
 *
 * @param {number} offsetMs — milliseconds to add to baseDate
 * @param {Date}   [baseDate=new Date()] — reference time, defaults to now
 * @returns {Date} deadline timestamp
 */
function calcDeliveryDeadline(offsetMs, baseDate) {
  const base = baseDate instanceof Date ? baseDate : new Date();
  if (!Number.isFinite(offsetMs) || offsetMs < 0) {
    throw new Error('offsetMs must be a non-negative finite number');
  }
  return new Date(base.getTime() + offsetMs);
}

/**
 * Check whether a phone number's country code is in an allowlist.
 *
 * Allowlist is an array of E.164-prefix strings (e.g., ['+1', '+44']) — a
 * phone matches if it starts with any of them. Use this to restrict which
 * recipients are eligible for the fallback (cost control, regional scope).
 */
function isAllowlisted(phoneE164, allowlistPrefixes) {
  if (!phoneE164 || !Array.isArray(allowlistPrefixes) || allowlistPrefixes.length === 0) {
    return false;
  }
  return allowlistPrefixes.some(prefix => phoneE164.startsWith(prefix));
}

module.exports = {
  normalizePhoneE164,
  sha256Hash,
  calcDeliveryDeadline,
  isAllowlisted,
};
