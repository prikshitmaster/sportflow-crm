-- ============================================================
-- 0051 — Phase 10a: secure trials, fee_plans, announcements RPCs
-- ============================================================
-- WHY
--   trials_anon_all, trial_sources_anon_all, fee_plans_anon_all,
--   announcements_anon_all (from 0032) let any anon caller forge trial
--   records, manipulate pricing, or inject announcements to all students.
--
-- RPCs ADDED
--   trials:        secure_insert_trial, secure_update_trial, secure_delete_trial
--   trial_sources: secure_insert_trial_source, secure_delete_trial_source
--   fee_plans:     secure_insert_fee_plan, secure_update_fee_plan, secure_delete_fee_plan
--   announcements: secure_insert_announcement
--
-- PERMISSIONS
--   trials / trial_sources  → requires trials.manage
--   fee_plans               → owner only
--   announcements           → owner or any staff (actor_kind IN owner/staff)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. secure_insert_trial ───────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_trial(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a      RECORD;
  v_id   BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  INSERT INTO trials (
    name, parent, phone, age, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, follow_up, notes,
    quoted_fee, session_start, session_end, dob, age_group, program_type,
    trial_fee_paid, academy_id, branch_id
  ) VALUES (
    p_payload->>'name',
    COALESCE(p_payload->>'parent', ''),
    p_payload->>'phone',
    NULLIF(p_payload->>'age', '')::INTEGER,
    p_payload->>'sport',
    (p_payload->>'trialDate')::DATE,
    NULLIF(p_payload->>'source', ''),
    'Scheduled',
    'scheduled',
    NULLIF(p_payload->>'batchId', '')::BIGINT,
    COALESCE((p_payload->>'trialSessions')::INTEGER, 1),
    0,
    false,
    NULLIF(p_payload->>'followUp', '')::DATE,
    NULLIF(p_payload->>'notes', ''),
    NULLIF(p_payload->>'quotedFee', '')::NUMERIC,
    NULLIF(p_payload->>'sessionStart', '')::TIME,
    NULLIF(p_payload->>'sessionEnd', '')::TIME,
    NULLIF(p_payload->>'dob', '')::DATE,
    NULLIF(p_payload->>'ageGroup', ''),
    COALESCE(NULLIF(p_payload->>'programType', ''), 'academy'),
    COALESCE((p_payload->>'trialFeePaid')::NUMERIC, 590),
    a.academy_id,
    NULLIF(p_payload->>'branchId', '')::UUID
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_trial(JSONB, TEXT) TO anon, authenticated;


-- ── 2. secure_update_trial ───────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_trial(
  p_trial_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
  v_trial_academy  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id INTO v_trial_academy FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial edit' USING ERRCODE = '42501';
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


-- ── 3. secure_delete_trial ───────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_trial(
  p_trial_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a               RECORD;
  v_trial_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id INTO v_trial_academy FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial delete' USING ERRCODE = '42501';
  END IF;

  DELETE FROM trials WHERE id = p_trial_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_trial(BIGINT, TEXT) TO anon, authenticated;


-- ── 4. secure_insert_trial_source ────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_trial_source(
  p_label TEXT,
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a     RECORD;
  v_row trial_sources%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  INSERT INTO trial_sources (academy_id, label)
  VALUES (a.academy_id, trim(p_label))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_trial_source(TEXT, TEXT) TO anon, authenticated;


-- ── 5. secure_delete_trial_source ────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_trial_source(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                  RECORD;
  v_source_academy   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id INTO v_source_academy FROM trial_sources WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_source_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM trial_sources WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_trial_source(BIGINT, TEXT) TO anon, authenticated;


-- ── 6. secure_insert_fee_plan ────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_fee_plan(
  p_batch_id      BIGINT,
  p_name          TEXT,
  p_training_type TEXT    DEFAULT 'daily',
  p_monthly_fee   INTEGER DEFAULT 0,
  p_quarterly_fee INTEGER DEFAULT 0,
  p_yearly_fee    INTEGER DEFAULT 0,
  p_token         TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a     RECORD;
  v_row fee_plans%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage fee plans'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO fee_plans (academy_id, batch_id, name, training_type, monthly_fee, quarterly_fee, yearly_fee)
  VALUES (a.academy_id, p_batch_id, p_name, COALESCE(p_training_type,'daily'),
          COALESCE(p_monthly_fee,0), COALESCE(p_quarterly_fee,0), COALESCE(p_yearly_fee,0))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_fee_plan(BIGINT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO anon, authenticated;


-- ── 7. secure_update_fee_plan ────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_fee_plan(
  p_id            BIGINT,
  p_name          TEXT,
  p_training_type TEXT,
  p_monthly_fee   INTEGER,
  p_quarterly_fee INTEGER,
  p_yearly_fee    INTEGER,
  p_token         TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a              RECORD;
  v_plan_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage fee plans'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_plan_academy FROM fee_plans WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fee plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy fee plan edit' USING ERRCODE = '42501';
  END IF;

  UPDATE fee_plans SET
    name          = p_name,
    training_type = COALESCE(p_training_type, 'daily'),
    monthly_fee   = COALESCE(p_monthly_fee, 0),
    quarterly_fee = COALESCE(p_quarterly_fee, 0),
    yearly_fee    = COALESCE(p_yearly_fee, 0)
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_fee_plan(BIGINT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO anon, authenticated;


-- ── 8. secure_delete_fee_plan ────────────────────────────
CREATE OR REPLACE FUNCTION secure_delete_fee_plan(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a              RECORD;
  v_plan_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage fee plans'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_plan_academy FROM fee_plans WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM fee_plans WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_fee_plan(BIGINT, TEXT) TO anon, authenticated;


-- ── 9. secure_insert_announcement ───────────────────────
-- Owner or any staff can post announcements (broadcast to all students).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_announcement(
  p_title  TEXT,
  p_body   TEXT,
  p_type   TEXT,
  p_author TEXT    DEFAULT NULL,
  p_token  TEXT    DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a     RECORD;
  v_row announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO announcements (title, body, type, author, date, academy_id)
  VALUES (
    p_title,
    p_body,
    p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    CURRENT_DATE,
    a.academy_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_announcement(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
