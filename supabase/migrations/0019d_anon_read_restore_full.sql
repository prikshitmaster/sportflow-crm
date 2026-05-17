-- ============================================================
-- 0019d — Restore wide-open anon SELECT (login + coach UI fix)
-- ============================================================
-- BACKGROUND
--   • 0019b dropped the `open_access` policy from `staff`, which
--     broke staff login (anon → staff_auth → staff(*) join).
--   • 0019c partially fixed that with `staff_anon_read USING(true)`.
--   • BUT — 0004 had earlier rewritten `students_anon_read`,
--     `batches_anon_read`, `payments_anon_read`,
--     `attendance_anon_read`, `announcements_anon_read`,
--     `gate_qr_anon_read` to require `x-staff-token` /
--     `x-student-token` request headers. Those headers ARE sent
--     by the client (src/lib/supabase.js), but during the login
--     query itself NO session exists yet, so:
--
--        Student login → reads `students` with anon + no header
--                      → policy returns no rows → "Invalid Student ID"
--
--        Coach login   → reads `staff_auth.staff(*)` with anon + no header
--                      → staff row hidden → "Staff record not found"
--
--        Coach UI      → if login fails, no session, so all subsequent
--                      anon reads also return 0 rows (no batches /
--                      no students / no attendance visible)
--
--   • Localhost works because 0004 / 0019b were not applied there.
--
-- THIS MIGRATION
--   • Restores the pre-0004 wide-open `*_anon_read` policies.
--   • Re-affirms `staff_anon_read` from 0019c (idempotent).
--   • Authenticated paths still scoped by 0019b's *_owner_all
--     (owner login is unaffected).
--   • Re-opens the SAME anon read leak that already existed
--     before 0004 — i.e. exactly the state the app was shipped
--     in. Phase A2 closes it properly via RPC-gated logins.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ============================================================

BEGIN;

-- ── 1. students ──────────────────────────────────────────────
DROP POLICY IF EXISTS "students_anon_read"        ON students;
DROP POLICY IF EXISTS "students anon update photo" ON students;
DROP POLICY IF EXISTS "students_anon_update_photo" ON students;
CREATE POLICY "students_anon_read"
  ON students FOR SELECT TO anon USING (true);

-- ── 2. batches ───────────────────────────────────────────────
DROP POLICY IF EXISTS "batches_anon_read" ON batches;
CREATE POLICY "batches_anon_read"
  ON batches FOR SELECT TO anon USING (true);

-- ── 3. payments ──────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_anon_read" ON payments;
CREATE POLICY "payments_anon_read"
  ON payments FOR SELECT TO anon USING (true);

-- ── 4. attendance ────────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_anon_read"   ON attendance;
DROP POLICY IF EXISTS "attendance_anon_insert" ON attendance;
CREATE POLICY "attendance_anon_read"
  ON attendance FOR SELECT TO anon USING (true);
CREATE POLICY "attendance_anon_insert"
  ON attendance FOR INSERT TO anon WITH CHECK (true);

-- ── 5. announcements ─────────────────────────────────────────
DROP POLICY IF EXISTS "announcements_anon_read" ON announcements;
CREATE POLICY "announcements_anon_read"
  ON announcements FOR SELECT TO anon USING (true);

-- ── 6. gate_qr ───────────────────────────────────────────────
DROP POLICY IF EXISTS "gate_qr_anon_read" ON gate_qr;
CREATE POLICY "gate_qr_anon_read"
  ON gate_qr FOR SELECT TO anon USING (true);

-- ── 7. staff (re-affirm 0019c — staff login lookup) ──────────
DROP POLICY IF EXISTS "staff_anon_read" ON staff;
CREATE POLICY "staff_anon_read"
  ON staff FOR SELECT TO anon USING (true);

-- ── 8. Safety net: ensure staff_auth / staff_sessions /
--      staff_profiles / student_sessions still allow anon ops.
--      These tables already had `*_all_roles` policies from
--      schema_staff_complete.sql; this is belt-and-braces in
--      case they were dropped along the way.
DO $$
DECLARE
  t_auth text[] := ARRAY['staff_auth','staff_sessions','staff_profiles','student_sessions'];
  t text;
  pname text;
BEGIN
  FOREACH t IN ARRAY t_auth LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      pname := t || '_anon_full';
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pname, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
        pname, t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ============================================================
-- Verification (run from the app, not SQL editor):
-- ============================================================
--   1. Student login with valid code+password → success
--   2. Staff login with valid email+password  → success
--   3. After coach login, /students, /batches, /attendance all
--      return rows for the coach's academy
--   4. Owner login still works (uses authenticated path via 0019b)
--   5. SELECT COUNT(*) FROM students;  -- as owner, returns own academy only
--      (0019b academy scoping for authenticated is untouched)
--
-- Rollback:
--   Re-apply 0004_session_header_rls.sql to restore the
--   header-gated policies. (App will break again until Phase A2
--   moves login to an RPC.)
-- ============================================================
