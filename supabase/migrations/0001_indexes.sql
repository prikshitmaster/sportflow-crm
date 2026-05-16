-- ============================================================
-- 0001 — Missing indexes (perf only, additive, zero behaviour change)
-- ============================================================
-- Closes AUDIT.md M2-bis. Safe to run anytime; idempotent.
--
-- Why each one:
--   *_academy_id        — every query in db.js filters by academy_id; without
--                          an index, every fetch sequentially scans the table
--   payments.student_id — student portal `fetchStudentOwnPayments` joins here
--   payments.date       — Reports group-by-month and Payments period filters
--   attendance.(student_id, date) — unique-per-day lookup in markAttendance*
--   attendance.(batch_id, date)   — Attendance page month view
--   student_batches.(student_id, batch_id) — pitch / batchmates queries
--   *_sessions.token    — every authenticated request validates by token
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_students_academy_id      ON students(academy_id);
CREATE INDEX IF NOT EXISTS idx_students_academy_status  ON students(academy_id, status);
CREATE INDEX IF NOT EXISTS idx_students_paid_till       ON students(paid_till);
CREATE INDEX IF NOT EXISTS idx_students_batch_id        ON students(batch_id);

CREATE INDEX IF NOT EXISTS idx_payments_academy_id      ON payments(academy_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id      ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date            ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_status          ON payments(status);

CREATE INDEX IF NOT EXISTS idx_attendance_student_date  ON attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_batch_date    ON attendance(batch_id, date);

CREATE INDEX IF NOT EXISTS idx_batches_academy_id       ON batches(academy_id);
CREATE INDEX IF NOT EXISTS idx_staff_academy_id         ON staff(academy_id);
CREATE INDEX IF NOT EXISTS idx_trials_academy_id        ON trials(academy_id);
CREATE INDEX IF NOT EXISTS idx_announcements_academy_id ON announcements(academy_id);
CREATE INDEX IF NOT EXISTS idx_events_academy_id        ON events(academy_id);
CREATE INDEX IF NOT EXISTS idx_feeplans_academy_id      ON fee_plans(academy_id);

-- student_batches: depends on whether table exists (created in schema_student_batches.sql)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'student_batches') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_student_batches_student ON student_batches(student_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_student_batches_batch   ON student_batches(batch_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_student_batches_pair    ON student_batches(student_id, batch_id)';
  END IF;
END $$;

-- Session token lookups: every authenticated request from staff/student portal validates by token
CREATE INDEX IF NOT EXISTS idx_staff_sessions_token     ON staff_sessions(token);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires   ON staff_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_student_sessions_token   ON student_sessions(token);
CREATE INDEX IF NOT EXISTS idx_student_sessions_expires ON student_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_academy_time  ON audit_logs(academy_id, created_at DESC);

-- Verification — list new indexes
-- SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_%' ORDER BY indexname;

-- ROLLBACK (paste to revert):
-- DROP INDEX IF EXISTS idx_students_academy_id, idx_students_academy_status,
--   idx_students_paid_till, idx_students_batch_id,
--   idx_payments_academy_id, idx_payments_student_id, idx_payments_date, idx_payments_status,
--   idx_attendance_student_date, idx_attendance_batch_date,
--   idx_batches_academy_id, idx_staff_academy_id, idx_trials_academy_id,
--   idx_announcements_academy_id, idx_events_academy_id, idx_feeplans_academy_id,
--   idx_student_batches_student, idx_student_batches_batch, idx_student_batches_pair,
--   idx_staff_sessions_token, idx_staff_sessions_expires,
--   idx_student_sessions_token, idx_student_sessions_expires,
--   idx_audit_logs_academy_time;
