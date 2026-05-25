-- 0079 — Batch create/edit: owner-only → batches.manage (with branch scope)
--
-- WHY
--   secure_delete_batch (security-v3/02) already requires 'batches.manage',
--   but secure_insert_batch / secure_update_batch (migration 0049) were still
--   owner-only. That made the batches.manage permission half-functional: a
--   staff member granted it could DELETE a batch but not CREATE or EDIT one,
--   and the UI showed Create/Edit buttons that errored with "only academy
--   owners can …". This aligns all three batch write RPCs on batches.manage.
--
-- WHAT CHANGES
--   secure_insert_batch — now requires batches.manage; branch-scoped staff are
--     forced into their own branch (cannot create a batch in another branch).
--   secure_update_batch — now requires batches.manage; same-academy + branch
--     scope enforced; branch-scoped staff cannot edit or move a batch to a
--     different branch.
--   Owners bypass perm + branch checks (via _require_perm / _require_branch_scope).
--
-- Signatures and return types are UNCHANGED. IDEMPOTENT — safe to re-run.

BEGIN;

-- ── secure_insert_batch ───────────────────────────────────
CREATE OR REPLACE FUNCTION secure_insert_batch(
  p_token        TEXT,
  p_name         TEXT,
  p_time         TEXT       DEFAULT NULL,
  p_sports       JSONB      DEFAULT '[]',
  p_coach        TEXT       DEFAULT NULL,
  p_capacity     INTEGER    DEFAULT 30,
  p_days         JSONB      DEFAULT '[]',
  p_start_time   TEXT       DEFAULT NULL,
  p_end_time     TEXT       DEFAULT NULL,
  p_age_min      INTEGER    DEFAULT 0,
  p_age_max      INTEGER    DEFAULT 99,
  p_ground       TEXT       DEFAULT NULL,
  p_code         TEXT       DEFAULT NULL,
  p_default_fee  INTEGER    DEFAULT 0,
  p_default_plan TEXT       DEFAULT 'monthly',
  p_branch_id    UUID       DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a           RECORD;
  v_branch_id UUID;
  v_row       batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  -- Branch-scoped staff are forced into their own branch; others use payload.
  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  INSERT INTO batches (
    name, time, sports, coach, capacity, enrolled, waitlist,
    days, start_time, end_time, age_min, age_max, ground, code,
    default_fee, default_plan, academy_id, branch_id
  ) VALUES (
    p_name,
    p_time,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_sports, '[]'::JSONB))),
    p_coach,
    COALESCE(p_capacity, 30),
    0,
    0,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_days, '[]'::JSONB))),
    p_start_time,
    p_end_time,
    COALESCE(p_age_min, 0),
    COALESCE(p_age_max, 99),
    p_ground,
    p_code,
    COALESCE(p_default_fee, 0),
    COALESCE(p_default_plan, 'monthly'),
    a.academy_id,
    v_branch_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_batch(TEXT, TEXT, TEXT, JSONB, TEXT, INTEGER, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, UUID) TO anon, authenticated;


-- ── secure_update_batch ───────────────────────────────────
CREATE OR REPLACE FUNCTION secure_update_batch(
  p_batch_id BIGINT,
  p_payload  JSONB,
  p_token    TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a               RECORD;
  v_batch_academy UUID;
  v_batch_branch  UUID;
  v_row           batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy batch edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  -- Branch-scoped staff cannot move a batch to a different branch
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move batch to a different branch' USING ERRCODE = '42501';
  END IF;

  UPDATE batches SET
    name         = CASE WHEN p_payload ? 'name'        THEN p_payload->>'name'                            ELSE name         END,
    time         = CASE WHEN p_payload ? 'time'        THEN p_payload->>'time'                            ELSE time         END,
    sports       = CASE WHEN p_payload ? 'sports'      THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'sports')) ELSE sports       END,
    coach        = CASE WHEN p_payload ? 'coach'       THEN p_payload->>'coach'                           ELSE coach        END,
    capacity     = CASE WHEN p_payload ? 'capacity'    THEN (p_payload->>'capacity')::INTEGER             ELSE capacity     END,
    days         = CASE WHEN p_payload ? 'days'        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'days'))   ELSE days         END,
    start_time   = CASE WHEN p_payload ? 'startTime'   THEN NULLIF(p_payload->>'startTime', '')           ELSE start_time   END,
    end_time     = CASE WHEN p_payload ? 'endTime'     THEN NULLIF(p_payload->>'endTime', '')             ELSE end_time     END,
    age_min      = CASE WHEN p_payload ? 'ageMin'      THEN COALESCE((p_payload->>'ageMin')::INTEGER, 0) ELSE age_min      END,
    age_max      = CASE WHEN p_payload ? 'ageMax'      THEN COALESCE((p_payload->>'ageMax')::INTEGER, 99) ELSE age_max     END,
    ground       = CASE WHEN p_payload ? 'ground'      THEN NULLIF(p_payload->>'ground', '')              ELSE ground       END,
    code         = CASE WHEN p_payload ? 'code'        THEN NULLIF(p_payload->>'code', '')               ELSE code         END,
    default_fee  = CASE WHEN p_payload ? 'defaultFee'  THEN COALESCE((p_payload->>'defaultFee')::INTEGER, 0)  ELSE default_fee  END,
    default_plan = CASE WHEN p_payload ? 'defaultPlan' THEN COALESCE(p_payload->>'defaultPlan', 'monthly')    ELSE default_plan END,
    branch_id    = CASE WHEN p_payload ? 'branchId'    THEN NULLIF(p_payload->>'branchId','')::UUID            ELSE branch_id    END
  WHERE id = p_batch_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_batch(BIGINT, JSONB, TEXT) TO anon, authenticated;

COMMIT;
