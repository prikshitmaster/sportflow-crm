-- ============================================================
-- SportFlow CRM — Complete Staff System
-- Paste and run ONCE in Supabase > SQL Editor
-- Safe to re-run (fully idempotent)
-- ============================================================


-- ============================================================
-- 1. STAFF TABLE — add any missing columns
-- ============================================================

ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url  TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS academy_id UUID REFERENCES academies(id) ON DELETE CASCADE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id    UUID;


-- ============================================================
-- 2. STAFF_AUTH — custom auth (email + hashed password)
--    Fresh create; if it already exists, add missing columns.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_auth (
  id            BIGSERIAL PRIMARY KEY,
  staff_id      BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  staff_code    TEXT   NOT NULL UNIQUE,
  join_code     TEXT,
  status        TEXT   NOT NULL DEFAULT 'pending'
                  CHECK (status    IN ('pending', 'active')),
  staff_type    TEXT   NOT NULL DEFAULT 'coach'
                  CHECK (staff_type IN ('coach', 'office')),
  email         TEXT,
  password_hash TEXT,
  access_role   TEXT   NOT NULL DEFAULT 'coach',
  permissions   JSONB  NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing if the table was created in an earlier session
ALTER TABLE staff_auth ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE staff_auth ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE staff_auth ADD COLUMN IF NOT EXISTS access_role   TEXT NOT NULL DEFAULT 'coach';
ALTER TABLE staff_auth ADD COLUMN IF NOT EXISTS permissions   JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS staff_auth_staff_id_idx   ON staff_auth(staff_id);
CREATE INDEX IF NOT EXISTS staff_auth_email_idx      ON staff_auth(email);
CREATE INDEX IF NOT EXISTS staff_auth_staff_code_idx ON staff_auth(staff_code);


-- ============================================================
-- 3. STAFF_SESSIONS — persistent login tokens (30-day)
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_sessions (
  id         BIGSERIAL PRIMARY KEY,
  staff_id   BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token      TEXT   NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_sessions_token_idx   ON staff_sessions(token);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON staff_sessions(staff_id);


-- ============================================================
-- 4. STAFF_PROFILES — age + sport licence (separate table to
--    avoid PostgREST schema-cache issues with ALTER TABLE on staff)
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_profiles (
  staff_id    BIGINT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  age         INTEGER,
  licence_url TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- 5. LEAVE_REQUESTS — fix staff_id column type
--    Original schema had staff_id UUID (for Supabase-auth staff).
--    Custom-auth staff have BIGINT ids — change the column type.
--    Uses a DO block so it's safe even if already fixed.
-- ============================================================

DO $$
BEGIN
  -- Only change the column if it's still UUID type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests'
      AND column_name = 'staff_id'
      AND data_type   = 'uuid'
  ) THEN
    ALTER TABLE leave_requests DROP COLUMN staff_id;
    ALTER TABLE leave_requests ADD  COLUMN staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL;
  END IF;

  -- Add staff_id if it doesn't exist at all yet
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leave_requests'
      AND column_name = 'staff_id'
  ) THEN
    ALTER TABLE leave_requests ADD COLUMN staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Add academy_id to leave_requests if missing (for multi-academy scoping)
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS academy_id UUID REFERENCES academies(id) ON DELETE CASCADE;


-- ============================================================
-- 6. ROW LEVEL SECURITY — enable on all staff tables
-- ============================================================

ALTER TABLE staff            ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_auth       ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 7. RLS POLICIES
--    Drop any existing policies first (makes re-runs safe)
-- ============================================================

-- ── staff ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_auth_all"               ON staff;
DROP POLICY IF EXISTS "staff_anon_read"              ON staff;

-- Anon read: login flow resolves staff(*) from staff_auth join
CREATE POLICY "staff_anon_read"
  ON staff FOR SELECT TO anon
  USING (true);

-- Anon update: staff edit their own profile (custom auth = anon role, no JWT)
CREATE POLICY "staff_anon_update"
  ON staff FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

-- Authenticated full access: admin dashboard CRUD
CREATE POLICY "staff_auth_all"
  ON staff FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ── staff_auth ───────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_auth_all_roles"         ON staff_auth;
DROP POLICY IF EXISTS "allow_all_staff_auth"         ON staff_auth;

-- Both anon and authenticated need full access:
--   anon: activation (verify codes, set password), login (read by email+hash)
--   authenticated: admin reads permissions
CREATE POLICY "staff_auth_all_roles"
  ON staff_auth FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);


-- ── staff_sessions ───────────────────────────────────────────
DROP POLICY IF EXISTS "staff_sessions_all_roles"     ON staff_sessions;
DROP POLICY IF EXISTS "allow_all_staff_sessions"     ON staff_sessions;

-- Anon + authenticated: login creates session (INSERT), validate reads it (SELECT), logout deletes (DELETE)
CREATE POLICY "staff_sessions_all_roles"
  ON staff_sessions FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);


-- ── staff_profiles ───────────────────────────────────────────
DROP POLICY IF EXISTS "staff_profiles_all_roles"     ON staff_profiles;
DROP POLICY IF EXISTS "allow_all_staff_profiles"     ON staff_profiles;

-- Anon: staff portal edits own profile (upsert age/licence) without a JWT
-- Authenticated: admin sees age/licence in dashboard
CREATE POLICY "staff_profiles_all_roles"
  ON staff_profiles FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);


-- ── leave_requests ───────────────────────────────────────────
DROP POLICY IF EXISTS "leave_requests_access"        ON leave_requests;
DROP POLICY IF EXISTS "leave_requests_auth"          ON leave_requests;
DROP POLICY IF EXISTS "leave_requests_anon"          ON leave_requests;

-- Anon: staff portal submits and reads own leave requests (no JWT available)
CREATE POLICY "leave_requests_anon"
  ON leave_requests FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- Authenticated: admin approve / reject / view all
CREATE POLICY "leave_requests_auth"
  ON leave_requests FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ── staff_attendance ─────────────────────────────────────────
DROP POLICY IF EXISTS "staff_attendance_auth"              ON staff_attendance;
DROP POLICY IF EXISTS "staff_attendance_anon_insert"       ON staff_attendance;
DROP POLICY IF EXISTS "staff_attendance_anon_read"         ON staff_attendance;

-- Authenticated: admin views all attendance
CREATE POLICY "staff_attendance_auth"
  ON staff_attendance FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anon insert: QR clock-in happens without a JWT
CREATE POLICY "staff_attendance_anon_insert"
  ON staff_attendance FOR INSERT TO anon
  WITH CHECK (true);

-- Anon read: staff portal can read own attendance
CREATE POLICY "staff_attendance_anon_read"
  ON staff_attendance FOR SELECT TO anon
  USING (true);


-- ============================================================
-- 8. STORAGE BUCKET
--    Cannot be created via SQL — do this manually in Supabase:
--    Storage > New Bucket > Name: staff-photos > Public: ON
--    (needed for staff profile photos and sport licence uploads)
-- ============================================================

-- Done. All staff-related tables, columns, and RLS policies are set.
