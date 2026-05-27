-- Migration 0010 — Admin UI (sessions + audit log)
--
-- Adds the persistence layer for the bundled admin UI:
--   - admin_sessions:  one row per active login (cookie-backed)
--   - admin_audit_log: append-only log of every action an admin takes
--
-- Run against an existing database:
--   psql -U whatsapp -d whatsapp_messages -h 127.0.0.1 -f db/migrations/0010-admin-ui.sql
--
-- Safe to re-run (uses IF NOT EXISTS).

BEGIN;

-- ── Admin sessions ──
CREATE TABLE IF NOT EXISTS admin_sessions (
    id          VARCHAR(64) PRIMARY KEY,            -- 32 bytes of random hex
    admin_user  VARCHAR(64) NOT NULL DEFAULT 'admin',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip          INET,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions (expires_at);

-- ── Admin audit log ──
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id           BIGSERIAL PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    admin_user   VARCHAR(64) NOT NULL,
    action       VARCHAR(64) NOT NULL,                 -- e.g., 'forward_retry', 'bot_pause'
    target_type  VARCHAR(32),                          -- e.g., 'conversation', 'message'
    target_id    VARCHAR(128),
    payload      JSONB,                                -- action-specific details
    ip           INET,
    user_agent   TEXT,
    result       VARCHAR(16) NOT NULL DEFAULT 'success' -- 'success' | 'error'
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_user_created ON admin_audit_log (admin_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log (action);

COMMIT;
