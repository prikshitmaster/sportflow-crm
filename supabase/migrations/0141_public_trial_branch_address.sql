-- ============================================================
-- 0141 — Expose sport_branches.address on the public trial funnel
-- ============================================================
-- WHAT
--   secure_public_trial_branches_v2(p_slug) now also returns `address` —
--   already a real, owner-editable column (insertSportBranch/
--   updateSportBranch in db.js have written it for a while), just never
--   surfaced to the public /join funnel. Purely additive: one more column
--   in the SELECT list, same signature, same anon grant (see 0140).
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

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
      SELECT id, sport_name, branch_name, photo_url, address
      FROM sport_branches
      WHERE academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY branch_name, sport_name
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_public_trial_branches_v2(TEXT) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Post-migration verification:
-- ============================================================
--   SELECT secure_public_trial_branches_v2('ara'); -- rows now include "address"
