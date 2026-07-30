-- ============================================================
-- 0118 — Development plan: attribution + stop losing focus skills
-- ============================================================
-- PROBLEM
--   Two surfaces now edit the same player_goals row (student_id, month):
--   the owner's /performance page and the coach's Staff → Player Performance
--   → Goals tab. Three concrete faults fell out of that:
--
--   1. NO ATTRIBUTION. secure_upsert_player_goal does
--        ON CONFLICT DO UPDATE SET goal_text, staff_id = EXCLUDED.staff_id
--      The owner saves with p_staff_id = NULL, so an owner edit wipes the
--      coach's authorship and neither side can tell who set the plan.
--
--   2. SILENT DATA LOSS. A blank goal DELETEs the row — taking the focus
--      skills (0117) with it, with no warning. A coach clearing a goal
--      destroyed the academy's focus list.
--
--   3. No way to show "last edited" even though player_goals.updated_at and
--      its touch trigger have existed since 0008.
--
-- FIX
--   • add updated_by_role so every write records whether an owner or a staff
--     member made it — read alongside staff_id + updated_at for a full
--     "set by X on DATE" line on both surfaces.
--   • blank goal now only DELETEs when there are no focus skills to lose;
--     otherwise the row survives with goal_text = '' (the column is NOT NULL,
--     not non-empty, so '' is legal and both UIs treat it as "no goal").
--
-- BOTH FUNCTIONS KEEP THEIR EXACT EXISTING SIGNATURES.
--   updated_by_role is derived from current_actor() inside the body, so no new
--   parameter is added and no second overload can appear. That matters: an
--   overload makes PostgREST fail with "could not choose the best candidate
--   function", which is the bug 0116 had to undo.
--
-- IDEMPOTENT — safe to re-run. Apply AFTER 0117.
-- ============================================================

BEGIN;

ALTER TABLE player_goals
  ADD COLUMN IF NOT EXISTS updated_by_role text;

COMMENT ON COLUMN player_goals.updated_by_role IS
  'actor_kind of whoever last wrote this row: ''owner'' or ''staff''. Paired with staff_id + updated_at to show attribution on the owner Performance page and the coach Goals tab.';

-- ── secure_upsert_player_goal — unchanged signature (BIGINT,TEXT,TEXT,BIGINT,TEXT)
CREATE OR REPLACE FUNCTION secure_upsert_player_goal(
  p_student_id BIGINT,
  p_month      TEXT,
  p_goal_text  TEXT,
  p_staff_id   BIGINT DEFAULT NULL,
  p_token      TEXT   DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                  RECORD;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_txt              TEXT;
  v_has_focus        BOOLEAN;
  v_row              player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy goal' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  v_txt := trim(COALESCE(p_goal_text, ''));

  IF v_txt = '' THEN
    -- Only destroy the row when there is no focus list attached to it.
    SELECT COALESCE(jsonb_array_length(focus_skills), 0) > 0
      INTO v_has_focus
      FROM player_goals
     WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id;

    IF COALESCE(v_has_focus, FALSE) THEN
      UPDATE player_goals
         SET goal_text       = '',
             staff_id        = p_staff_id,
             updated_by_role = a.actor_kind
       WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id
      RETURNING * INTO v_row;
      RETURN row_to_json(v_row);
    END IF;

    DELETE FROM player_goals
     WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id;
    RETURN NULL;
  END IF;

  INSERT INTO player_goals (student_id, month, goal_text, staff_id, academy_id, updated_by_role)
  VALUES (p_student_id, p_month, v_txt, p_staff_id, a.academy_id, a.actor_kind)
  ON CONFLICT (student_id, month) DO UPDATE SET
    goal_text       = EXCLUDED.goal_text,
    staff_id        = EXCLUDED.staff_id,
    updated_by_role = EXCLUDED.updated_by_role
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_player_goal(BIGINT, TEXT, TEXT, BIGINT, TEXT) TO anon, authenticated;

-- ── secure_set_player_focus — unchanged signature (BIGINT,TEXT,JSONB,TEXT)
CREATE OR REPLACE FUNCTION secure_set_player_focus(
  p_student_id   BIGINT,
  p_month        TEXT,
  p_focus_skills JSONB,
  p_token        TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_row             player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  IF p_focus_skills IS NOT NULL AND jsonb_typeof(p_focus_skills) <> 'array' THEN
    RAISE EXCEPTION 'focus_skills must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy focus' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  UPDATE player_goals
     SET focus_skills    = COALESCE(p_focus_skills, '[]'::jsonb),
         updated_by_role = a.actor_kind
   WHERE student_id = p_student_id
     AND month      = p_month
     AND academy_id = a.academy_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no goal for this student/month — save the goal first'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_set_player_focus(BIGINT, TEXT, JSONB, TEXT) TO anon, authenticated;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'player_goals' AND column_name IN ('focus_skills','updated_by_role');
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.proname IN ('secure_upsert_player_goal','secure_set_player_focus')
--    ORDER BY 1;
--   -- expect exactly two rows, one signature each
