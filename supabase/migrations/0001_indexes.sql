-- ============================================================
-- 0001 — Missing indexes (perf only, additive, zero behaviour change)
-- ============================================================
-- Closes AUDIT.md M2-bis. Safe to run anytime; idempotent and
-- DEFENSIVE — every index creation first verifies the column exists,
-- so partial-schema databases just skip with a NOTICE instead of
-- aborting the whole transaction.
--
-- Why each one:
--   *_academy_id        — every query in db.js filters by academy_id; without
--                          an index, every fetch sequentially scans the table
--   payments.student_id — student portal `fetchStudentOwnPayments` joins here
--   payments.date       — Reports group-by-month and Payments period filters
--   attendance.(student_id, date) — unique-per-day lookup in markAttendance*
--   student_batches.(student_id, batch_id) — pitch / batchmates queries
--   *_sessions.token    — every authenticated request validates by token
-- ============================================================

-- Helper: create an index only if the table AND all referenced columns exist.
-- Uses pg_temp so the function lives only for this session and never pollutes
-- the public schema.
CREATE OR REPLACE FUNCTION pg_temp.idx_if_cols(
  idx_name text,
  tbl      text,
  cols     text[]
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c text;
  missing boolean := false;
  col_list text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = tbl
  ) THEN
    RAISE NOTICE 'skip %: table % missing', idx_name, tbl;
    RETURN;
  END IF;

  FOREACH c IN ARRAY cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = tbl AND column_name = c
    ) THEN
      RAISE NOTICE 'skip %: column %.% missing', idx_name, tbl, c;
      missing := true;
    END IF;
  END LOOP;

  IF missing THEN RETURN; END IF;

  SELECT string_agg(quote_ident(col), ', ') INTO col_list
    FROM unnest(cols) AS col;

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
                 idx_name, tbl, col_list);
END $$;

-- ── Students ────────────────────────────────────────────────
SELECT pg_temp.idx_if_cols('idx_students_academy_id',     'students', ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_students_academy_status', 'students', ARRAY['academy_id','status']);
SELECT pg_temp.idx_if_cols('idx_students_paid_till',      'students', ARRAY['paid_till']);
SELECT pg_temp.idx_if_cols('idx_students_batch_id',       'students', ARRAY['batch_id']);

-- ── Payments ────────────────────────────────────────────────
SELECT pg_temp.idx_if_cols('idx_payments_academy_id',     'payments', ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_payments_student_id',     'payments', ARRAY['student_id']);
SELECT pg_temp.idx_if_cols('idx_payments_date',           'payments', ARRAY['date']);
SELECT pg_temp.idx_if_cols('idx_payments_status',         'payments', ARRAY['status']);

-- ── Attendance ──────────────────────────────────────────────
-- NOTE: attendance has no batch_id column (batch is derived through students),
-- so we skip the batch_date index intentionally.
SELECT pg_temp.idx_if_cols('idx_attendance_student_date', 'attendance', ARRAY['student_id','date']);
SELECT pg_temp.idx_if_cols('idx_attendance_date',         'attendance', ARRAY['date']);

-- ── Domain tables ───────────────────────────────────────────
SELECT pg_temp.idx_if_cols('idx_batches_academy_id',       'batches',       ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_staff_academy_id',         'staff',         ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_trials_academy_id',        'trials',        ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_announcements_academy_id', 'announcements', ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_events_academy_id',        'events',        ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_feeplans_academy_id',      'fee_plans',     ARRAY['academy_id']);
SELECT pg_temp.idx_if_cols('idx_leaverequests_academy_id', 'leave_requests', ARRAY['academy_id']);

-- ── Student-batches junction ────────────────────────────────
SELECT pg_temp.idx_if_cols('idx_student_batches_student',  'student_batches', ARRAY['student_id']);
SELECT pg_temp.idx_if_cols('idx_student_batches_batch',    'student_batches', ARRAY['batch_id']);
SELECT pg_temp.idx_if_cols('idx_student_batches_pair',     'student_batches', ARRAY['student_id','batch_id']);

-- ── Session tokens (auth hot path) ──────────────────────────
SELECT pg_temp.idx_if_cols('idx_staff_sessions_token',     'staff_sessions',   ARRAY['token']);
SELECT pg_temp.idx_if_cols('idx_staff_sessions_expires',   'staff_sessions',   ARRAY['expires_at']);
SELECT pg_temp.idx_if_cols('idx_student_sessions_token',   'student_sessions', ARRAY['token']);
SELECT pg_temp.idx_if_cols('idx_student_sessions_expires', 'student_sessions', ARRAY['expires_at']);

-- ── Audit log retrieval ─────────────────────────────────────
SELECT pg_temp.idx_if_cols('idx_audit_logs_academy_time',  'audit_logs', ARRAY['academy_id','created_at']);
SELECT pg_temp.idx_if_cols('idx_audit_logs_actor',         'audit_logs', ARRAY['actor_id']);

-- Verification — list the indexes that were actually created:
-- SELECT indexname, tablename FROM pg_indexes
--  WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
--  ORDER BY tablename, indexname;

-- ROLLBACK (paste to revert — only drops indexes that exist, so safe):
-- DO $$
-- DECLARE n text;
-- BEGIN
--   FOR n IN SELECT indexname FROM pg_indexes
--             WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
--   LOOP
--     EXECUTE format('DROP INDEX IF EXISTS public.%I', n);
--   END LOOP;
-- END $$;
