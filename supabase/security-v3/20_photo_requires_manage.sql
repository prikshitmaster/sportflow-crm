-- security-v3 / 20 — Photo update is a WRITE → require students.manage
--
-- Rule: a view-only grant must never permit a write. secure_update_student_photo
-- previously required only 'students.view' for staff/owner, so a read-only coach
-- could change any student's photo. Tightened to 'students.manage'.
--
-- UNCHANGED: a student updating their OWN photo (actor_kind = 'student') — that
-- path needs no module permission and is preserved exactly.
--
-- Body copied verbatim from security-v3/02 with the single perm change.
-- Signature UNCHANGED. IDEMPOTENT — safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION secure_update_student_photo(
  p_student_id BIGINT,
  p_photo_url  TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: students can only update their own photo' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);
  END IF;

  UPDATE students SET photo_url = p_photo_url WHERE id = p_student_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student_photo(BIGINT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
