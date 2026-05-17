-- ============================================================
-- SportFlow CRM — Row Level Security Policies
-- Run in Supabase > SQL Editor > New Query
-- Run AFTER schema.sql, schema_v2.sql, schema_v3.sql, schema_permissions.sql
-- ============================================================

-- ── Helper: current user's academy_id ────────────────────
-- SECURITY DEFINER bypasses RLS on profiles to avoid circular dependency
CREATE OR REPLACE FUNCTION get_my_academy_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id FROM profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_qr          ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE academies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_branches ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DROP EXISTING POLICIES (idempotent re-run)
-- ============================================================
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT schemaname, tablename, policyname
           FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- CORE TABLES  (no academy_id — single-tenant per project)
-- Authenticated = owner or staff (have Supabase Auth JWT)
-- Anon = student portal (custom auth, no JWT)
-- ============================================================

-- ── STUDENTS ─────────────────────────────────────────────
-- Anon: read (student portal loads own record by id)
-- Authenticated: full access
CREATE POLICY "students_anon_read"        ON students FOR SELECT TO anon          USING (true);
CREATE POLICY "students_auth_all"         ON students FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- ── BATCHES ──────────────────────────────────────────────
-- Anon: read (student dashboard shows batch name)
CREATE POLICY "batches_anon_read"         ON batches  FOR SELECT TO anon          USING (true);
CREATE POLICY "batches_auth_all"          ON batches  FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- ── STAFF ────────────────────────────────────────────────
-- Salary / HR data: only authenticated users
CREATE POLICY "staff_auth_all"            ON staff    FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- ── PAYMENTS ─────────────────────────────────────────────
-- Anon: read (student portal shows own payment history; filtered client-side by student_id)
CREATE POLICY "payments_anon_read"        ON payments FOR SELECT TO anon          USING (true);
CREATE POLICY "payments_auth_all"         ON payments FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- ── TRIALS ───────────────────────────────────────────────
CREATE POLICY "trials_auth_all"           ON trials   FOR ALL    TO authenticated  USING (true) WITH CHECK (true);

-- ── ATTENDANCE ───────────────────────────────────────────
-- Anon read: student checks own attendance history
-- Anon insert: QR scan marks attendance (one-per-day enforced by unique constraint)
CREATE POLICY "attendance_anon_read"      ON attendance FOR SELECT TO anon        USING (true);
CREATE POLICY "attendance_anon_insert"    ON attendance FOR INSERT TO anon        WITH CHECK (true);
CREATE POLICY "attendance_auth_all"       ON attendance FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ── ANNOUNCEMENTS ─────────────────────────────────────────
-- Anon: read (student portal notice board)
CREATE POLICY "announcements_anon_read"   ON announcements FOR SELECT TO anon      USING (true);
CREATE POLICY "announcements_auth_all"    ON announcements FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ── GATE QR ───────────────────────────────────────────────
-- Anon: read (student scans QR → app validates token via SELECT)
CREATE POLICY "gate_qr_anon_read"         ON gate_qr FOR SELECT TO anon           USING (true);
CREATE POLICY "gate_qr_auth_all"          ON gate_qr FOR ALL    TO authenticated   USING (true) WITH CHECK (true);

-- ── STUDENT SESSIONS (custom auth — anon needs full control) ──
-- Login: INSERT a session. Verify: SELECT by token. Logout: DELETE.
-- No JWT available here, so we must allow anon fully.
CREATE POLICY "student_sessions_all"      ON student_sessions FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- V3 / ADMIN TABLES  (have academy_id — fully isolated)
-- ============================================================

-- ── ACADEMIES ─────────────────────────────────────────────
-- Only members of the academy can read it; only owner can modify
CREATE POLICY "academies_read"  ON academies FOR SELECT    TO authenticated USING (id = get_my_academy_id());
CREATE POLICY "academies_owner" ON academies FOR INSERT    TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "academies_update"ON academies FOR UPDATE    TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "academies_delete"ON academies FOR DELETE    TO authenticated USING (owner_id = auth.uid());

-- ── PROFILES ──────────────────────────────────────────────
-- Users can always read/write their own row (needed for signup + profile load)
-- Users can read other profiles in their academy (owner sees all staff)
CREATE POLICY "profiles_own"         ON profiles FOR ALL    TO authenticated USING (id = auth.uid())           WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_same_academy"ON profiles FOR SELECT TO authenticated USING (academy_id = get_my_academy_id());

-- ── FEATURE FLAGS ─────────────────────────────────────────
CREATE POLICY "feature_flags_access" ON feature_flags FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── LEAVE REQUESTS ────────────────────────────────────────
-- No academy_id column — allow all authenticated for now (single-tenant acceptable)
-- TODO: add academy_id to leave_requests and tighten this policy
CREATE POLICY "leave_requests_access" ON leave_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── STAFF ATTENDANCE ──────────────────────────────────────
-- Staff clock-in via QR uses anon key — allow anon insert
CREATE POLICY "staff_attendance_auth"         ON staff_attendance FOR ALL    TO authenticated USING (academy_id = get_my_academy_id()) WITH CHECK (academy_id = get_my_academy_id());
CREATE POLICY "staff_attendance_anon_insert"  ON staff_attendance FOR INSERT TO anon          WITH CHECK (true);

-- ── USER PERMISSIONS ──────────────────────────────────────
CREATE POLICY "user_permissions_access" ON user_permissions FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── STAFF INVITES ─────────────────────────────────────────
-- Anon read: invited staff accept the invite ok they have a session
CREATE POLICY "staff_invites_auth"       ON staff_invites FOR ALL    TO authenticated USING (academy_id = get_my_academy_id()) WITH CHECK (academy_id = get_my_academy_id());
CREATE POLICY "staff_invites_anon_read"  ON staff_invites FOR SELECT TO anon          USING (true);
-- Anon update: mark invite as used on acceptance
CREATE POLICY "staff_invites_anon_use"   ON staff_invites FOR UPDATE TO anon          USING (true) WITH CHECK (true);

-- ── ACADEMY BRANCHES ──────────────────────────────────────
CREATE POLICY "academy_branches_access" ON academy_branches FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());
