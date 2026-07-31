-- Coaches saving a monthly assessment (StaffAssess.jsx) can also set a
-- student's playing position from the same form. That went through the
-- general secure_update_student RPC, which requires students.manage —
-- the broad "edit any student field" permission, not held by most coaches,
-- who only have training.manage. Every save where the position dropdown
-- differed from the stored value threw "forbidden: missing permission
-- students.manage" for those coaches — and since this ran AFTER the
-- assessment itself was already written, the coach saw a scary error on a
-- save that had actually (partially) succeeded.
--
-- Mirrors secure_update_student_photo's existing pattern: a narrowly-scoped
-- RPC that touches exactly one column, gated by whichever permission
-- actually matches that column's real-world owner — here, the coach doing
-- an assessment, not office staff editing student records generally.

CREATE OR REPLACE FUNCTION secure_update_student_position(
  p_student_id BIGINT,
  p_position   TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_student_academy FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
  END IF;

  -- Same primitive _require_perm uses (perms is a JSONB array of strings),
  -- just inlined for an OR of two permissions instead of one: office
  -- staff/owners already covered by students.manage, coaches by
  -- training.manage. Owners are unrestricted; students never reach here
  -- (actor_kind = 'student' was already rejected above).
  IF a.actor_kind = 'staff' AND NOT (a.perms ? 'students.manage' OR a.perms ? 'training.manage') THEN
    RAISE EXCEPTION 'forbidden: missing permission students.manage or training.manage' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET position = p_position WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_student_position(BIGINT, TEXT, TEXT) TO anon, authenticated;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS secure_update_student_position(BIGINT, TEXT, TEXT);
