-- security-v3 / 01 — Extend current_actor() with branch_id + branch-check helper
--
-- Drops + recreates current_actor() with one extra column (branch_id).
-- All existing callers (`SELECT * INTO a FROM current_actor(...)`) keep working
-- — they now also see a.branch_id (NULL for owners and unassigned staff).
--
-- Adds _require_branch_scope() — raises 42501 if a branch-scoped staff tries
-- to act on a row outside their branch. Owners and NULL-branch staff bypass.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- current_actor — adds branch_id to the returned row
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS current_actor(TEXT);

CREATE OR REPLACE FUNCTION current_actor(p_token TEXT DEFAULT NULL)
RETURNS TABLE (
  actor_kind  TEXT,
  actor_id    BIGINT,
  academy_id  UUID,
  perms       JSONB,
  branch_id   UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID;
BEGIN
  -- 1. Owner JWT
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    RETURN QUERY
      SELECT 'owner'::TEXT, NULL::BIGINT, p.academy_id, NULL::JSONB, NULL::UUID
      FROM profiles p WHERE p.id = v_uid LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Staff session token
  IF p_token IS NOT NULL AND length(p_token) > 0 THEN
    RETURN QUERY
      SELECT 'staff'::TEXT, ss.staff_id, st.academy_id,
             COALESCE(sa.permissions::JSONB, '[]'::JSONB),
             st.branch_id
      FROM staff_sessions ss
      JOIN staff st        ON st.id = ss.staff_id
      LEFT JOIN staff_auth sa ON sa.staff_id = st.id
      WHERE ss.token = p_token
        AND (ss.expires_at IS NULL OR ss.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;

  -- 3. Student session token
    RETURN QUERY
      SELECT 'student'::TEXT, sst.student_id, s.academy_id, NULL::JSONB, s.branch_id
      FROM student_sessions sst
      JOIN students s ON s.id = sst.student_id
      WHERE sst.token = p_token
        AND (sst.expires_at IS NULL OR sst.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN;
END;
$$;
GRANT EXECUTE ON FUNCTION current_actor(TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- _require_branch_scope — branch isolation gate
--
-- Raises 42501 if a branch-scoped actor (staff with branch_id set) tries
-- to act on a row in a different branch. Owner + branch-less staff bypass.
-- A target row with NULL branch_id is always allowed (unassigned data).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION _require_branch_scope(
  p_actor_kind   TEXT,
  p_actor_branch UUID,
  p_target_branch UUID
) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Owners bypass branch scope (they manage the entire academy)
  IF p_actor_kind = 'owner' THEN RETURN; END IF;
  -- Actors without a branch assignment (office staff) are academy-wide
  IF p_actor_branch IS NULL THEN RETURN; END IF;
  -- Targets without a branch are allowed (unassigned / academy-wide rows)
  IF p_target_branch IS NULL THEN RETURN; END IF;
  -- Branch-scoped actor + branch-tagged target → must match
  IF p_target_branch IS DISTINCT FROM p_actor_branch THEN
    RAISE EXCEPTION 'forbidden: cross-branch action blocked' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMIT;
