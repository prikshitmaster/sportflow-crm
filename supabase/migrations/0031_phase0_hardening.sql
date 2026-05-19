-- Phase 0 hardening: fixes attendance dup rows, gate_qr tenancy,
-- batch enrolled race, leave request leak, and adds scaling indexes.
-- All operations are additive and idempotent — safe to re-run.

-- ─────────────────────────────────────────────────────────────
-- 1. Partial unique index for null-batch attendance
--    Required so saveAttendanceMonth can use onConflict(date,student_id,batch_id)
--    even for rows where batch_id IS NULL (Postgres treats NULL != NULL otherwise).
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS att_no_batch_idx
  ON attendance(date, student_id)
  WHERE batch_id IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. gate_qr tenant isolation
-- ─────────────────────────────────────────────────────────────
ALTER TABLE gate_qr
  ADD COLUMN IF NOT EXISTS academy_id uuid REFERENCES academies(id);

-- ─────────────────────────────────────────────────────────────
-- 3. Atomic batch enrolled counter (no read-modify-write race)
--    Drop first because migration 0014 may have defined it with a
--    different return type — Postgres won't let CREATE OR REPLACE change that.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS bump_batch_enrolled(BIGINT, INT);
CREATE FUNCTION bump_batch_enrolled(p_batch_id BIGINT, p_delta INT)
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE batches
     SET enrolled = GREATEST(0, COALESCE(enrolled, 0) + p_delta)
   WHERE id = p_batch_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Backfill leave_requests.academy_id from staff.academy_id
--    After this, fetchLeaveRequests can use strict equality.
-- ─────────────────────────────────────────────────────────────
UPDATE leave_requests lr
   SET academy_id = (
     SELECT s.academy_id FROM staff s WHERE s.id = lr.staff_id LIMIT 1
   )
 WHERE lr.academy_id IS NULL
   AND lr.staff_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 5. Backfill students.branch_id for single-branch sports (safe — only auto-assigns
--    when there's exactly one branch for the student's sport in their academy)
-- ─────────────────────────────────────────────────────────────
UPDATE students s
   SET branch_id = sb.id
  FROM sport_branches sb
 WHERE s.academy_id = sb.academy_id
   AND s.sport = sb.sport_name
   AND s.branch_id IS NULL
   AND (
     SELECT COUNT(*) FROM sport_branches
      WHERE academy_id = s.academy_id AND sport_name = s.sport
   ) = 1;

-- ─────────────────────────────────────────────────────────────
-- 6. Scale indexes for branch-filtered queries
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_academy_sport_branch
  ON students(academy_id, sport, branch_id);

CREATE INDEX IF NOT EXISTS idx_students_academy_branch
  ON students(academy_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_payments_academy_student
  ON payments(academy_id, student_id);
