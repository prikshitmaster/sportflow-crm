-- 0179 — SECURITY: secure_claim_parent_account trusted a caller-supplied phone
--
-- THE HOLE: the function bound auth.uid() to whatever `parents` row matched the
-- p_phone ARGUMENT. That argument is chosen by the caller and was never compared
-- against the caller's own verified number — the body never referenced auth.jwt()
-- at all. Any account that could complete a phone OTP (the public /join funnel
-- lets any member of the public do exactly that) could therefore claim any
-- UNCLAIMED parent record and read that family's children through
-- secure_get_parent_dashboard().
--
-- Reproduced against production (rolled back) before this fix: a session
-- verified as 919111100000, with no parent row of its own, successfully claimed
-- the parent record for 6471512591. A session with NO phone claim at all also
-- succeeded. At the time of writing all 46 parent rows were unclaimed, so all 46
-- were takeable. Single-academy today, so parent<->parent; it becomes
-- cross-tenant as soon as a second academy onboards parents.
--
-- THE FIX: match on the phone Supabase Auth actually verified — the top-level
-- `phone` claim — and never on the argument.
--
-- Why NOT user_metadata: a signed-in user can rewrite their own user_metadata
-- via auth.updateUser({data:…}), so `user_metadata.phone` is attacker-controlled
-- and using it would hand back the exact hole this closes. Only the top-level
-- claim is set by the OTP flow and not user-writable.
--
-- p_phone is KEPT in the signature (db.js:3311 passes it) but is now only
-- allowed to agree with the verified number — a mismatch is an explicit 42501
-- rather than a silent substitution, so a confused client fails loudly.
--
-- Phone formats differ: parents.phone is 10-digit ('6471512591'),
-- auth.users.phone is country-coded ('919979369521'). Both sides are reduced to
-- digits-only and compared on the last 10.
--
-- KNOWN FOLLOW-UP (not a regression, pre-existing): if one verified phone
-- matches parent rows in several academies, this still claims the OLDEST. There
-- are 0 such collisions today, but 10 student phone numbers already span
-- academies, so a disambiguation step will be needed before parents are
-- onboarded at a second academy.
--
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_claim_parent_account(p_phone text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_row       parents%ROWTYPE;
  v_verified  TEXT;
  v_requested TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'must be authenticated' USING ERRCODE = '42501';
  END IF;

  -- The only trustworthy phone: the one the OTP flow verified.
  v_verified := right(regexp_replace(COALESCE(auth.jwt() ->> 'phone', ''), '\D', '', 'g'), 10);
  IF length(v_verified) <> 10 THEN
    RAISE EXCEPTION 'a phone-verified session is required to claim a parent account'
      USING ERRCODE = '42501';
  END IF;

  -- Argument may agree with the verified number, or be omitted. Never override it.
  v_requested := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  IF v_requested <> '' AND v_requested IS DISTINCT FROM v_verified THEN
    RAISE EXCEPTION 'forbidden: that is not your verified phone number'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM parents
   WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_verified
     AND (auth_user_id IS NULL OR auth_user_id = v_uid)
   ORDER BY created_at
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no parent record found for this phone — ask the academy to add you'
      USING ERRCODE = '42501';
  END IF;

  UPDATE parents
     SET auth_user_id = v_uid,
         updated_at   = NOW()
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_claim_parent_account(text) TO anon, authenticated;

COMMIT;
