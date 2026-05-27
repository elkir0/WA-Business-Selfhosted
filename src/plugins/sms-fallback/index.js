/**
 * SMS Fallback Plugin
 *
 * Provides an interface (`SMSProvider`) for delivering SMS as a fallback when a
 * WhatsApp message has not been delivered/read within its deadline.
 *
 * This plugin DOES NOT decide which messages to fall back on — that's the
 * orchestration layer's job (see the admin endpoints in server.js). The plugin
 * only exposes:
 *
 *   - the provider interface that drivers must implement
 *   - a registry for configured drivers
 *   - generic helpers (E.164 normalization, content hashing, deadline math)
 *
 * Drivers shipped:
 *   - drivers/twilio.js — reference implementation against the Twilio HTTP API
 *
 * Custom drivers (e.g., your own SMS bridge, a regional aggregator) plug into
 * the same interface. See docs/plugins.md for details.
 */

const helpers = require('./helpers');

// ── Provider interface ──
// All drivers must implement `send(to, body, opts)` returning a promise that
// resolves to `{ providerId, status: 'sent'|'queued'|'failed', raw }`.
//
// `to`   — E.164 phone number (string, starting with +)
// `body` — UTF-8 message body (string, ≤ provider's max length)
// `opts` — optional driver-specific options (e.g., sender ID, callback URL)

class SMSProvider {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async send(to, body, opts) {
    throw new Error('SMSProvider.send() must be implemented by the driver');
  }
}

// ── Registry ──
// Drivers register themselves at load time. The active driver is selected via
// the SMS_FALLBACK_DRIVER env var (e.g., "twilio"). If unset or "disabled",
// the plugin is effectively off.

const registry = new Map();

function registerDriver(name, instance) {
  if (!(instance instanceof SMSProvider)) {
    throw new Error('registerDriver: instance must extend SMSProvider');
  }
  registry.set(name, instance);
}

function getActiveDriver() {
  const name = process.env.SMS_FALLBACK_DRIVER;
  if (!name || name === 'disabled') return null;
  const driver = registry.get(name);
  if (!driver) {
    console.warn(`[sms-fallback] SMS_FALLBACK_DRIVER="${name}" but no driver is registered with that name. Available: [${[...registry.keys()].join(', ') || 'none'}]`);
    return null;
  }
  return driver;
}

function isEnabled() {
  return getActiveDriver() !== null;
}

module.exports = {
  SMSProvider,
  registerDriver,
  getActiveDriver,
  isEnabled,
  helpers,
};
