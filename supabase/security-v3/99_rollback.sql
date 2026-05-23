-- security-v3 / rollback — Revert Phase 1
--
-- Reverts:
--   1. current_actor() to its 4-column shape (drops branch_id from RETURNS)
--   2. Drops _require_branch_scope helper
--   3. RPCs in 02/03 must be reverted by re-applying the original migrations:
--        supabase/migrations/0033_secure_delete_rpcs.sql
--        supabase/migrations/0035_secure_insert_payment.sql
--        supabase/migrations/0037_secure_update_payment.sql
--        supabase/migrations/0039_secure_update_student.sql
--        supabase/migrations/0049_secure_batch_write.sql
--        supabase/migrations/0051_secure_trials_feeplans_announcements.sql
--        supabase/migrations/0053_secure_all_remaining_writes.sql (assessment + goals)
--        supabase/migrations/0056_announcement_sport_branch.sql
--      The 4 attendance RPCs (0072) already encode their own branch checks
--      — they were Phase 0 and don't depend on _require_branch_scope.
--
-- The RPC rollback isn't bundled here because re-running the original
-- migrations is the simplest, safest way (each is idempotent).
-- Run `node scripts/db-fast.mjs apply <file>` for each in order.

BEGIN;

DROP FUNCTION IF EXISTS _require_branch_scope(TEXT, UUID, UUID);

DROP FUNCTION IF EXISTS current_actor(TEXT);

CREATE OR REPLACE FUNCTION current_actor(p_token TEXT DEFAULT NULL)
RETURNS TABLE (
  actor_kind  TEXT,
  actor_id    BIGINT,
  academy_id  UUID,
  perms       JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    RETURN QUERY
      SELECT 'owner'::TEXT, NULL::BIGINT, p.academy_id, NULL::JSONB
      FROM profiles p WHERE p.id = v_uid LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_token IS NOT NULL AND length(p_token) > 0 THEN
    RETURN QUERY
      SELECT 'staff'::TEXT, ss.staff_id, st.academy_id, COALESCE(sa.permissions::JSONB, '[]'::JSONB)
      FROM staff_sessions ss
      JOIN staff st        ON st.id = ss.staff_id
      LEFT JOIN staff_auth sa ON sa.staff_id = st.id
      WHERE ss.token = p_token AND (ss.expires_at IS NULL OR ss.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    RETURN QUERY
      SELECT 'student'::TEXT, sst.student_id, s.academy_id, NULL::JSONB
      FROM student_sessions sst
      JOIN students s ON s.id = sst.student_id
      WHERE sst.token = p_token AND (sst.expires_at IS NULL OR sst.expires_at > now())
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN;
END;
$$;
GRANT EXECUTE ON FUNCTION current_actor(TEXT) TO anon, authenticated;

COMMIT;
