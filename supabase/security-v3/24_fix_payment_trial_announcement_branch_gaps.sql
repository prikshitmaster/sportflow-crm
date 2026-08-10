-- security-v3 / 24 — Close three branch/permission gaps found by a live QA
-- audit (2026-08-10), each confirmed by actually calling the RPC as a
-- branch-scoped staff token against an isolated test academy:
--
--   1. secure_insert_payment    — had NO branch check at all (only academy).
--      A coach in one branch (even a different sport) could record a
--      payment against a student in a completely different branch. Every
--      sibling payment RPC (update/delete) already has this check; insert
--      lost it when 0129_payment_coverage_end.sql rebuilt the function body
--      from an older pre-branch-check version (0125) instead of the
--      security-v3/02 version that had the guard. Also adds a floor on
--      `amount` — 0, negative, and absurd values were all being accepted.
--
--   2. secure_link_trial_payment — same missing-branch-check shape: a coach
--      could link their own branch's trial onto ANOTHER branch's student,
--      reassigning that student's payment/conversion record cross-branch.
--
--   3. secure_insert_announcement — the live 9-parameter (audience-aware)
--      overload never checked the `community.manage` ("Post Announcements")
--      permission at all, and never forced branch-scoped staff into their
--      own branch (unlike the immediately-prior 7-parameter overload, whose
--      branch-forcing logic was dropped when audience targeting was added).
--      Confirmed live: a staff member with community.manage explicitly
--      withheld posted an academy-wide announcement and set an arbitrary
--      branch_id belonging to a different branch. The two now-superseded
--      overloads (5-param, 7-param) are dropped — db.js only ever calls the
--      9-param version (verified: only caller in the repo).
--
-- Signatures of the functions we KEEP are unchanged. IDEMPOTENT — safe to
-- re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 1. secure_insert_payment — add branch check + amount floor
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_insert_payment(p_payload jsonb, p_token text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_academy_id      UUID;
  v_payment_id      TEXT;
  v_student_id      BIGINT;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_payment_type    TEXT;
  v_amount          NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);

  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
    FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  v_amount := NULLIF(p_payload->>'amount','')::NUMERIC;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  -- 'custom' is a UI-only concept; 'trial' is reserved for trial-originated
  -- rows. Both normalise to 'monthly' here.
  v_payment_type := COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly');
  IF v_payment_type IN ('custom', 'trial') THEN
    v_payment_type := 'monthly';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start, coverage_end,
    academy_id, notes
  ) VALUES (
    v_payment_id,
    v_student_id,
    p_payload->>'student',
    v_amount,
    p_payload->>'month',
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    v_payment_type,
    COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0),
    COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1),
    NULLIF(p_payload->>'coverageStart','')::DATE,
    NULLIF(p_payload->>'coverageEnd','')::DATE,
    v_academy_id,
    p_payload->>'notes'
  );

  RETURN v_payment_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_insert_payment(jsonb, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. secure_link_trial_payment — add branch check on both sides
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_link_trial_payment(p_trial_id bigint, p_student_id bigint, p_token text DEFAULT NULL::text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_trial_academy   UUID;
  v_trial_branch    UUID;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_amount          NUMERIC;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden: students cannot perform this action' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind <> 'owner'
     AND NOT (a.perms ? 'trials.manage' OR a.perms ? 'students.manage') THEN
    RAISE EXCEPTION 'forbidden: trials.manage or students.manage required'
      USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_trial_academy, v_trial_branch     FROM trials   WHERE id = p_trial_id;
  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch FROM students WHERE id = p_student_id;

  IF v_trial_academy IS NULL OR v_student_academy IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id
     OR v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy link blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch);
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  UPDATE payments
     SET student_id = p_student_id
   WHERE trial_id = p_trial_id
     AND student_id IS NULL;

  -- The actual "which student did this trial become" back-link — powers
  -- the public Profile tab's joining-code/activation display.
  UPDATE trials SET converted_student_id = p_student_id WHERE id = p_trial_id;

  SELECT amount INTO v_amount FROM payments WHERE trial_id = p_trial_id;

  RETURN v_amount;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_link_trial_payment(bigint, bigint, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. secure_insert_announcement — permission check + branch forcing on the
--    live 9-param overload; drop the two superseded overloads (dead code,
--    no callers left — verified against src/lib/db.js and supabase/functions).
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.secure_insert_announcement(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.secure_insert_announcement(text, text, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.secure_insert_announcement(
  p_title text, p_body text, p_type text, p_author text DEFAULT NULL::text,
  p_token text DEFAULT NULL::text, p_sport text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT NULL::uuid, p_audience_type text DEFAULT 'all'::text,
  p_audience_ids jsonb DEFAULT '[]'::jsonb
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a            RECORD;
  v_branch_id  UUID;
  v_row        announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  -- _require_perm already rejects NULL (unauthenticated) and 'student' actors,
  -- lets 'owner' through unconditionally, and checks the JSONB perms array
  -- for staff — same pattern as every other secure_insert_* RPC.
  PERFORM _require_perm(a.actor_kind, a.perms, 'community.manage');

  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch_id := a.branch_id;
  ELSE
    v_branch_id := p_branch_id;
  END IF;

  INSERT INTO announcements (title, body, type, author, date, academy_id, sport, branch_id,
                             audience_type, audience_ids)
  VALUES (
    p_title,
    p_body,
    p_type,
    COALESCE(NULLIF(p_author,''), 'Admin'),
    public.ist_today(),
    a.academy_id,
    NULLIF(p_sport, ''),
    v_branch_id,
    COALESCE(NULLIF(p_audience_type, ''), 'all'),
    COALESCE(p_audience_ids, '[]'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_insert_announcement(text, text, text, text, text, text, uuid, text, jsonb) TO anon, authenticated;

COMMIT;
