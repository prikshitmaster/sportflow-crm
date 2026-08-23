-- ============================================================
-- 0185 — auto-derived ground capacity (replaces manual cap_per_day)
-- ============================================================
-- WHY
--   0184's `batch_slots.cap_per_day` was a number the owner had to type by
--   hand, meant to represent the ground's real physical capacity — a fact
--   nobody had written down anywhere. Once every batch already carries its
--   own meaningful `capacity`, a second manual number on top of that is
--   redundant.
--
-- THE NEW MODEL
--   For any calendar day a slot runs, that day's ceiling is no longer a
--   stored number — it is the SMALLEST `capacity` among every batch in the
--   slot that trains that day. Worked example: TTS batch cap 10 (5 free),
--   MWF batch cap 10 (4 free) never share a day, so a Daily-type student
--   (who stands on every slot day) is capped by the tighter of the two: 4.
--   Generalizes to any future batch/schedule automatically — a 2-day batch
--   added later tightens only the specific days it shares with others.
--
--   `batch_slots.cap_per_day` is left in place (dropping a NOT NULL column
--   is a separate, riskier schema change) but is no longer read by the
--   capacity check. `secure_upsert_batch_slot` still accepts it so existing
--   callers don't break.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. _slot_day_ceiling — the auto-derived per-day limit ─
-- The smallest capacity among batches in the slot active on p_day. NULL
-- only if somehow no batch in the slot runs that day (shouldn't happen,
-- since callers derive p_day from _slot_days(), the union of member days).

CREATE OR REPLACE FUNCTION _slot_day_ceiling(p_slot_id BIGINT, p_day TEXT)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT MIN(b.capacity)
    FROM batches b
   WHERE b.slot_id = p_slot_id
     AND p_day = ANY(COALESCE(b.days, ARRAY[]::TEXT[]))
     AND b.capacity IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION _slot_day_ceiling(BIGINT, TEXT) TO anon, authenticated;

-- ── 2. _require_batch_capacity — section 6b rewritten ─────
-- Section 6a (the batch's own cap) is copied verbatim, untouched. Only the
-- ground-check half now asks _slot_day_ceiling instead of reading
-- batch_slots.cap_per_day.

CREATE OR REPLACE FUNCTION _require_batch_capacity(
  p_batch_id      BIGINT,
  p_student_id    BIGINT,
  p_training_type TEXT DEFAULT NULL,
  p_status        TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch      RECORD;
  v_slot       RECORD;
  v_tt         TEXT;
  v_status     TEXT;
  v_enrolled   INTEGER;
  v_want       TEXT[];
  v_have       TEXT[];
  v_day        TEXT;
  v_occupied   INTEGER;
  v_ceiling    INTEGER;
BEGIN
  IF COALESCE(current_setting('app.skip_capacity_check', TRUE), '') = 'on' THEN
    RETURN;
  END IF;

  SELECT id, name, capacity, slot_id, COALESCE(days, ARRAY[]::TEXT[]) AS days
    INTO v_batch
    FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_training_type IS NOT NULL OR p_status IS NOT NULL THEN
    v_tt     := COALESCE(p_training_type, 'Daily');
    v_status := COALESCE(p_status, 'Active');
  ELSE
    SELECT COALESCE(training_type, 'Daily'), COALESCE(status, 'Active')
      INTO v_tt, v_status
      FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  IF v_status <> 'Active' THEN RETURN; END IF;

  -- ── 6a. the batch's own cap (unchanged from 0184) ────────
  SELECT count(*)::INTEGER INTO v_enrolled FROM (
    SELECT s.id FROM students s
      WHERE s.status = 'Active' AND s.id <> p_student_id
        AND (s.batch_id = v_batch.id OR s.batch = v_batch.name)
    UNION
    SELECT s.id FROM student_batches sb
      JOIN students s ON s.id = sb.student_id
      WHERE sb.batch_id = v_batch.id AND s.status = 'Active' AND s.id <> p_student_id
  ) roster;

  IF v_batch.capacity IS NOT NULL AND v_enrolled >= v_batch.capacity THEN
    RAISE EXCEPTION
      'Batch full: "%" already has % of % students. Raise this batch''s capacity to add more.',
      v_batch.name, v_enrolled, v_batch.capacity
      USING ERRCODE = '23514', HINT = 'batch_capacity';
  END IF;

  -- ── 6b. the ground's cap, per day — now auto-derived ─────
  IF v_batch.slot_id IS NULL THEN RETURN; END IF;   -- ungrouped: legacy behaviour

  SELECT id, name INTO v_slot FROM batch_slots WHERE id = v_batch.slot_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF lower(trim(v_tt)) = 'alternate' THEN
    v_want := v_batch.days;
  ELSE
    v_want := _slot_days(v_batch.slot_id);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT ss.day), ARRAY[]::TEXT[])
    INTO v_have
    FROM _slot_seats(v_batch.slot_id) ss
   WHERE ss.student_id = p_student_id;

  FOREACH v_day IN ARRAY v_want LOOP
    CONTINUE WHEN v_day = ANY(v_have);   -- already counted on this day

    v_ceiling := _slot_day_ceiling(v_batch.slot_id, v_day);
    CONTINUE WHEN v_ceiling IS NULL;     -- defensive: no batch defines this day

    SELECT l.occupied INTO v_occupied FROM slot_day_load(v_batch.slot_id) l WHERE l.day = v_day;
    v_occupied := COALESCE(v_occupied, 0);

    IF v_occupied >= v_ceiling THEN
      RAISE EXCEPTION
        'Ground full on %: % of % students already there that day (limited by the smallest batch sharing the ground that day). Raise that batch''s capacity to add more.',
        v_day, v_occupied, v_ceiling
        USING ERRCODE = '23514', HINT = 'batch_capacity';
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION _require_batch_capacity(BIGINT, BIGINT, TEXT, TEXT) TO anon, authenticated;

COMMIT;
