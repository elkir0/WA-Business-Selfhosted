# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial public repository scaffold: branding (Direction A logo, sky palette, favicons), governance (AGPL-3.0 LICENSE, SECURITY, CONTRIBUTING, trademark notice).
- `src/server.js` — Express HTTP server with 57 endpoints (webhook, send all message types, conversations, contacts, templates, profile, SSE, media, admin).
- `src/lib/meta-api.js` — Meta WhatsApp Cloud API client (26 methods).
- `src/lib/db.js` — PostgreSQL pool + CRUD helpers, fully env-driven.
- `src/lib/sms-fallback-config.js` — shim adapting plugin helpers to legacy call sites via env vars (`SMS_FALLBACK_DEADLINE_MS`, `SMS_FALLBACK_ALLOWLIST_PREFIXES`).
- `src/plugins/webhook-forward/` — optional pipeline that re-publishes inbound payloads to an external URL (env `WEBHOOK_FORWARD_URL`), with retries and a failed-forwards ring buffer.
- `src/plugins/sms-fallback/` — `SMSProvider` interface + driver registry + Twilio reference driver. Activate with `SMS_FALLBACK_DRIVER=twilio`.
- `db/schema.sql` — full PostgreSQL schema (extracted from production, scrubbed of provider-specific identifiers).
- `docs/deployment.md` — zero-to-running deployment guide (Postgres, Node, systemd, Nginx, HTTPS).
- `docs/meta-setup.md` — Meta App + WABA + System User token + webhook configuration.
- `docs/plugins.md` — webhook-forward and sms-fallback configuration + custom driver guide.
- `docs/webhook-format.md` — reference for Meta payloads received and stored.
- `examples/nginx/wa-selfhosted.conf` — production-ready vhost with HTTPS + dedicated SSE location (24h read timeout).
- `examples/systemd/wa-selfhosted.service` — hardened unit (NoNewPrivileges, ProtectSystem, etc.).
- `examples/docker-compose.yml` — Postgres + gateway side-by-side for quick spin-up.
- `tests/sms-fallback-helpers.test.js`, `tests/smoke.test.js` — 24 tests covering helpers, repo layout, middleware order, rate-limiter config, and forbidden-pattern verification.
- `scripts/scan-secrets.sh` — pre-push gitleaks scan (worktree + full history).
- `.github/workflows/ci.yml` — secret scan + YAML lint CI job.
