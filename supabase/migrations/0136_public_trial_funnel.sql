-- ============================================================
-- 0136 — Public trial self-enrollment funnel (Ahmedabad Racquet Academy)
-- ============================================================
-- WHAT
--   • trials gets 4 new nullable columns: emergency_contact_name,
--     emergency_contact_phone, medical_notes, document_path
--   • storage bucket 'trial-documents' — same pattern as student-documents
--     (0103): public bucket, unguessable path, real access control is
--     "you can't download what you can't list," not storage RLS (a public
--     bucket's public-URL route bypasses storage.objects RLS entirely, so
--     matching the existing permissive-policy convention here is honest
--     about the actual security model, not a downgrade from it).
--   • _public_trial_academy_id() — hardcoded single-academy constant.
--     Every new RPC below uses this instead of trusting a client-supplied
--     academy_id, which removes cross-tenant injection as a whole class
--     of bug rather than validating it after the fact.
--   • Three new SECURITY DEFINER RPCs for the OTP-verified-but-otherwise-
--     anonymous prospect actor (real Supabase Auth JWT via phone OTP,
--     same mechanism ParentLogin.jsx already uses — but this actor has no
--     profiles/staff/students row, so existing RLS on sport_branches/
--     batches/academies never matches them; same shape of problem
--     secure_get_parent_dashboard already solves for parents):
--       secure_public_trial_branches()            — read
--       secure_public_trial_batches(p_branch_id)   — read
--       secure_submit_public_trial(...)            — write
--
-- WHY secure_submit_public_trial DOES ITS OWN PLAIN INSERT
--   secure_insert_trial (0125) auto-books a `payments` row whenever
--   trial_fee_mode <> 'Not collected' — see 0125_trial_fee_rpcs.sql:112.
--   This RPC hardcodes trial_fee_mode = 'Not collected' and never touches
--   `payments` at all, so no code path here can book unearned revenue.
--   Staff collect the fee in person later; secure_update_trial's existing
--   lazy-create (0 -> N) logic books it correctly at that point, unchanged.
--
-- SECURITY DESIGN — phone/academy/branch/batch are never trusted from the
-- client for the write RPC:
--   • phone   — derived from auth.users via auth.uid(), never a parameter
--   • academy — resolved from p_branch_id via sport_branches, must match
--               _public_trial_academy_id() or the call is rejected
--   • batch   — if given, must actually belong to that branch+academy+sport
--
-- IDEMPOTENT — safe to re-run.
--
-- _public_trial_academy_id() is hardcoded to the real "ARA" academy
-- (cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf), confirmed via direct query
-- against live data (503 students / 10 branches) vs. a decoy "ara"
-- academy (31 students / 1 branch) — not guessed.
-- ============================================================

BEGIN;

-- ── 1. New columns on trials ─────────────────────────────────
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS medical_notes           TEXT,
  ADD COLUMN IF NOT EXISTS document_path           TEXT;

COMMENT ON COLUMN trials.emergency_contact_name  IS 'Public self-enrollment: contact distinct from the OTP-verified phone (grandparent, neighbour, etc).';
COMMENT ON COLUMN trials.emergency_contact_phone IS 'Public self-enrollment: emergency contact number, separate from trials.phone.';
COMMENT ON COLUMN trials.medical_notes           IS 'Self-reported by the submitter at signup, unverified. Kept separate from `notes` (staff-owned) on purpose.';
COMMENT ON COLUMN trials.document_path            IS 'Storage object path in the trial-documents bucket, e.g. ID/medical photo. Optional.';

-- ── 2. Storage bucket for the optional document photo ────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('trial-documents', 'trial-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'trial-documents open access'
  ) THEN
    CREATE POLICY "trial-documents open access"
      ON storage.objects
      FOR ALL
      USING (bucket_id = 'trial-documents')
      WITH CHECK (bucket_id = 'trial-documents');
  END IF;
END $$;

-- ── 3. Single-academy constant ────────────────────────────────
CREATE OR REPLACE FUNCTION _public_trial_academy_id()
RETURNS UUID
LANGUAGE SQL IMMUTABLE
AS $$
  -- "ARA" — confirmed the real, live Ahmedabad Racquet Academy (503 students,
  -- 10 branches, 32 batches as of this migration) vs. a decoy "ara" academy
  -- with only 31 students / 1 branch. Checked via direct query, not assumed.
  SELECT 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'::UUID
$$;

-- ── 4. secure_public_trial_branches — read RPC ────────────────
-- No params. Requires a completed OTP session (auth.uid() present) per
-- the "OTP before browsing" design; returns this academy's branch/sport
-- rows. sport_branches.id already uniquely encodes one
-- (academy, sport, branch) triple (UNIQUE constraint, 0016b), so the
-- client only ever needs to carry this one id forward.
CREATE OR REPLACE FUNCTION secure_public_trial_branches()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT id, sport_name, branch_name
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id()
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches() TO anon, authenticated;

-- ── 5. secure_public_trial_batches — read RPC ─────────────────
-- Validates p_branch_id resolves to this academy before returning
-- anything. A batch's branch_id only corresponds to its PRIMARY sport
-- (sports[1], see 0017b_branch_isolation.sql:118-126) even though
-- sports[] can list more than one — so match sport independently via
-- unnest(), don't assume branch_id alone implies the sport. Seats-left
-- uses the same Math.max(0, capacity - enrolled) formula as Batches.jsx.
CREATE OR REPLACE FUNCTION secure_public_trial_batches(p_branch_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_academy UUID;
  v_sport   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id() THEN
    RAISE EXCEPTION 'invalid branch' USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT
        b.id, b.name, b.days, b.start_time, b.end_time,
        b.capacity, b.waitlist,
        GREATEST(0, b.capacity - COALESCE(cnt.n, 0)) AS seats_left
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, COUNT(*) AS n
        FROM student_batches
        GROUP BY batch_id
      ) cnt ON cnt.batch_id = b.id
      WHERE b.branch_id = p_branch_id
        AND b.academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(b.sports) s WHERE lower(s) = lower(v_sport))
      ORDER BY b.name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_batches(UUID) TO anon, authenticated;

-- ── 6. secure_submit_public_trial — the write RPC ─────────────
CREATE OR REPLACE FUNCTION secure_submit_public_trial(
  p_branch_id                UUID,
  p_batch_id                 BIGINT DEFAULT NULL,
  p_name                     TEXT   DEFAULT NULL,
  p_parent_name              TEXT   DEFAULT NULL,
  p_emergency_contact_name   TEXT   DEFAULT NULL,
  p_emergency_contact_phone  TEXT   DEFAULT NULL,
  p_dob                      DATE   DEFAULT NULL,
  p_age                      INT    DEFAULT NULL,
  p_medical_notes            TEXT   DEFAULT NULL,
  p_document_path            TEXT   DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_phone   TEXT;
  v_academy UUID;
  v_sport   TEXT;
  v_id      BIGINT;
  v_name    TEXT;
  v_parent  TEXT;
BEGIN
  -- Only real gate that matters: a completed phone-OTP Supabase Auth session.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Phone is always the server-verified OTP number, never a client param.
  SELECT phone INTO v_phone FROM auth.users WHERE id = v_uid;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'no verified phone on this session' USING ERRCODE = '42501';
  END IF;

  -- Resolve academy/sport from the branch id and reject anything that
  -- doesn't match this academy — the cross-tenant guard.
  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id() THEN
    RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
  END IF;

  -- If a batch was picked, verify it actually belongs to this
  -- branch+academy+sport before accepting it.
  IF p_batch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM batches
      WHERE id = p_batch_id
        AND branch_id = p_branch_id
        AND academy_id = v_academy
        AND EXISTS (SELECT 1 FROM unnest(sports) s WHERE lower(s) = lower(v_sport))
    ) THEN
      RAISE EXCEPTION 'invalid batch for this branch' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_name   := NULLIF(TRIM(p_name), '');
  v_parent := NULLIF(TRIM(p_parent_name), '');
  IF v_name IS NULL OR v_parent IS NULL THEN
    RAISE EXCEPTION 'name and parent name are required' USING ERRCODE = '22023';
  END IF;

  -- Light anti-spam guard: nothing else rate-limits this public endpoint.
  IF (
    SELECT COUNT(*) FROM trials
    WHERE phone = v_phone AND academy_id = v_academy
      AND created_at > now() - interval '1 day'
  ) >= 4 THEN
    RAISE EXCEPTION 'too many submissions — please contact the academy directly' USING ERRCODE = '22023';
  END IF;

  INSERT INTO trials (
    name, parent, phone, age, dob, sport, trial_date, source, status, stage,
    batch_id, trial_sessions, sessions_done, converted, program_type,
    trial_fee_paid, trial_fee_mode, academy_id, branch_id,
    emergency_contact_name, emergency_contact_phone, medical_notes, document_path
  ) VALUES (
    v_name, v_parent, v_phone, p_age, p_dob, v_sport, CURRENT_DATE,
    'App', 'Scheduled', 'new',
    p_batch_id, 1, 0, false, 'academy',
    590, 'Not collected', v_academy, p_branch_id,
    NULLIF(TRIM(p_emergency_contact_name), ''),
    NULLIF(TRIM(p_emergency_contact_phone), ''),
    NULLIF(TRIM(p_medical_notes), ''),
    NULLIF(TRIM(p_document_path), '')
  )
  RETURNING id INTO v_id;

  RETURN (SELECT row_to_json(t) FROM trials t WHERE t.id = v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_submit_public_trial(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, INT, TEXT, TEXT
) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT proname FROM pg_proc WHERE proname LIKE 'secure_public_trial%' OR proname = '_public_trial_academy_id';
-- SELECT id, public FROM storage.buckets WHERE id = 'trial-documents';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'trials' AND column_name IN
--   ('emergency_contact_name','emergency_contact_phone','medical_notes','document_path');
