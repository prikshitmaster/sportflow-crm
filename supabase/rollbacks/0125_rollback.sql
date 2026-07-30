-- ============================================================
-- 0125 ROLLBACK — restore pre-trial-fee RPCs
-- ============================================================
-- Restores secure_insert_trial / secure_update_trial /
-- secure_delete_trial to their 0051 definitions, secure_insert_payment
-- to 0035, and secure_delete_payment to security-v3/02, then drops the
-- link RPC.
--
-- Existing trial payment rows are NOT deleted here — run
-- 0126_rollback.sql (or 0124_rollback.sql) for that.
-- ============================================================

DROP FUNCTION IF EXISTS secure_link_trial_payment(BIGINT, BIGINT, TEXT);


-- ── secure_insert_trial → 0051 definition ────────────────────
CREATE OR REPLACE FUNCTION secure_insert_trial(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a    RECORD;
  v_id BIGINT;
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


-- ── secure_delete_trial → 0051 definition ────────────────────
CREATE OR REPLACE FUNCTION secure_delete_trial(
  p_trial_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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


-- ── secure_delete_payment → security-v3/02 definition ────────
CREATE OR REPLACE FUNCTION secure_delete_payment(
  p_payment_id TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                RECORD;
  v_pay_academy    UUID;
  v_student_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT COALESCE(p.academy_id, s.academy_id), s.branch_id
    INTO v_pay_academy, v_student_branch
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;
  IF v_pay_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  DELETE FROM payments WHERE id = p_payment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_payment(TEXT, TEXT) TO anon, authenticated;

-- NOTE: secure_update_trial and secure_insert_payment are left at their
-- 0125 definitions. Both are backward compatible — secure_update_trial's
-- sync block is a no-op once payments.trial_id is gone (0124_rollback
-- drops the column, which drops the sync targets), and
-- secure_insert_payment's only change is normalising 'trial' to
-- 'monthly', which is exactly what the narrowed CHECK requires anyway.
-- Re-apply 0051 / 0035 verbatim if you need them byte-identical.
