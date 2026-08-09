-- ============================================================
-- 0140 — Public trial funnel: allow anon to READ branches/batches
-- ============================================================
-- WHAT
--   Drops the `auth.uid() IS NULL -> raise` guard from the two READ-only
--   funnel RPCs so a prospect can browse sports / branches / batches BEFORE
--   completing phone-OTP (the redesigned /join funnel lets people tap
--   "Skip for now" and browse first, then verifies with OTP at submit time).
--
--     • secure_public_trial_branches_v2(p_slug)
--     • secure_public_trial_batches_v2(p_slug, p_branch_id)
--
--   Bodies are copied verbatim from 0139 (which was itself verified against
--   the LIVE pg_get_functiondef, not reconstructed) — the ONLY change is the
--   removal of the auth gate. Every cross-tenant validation check
--   (academy/branch/sport ownership) is kept exactly as-is.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--   secure_submit_public_trial_v2 is UNCHANGED and still hard-requires
--   auth.uid(). The trial's phone is still derived server-side from the
--   verified OTP session (never a client param), and the 4/day per-phone
--   anti-spam cap is intact. Writes stay OTP-gated; only public read data
--   (sport names, branch names, batch seat counts) becomes anon-readable.
--
-- WHY IN-PLACE CREATE OR REPLACE (not new _v3 names)
--   Unlike 0139 (which changed behaviour AND was called by an already-shipped
--   APK, so needed new names to avoid a mid-deploy signature break), this
--   change keeps the exact same signatures and only makes the functions MORE
--   permissive. An anon call that previously raised now succeeds; an
--   authenticated call behaves identically. There is no call site that breaks
--   during the deploy window, so replacing in place is safe.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── secure_public_trial_branches_v2 — anon-readable ───────────
CREATE OR REPLACE FUNCTION secure_public_trial_branches_v2(p_slug TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT id, sport_name, branch_name, photo_url
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches_v2(TEXT) TO anon, authenticated;

-- ── secure_public_trial_batches_v2 — anon-readable ────────────
CREATE OR REPLACE FUNCTION secure_public_trial_batches_v2(p_slug TEXT, p_branch_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_academy UUID;
  v_sport   TEXT;
BEGIN
  SELECT academy_id, sport_name INTO v_academy, v_sport
  FROM sport_branches WHERE id = p_branch_id;

  IF NOT FOUND OR v_academy IS DISTINCT FROM _public_trial_academy_id_v2(p_slug) THEN
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

GRANT EXECUTE ON FUNCTION secure_public_trial_batches_v2(TEXT, UUID) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit, as anon):
-- ============================================================
--   SELECT secure_public_trial_branches_v2('ara');        -- returns rows, no "authentication required"
--   -- pick a branch id from the above, then:
--   SELECT secure_public_trial_batches_v2('ara', '<branch-uuid>');
--   -- submit must STILL reject anon:
--   SELECT secure_submit_public_trial_v2('ara', '<branch-uuid>'); -- expect 'authentication required'
