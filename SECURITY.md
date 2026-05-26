# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in WA-Business-Selfhosted, please report it **privately** before disclosing publicly.

**How to report:**

- Open a GitHub Security Advisory: <https://github.com/elkir0/WA-Business-Selfhosted/security/advisories/new>
- Or email: `security@<placeholder-domain>` (replace before public push)

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce
- Any proof-of-concept code
- Your suggested fix, if any

**What to expect:**

- Acknowledgement within 5 business days
- Disclosure timeline: we aim to ship a fix within 90 days for high/critical issues
- Public disclosure happens after a patched release, with credit to the reporter unless anonymity is requested

## Built-in Security Features

| Layer | Mechanism |
|---|---|
| Webhook signature | HMAC-SHA256 via `X-Hub-Signature-256` (configurable `META_APP_SECRET`) |
| API authentication | Bearer token, `crypto.timingSafeEqual` comparison |
| Admin UI authentication | Session cookie (HttpOnly, Secure, SameSite=Strict) **or** reverse-proxy `X-Forwarded-User` (configurable via `AUTH_MODE`) |
| CSRF | Double-submit cookie pattern on all state-changing admin requests |
| Rate limiting | API 100/min, webhook 100/min, send 30/min, admin login 5/15min per IP |
| CORS | Strict allowlist (`CORS_ORIGIN` required at boot, no wildcard fallback) |
| Path traversal | Regex + `path.resolve` guards on media serving |
| Secrets at rest | Refuses to boot if required env vars are missing or empty |
| Logs | Tokens redacted; PII masking helpers available |
| HTTPS enforcement | In `NODE_ENV=production`, login refuses non-HTTPS requests |

## Hardening Checklist for Self-Hosters

- [ ] Use HTTPS (Nginx/Caddy/Traefik in front of the gateway)
- [ ] Run behind a reverse proxy that strips dangerous headers
- [ ] Set strong values for `API_TOKEN`, `META_APP_SECRET`, `ADMIN_PASSWORD_HASH`
- [ ] Restrict outbound network if not needed (firewall the host)
- [ ] Back up PostgreSQL regularly
- [ ] Subscribe to release notifications (GitHub > Watch > Custom > Releases)

## Scope

In-scope:

- The Node.js application code in this repository
- Provided example configurations (`examples/`)
- Documented integrations (webhook-forward, sms-fallback plugin interfaces)

Out-of-scope:

- Vulnerabilities in third-party drivers users may plug into the `sms-fallback` interface
- Infrastructure components users deploy alongside (PostgreSQL, Nginx, OS)
- Issues caused by misconfiguration (missing env vars, weak passwords, exposed admin without HTTPS)
