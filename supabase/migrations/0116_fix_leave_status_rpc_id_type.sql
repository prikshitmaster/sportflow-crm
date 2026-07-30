-- ============================================================
-- 0116 — Fix secure_update_leave_status: p_id was BIGINT, ids are UUID
-- ============================================================
-- SYMPTOM
--   Approving or rejecting any leave request fails with:
--     invalid input syntax for type bigint: "657d8b50-8636-4bb1-ac50-a5f47d43ec25"
--
-- CAUSE
--   leave_requests.id has been `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
--   since schema_v3.sql and was never altered. But 0053 declared the RPC as
--   secure_update_leave_status(p_id BIGINT, ...), so PostgREST tries to coerce
--   the row's UUID into a bigint and dies before the function body ever runs.
--   Approve/Reject has therefore never worked from the owner dashboard or the
--   Staff page — it only became visible once there were leave rows to click.
--
-- FIX
--   Take p_id as TEXT and compare on id::text. That is deliberate: it works
--   whether this database's leave_requests.id is uuid (expected) or bigint
--   (older installs), so the migration is safe to apply anywhere without
--   first inspecting the column type. The table is tiny, so losing the PK
--   index on this one UPDATE costs nothing.
--
--   The old BIGINT overload is DROPped rather than left in place — with both
--   present PostgREST cannot choose between the candidates and every call
--   would fail with "Could not choose the best candidate function".
--
-- Owner-only authorisation is unchanged from 0053.
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS secure_update_leave_status(BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS secure_update_leave_status(TEXT, TEXT, TEXT);

CREATE FUNCTION secure_update_leave_status(
  p_id     TEXT,
  p_status TEXT,
  p_token  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
  n INT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only owners can approve/reject leave' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('Pending','Approved','Rejected') THEN
    RAISE EXCEPTION 'invalid leave status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE leave_requests
     SET status = p_status
   WHERE id::text = p_id
     AND academy_id = a.academy_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'leave request not found in this academy' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_update_leave_status(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMIT;

-- Verify:
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.proname = 'secure_update_leave_status';
--   -- expect exactly one row: secure_update_leave_status(text,text,text)
