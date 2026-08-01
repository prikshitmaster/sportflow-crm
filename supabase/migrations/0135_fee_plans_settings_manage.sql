-- 0135 — Let staff with settings.manage manage fee plans, not owners only
--
-- secure_insert_fee_plan / secure_update_fee_plan / secure_delete_fee_plan
-- (0051) hard-checked actor_kind = 'owner' with no permission escalation
-- path at all — settings.manage (which gates the rest of the Settings page,
-- including the Fee Plans tab client-side) had no effect here. A staff
-- member could open Fee Plans, fill in a whole new plan, and only discover
-- it was impossible on submit ("forbidden: only academy owners can manage
-- fee plans"). Product decision: allow it via settings.manage.
--
-- Since this was owner-only before, there was no need to validate p_batch_id
-- against the actor's own academy/branch — the owner's academy_id was
-- trusted implicitly. Now that a possibly branch-scoped staff member can
-- call this, added: batch must belong to the actor's academy, and if the
-- actor has a branch, the batch's branch must match (_require_branch_scope,
-- same helper used everywhere else for this). Mirrors the escalation-guard
-- pattern already established for staff permission edits (0081) — signatures
-- unchanged, IDEMPOTENT.

BEGIN;

-- ── secure_insert_fee_plan ─────────────────────────────────
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
  a               RECORD;
  v_row           fee_plans%ROWTYPE;
  v_batch_academy UUID;
  v_batch_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy fee plan create' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  INSERT INTO fee_plans (academy_id, batch_id, name, training_type, monthly_fee, quarterly_fee, yearly_fee)
  VALUES (a.academy_id, p_batch_id, p_name, COALESCE(p_training_type,'daily'),
          COALESCE(p_monthly_fee,0), COALESCE(p_quarterly_fee,0), COALESCE(p_yearly_fee,0))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_fee_plan(BIGINT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO anon, authenticated;


-- ── secure_update_fee_plan ─────────────────────────────────
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
  v_plan_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT fp.academy_id, b.branch_id INTO v_plan_academy, v_plan_branch
  FROM fee_plans fp LEFT JOIN batches b ON b.id = fp.batch_id
  WHERE fp.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fee plan not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy fee plan edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_plan_branch);

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


-- ── secure_delete_fee_plan ─────────────────────────────────
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
  v_plan_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  SELECT fp.academy_id, b.branch_id INTO v_plan_academy, v_plan_branch
  FROM fee_plans fp LEFT JOIN batches b ON b.id = fp.batch_id
  WHERE fp.id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_plan_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_plan_branch);

  DELETE FROM fee_plans WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_fee_plan(BIGINT, TEXT) TO anon, authenticated;

COMMIT;
