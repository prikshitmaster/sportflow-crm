-- 0070 — Fix attendance "Marked by" RPCs
-- Migration 0067 referenced a.actor_name, but current_actor() (defined in 0033)
-- only returns (actor_kind, actor_id, academy_id, perms) — no actor_name.
-- Result: saving attendance failed with: record "a" has no field "actor_name".
--
-- Fix: look up the actor's display name locally based on actor_kind, instead
-- of changing current_actor()'s return shape (which would risk every other
-- RPC that selects from it).

BEGIN;

CREATE OR REPLACE FUNCTION secure_save_attendance_date(
  p_date     DATE,
  p_batch_id BIGINT,
  p_records  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a            RECORD;
  v_actor_name TEXT;
  v_to_delete  BIGINT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  -- Resolve actor display name based on kind
  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

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
  SELECT p_date, r.k::BIGINT, p_batch_id, r.v = 'Present', r.v, v_actor_name
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NOT NULL AND r.v != ''
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_save_attendance_date(DATE, BIGINT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_mark_attendance(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_actor_name      TEXT;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (CURRENT_DATE, p_student_id, p_batch_id, true, 'Present', v_actor_name)
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.present   ELSE EXCLUDED.present   END,
    status    = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.status    ELSE EXCLUDED.status    END,
    marked_by = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.marked_by ELSE EXCLUDED.marked_by END;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_mark_attendance(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
