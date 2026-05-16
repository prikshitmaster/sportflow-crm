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
-- DEFENSIVE: every policy creation checks that the table + academy_id
-- column exist; tables without academy_id (or absent entirely) are
-- skipped with a NOTICE.
-- ============================================================

-- Ensure the helper exists (defined in schema_rls.sql; safe to re-create)
CREATE OR REPLACE FUNCTION get_my_academy_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id FROM profiles WHERE id = auth.uid()
$$;

-- Helper: drop the old "auth_all" / "access" / similar wide policy and
-- replace with academy-scoped one. Skips silently if table/column missing.
CREATE OR REPLACE FUNCTION pg_temp.scope_owner_rls(
  tbl text, old_names text[]
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = tbl
  ) THEN
    RAISE NOTICE 'skip %: table missing', tbl;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'academy_id'
  ) THEN
    RAISE NOTICE 'skip %: no academy_id column', tbl;
    RETURN;
  END IF;

  -- Drop the legacy wide-open policies
  FOREACH n IN ARRAY old_names LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', n, tbl);
  END LOOP;

  -- Drop any prior owner_all policy from a previous run of this migration
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_owner_all', tbl);

  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (academy_id = get_my_academy_id())
       WITH CHECK (academy_id = get_my_academy_id())',
    tbl || '_owner_all', tbl
  );
  RAISE NOTICE 'scoped owner RLS for %', tbl;
END $$;

-- ── Tables with academy_id column on the row directly ───────
SELECT pg_temp.scope_owner_rls('students',       ARRAY['students_auth_all']);
SELECT pg_temp.scope_owner_rls('batches',        ARRAY['batches_auth_all']);
SELECT pg_temp.scope_owner_rls('staff',          ARRAY['staff_auth_all']);
SELECT pg_temp.scope_owner_rls('payments',       ARRAY['payments_auth_all']);
SELECT pg_temp.scope_owner_rls('trials',         ARRAY['trials_auth_all']);
SELECT pg_temp.scope_owner_rls('announcements',  ARRAY['announcements_auth_all']);
SELECT pg_temp.scope_owner_rls('events',         ARRAY['events_auth_all']);
SELECT pg_temp.scope_owner_rls('fee_plans',      ARRAY['fee_plans_auth_all']);
SELECT pg_temp.scope_owner_rls('leave_requests', ARRAY['leave_requests_access','leave_requests_auth']);

-- ── Attendance: no academy_id column, scope via students FK ──
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'attendance'
  ) THEN
    DROP POLICY IF EXISTS "attendance_auth_all"   ON attendance;
    DROP POLICY IF EXISTS "attendance_owner_all"  ON attendance;
    CREATE POLICY "attendance_owner_all" ON attendance FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM students s
         WHERE s.id = attendance.student_id AND s.academy_id = get_my_academy_id()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM students s
         WHERE s.id = attendance.student_id AND s.academy_id = get_my_academy_id()
      ));
    RAISE NOTICE 'scoped owner RLS for attendance';
  END IF;
END $$;

-- ── Gate QR: only if it has academy_id ─────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'gate_qr' AND column_name = 'academy_id'
  ) THEN
    DROP POLICY IF EXISTS "gate_qr_auth_all"   ON gate_qr;
    DROP POLICY IF EXISTS "gate_qr_owner_all"  ON gate_qr;
    CREATE POLICY "gate_qr_owner_all" ON gate_qr FOR ALL TO authenticated
      USING (academy_id = get_my_academy_id())
      WITH CHECK (academy_id = get_my_academy_id());
    RAISE NOTICE 'scoped owner RLS for gate_qr';
  ELSE
    RAISE NOTICE 'skip gate_qr: no academy_id column — leaving open policy in place';
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
-- DO $$ DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY['students','batches','staff','payments','trials',
--                            'announcements','events','fee_plans','leave_requests','attendance','gate_qr']
--   LOOP
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_all', t);
--   END LOOP;
-- END $$;
-- CREATE POLICY "students_auth_all"      ON students      FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "batches_auth_all"       ON batches       FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "staff_auth_all"         ON staff         FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "payments_auth_all"      ON payments      FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "trials_auth_all"        ON trials        FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "attendance_auth_all"    ON attendance    FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "announcements_auth_all" ON announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "leave_requests_access"  ON leave_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
