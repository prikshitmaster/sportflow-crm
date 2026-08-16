-- 0160 — Batch Code becomes required (on create) and unique (per academy)
--
-- The Create/Edit Batch form has always labelled this field "(Optional)"
-- and neither secure_insert_batch nor secure_update_batch validated it —
-- two batches at the same academy could carry the same code, or none at
-- all. Now that student registration shows the code as the batch's primary
-- label (rather than its full name), a blank or duplicate code is no
-- longer just cosmetic — it makes two different batches indistinguishable
-- in that picker.
--
-- SCOPE, DELIBERATELY ASYMMETRIC (no backfill — same principle as 0159):
--   • NEW batches (secure_insert_batch): code is now REQUIRED.
--   • EXISTING batches (secure_update_batch): code stays optional on edit —
--     25 of 45 live batches have none today, and forcing every unrelated
--     edit (renaming a batch, changing its coach) to fail until someone
--     retroactively assigns a code would be a worse regression than the
--     problem being fixed. If a code IS supplied on either path, it must
--     be unique — that part applies uniformly.
--   • The 20 existing coded batches were verified already pairwise-unique
--     per academy before writing this (checked via SQL), so the index
--     below is safe to add with zero pre-existing violations.
--
-- Codes are matched case-insensitively (lower(code)) — the client already
-- lowercases on input (Batches.jsx), this just makes the DB agree.
--
-- Bodies otherwise byte-identical to the live functions (verified via
-- pg_get_functiondef before writing this) — every existing check (perm,
-- branch, capacity, age range, batch_type) is preserved exactly; only the
-- code checks were added. Signatures UNCHANGED on both — plain CREATE OR
-- REPLACE, no DROP, no PostgREST overload risk.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ── 1. Uniqueness, case-insensitive, per academy, only where a code exists ──
CREATE UNIQUE INDEX IF NOT EXISTS batches_academy_code_unique
  ON batches (academy_id, lower(code))
  WHERE code IS NOT NULL AND code <> '';

-- ── 2. secure_insert_batch — code required + unique ────────
CREATE OR REPLACE FUNCTION public.secure_insert_batch(
  p_token text, p_name text, p_time text DEFAULT NULL::text, p_sports jsonb DEFAULT '[]'::jsonb,
  p_coach text DEFAULT NULL::text, p_capacity integer DEFAULT 30, p_days jsonb DEFAULT '[]'::jsonb,
  p_start_time text DEFAULT NULL::text, p_end_time text DEFAULT NULL::text, p_age_min integer DEFAULT 0,
  p_age_max integer DEFAULT 99, p_ground text DEFAULT NULL::text, p_code text DEFAULT NULL::text,
  p_default_fee integer DEFAULT 0, p_default_plan text DEFAULT 'monthly'::text, p_branch_id uuid DEFAULT NULL::uuid,
  p_batch_type text DEFAULT 'development'::text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a           RECORD;
  v_branch_id UUID;
  v_type      TEXT;
  v_code      TEXT;
  v_row       batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — no academy context' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  v_branch_id := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch required — open a specific branch before creating a batch'
      USING ERRCODE = '23502';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Batch name is required' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_capacity, 0) <= 0 THEN
    RAISE EXCEPTION 'Capacity must be greater than zero' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_default_fee, 0) < 0 THEN
    RAISE EXCEPTION 'Default fee cannot be negative' USING ERRCODE = '23514';
  END IF;
  IF p_age_min IS NOT NULL AND p_age_max IS NOT NULL AND p_age_min > p_age_max THEN
    RAISE EXCEPTION 'age_min cannot be greater than age_max' USING ERRCODE = '23514';
  END IF;

  v_type := lower(COALESCE(NULLIF(trim(p_batch_type), ''), 'development'));
  IF v_type NOT IN ('development', 'advance') THEN
    RAISE EXCEPTION 'batch_type must be development or advance' USING ERRCODE = '23514';
  END IF;

  v_code := NULLIF(trim(p_code), '');
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Batch code is required' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM batches WHERE academy_id = a.academy_id AND lower(code) = lower(v_code)
  ) THEN
    RAISE EXCEPTION 'Batch code "%" is already used by another batch', v_code USING ERRCODE = '23505';
  END IF;

  INSERT INTO batches (
    name, time, sports, coach, capacity, enrolled, waitlist,
    days, start_time, end_time, age_min, age_max, ground, code,
    default_fee, default_plan, batch_type, academy_id, branch_id
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
    v_code,
    COALESCE(p_default_fee, 0),
    COALESCE(p_default_plan, 'monthly'),
    v_type,
    a.academy_id,
    v_branch_id
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_insert_batch(
  text, text, text, jsonb, text, integer, jsonb, text, text, integer, integer, text, text, integer, text, uuid, text
) TO anon, authenticated;

-- ── 3. secure_update_batch — code stays optional, but unique if given ──
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
  v_new_code      TEXT;
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

  IF p_payload ? 'batchType'
     AND lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development'))
         NOT IN ('development', 'advance')
  THEN
    RAISE EXCEPTION 'batch_type must be development or advance' USING ERRCODE = '23514';
  END IF;

  -- Not required on edit (no backfill), but a non-blank code must stay
  -- unique within the academy, excluding this batch's own current row.
  IF p_payload ? 'code' THEN
    v_new_code := NULLIF(trim(p_payload->>'code'), '');
    IF v_new_code IS NOT NULL AND EXISTS (
      SELECT 1 FROM batches
      WHERE academy_id = v_batch_academy AND lower(code) = lower(v_new_code) AND id <> p_batch_id
    ) THEN
      RAISE EXCEPTION 'Batch code "%" is already used by another batch', v_new_code USING ERRCODE = '23505';
    END IF;
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
    code         = CASE WHEN p_payload ? 'code'        THEN v_new_code                                    ELSE code         END,
    default_fee  = CASE WHEN p_payload ? 'defaultFee'  THEN COALESCE((p_payload->>'defaultFee')::INTEGER, 0)  ELSE default_fee  END,
    default_plan = CASE WHEN p_payload ? 'defaultPlan' THEN COALESCE(p_payload->>'defaultPlan', 'monthly')    ELSE default_plan END,
    batch_type   = CASE WHEN p_payload ? 'batchType'   THEN lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development')) ELSE batch_type END,
    branch_id    = CASE WHEN p_payload ? 'branchId'    THEN NULLIF(p_payload->>'branchId','')::UUID            ELSE branch_id    END
  WHERE id = p_batch_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_batch(BIGINT, JSONB, TEXT) TO anon, authenticated;

COMMIT;
