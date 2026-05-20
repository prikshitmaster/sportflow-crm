-- ============================================================
-- 0043 — Phase 6a: secure attendance write RPCs
-- ============================================================
-- WHY
--   attendance_anon_all (from 0032) lets any anon caller forge attendance:
--     supabase.from('attendance').insert({ student_id: X, date: '...', status: 'Present' })
--   This migration adds 4 SECURITY DEFINER RPCs covering all write paths
--   so the anon write hole can be closed in migration 0044.
--
-- INDEX CONTEXT
--   idx_attendance_date_student_batch ON attendance(date, student_id, batch_id)
--   NULLS NOT DISTINCT (migration 0007) — allows ON CONFLICT to work for both
--   null and non-null batch_id rows without special-casing.
--
-- RPCs ADDED
--   1. secure_save_attendance_date — date-level save (delete + upsert)
--   2. secure_upsert_attendance    — bulk month upsert
--   3. secure_mark_attendance      — live class mark (coach/owner)
--   4. secure_mark_attendance_qr   — gate QR scan (validated by gate token)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_save_attendance_date ───────────────────────
-- Handles the saveAttendanceForDate path: accepts a {studentId: status}
-- JSONB object where empty/null status means "delete that row" and
-- any other value means "upsert with that status".
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_save_attendance_date(
  p_date     DATE,
  p_batch_id BIGINT,   -- NULL for admin/legacy (no-batch) marks
  p_records  JSONB,    -- { "studentId": "status" | "" }
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a          RECORD;
  v_to_delete BIGINT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  -- Academy scope check: every student_id in the records must belong to
  -- the caller's academy.
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_records) k
    JOIN students s ON s.id = k::BIGINT
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance references student from another academy'
      USING ERRCODE = '42501';
  END IF;

  -- Collect student IDs to delete (empty or null status = "undo mark")
  SELECT array_agg(k::BIGINT)
  INTO v_to_delete
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NULL OR r.v = '';

  IF v_to_delete IS NOT NULL AND array_length(v_to_delete, 1) > 0 THEN
    IF p_batch_id IS NOT NULL THEN
      DELETE FROM attendance
      WHERE date = p_date AND batch_id = p_batch_id
        AND student_id = ANY(v_to_delete);
    ELSE
      DELETE FROM attendance
      WHERE date = p_date AND batch_id IS NULL
        AND student_id = ANY(v_to_delete);
    END IF;
  END IF;

  -- Upsert rows with a real status value
  INSERT INTO attendance (date, student_id, batch_id, present, status)
  SELECT
    p_date,
    r.k::BIGINT,
    p_batch_id,
    r.v = 'Present',
    r.v
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NOT NULL AND r.v != ''
  ON CONFLICT (date, student_id, batch_id)
    DO UPDATE SET
      present = EXCLUDED.present,
      status  = EXCLUDED.status;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_save_attendance_date(DATE, BIGINT, JSONB, TEXT) TO anon, authenticated;


-- ── 2. secure_upsert_attendance ───────────────────────────
-- Handles the saveAttendanceMonth path: accepts a JSONB array of
-- {date, student_id, batch_id, present, status} rows and bulk-upserts
-- them. Relies on idx_attendance_date_student_batch NULLS NOT DISTINCT
-- (migration 0007) to handle null and non-null batch_id uniformly.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_upsert_attendance(
  p_rows  JSONB,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  -- Academy scope check
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(student_id BIGINT)
    JOIN students s ON s.id = r.student_id
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance row references student from another academy'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status)
  SELECT
    (r.date)::DATE,
    r.student_id,
    r.batch_id,
    COALESCE(r.present, true),
    COALESCE(NULLIF(r.status, ''), 'Present')
  FROM jsonb_to_recordset(p_rows) AS r(
    date       TEXT,
    student_id BIGINT,
    batch_id   BIGINT,
    present    BOOLEAN,
    status     TEXT
  )
  ON CONFLICT (date, student_id, batch_id)
    DO UPDATE SET
      present = EXCLUDED.present,
      status  = EXCLUDED.status;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_upsert_attendance(JSONB, TEXT) TO anon, authenticated;


-- ── 3. secure_mark_attendance ─────────────────────────────
-- Handles the markAttendanceDirect path: marks one student Present
-- for today. Preserves the "never downgrade from Present/Late" rule —
-- if the student is already Present or Late, the row is untouched.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_mark_attendance(
  p_student_id BIGINT,
  p_batch_id   BIGINT,   -- NULL for no-batch students
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  -- Upsert with no-downgrade: if already Present/Late, keep existing values.
  INSERT INTO attendance (date, student_id, batch_id, present, status)
  VALUES (CURRENT_DATE, p_student_id, p_batch_id, true, 'Present')
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present = CASE
                WHEN attendance.status IN ('Present', 'Late') THEN attendance.present
                ELSE EXCLUDED.present
              END,
    status  = CASE
                WHEN attendance.status IN ('Present', 'Late') THEN attendance.status
                ELSE EXCLUDED.status
              END;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_mark_attendance(BIGINT, BIGINT, TEXT) TO anon, authenticated;


-- ── 4. secure_mark_attendance_qr ─────────────────────────
-- Handles the markAttendanceViaQR path: gate-device or student scan.
-- Auth is the gate QR token rather than a staff/owner session — the
-- gate_qr table is the credential store. Raises 'already marked' if
-- the student already has a record for today (same behavior as the
-- JS SELECT-then-INSERT check). Raises 'Invalid gate QR code' if the
-- token doesn't match the academy's gate QR.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_mark_attendance_qr(
  p_student_id BIGINT,
  p_gate_token TEXT,
  p_batch_id   BIGINT,   -- NULL for no-batch students
  p_academy_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_academy UUID;
BEGIN
  -- Validate gate token against this academy's gate QR record.
  IF NOT EXISTS (
    SELECT 1 FROM gate_qr
    WHERE token = p_gate_token AND academy_id = p_academy_id
  ) THEN
    RAISE EXCEPTION 'Invalid gate QR code' USING ERRCODE = '42501';
  END IF;

  -- Verify the student belongs to the same academy as the gate.
  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM p_academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  -- Check if already marked today for this date+student+batch combination.
  IF EXISTS (
    SELECT 1 FROM attendance
    WHERE date = CURRENT_DATE
      AND student_id = p_student_id
      AND (
        (p_batch_id IS NULL     AND batch_id IS NULL) OR
        (p_batch_id IS NOT NULL AND batch_id = p_batch_id)
      )
  ) THEN
    RAISE EXCEPTION 'already marked' USING ERRCODE = '23505';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status)
  VALUES (CURRENT_DATE, p_student_id, p_batch_id, true, 'Present');
END;
$$;

GRANT EXECUTE ON FUNCTION secure_mark_attendance_qr(BIGINT, TEXT, BIGINT, UUID) TO anon, authenticated;
