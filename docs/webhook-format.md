# Webhook payload format

This is a short reference for what the gateway receives from Meta and how it processes it. Use it when you're writing a `WEBHOOK_FORWARD_URL` consumer or when you want to understand what's in the `webhook_events` table.

The authoritative spec is at <https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples> — this page summarizes the parts the gateway actually handles.

## Verification (GET)

Meta sends a `GET` once when you save the webhook URL in the App Dashboard, to verify ownership.

```
GET /webhook/whatsapp-meta?hub.mode=subscribe&hub.verify_token=<your-token>&hub.challenge=<random>
```

The gateway returns the challenge verbatim if `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`, otherwise `403`.

## Inbound messages (POST)

Wrapped in the same outer envelope:

```jsonc
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "+15555550100",
          "phone_number_id": "PHONE_NUMBER_ID"
        },
        "contacts": [{
          "profile": { "name": "Alice Example" },
          "wa_id": "15555551234"
        }],
        "messages": [{
          "from": "15555551234",
          "id": "wamid.ABCxxxxxxxx",
          "timestamp": "1700000000",
          "type": "text",
          "text": { "body": "hello" }
        }]
      }
    }]
  }]
}
```

The gateway parses each `messages[i]` and stores it. Supported `type` values:

- `text`
- `image`, `video`, `document`, `audio`, `sticker` (each has a `{id, mime_type, sha256}` block; the gateway auto-downloads via the Cloud API and stores under `MEDIA_ROOT`)
- `location` (`{latitude, longitude, name, address}`)
- `contacts` (array of vCard-like contact objects)
- `interactive` (button reply / list reply)
- `button` (template button reply)
- `reaction` (`{message_id, emoji}`)

Any unrecognized `type` is still stored with `raw_payload` intact, so you can write a downstream handler later.

## Statuses (POST)

Same envelope, but `value` has a `statuses` array instead of `messages`:

```jsonc
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { /* ... */ },
        "statuses": [{
          "id": "wamid.ABCxxxxxxxx",
          "recipient_id": "15555551234",
          "status": "delivered",
          "timestamp": "1700000010"
        }]
      }
    }]
  }]
}
```

The gateway maps `status` to the `messages.status` column:

| Meta value | DB value |
|---|---|
| `sent` | `sent` |
| `delivered` | `delivered` |
| `read` | `read` |
| `failed` | `failed` (with `error_code` and `error_details` populated from the `errors` array) |

## Signature verification

Every POST carries an `X-Hub-Signature-256: sha256=<hex>` header. The gateway computes `HMAC-SHA256(META_APP_SECRET, raw_body)` and rejects the request with `403` if it doesn't match. The raw body is captured before JSON parsing — see `verifyWebhookSignature` in `src/server.js`.

## What gets forwarded by `WEBHOOK_FORWARD_URL`

The plugin forwards the **full Meta payload** as received, untouched. Your consumer gets the exact same JSON Meta sent, including the outer envelope. It is NOT a re-serialized or summarized version.

## What's in `webhook_events`

Every payload is also stored in the `webhook_events` table (as raw JSONB) for replay and audit. Use the admin endpoint to inspect:

```bash
curl -H "Authorization: Bearer $API_TOKEN" https://your-domain/api/webhook-events?limit=20
```

A separate `webhook_events_unmatched` table holds status events that arrived before the originating message was stored — a known race in some Meta deployments. The gateway tries to retrofit those once the message appears.
