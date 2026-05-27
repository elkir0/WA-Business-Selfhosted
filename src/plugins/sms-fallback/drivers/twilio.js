/**
 * Twilio reference SMS driver.
 *
 * Required env vars (when SMS_FALLBACK_DRIVER=twilio):
 *
 *   TWILIO_ACCOUNT_SID   — your Twilio Account SID
 *   TWILIO_AUTH_TOKEN    — your Twilio Auth Token
 *   TWILIO_FROM          — sender phone number (E.164) or messaging service SID
 *
 * No external SDK is required — the driver talks to the Twilio REST API
 * directly via fetch, keeping the dependency footprint minimal.
 *
 * Returns `{ providerId, status, raw }`:
 *   providerId — Twilio Message SID (e.g., "SMxxxxxxxxxxxx")
 *   status     — "queued" | "sent" | "failed"
 *   raw        — full Twilio JSON response
 */

const { SMSProvider } = require('..');

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

class TwilioSMSDriver extends SMSProvider {
  constructor() {
    super();
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.from = process.env.TWILIO_FROM;

    if (!this.accountSid || !this.authToken || !this.from) {
      throw new Error('Twilio driver: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM are required');
    }
  }

  async send(to, body, opts) {
    const url = `${TWILIO_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const form = new URLSearchParams();
    form.set('To', to);
    form.set('Body', body);
    // TWILIO_FROM can be a phone (+1...) or a Messaging Service SID (MGxxxx).
    if (this.from.startsWith('MG')) {
      form.set('MessagingServiceSid', this.from);
    } else {
      form.set('From', this.from);
    }
    if (opts && opts.statusCallback) form.set('StatusCallback', opts.statusCallback);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const raw = await response.json();

    if (!response.ok) {
      const err = new Error(raw.message || `Twilio API error (HTTP ${response.status})`);
      err.status = response.status;
      err.provider = 'twilio';
      err.raw = raw;
      throw err;
    }

    return {
      providerId: raw.sid,
      status: raw.status === 'failed' ? 'failed' : (raw.status === 'sent' ? 'sent' : 'queued'),
      raw,
    };
  }
}

module.exports = TwilioSMSDriver;
