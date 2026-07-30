-- ============================================================
-- 0117 — Development plan: focus skills on player_goals
-- ============================================================
-- WHY
--   The new owner-facing Student Performance page (/performance) lets an
--   academy build a development plan from a player's assessment: a short list
--   of skills to work on, plus the monthly goal. `player_goals` only had
--   `month` + `goal_text`, so there was nowhere to keep the focus skills.
--
-- WHY A NEW FUNCTION INSTEAD OF A NEW PARAMETER
--   Adding p_focus_skills to secure_upsert_player_goal would leave a second
--   overload behind the moment anyone re-runs
--   security-v3/23_assessment_goal_require_perm.sql (which does a
--   CREATE OR REPLACE on the 5-arg signature). PostgREST then cannot pick a
--   candidate and every goal save fails with "could not choose the best
--   candidate function" — exactly the failure 0116 had to undo. So
--   secure_upsert_player_goal is left completely untouched and focus skills
--   get their own single-purpose RPC.
--
-- ORDER OF WRITES (client side)
--   goal_text is NOT NULL and blank text DELETES the row, so the plan editor
--   always saves the goal first, then the focus list. Clearing the goal removes
--   the row and the focus with it, which is the behaviour we want.
--
-- AUTHORISATION — identical to secure_upsert_player_goal:
--   students rejected; owners pass _require_perm by design
--   (migrations/0033_secure_delete_rpcs.sql:110 returns early for 'owner');
--   staff need training.manage; branch managers are held to their own branch
--   via _require_branch_scope.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE player_goals
  ADD COLUMN IF NOT EXISTS focus_skills jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN player_goals.focus_skills IS
  'JSON array of Football skill display names to work on this month, e.g. ["Heading","Positioning"]. Set via secure_set_player_focus. Max 5 enforced client-side.';

DROP FUNCTION IF EXISTS secure_set_player_focus(BIGINT, TEXT, JSONB, TEXT);

CREATE FUNCTION secure_set_player_focus(
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
     SET focus_skills = COALESCE(p_focus_skills, '[]'::jsonb)
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
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'player_goals' AND column_name = 'focus_skills';
--   SELECT p.oid::regprocedure FROM pg_proc p WHERE p.proname = 'secure_set_player_focus';
--   -- expect exactly one: secure_set_player_focus(bigint,text,jsonb,text)
