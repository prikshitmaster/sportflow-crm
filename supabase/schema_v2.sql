-- ============================================================
-- SportFlow CRM — Schema v2 Migration
-- Run in Supabase > SQL Editor > New Query
-- ============================================================

-- ── Extend students table ────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS student_code   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS join_code      TEXT,
  ADD COLUMN IF NOT EXISTS password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'pending'
    CHECK (account_status IN ('pending','active')),
  ADD COLUMN IF NOT EXISTS batch_id       BIGINT REFERENCES batches(id),
  ADD COLUMN IF NOT EXISTS parent_phone   TEXT,
  ADD COLUMN IF NOT EXISTS fee_amount     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_due_day    INTEGER DEFAULT 5;

-- ── Extend batches table ──────────────────────────────────
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS days       TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_time TEXT,
  ADD COLUMN IF NOT EXISTS end_time   TEXT,
  ADD COLUMN IF NOT EXISTS age_min    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS age_max    INTEGER DEFAULT 99;

-- ── Gate QR (one row per academy) ─────────────────────────
CREATE TABLE IF NOT EXISTS gate_qr (
  id           BIGSERIAL PRIMARY KEY,
  token        TEXT UNIQUE NOT NULL,
  academy_name TEXT DEFAULT 'Academy Gate',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Student sessions (persistent login) ───────────────────
CREATE TABLE IF NOT EXISTS student_sessions (
  id         BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Disable RLS on new tables ─────────────────────────────
ALTER TABLE gate_qr          DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_sessions DISABLE ROW LEVEL SECURITY;

-- ── Ensure attendance.status column exists ────────────────
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Present';

-- ── Back-fill student_code for existing seed students ─────
-- (FA001 format for Football Academy seed data)
DO $$
DECLARE
  r   RECORD;
  seq INT := 1;
BEGIN
  FOR r IN SELECT id FROM students WHERE student_code IS NULL ORDER BY id LOOP
    UPDATE students SET student_code = 'SA' || LPAD(seq::TEXT, 3, '0') WHERE id = r.id;
    seq := seq + 1;
  END LOOP;
END;
$$;
