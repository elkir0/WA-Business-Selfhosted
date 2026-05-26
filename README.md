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

This repository is **pre-alpha**. The Node application code is being extracted from a working production deployment and will land in `v0.1.0`. The admin UI lands in `v0.2.0`. See [CHANGELOG.md](CHANGELOG.md) and [docs/](docs/) for the current state.

If you want to be notified at first release: GitHub > **Watch** > **Custom** > **Releases**.

## Quickstart

> The quickstart will be filled in when `v0.1.0` ships. For now, this repo only contains branding, governance, and structure.

## Documentation

- [docs/trademark-notice.md](docs/trademark-notice.md) — trademark stance and naming rationale
- [SECURITY.md](SECURITY.md) — security policy, reporting, hardening checklist
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- More documentation lands with `v0.1.0` (deployment, meta-setup, plugins, admin-ui).

## License

[AGPL-3.0](LICENSE). If you self-host a modified version and expose it to users over a network, you must publish your modifications.

## Trademark notice

This project is **not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or WhatsApp LLC**. WhatsApp® and Meta® are trademarks of their respective owners. See [docs/trademark-notice.md](docs/trademark-notice.md) for the full statement.
