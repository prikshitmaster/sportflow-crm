-- security-v3 / 03 — Branch enforcement on extended write RPCs
-- (preserves the latest column/return-type contracts from migrations 0051/0053/0063)
--
-- Covers branch-scopable RPCs not in 02:
--   trials      : insert, update, delete (uses branch_id col)
--   announcements: insert (validates p_branch_id matches actor's branch)
--   skill_assessments: upsert (scoped via student.branch_id)
--   player_goals : upsert (scoped via student.branch_id)
--
-- NOT TOUCHED:
--   • Owner-only RPCs (batches insert/update, fee_plans, sport_branches,
--     gate_qr, invites, staff CRUD, user_permissions) — no branch check
--     needed since branch-scoped staff can't call them at all.
--   • Self-action RPCs (leave_request, staff_attendance check-in,
--     staff_profile self-update) — staff acts on their own staff_id only.
--   • Drills / session_plans / session_phases — no branch_id column today.
--   • Events / tournament_matches — events table has no branch_id today.
--   • Activity sessions, logout — observability/auth.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- trials.insert
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_insert_trial(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a              RECORD;
  v_id           BIGINT;
  v_branch_id    UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  v_branch_id := NULLIF(p_payload->>'branchId','')::UUID;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, follow_up, notes,
    quoted_fee, session_start, session_end, dob, age_group, program_type,
    trial_fee_paid, academy_id, branch_id
  ) VALUES (
    p_payload->>'name', COALESCE(p_payload->>'parent', ''),
    p_payload->>'phone', NULLIF(p_payload->>'age', '')::INTEGER,
    p_payload->>'sport', (p_payload->>'trialDate')::DATE,
    NULLIF(p_payload->>'source', ''), 'Scheduled', 'scheduled',
    NULLIF(p_payload->>'batchId', '')::BIGINT,
    COALESCE((p_payload->>'trialSessions')::INTEGER, 1),
    0, false,
    NULLIF(p_payload->>'followUp', '')::DATE,
    NULLIF(p_payload->>'notes', ''),
    NULLIF(p_payload->>'quotedFee', '')::NUMERIC,
    NULLIF(p_payload->>'sessionStart', '')::TIME,
    NULLIF(p_payload->>'sessionEnd', '')::TIME,
    NULLIF(p_payload->>'dob', '')::DATE,
    NULLIF(p_payload->>'ageGroup', ''),
    COALESCE(NULLIF(p_payload->>'programType', ''), 'academy'),
    COALESCE((p_payload->>'trialFeePaid')::NUMERIC, 590),
    a.academy_id, v_branch_id
  ) RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_trial(JSONB, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- trials.update
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_update_trial(
  p_trial_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a               RECORD;
  v_trial_academy UUID;
  v_trial_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id, branch_id INTO v_trial_academy, v_trial_branch
  FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002'; END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch);

  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move trial to a different branch' USING ERRCODE = '42501';
  END IF;

  UPDATE trials SET
    name           = CASE WHEN p_payload ? 'name'          THEN p_payload->>'name'                              ELSE name           END,
    phone          = CASE WHEN p_payload ? 'phone'         THEN p_payload->>'phone'                             ELSE phone          END,
    parent         = CASE WHEN p_payload ? 'parent'        THEN p_payload->>'parent'                            ELSE parent         END,
    age            = CASE WHEN p_payload ? 'age'           THEN NULLIF(p_payload->>'age','')::INTEGER           ELSE age            END,
    sport          = CASE WHEN p_payload ? 'sport'         THEN p_payload->>'sport'                             ELSE sport          END,
    status         = CASE WHEN p_payload ? 'status'        THEN p_payload->>'status'                            ELSE status         END,
    stage          = CASE WHEN p_payload ? 'stage'         THEN p_payload->>'stage'                             ELSE stage          END,
    converted      = CASE WHEN p_payload ? 'converted'     THEN (p_payload->>'converted')::BOOLEAN              ELSE converted      END,
    follow_up      = CASE WHEN p_payload ? 'followUp'      THEN NULLIF(p_payload->>'followUp','')::DATE          ELSE follow_up      END,
    batch_id       = CASE WHEN p_payload ? 'batchId'       THEN NULLIF(p_payload->>'batchId','')::BIGINT        ELSE batch_id       END,
    trial_date     = CASE WHEN p_payload ? 'trialDate'     THEN (p_payload->>'trialDate')::DATE                 ELSE trial_date     END,
    trial_sessions = CASE WHEN p_payload ? 'trialSessions' THEN (p_payload->>'trialSessions')::INTEGER          ELSE trial_sessions END,
    sessions_done  = CASE WHEN p_payload ? 'sessionsDone'  THEN (p_payload->>'sessionsDone')::INTEGER           ELSE sessions_done  END,
    coach_note     = CASE WHEN p_payload ? 'coachNote'     THEN NULLIF(p_payload->>'coachNote','')              ELSE coach_note     END,
    coach_rec      = CASE WHEN p_payload ? 'coachRec'      THEN NULLIF(p_payload->>'coachRec','')               ELSE coach_rec      END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN NULLIF(p_payload->>'notes','')                  ELSE notes          END,
    quoted_fee     = CASE WHEN p_payload ? 'quotedFee'     THEN NULLIF(p_payload->>'quotedFee','')::NUMERIC     ELSE quoted_fee     END,
    session_start  = CASE WHEN p_payload ? 'sessionStart'  THEN NULLIF(p_payload->>'sessionStart','')::TIME      ELSE session_start  END,
    session_end    = CASE WHEN p_payload ? 'sessionEnd'    THEN NULLIF(p_payload->>'sessionEnd','')::TIME        ELSE session_end    END,
    dob            = CASE WHEN p_payload ? 'dob'           THEN NULLIF(p_payload->>'dob','')::DATE              ELSE dob            END,
    age_group      = CASE WHEN p_payload ? 'ageGroup'      THEN NULLIF(p_payload->>'ageGroup','')               ELSE age_group      END,
    program_type   = CASE WHEN p_payload ? 'programType'   THEN COALESCE(NULLIF(p_payload->>'programType',''),'academy') ELSE program_type END,
    trial_fee_paid = CASE WHEN p_payload ? 'trialFeePaid'  THEN (p_payload->>'trialFeePaid')::NUMERIC           ELSE trial_fee_paid END
  WHERE id = p_trial_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_trial(BIGINT, JSONB, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- trials.delete
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_delete_trial(
  p_trial_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a               RECORD;
  v_trial_academy UUID;
  v_trial_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id, branch_id INTO v_trial_academy, v_trial_branch
  FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial delete' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch);

  DELETE FROM trials WHERE id = p_trial_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_trial(BIGINT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- announcements (7-arg overload — the one with branch_id param)
-- Branch-scoped staff: branch_id forced to their own.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_insert_announcement(
  p_title     TEXT,
  p_body      TEXT,
  p_type      TEXT,
  p_author    TEXT    DEFAULT NULL,
  p_token     TEXT    DEFAULT NULL,
  p_sport     TEXT    DEFAULT NULL,
  p_branch_id UUID    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a            RECORD;
  v_branch_id  UUID;
  v_row        announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  ELSE
    v_branch_id := p_branch_id;
  END IF;

  INSERT INTO announcements (title, body, type, author, date, academy_id, sport, branch_id)
  VALUES (
    p_title, p_body, p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    CURRENT_DATE, a.academy_id,
    NULLIF(p_sport, ''), v_branch_id
  ) RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- skill_assessments.upsert
-- (preserves 0063 schema: student_id, staff_id, batch_id, sport,
--  assessed_month, scores, notes, academy_id, category_notes)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_upsert_assessment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_assessment(JSONB, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- player_goals.upsert (preserves 0053 return type — RETURNS JSON)
-- ════════════════════════════════════════════════════════════════
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
  v_row              player_goals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_player_goal(BIGINT, TEXT, TEXT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
