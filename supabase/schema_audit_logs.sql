-- ── Audit Logs ───────────────────────────────────────────
-- Tracks all create / edit / delete actions by any user
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  academy_id  UUID,
  actor_id    TEXT,
  actor_name  TEXT NOT NULL DEFAULT 'Unknown',
  actor_role  TEXT NOT NULL DEFAULT 'Staff',
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  entity_name TEXT,
  changes     JSONB DEFAULT '{}',
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_academy_idx ON audit_logs (academy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx  ON audit_logs (action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_access ON audit_logs;
CREATE POLICY open_access ON audit_logs
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
