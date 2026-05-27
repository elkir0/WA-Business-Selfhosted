<p align="center">
  <img src="assets/logo-light.svg#gh-light-mode-only" alt="WA-Business-Selfhosted" height="64">
  <img src="assets/logo-dark.svg#gh-dark-mode-only"  alt="WA-Business-Selfhosted" height="64">
</p>

<p align="center">
  <strong>Open-source, self-hostable gateway for the WhatsApp Business Cloud API.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-orange.svg" alt="Pre-alpha">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node ≥ 20">
</p>

---

## What it is

A production-grade Node.js + PostgreSQL gateway that talks to the **official Meta WhatsApp Business Cloud API**, with:

- 40+ HTTP endpoints to send every WhatsApp message type (text, image, video, document, audio, template, interactive, location, contacts, sticker, reaction, typing, read receipts)
- Real-time **Server-Sent Events** stream for inbound messages, status updates, and admin actions
- **Webhook signature verification** (HMAC-SHA256), Bearer token auth, rate limiting, CORS allowlist, path-traversal guards
- **Auto-download of inbound media** with 1-year retention, served behind the same auth
- **Customer-window 24h enforcement** (template fallback bypass)
- A built-in **admin UI** (Phase 2 — coming soon) with dashboard, conversations, audit log, and operational actions
- Optional **webhook forwarding** plugin (replace SaaS automation tools) and **SMS fallback** plugin interface (Twilio reference driver included)

## What it is not

- Not an unofficial WhatsApp client. Talks only to the public Cloud API.
- Not a multi-tenant SaaS. One deployment = one WABA = one admin.
- Not a marketing/sequences platform. Build campaigns on top via the API.

## Status

This repository is **pre-alpha**. The application code is shipped and tested; an admin UI lands in `v0.2.0`. No tagged release yet — pin to a commit SHA if you deploy from here today.

If you want to be notified at the first tagged release: GitHub > **Watch** > **Custom** > **Releases**.

## Quickstart

> Requires Node ≥ 20, PostgreSQL ≥ 14, and a public HTTPS endpoint Meta can reach.

```bash
git clone https://github.com/elkir0/WA-Business-Selfhosted.git
cd WA-Business-Selfhosted
npm install --production
cp .env.example .env
# Edit .env — at minimum set DB_PASSWORD, API_TOKEN, META_APP_SECRET,
# WHATSAPP_VERIFY_TOKEN, CORS_ORIGIN, and the WHATSAPP_* credentials.

# Load schema (create the database first per docs/deployment.md)
psql -U whatsapp -d whatsapp_messages -h 127.0.0.1 -f db/schema.sql

# Run
npm start
# [WhatsApp API] listening on :3100
```

Then point a reverse proxy (`examples/nginx/wa-selfhosted.conf`) at it for HTTPS, configure the Meta webhook (see [docs/meta-setup.md](docs/meta-setup.md)), and you have a working WhatsApp Business gateway.

For a containerized setup: `cp examples/docker-compose.yml . && docker compose up -d`.

Send a test message:

```bash
curl -X POST https://your-domain.example.com/api/messages/send/text \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550100","body":"hello from WA-Business-Selfhosted"}'
```

## Documentation

- [docs/deployment.md](docs/deployment.md) — zero-to-running deployment guide
- [docs/meta-setup.md](docs/meta-setup.md) — Meta App, WABA, token, and webhook setup
- [docs/plugins.md](docs/plugins.md) — webhook-forward and sms-fallback plugins, writing custom drivers
- [docs/webhook-format.md](docs/webhook-format.md) — Meta payload reference
- [docs/trademark-notice.md](docs/trademark-notice.md) — trademark stance and naming rationale
- [SECURITY.md](SECURITY.md) — security policy, reporting, hardening checklist
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute

## License

[AGPL-3.0](LICENSE). If you self-host a modified version and expose it to users over a network, you must publish your modifications.

## Trademark notice

This project is **not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or WhatsApp LLC**. WhatsApp® and Meta® are trademarks of their respective owners. See [docs/trademark-notice.md](docs/trademark-notice.md) for the full statement.
