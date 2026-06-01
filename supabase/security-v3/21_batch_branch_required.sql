-- security-v3 / 21 — Branch is MANDATORY on batch creation
--
-- Same rule as students/staff (security-v3/19): a branchless batch would show
-- across every branch (collision). Reject NULL branch on create. Owners must be
-- inside a specific branch; field staff are force-bound to their own.
--
-- Body copied verbatim from 0079 (secure_insert_batch) + the guard.
-- secure_update_batch is unchanged here (it already enforces branch scope and
-- blocks cross-branch moves). Signature UNCHANGED. IDEMPOTENT.

BEGIN;

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

  -- Branch is mandatory (no all-branch batches).
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before creating a batch'
      USING ERRCODE = '23502';
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

COMMIT;
