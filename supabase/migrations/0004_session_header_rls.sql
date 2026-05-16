-- ============================================================
-- 0004 — Staff/Student session-header RLS  (apply LAST)
-- ============================================================
-- This file closes AUDIT.md C2/C4 for the anon (staff/student portal)
-- paths. It requires a coordinated app change in Phase D — the React
-- app must start sending the session token as a custom header on every
-- PostgREST request.
--
-- DO NOT APPLY YET if the deployed app does not send the header:
--   supabase.realtime.setAuth() or
--   supabase.functions.setAuth() do NOT do this; you need to add a
--   custom header via `headers: { 'x-staff-token': '...' }` on the
--   supabase client init (see supabase.js in Phase D).
--
-- After applying:
--   - Anon clients without the header → see no rows (correct).
--   - Anon clients with a valid header → see only their academy.
--   - Forged academy_id in localStorage → no effect; RLS reads the
--     academy from the SESSION TABLE via the token, never from client.
-- ============================================================

-- ── Helper: resolve academy from staff session token header ──
CREATE OR REPLACE FUNCTION current_staff_academy()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.academy_id
    FROM staff s
    JOIN staff_sessions ss ON ss.staff_id = s.id
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;

-- ── Helper: resolve academy from student session token header ──
CREATE OR REPLACE FUNCTION current_student_academy()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.academy_id
    FROM students st
    JOIN student_sessions ss ON ss.student_id = st.id
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-student-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;

-- ── Helper: resolve the student id behind a student token (for self-only reads) ──
CREATE OR REPLACE FUNCTION current_student_id()
RETURNS BIGINT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ss.student_id
    FROM student_sessions ss
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-student-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;

-- ── STUDENTS  (anon — staff portal reads, student reads own row) ──
DROP POLICY IF EXISTS "students_anon_read" ON students;
CREATE POLICY "students_anon_read" ON students FOR SELECT TO anon USING (
  academy_id = current_staff_academy()
  OR id = current_student_id()
);

-- ── BATCHES (anon — staff portal + student dashboard) ──
DROP POLICY IF EXISTS "batches_anon_read" ON batches;
CREATE POLICY "batches_anon_read" ON batches FOR SELECT TO anon USING (
  academy_id = current_staff_academy()
  OR academy_id = current_student_academy()
);

-- ── PAYMENTS (anon — staff portal full, student own only) ──
DROP POLICY IF EXISTS "payments_anon_read" ON payments;
CREATE POLICY "payments_anon_read" ON payments FOR SELECT TO anon USING (
  academy_id = current_staff_academy()
  OR student_id = current_student_id()
);

-- ── ATTENDANCE (anon read = student own; anon insert = student marking self) ──
DROP POLICY IF EXISTS "attendance_anon_read"   ON attendance;
DROP POLICY IF EXISTS "attendance_anon_insert" ON attendance;

CREATE POLICY "attendance_anon_read" ON attendance FOR SELECT TO anon USING (
  student_id = current_student_id()
  OR EXISTS (SELECT 1 FROM students s WHERE s.id = attendance.student_id AND s.academy_id = current_staff_academy())
);

-- Only insert attendance for SELF (closes the "forge another student's attendance" attack)
CREATE POLICY "attendance_anon_insert" ON attendance FOR INSERT TO anon WITH CHECK (
  student_id = current_student_id()
  OR EXISTS (SELECT 1 FROM students s WHERE s.id = attendance.student_id AND s.academy_id = current_staff_academy())
);

-- ── ANNOUNCEMENTS (anon — student dashboard notice board) ──
DROP POLICY IF EXISTS "announcements_anon_read" ON announcements;
CREATE POLICY "announcements_anon_read" ON announcements FOR SELECT TO anon USING (
  academy_id = current_student_academy()
  OR academy_id = current_staff_academy()
);

-- ── GATE QR (anon — student scans, validates within own academy) ──
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gate_qr' AND column_name = 'academy_id') THEN
    EXECUTE 'DROP POLICY IF EXISTS "gate_qr_anon_read" ON gate_qr';
    EXECUTE 'CREATE POLICY "gate_qr_anon_read" ON gate_qr FOR SELECT TO anon USING (academy_id = current_student_academy() OR academy_id = current_staff_academy())';
  END IF;
END $$;

-- Verification (run from your app, NOT SQL Editor — SQL Editor uses your owner JWT):
--   1. Open the app as student → see only own payments / attendance
--   2. Open the app as staff   → see only own academy's students
--   3. Open DevTools, replace localStorage academy_id → no extra rows visible
--      (because RLS reads academy from the SESSION row via the token, not the client)
--
-- ROLLBACK (revert to open anon policies — closes the security gap fix):
-- DROP POLICY IF EXISTS "students_anon_read"      ON students;
-- DROP POLICY IF EXISTS "batches_anon_read"       ON batches;
-- DROP POLICY IF EXISTS "payments_anon_read"      ON payments;
-- DROP POLICY IF EXISTS "attendance_anon_read"    ON attendance;
-- DROP POLICY IF EXISTS "attendance_anon_insert"  ON attendance;
-- DROP POLICY IF EXISTS "announcements_anon_read" ON announcements;
-- DROP POLICY IF EXISTS "gate_qr_anon_read"       ON gate_qr;
-- CREATE POLICY "students_anon_read"      ON students      FOR SELECT TO anon USING (true);
-- CREATE POLICY "batches_anon_read"       ON batches       FOR SELECT TO anon USING (true);
-- CREATE POLICY "payments_anon_read"      ON payments      FOR SELECT TO anon USING (true);
-- CREATE POLICY "attendance_anon_read"    ON attendance    FOR SELECT TO anon USING (true);
-- CREATE POLICY "attendance_anon_insert"  ON attendance    FOR INSERT TO anon WITH CHECK (true);
-- CREATE POLICY "announcements_anon_read" ON announcements FOR SELECT TO anon USING (true);
