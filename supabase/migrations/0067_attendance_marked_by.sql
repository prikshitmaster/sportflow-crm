-- 0067 — Add marked_by to attendance table
-- Every attendance row now records WHO marked it (actor_name from current_actor()).
-- For staff-marked rows this shows the coach/owner name.
-- For student QR/manual check-ins this shows the student's name (actor is the student).
-- Old rows get NULL marked_by — shown as "—" in the UI.

BEGIN;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS marked_by TEXT;

-- Update secure_save_attendance_date to stamp marked_by = actor name
CREATE OR REPLACE FUNCTION secure_save_attendance_date(
  p_date     DATE,
  p_batch_id BIGINT,
  p_records  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a           RECORD;
  v_to_delete BIGINT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_records) k
    JOIN students s ON s.id = k::BIGINT
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance references student from another academy'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(k::BIGINT) INTO v_to_delete
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NULL OR r.v = '';

  IF v_to_delete IS NOT NULL AND array_length(v_to_delete, 1) > 0 THEN
    IF p_batch_id IS NOT NULL THEN
      DELETE FROM attendance WHERE date = p_date AND batch_id = p_batch_id AND student_id = ANY(v_to_delete);
    ELSE
      DELETE FROM attendance WHERE date = p_date AND batch_id IS NULL AND student_id = ANY(v_to_delete);
    END IF;
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  SELECT p_date, r.k::BIGINT, p_batch_id, r.v = 'Present', r.v, a.actor_name
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NOT NULL AND r.v != ''
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_save_attendance_date(DATE, BIGINT, JSONB, TEXT) TO anon, authenticated;

-- Update secure_mark_attendance (QR/manual single-row mark) to stamp marked_by
CREATE OR REPLACE FUNCTION secure_mark_attendance(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (CURRENT_DATE, p_student_id, p_batch_id, true, 'Present', a.actor_name)
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.present   ELSE EXCLUDED.present   END,
    status    = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.status    ELSE EXCLUDED.status    END,
    marked_by = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.marked_by ELSE EXCLUDED.marked_by END;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_mark_attendance(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
