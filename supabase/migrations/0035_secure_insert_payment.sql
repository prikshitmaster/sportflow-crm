-- ============================================================
-- 0035 — Phase 2 Stage 3: secure payment INSERT
-- ============================================================
-- WHY
--   Stages 1+2 closed the anon DELETE attack surface on the 4 highest-
--   risk tables. INSERT is still wide-open via the anon_all policy for
--   the rest, including payments — meaning a coach with the anon key
--   can fabricate paid invoices via DevTools:
--     supabase.from('payments').insert({ student_id, amount, status: 'Paid', ... })
--   That's financial fraud. This migration adds a SECURITY DEFINER RPC
--   that gates payment inserts behind current_actor() validation and
--   the payments.manage perm.
--
-- WHAT THIS DOES NOT DO YET
--   Doesn't remove the anon INSERT permission from the payments table.
--   Stage 4 will do that (drop anon_insert policy on payments) so the
--   RPC becomes the only path. Until then, this RPC is just an
--   alternative path that the app uses; raw anon inserts still succeed.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION secure_insert_payment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a              RECORD;
  v_academy_id   UUID;
  v_payment_id   TEXT;
  v_student_id   BIGINT;
  v_student_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  -- Resolve academy from payload OR fall back to the actor's academy.
  -- This way owners/staff can omit academyId from the payload and it
  -- gets stamped server-side, while attackers can't override it.
  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  -- Verify the referenced student also belongs to the actor's academy.
  -- Prevents a coach from inserting payments against a different academy's
  -- students even when the payload claims their own academy.
  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id INTO v_student_academy FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start,
    academy_id, notes
  ) VALUES (
    v_payment_id,
    v_student_id,
    p_payload->>'student',
    NULLIF(p_payload->>'amount','')::NUMERIC,
    p_payload->>'month',
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly'),
    COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0),
    COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1),
    NULLIF(p_payload->>'coverageStart','')::DATE,
    v_academy_id,
    p_payload->>'notes'
  );

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_payment(JSONB, TEXT) TO anon, authenticated;
