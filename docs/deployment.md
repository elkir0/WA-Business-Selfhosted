# Deployment

This guide walks you from zero to a running WhatsApp Business gateway on a Linux server.

## Requirements

| Component | Minimum | Recommended |
|---|---|---|
| OS | Any modern Linux (Debian 12, Ubuntu 22.04, Alpine 3.18+) | Debian 12 |
| Node.js | 20 LTS | 22 LTS |
| PostgreSQL | 14 | 15+ |
| RAM | 512 MB | 1 GB |
| Disk | 5 GB (excluding inbound media) | 10+ GB if you keep 1y of media |
| Public HTTPS | Required (Meta webhook needs HTTPS) | Caddy / Nginx + Let's Encrypt |

The gateway is a single Node.js process. No build step, no native bindings beyond `pg`.

## 1. PostgreSQL

Create a dedicated user and database. Defaults expected by the app are user `whatsapp`, database `whatsapp_messages` — override via env vars if you prefer different names.

```bash
sudo -u postgres psql <<'SQL'
CREATE USER whatsapp WITH PASSWORD 'change-me-now';
CREATE DATABASE whatsapp_messages OWNER whatsapp;
\c whatsapp_messages
GRANT ALL ON SCHEMA public TO whatsapp;
SQL
```

Then load the schema:

```bash
psql -U whatsapp -d whatsapp_messages -h 127.0.0.1 -f db/schema.sql
```

If you need to apply incremental migrations later, run files under `db/migrations/` in order.

## 2. Application

```bash
git clone https://github.com/elkir0/WA-Business-Selfhosted.git
cd WA-Business-Selfhosted
npm install --production
cp .env.example .env
```

Edit `.env` and fill the **required** variables (see `.env.example` — they're marked at the top). The server **refuses to start** with missing required values:

- `DB_PASSWORD`
- `API_TOKEN` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `META_APP_SECRET` — see [meta-setup.md](./meta-setup.md)
- `WHATSAPP_VERIFY_TOKEN` — any string you choose; will be entered in the Meta Dashboard
- `CORS_ORIGIN` — comma-separated origins (no wildcard)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`

Create the media storage directory:

```bash
sudo mkdir -p /var/lib/whatsapp-media
sudo chown $(whoami) /var/lib/whatsapp-media
```

Start the server:

```bash
npm start
# [WhatsApp API] listening on :3100
```

## 3. systemd service

Use the example unit at `examples/systemd/wa-selfhosted.service`. Copy it to `/etc/systemd/system/`, edit the paths and user, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wa-selfhosted
sudo systemctl status wa-selfhosted
```

Logs go to the journal:

```bash
sudo journalctl -u wa-selfhosted -f
```

## 4. Reverse proxy + HTTPS

Meta requires HTTPS for the webhook. The example at `examples/nginx/wa-selfhosted.conf` is a complete vhost: it proxies `/webhook/*` and `/api/*` to the local Node process and sets a long timeout (`24h`) on the SSE endpoint `/api/events`.

```bash
sudo cp examples/nginx/wa-selfhosted.conf /etc/nginx/sites-available/
# Edit server_name and ssl_certificate paths
sudo ln -s /etc/nginx/sites-available/wa-selfhosted.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Get a free TLS certificate:

```bash
sudo certbot --nginx -d wa-api.example.com
```

## 5. Docker / Docker Compose (alternative)

If you prefer containers, the `examples/docker-compose.yml` brings up Postgres and the gateway side-by-side. You still need a reverse proxy in front for HTTPS.

```bash
cp examples/docker-compose.yml .
cp .env.example .env  # fill it in
docker compose up -d
docker compose logs -f gateway
```

## 6. Configure the Meta webhook

Once your reverse proxy is reachable over HTTPS, point Meta at it. See [meta-setup.md](./meta-setup.md).

## 7. Verify

```bash
# Health (no auth)
curl https://wa-api.example.com/health
# Should return: {"ok":true,"status":"healthy"}

# Database-backed health (auth required)
curl -H "Authorization: Bearer $API_TOKEN" https://wa-api.example.com/api/health

# Send a test text message
curl -X POST https://wa-api.example.com/api/messages/send/text \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550100","body":"hello from WA-Business-Selfhosted"}'
```

## 8. Hardening

See [../SECURITY.md](../SECURITY.md) for the recommended checklist:
- HTTPS only, with strong ciphers
- Firewall to expose only 443 publicly
- Process runs as a dedicated unprivileged user
- Database listens only on 127.0.0.1
- `MEDIA_ROOT` is on a partition with quota / monitoring

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Server exits with `FATAL: ... required` | Missing env var, fix `.env` and restart |
| Webhook GET verification fails | `WHATSAPP_VERIFY_TOKEN` mismatch with Meta Dashboard |
| Webhook POST returns 403 | `META_APP_SECRET` mismatch (signature check fails) |
| 401 on every `/api/*` request | Wrong or missing `Authorization: Bearer` header |
| `getaddrinfo ENOTFOUND` | Wrong `DB_HOST`, or Postgres not running |
| Media downloads return 404 | Inbound media is async — check disk space + permissions on `MEDIA_ROOT` |
| Inbound message stored but no SSE | Reverse proxy is buffering — see the SSE location in the Nginx example |
