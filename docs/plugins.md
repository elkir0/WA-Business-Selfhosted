# Plugins

WA-Business-Selfhosted ships with two optional plugins. Both are off by default and only activate when their env vars are set.

## webhook-forward

Re-publishes every inbound message payload to an external HTTP endpoint, after the gateway has stored it locally. Use it to drive an external automation, a queue ingest, or any downstream worker.

### Activation

```bash
WEBHOOK_FORWARD_URL=https://your-automation.example.com/webhook/wa-inbound
WEBHOOK_FORWARD_TIMEOUT_MS=15000    # optional, default 15000
WEBHOOK_FORWARD_RETRIES=3           # optional, default 3 (with exponential backoff)
```

If `WEBHOOK_FORWARD_URL` is empty or unset, the plugin is disabled and no requests are made.

### Behaviour

- Called once per inbound Meta webhook payload, **after** the gateway has stored and broadcast over SSE.
- POST `Content-Type: application/json`, body = the full Meta payload as received.
- Retries on any HTTP non-2xx with exponential backoff (1s, 2s, 4s, …, capped at 10s).
- After all retries are exhausted, the failure is kept in an in-memory ring buffer (last 100). View them:

  ```bash
  curl -H "Authorization: Bearer $API_TOKEN" https://your-domain/api/admin/failed-forwards
  ```

  The buffer resets when the process restarts, so do not rely on it for durable storage.

### Skipped on human takeover

If the gateway detects that a human operator has paused the bot for a conversation (by sending a manual message — see "human takeover" in the source), webhook-forward is **skipped for inbound messages from that contact for 1 hour**, so your automation doesn't fight the human. Resume with:

```bash
curl -X POST -H "Authorization: Bearer $API_TOKEN" \
  https://your-domain/api/conversations/<id>/ai-resume
```

## sms-fallback

Sends an SMS to the same recipient when a WhatsApp message has not been delivered or read within a deadline. Useful when your audience may be partly offline or use SMS more reliably than WhatsApp.

### Architecture

The plugin is split in three:

```
src/plugins/sms-fallback/
├── index.js          ← SMSProvider interface + driver registry
├── helpers.js        ← Generic helpers (E.164 normalization, content hashing)
└── drivers/
    └── twilio.js     ← Reference driver against the Twilio REST API
```

The gateway records eligibility on every outbound message (`recipient_phone`, `source`, `content_hash`, `delivery_deadline_at`, `fallback_eligible` in the `messages` table). Deciding **when** to actually call the SMS provider is the orchestration layer's job — see the admin endpoints below.

### Activation (Twilio example)

```bash
SMS_FALLBACK_DRIVER=twilio
SMS_FALLBACK_ALLOWLIST_PREFIXES=+1,+44       # only these recipients are eligible
SMS_FALLBACK_DEADLINE_MS=300000              # 5 minutes

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM=+15555550100        # or a Messaging Service SID starting with MG
```

### Orchestration endpoints

The gateway exposes the building blocks; you call them from a cron, a queue worker, or whatever you prefer.

- `GET /api/admin/messages/pending-fallback` — outbound messages past their deadline without delivery confirmation.
- `GET /api/admin/cooldown-check?phone=+15551234567` — has this recipient already received a fallback in the cooldown window? Use it to avoid duplicates.
- `POST /api/admin/fallback-log` — record a fallback attempt (sent, skipped, or failed). Transactional: if `status='sent'` it also flips the original `messages.status` to `fallback_sent`.
- `GET /api/admin/digest-yesterday` — summary counters for the previous calendar day in your `DIGEST_TIMEZONE`.

All of these require the Bearer token.

### Writing a custom driver

Implement the `SMSProvider` interface:

```js
// src/plugins/sms-fallback/drivers/my-provider.js
const { SMSProvider, registerDriver } = require('..');

class MyDriver extends SMSProvider {
  async send(to, body, opts) {
    // ...your provider call here...
    return {
      providerId: 'their-message-id',
      status: 'queued',   // | 'sent' | 'failed'
      raw: {/* their full response */},
    };
  }
}

registerDriver('my-provider', new MyDriver());
```

Then set `SMS_FALLBACK_DRIVER=my-provider` in `.env`. The constructor runs at registration time, so it's a good place to validate any env vars your driver needs.

### Fire-and-forget pattern (optional FALLBACK_WATCHER hook)

If you'd rather not poll the gateway, configure a **watcher hook**:

```bash
FALLBACK_WATCHER_URL=https://your-worker.example.com/wa-fallback
FALLBACK_WATCHER_TOKEN=some-shared-secret
```

When a delivery status arrives indicating the message did not reach the recipient (and the row is `fallback_eligible`), the gateway POSTs the row metadata to the watcher URL. The watcher is responsible for actually calling the SMS provider and POSTing back to `/api/admin/fallback-log` with the result.

This is what we use in production: it lets the gateway stay simple (just signal) while a dedicated worker handles retries, dedup, regional rules, etc.
