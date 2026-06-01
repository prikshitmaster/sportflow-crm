-- security-v3 / 23 — Assessment + Player Goal writes require training.manage
--
-- Gap: secure_upsert_assessment and secure_upsert_player_goal enforced academy +
-- branch scope but NO permission check. The Player Performance page is route-gated
-- to 'training.manage' in the UI, but the RPCs accepted ANY non-student staff
-- token — so a coach without training.manage could write assessments/goals via the
-- API. This aligns the backend with the UI (owners bypass via _require_perm).
--
-- Bodies copied verbatim from the live definitions + one _require_perm line.
-- Signatures UNCHANGED. IDEMPOTENT.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- secure_upsert_assessment
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_upsert_assessment(p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a                  RECORD;
  v_student_id       BIGINT;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_row              skill_assessments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  v_student_id := (p_payload->>'studentId')::BIGINT;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'studentId required' USING ERRCODE = '22023';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = v_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  INSERT INTO skill_assessments (
    student_id, staff_id, batch_id, sport, assessed_month, scores, notes,
    academy_id, category_notes
  ) VALUES (
    v_student_id,
    (p_payload->>'staffId')::BIGINT,
    NULLIF(p_payload->>'batchId','')::BIGINT,
    p_payload->>'sport',
    p_payload->>'month',
    p_payload->'scores',
    NULLIF(p_payload->>'notes',''),
    a.academy_id,
    COALESCE(p_payload->'categoryNotes', '{}'::jsonb)
  )
  ON CONFLICT (student_id, assessed_month, sport) DO UPDATE SET
    staff_id       = EXCLUDED.staff_id,
    batch_id       = EXCLUDED.batch_id,
    scores         = EXCLUDED.scores,
    notes          = EXCLUDED.notes,
    category_notes = EXCLUDED.category_notes
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_upsert_assessment(jsonb, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_upsert_player_goal
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_upsert_player_goal(
  p_student_id bigint, p_month text, p_goal_text text,
  p_staff_id bigint DEFAULT NULL::bigint, p_token text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a                  RECORD;
  v_student_academy  UUID;
  v_student_branch   UUID;
  v_txt              TEXT;
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
    DELETE FROM player_goals
    WHERE student_id = p_student_id AND month = p_month AND academy_id = a.academy_id;
    RETURN NULL;
  END IF;

  INSERT INTO player_goals (student_id, month, goal_text, staff_id, academy_id)
  VALUES (p_student_id, p_month, v_txt, p_staff_id, a.academy_id)
  ON CONFLICT (student_id, month) DO UPDATE SET
    goal_text = EXCLUDED.goal_text,
    staff_id  = EXCLUDED.staff_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_upsert_player_goal(bigint, text, text, bigint, text) TO anon, authenticated;

COMMIT;
