-- 0161 — /join's "Choose a Batch" step returns the batch code too
--
-- secure_public_trial_batches_v2 never selected batches.code, so
-- _mapPublicTrialBatch (db.js) had nothing to map it from — the public
-- funnel's batch cards showed the full batch name even after 0160 made
-- code the short, unique, student-facing label used everywhere else a
-- batch is picked (Add Student's Primary Batch, now this).
--
-- Ordering switches from name to code to match what's actually displayed.
--
-- Signature UNCHANGED (p_slug text, p_branch_id uuid) — plain CREATE OR
-- REPLACE, no DROP, no PostgREST overload risk. Every existing check
-- (branch/academy/sport match) preserved exactly; only the SELECT list and
-- ORDER BY changed.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_public_trial_batches_v2(p_slug text, p_branch_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
        b.id, b.name, b.code, b.days, b.start_time, b.end_time,
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
      ORDER BY b.code, b.name
    ) x
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_public_trial_batches_v2(text, uuid) TO anon, authenticated;

COMMIT;
