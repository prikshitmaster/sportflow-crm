-- ── Staff Activation System ──────────────────────────────────
-- Run after schema_v3.sql
-- Adds code-based auth + staff_type to staff table

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS staff_code     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS join_code      TEXT,
  ADD COLUMN IF NOT EXISTS staff_type     TEXT DEFAULT 'coach',   -- 'coach' | 'office'
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'pending', -- 'pending' | 'active'
  ADD COLUMN IF NOT EXISTS password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS age            INTEGER;

-- Sessions table (mirrors student_sessions)
CREATE TABLE IF NOT EXISTS staff_sessions (
  id         BIGSERIAL PRIMARY KEY,
  staff_id   BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_sessions_token_idx ON staff_sessions(token);

-- Storage bucket for staff photos (run in Supabase dashboard if not exists)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('staff-photos', 'staff-photos', true)
-- ON CONFLICT (id) DO NOTHING;
