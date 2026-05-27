# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.2.0] — 2026-05-26

### Added — admin UI

- Bundled admin web interface served at `/admin/*` from the same Node process. Login at `/admin/login`. Built with Preact + Vite + Tailwind v4, no external SPA build required at deploy time.
- Two authentication modes (`AUTH_MODE`):
  - `password` (default) — single admin logs in with a password whose bcrypt hash is in `ADMIN_PASSWORD_HASH`. Sessions persisted in `admin_sessions` table with HttpOnly/Secure/SameSite=Strict cookies. Rate-limited login (5/15min/IP).
  - `proxy` — trust upstream reverse proxy that sets `X-Forwarded-User`.
- HTTPS enforcement in production (refuses login over plain HTTP when `NODE_ENV=production`).
- CSRF protection via signed double-submit cookie. All state-changing admin endpoints require either an `X-CSRF-Token` header or `_csrf` form field.
- Audit log: every admin action lands in `admin_audit_log` with action name, target, payload (secrets redacted), IP, user agent, and result. Read at `GET /admin/api/audit`.
- CLI helper `npm run set-password` — interactive bcrypt hash generation.
- New tables (migration `db/migrations/0010-admin-ui.sql`): `admin_sessions`, `admin_audit_log`.

### Added — admin pages (read-only)

- **Dashboard** — KPI cards + Chart.js graphs (messages-per-hour stacked bar + outbound-status doughnut), auto-refresh every 30 seconds.
- **Conversations** — filterable list, link to detail.
- **ConversationDetail** — chat-bubble message timeline with status badges.
- **Contacts** — list with debounced search.
- **FailedForwards** — table of failed webhook-forward attempts.
- **System** — live process/memory/db/media/plugins health, refresh every 10 seconds.
- **Audit log** — recent admin actions.

### Added — admin actions

- Retry single failed webhook forward, retry all, clear all (CSRF + audit).
- Pause / resume bot per conversation (toggles `ai_enabled`).
- Close / reopen conversation.
- Mark conversation as read.

### Added — admin API endpoints (session-auth, not Bearer)

- `GET /admin/api/dashboard/stats`, `/messages-by-hour`, `/status-breakdown`
- `GET /admin/api/conversations[/{id}[/messages]]`
- `GET /admin/api/contacts[/{waId}]`
- `GET /admin/api/forwards/failed`
- `GET /admin/api/system`
- `GET /admin/api/audit`
- `POST /admin/api/forwards/{id}/retry`, `/retry-all`
- `DELETE /admin/api/forwards`
- `POST /admin/api/conversations/{id}/{pause-bot|resume-bot|close|reopen|mark-read}`

### Changed

- `webhook-forward` plugin now retains the full original payload (capped at 64 KB per entry) so failures can be re-attempted. Adds `retryFailed(id)` and `retryAll()` helpers.
- Vite bumped to `^6.0.0` to clear two moderate dev-only Dependabot alerts (path traversal in optimized-deps `.map` handling + dev-server CORS in transitive `esbuild`).

### Polish

- Dark / light / system theme toggle in the topbar, persisted via `localStorage`. Avoids flash-of-wrong-theme by applying the stored preference before render.
- Mobile responsive layout: sidebar becomes a hamburger drawer below the `md` breakpoint with a click-to-close backdrop.
- Top-level error boundary so a bad page doesn't blank the whole admin UI.
- 49 tests covering helpers, CSRF, admin-auth, webhook-forward retries, and repo layout — all currently passing.

### Security

- All `/admin/api/*` routes refuse the public API Bearer token: they only accept the admin session cookie. A leak of `API_TOKEN` does not give admin control.
- Login rate-limited 5/15min/IP using the same `express-rate-limit` instance as the public API.
- gitleaks-action workflow scans every push + a manual `npm run scan` (worktree + full history) is the gate before any push.

## [0.1.0] — 2026-05-26

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

_Note: 0.1.0 was never tagged on the remote — the application code shipped publicly as part of the 0.2.0 push. This entry is preserved for changelog continuity._
