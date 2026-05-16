-- ============================================================
-- 0003 — Tighten OWNER-side RLS (Supabase Auth JWT path)
-- ============================================================
-- Closes AUDIT.md C1 partially: owners can no longer read or write
-- another academy's rows. Anon (staff/student portal) policies stay
-- unchanged — those tighten in 0004 after Phase D app changes.
--
-- PRECONDITIONS:
--   - 0002_backfill_academy_id.sql has been run successfully
--   - The owner's profile row has academy_id set correctly
--   - You have logged in as owner once on the latest app build to
--     confirm the JWT contains a valid sub
--
-- HOW IT WORKS:
--   get_my_academy_id() reads profiles.academy_id for auth.uid().
--   Every owner read/write is now scoped through that one function.
--
-- BREAKAGE SURFACE (test these after applying):
--   - Owner dashboard loads students/payments/batches list
--   - Owner can create a new student → row appears
--   - Owner cannot SELECT a row from another academy via SQL Editor
--     while logged in as the owner (verification query below)
-- ============================================================

-- Ensure the helper exists (defined in schema_rls.sql; safe to re-create)
CREATE OR REPLACE FUNCTION get_my_academy_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id FROM profiles WHERE id = auth.uid()
$$;

-- ── STUDENTS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "students_auth_all" ON students;
CREATE POLICY "students_owner_all" ON students FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── BATCHES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "batches_auth_all" ON batches;
CREATE POLICY "batches_owner_all" ON batches FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── STAFF ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_auth_all" ON staff;
CREATE POLICY "staff_owner_all" ON staff FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── PAYMENTS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_auth_all" ON payments;
CREATE POLICY "payments_owner_all" ON payments FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── TRIALS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "trials_auth_all" ON trials;
CREATE POLICY "trials_owner_all" ON trials FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── ATTENDANCE ─────────────────────────────────────────────
-- Cannot filter by academy_id directly (column lives on student/batch),
-- so we join. Owner can see attendance for students in their academy.
DROP POLICY IF EXISTS "attendance_auth_all" ON attendance;
CREATE POLICY "attendance_owner_all" ON attendance FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM students WHERE students.id = attendance.student_id AND students.academy_id = get_my_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM students WHERE students.id = attendance.student_id AND students.academy_id = get_my_academy_id()));

-- ── ANNOUNCEMENTS ──────────────────────────────────────────
DROP POLICY IF EXISTS "announcements_auth_all" ON announcements;
CREATE POLICY "announcements_owner_all" ON announcements FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── EVENTS ─────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    EXECUTE 'DROP POLICY IF EXISTS "events_auth_all" ON events';
    EXECUTE 'CREATE POLICY "events_owner_all" ON events FOR ALL TO authenticated USING (academy_id = get_my_academy_id()) WITH CHECK (academy_id = get_my_academy_id())';
  END IF;
END $$;

-- ── GATE QR ────────────────────────────────────────────────
-- Owners regenerate the gate QR for their academy only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gate_qr' AND column_name = 'academy_id') THEN
    EXECUTE 'DROP POLICY IF EXISTS "gate_qr_auth_all" ON gate_qr';
    EXECUTE 'CREATE POLICY "gate_qr_owner_all" ON gate_qr FOR ALL TO authenticated USING (academy_id = get_my_academy_id()) WITH CHECK (academy_id = get_my_academy_id())';
  ELSE
    RAISE NOTICE 'gate_qr.academy_id missing — leaving open policy in place';
  END IF;
END $$;

-- ── LEAVE REQUESTS ─────────────────────────────────────────
DROP POLICY IF EXISTS "leave_requests_access" ON leave_requests;
CREATE POLICY "leave_requests_owner_all" ON leave_requests FOR ALL TO authenticated
  USING (academy_id = get_my_academy_id() OR academy_id IS NULL)
  WITH CHECK (academy_id = get_my_academy_id());

-- ── FEE PLANS ──────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fee_plans') THEN
    EXECUTE 'DROP POLICY IF EXISTS "fee_plans_auth_all" ON fee_plans';
    EXECUTE 'CREATE POLICY "fee_plans_owner_all" ON fee_plans FOR ALL TO authenticated USING (academy_id = get_my_academy_id()) WITH CHECK (academy_id = get_my_academy_id())';
  END IF;
END $$;

-- Verification (run while logged in as a real owner via the app — uses their JWT):
-- SELECT COUNT(*) FROM students;   -- should equal only YOUR academy's count
-- SELECT COUNT(*) FROM payments;   -- same
-- SELECT COUNT(*) FROM staff;      -- same
--
-- Negative test (should return 0): try to read another academy's id directly:
-- SELECT * FROM students WHERE academy_id = '<some-other-academy-uuid>' LIMIT 1;

-- ROLLBACK (paste to revert to open policies):
-- DROP POLICY IF EXISTS "students_owner_all"        ON students;
-- DROP POLICY IF EXISTS "batches_owner_all"         ON batches;
-- DROP POLICY IF EXISTS "staff_owner_all"           ON staff;
-- DROP POLICY IF EXISTS "payments_owner_all"        ON payments;
-- DROP POLICY IF EXISTS "trials_owner_all"          ON trials;
-- DROP POLICY IF EXISTS "attendance_owner_all"      ON attendance;
-- DROP POLICY IF EXISTS "announcements_owner_all"   ON announcements;
-- DROP POLICY IF EXISTS "events_owner_all"          ON events;
-- DROP POLICY IF EXISTS "gate_qr_owner_all"         ON gate_qr;
-- DROP POLICY IF EXISTS "leave_requests_owner_all"  ON leave_requests;
-- DROP POLICY IF EXISTS "fee_plans_owner_all"       ON fee_plans;
-- CREATE POLICY "students_auth_all"      ON students      FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "batches_auth_all"       ON batches       FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "staff_auth_all"         ON staff         FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "payments_auth_all"      ON payments      FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "trials_auth_all"        ON trials        FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "attendance_auth_all"    ON attendance    FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "announcements_auth_all" ON announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "leave_requests_access"  ON leave_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
