-- ============================================================
-- 0184 — batch_slots: shared ground capacity across batches
-- ============================================================
-- WHY
--   Capacity was enforced per batch, in isolation (Batches.jsx:244
--   `enrolled >= b.capacity`). Nothing knew that two batches stand on the
--   same ground at the same hour. A morning U15 slot with a TTS batch (20),
--   an MWF batch (20) and a Daily batch (20) reported 60 seats when the
--   ground holds 20 at a time.
--
--   Worse, seat-days do not come from the batch. Attendance.jsx:546 only
--   grants an "off day" to Alternate students — a Daily student is expected
--   EVERY day regardless of their batch's days. 323 Daily students currently
--   sit in 3-day batches, each silently standing on 6 days of ground.
--
-- THE MODEL
--   A slot is the physical ground+time. Batches point at it (batches.slot_id).
--   The slot owns cap_per_day. A student's seat-days are:
--       Alternate → their batch's days      (MWF kid → Mon/Wed/Fri)
--       Daily     → every day the slot runs (all 6)
--   A batch's free seats = min(
--       batch.capacity − enrolled,
--       min over each day it runs of (slot.cap_per_day − that day's load)
--   )
--
-- ENFORCEMENT
--   BEFORE triggers on student_batches + students, NOT patched into the
--   write RPCs. Triggers cover every path — Batches page, Students page,
--   trial conversion, and the public /join funnel — including paths added
--   later. Set `app.skip_capacity_check = 'on'` to bypass for data repair.
--
-- DELIBERATE NON-ENFORCEMENT (grandfathering)
--   * Batches already over their cap when grouped are NOT unwound. Only
--     NEW seat-days are blocked; the slot drains back under naturally.
--   * Reactivating a Suspended student is NOT blocked. 413 of 569 students
--     are Suspended; a parent paying their dues must never be refused
--     because the ground filled up while they were away. The UI shows the
--     over-capacity day in red instead.
--
--   slot_id IS NULL ⇒ behaves exactly as before. All 44 existing batches
--   are untouched until an owner groups them.
--
-- WRITE SURFACE
--   batch_slots → secure_upsert_batch_slot / secure_delete_batch_slot /
--                 secure_set_batch_slot (all 'batches.manage'), owner
--                 (authenticated) scoped to their academy, anon SELECT only.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. table + column ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS batch_slots (
  id          BIGSERIAL   PRIMARY KEY,
  academy_id  UUID        NOT NULL,
  branch_id   UUID,
  name        TEXT        NOT NULL,
  cap_per_day INTEGER     NOT NULL CHECK (cap_per_day > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE batch_slots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_batch_slots_academy ON batch_slots (academy_id);

ALTER TABLE batches ADD COLUMN IF NOT EXISTS slot_id BIGINT
  REFERENCES batch_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_batches_slot ON batches (slot_id) WHERE slot_id IS NOT NULL;

-- ── 2. RLS ────────────────────────────────────────────────
-- anon SELECT stays open (staff/student portals read with the anon key and
-- resolve identity from request headers); writes are RPC-only.

DROP POLICY IF EXISTS batch_slots_anon_select ON public.batch_slots;
CREATE POLICY batch_slots_anon_select ON public.batch_slots FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS batch_slots_auth_all ON public.batch_slots;
CREATE POLICY batch_slots_auth_all ON public.batch_slots FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── 3. _slot_days — the days a slot actually runs ─────────
-- Union of every member batch's days. This is what a Daily student occupies.
-- Ordered Mon→Sun, not alphabetically: this array drives both the error
-- message ("Ground full on Mon") and the UI's day table, and "Fri, Mon, Sat…"
-- reads as a bug in both.

CREATE OR REPLACE FUNCTION _slot_days(p_slot_id BIGINT)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
           array_agg(d ORDER BY array_position(
             ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], d)),
           ARRAY[]::TEXT[])
    FROM (
      SELECT DISTINCT d
        FROM batches b
        CROSS JOIN LATERAL unnest(COALESCE(b.days, ARRAY[]::TEXT[])) AS d
       WHERE b.slot_id = p_slot_id
    ) t;
$$;
GRANT EXECUTE ON FUNCTION _slot_days(BIGINT) TO anon, authenticated;

-- ── 4. _slot_seats — (student, day) pairs standing in a slot ──
-- Both enrolment sources: the primary students.batch_id/students.batch AND
-- the student_batches rows. Only Active students hold a seat, matching
-- Batches.jsx which counts `students.filter(s => s.status === 'Active')`.

CREATE OR REPLACE FUNCTION _slot_seats(p_slot_id BIGINT)
RETURNS TABLE (student_id BIGINT, day TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH enrol AS (
    SELECT s.id AS sid, s.training_type AS tt, COALESCE(b.days, ARRAY[]::TEXT[]) AS bdays
      FROM students s
      JOIN batches b ON b.slot_id = p_slot_id
                    AND (s.batch_id = b.id OR s.batch = b.name)
     WHERE s.status = 'Active'
    UNION
    SELECT s.id, s.training_type, COALESCE(b.days, ARRAY[]::TEXT[])
      FROM student_batches sb
      JOIN students s ON s.id = sb.student_id
      JOIN batches  b ON b.id = sb.batch_id AND b.slot_id = p_slot_id
     WHERE s.status = 'Active'
  )
  SELECT DISTINCT e.sid, d.day
    FROM enrol e
    CROSS JOIN LATERAL unnest(
      CASE WHEN lower(trim(COALESCE(e.tt, 'Daily'))) = 'alternate'
           THEN e.bdays                 -- alternate: only their batch's days
           ELSE _slot_days(p_slot_id)   -- daily: every day the ground runs
      END
    ) AS d(day)
$$;
GRANT EXECUTE ON FUNCTION _slot_seats(BIGINT) TO anon, authenticated;

-- ── 5. slot_day_load — headcount per day, the number that matters ──

CREATE OR REPLACE FUNCTION slot_day_load(p_slot_id BIGINT)
RETURNS TABLE (day TEXT, occupied INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sd.day,
         (SELECT count(*)::INTEGER FROM _slot_seats(p_slot_id) ss WHERE ss.day = sd.day)
    FROM unnest(_slot_days(p_slot_id)) AS sd(day);
$$;
GRANT EXECUTE ON FUNCTION slot_day_load(BIGINT) TO anon, authenticated;

-- ── 6. _require_batch_capacity — the gate ─────────────────
-- Raises 23514 with a message naming WHICH limit blocked, so the owner knows
-- which number to go raise. Returns silently when there is room, when the
-- batch has no slot, or when the student already holds the seat-days.

-- p_training_type / p_status let a BEFORE trigger hand over the NEW row's
-- values. Without them this function is blind on INSERT: at BEFORE INSERT
-- time the student is not in `students` yet, the lookup below finds nothing,
-- and every newly-created student would slip past the gate. They also fix a
-- quieter case — an UPDATE that changes batch AND training type at once,
-- where a lookup returns the OLD type and sizes the student's seat-days wrong.
DROP FUNCTION IF EXISTS _require_batch_capacity(BIGINT, BIGINT);

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
BEGIN
  -- Explicit bypass for data repair / backfills.
  IF COALESCE(current_setting('app.skip_capacity_check', TRUE), '') = 'on' THEN
    RETURN;
  END IF;

  SELECT id, name, capacity, slot_id, COALESCE(days, ARRAY[]::TEXT[]) AS days
    INTO v_batch
    FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RETURN; END IF;   -- batch gone; let the FK complain

  IF p_training_type IS NOT NULL OR p_status IS NOT NULL THEN
    v_tt     := COALESCE(p_training_type, 'Daily');
    v_status := COALESCE(p_status, 'Active');
  ELSE
    SELECT COALESCE(training_type, 'Daily'), COALESCE(status, 'Active')
      INTO v_tt, v_status
      FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  -- Suspended students take no seat, so moving one costs nothing.
  IF v_status <> 'Active' THEN RETURN; END IF;

  -- ── 6a. the batch's own cap ──────────────────────────────
  -- Counts the batch's live roster excluding this student, so re-assigning
  -- somebody already in the batch is a harmless no-op rather than an error.
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
      -- HINT is the machine-readable marker. ERRCODE alone is not enough to
      -- act on: 23514 is also raised by the alternate-day one-batch rule and
      -- by slot validation. The Trials page keys off this hint to park an
      -- unseatable trial in "enquired" instead of reverting it to "accepted".
      USING ERRCODE = '23514', HINT = 'batch_capacity';
  END IF;

  -- ── 6b. the ground's cap, per day ────────────────────────
  IF v_batch.slot_id IS NULL THEN RETURN; END IF;   -- ungrouped: legacy behaviour

  SELECT id, name, cap_per_day INTO v_slot FROM batch_slots WHERE id = v_batch.slot_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Days this student would stand on once enrolled here.
  IF lower(trim(v_tt)) = 'alternate' THEN
    v_want := v_batch.days;
  ELSE
    v_want := _slot_days(v_batch.slot_id);
  END IF;

  -- Days they ALREADY stand on in this slot. A daily student moving between
  -- two batches of the same slot adds no new body to any day, so nothing to
  -- check — without this, every such move would be refused.
  SELECT COALESCE(array_agg(DISTINCT ss.day), ARRAY[]::TEXT[])
    INTO v_have
    FROM _slot_seats(v_batch.slot_id) ss
   WHERE ss.student_id = p_student_id;

  FOREACH v_day IN ARRAY v_want LOOP
    CONTINUE WHEN v_day = ANY(v_have);   -- already counted on this day

    SELECT l.occupied INTO v_occupied FROM slot_day_load(v_batch.slot_id) l WHERE l.day = v_day;
    v_occupied := COALESCE(v_occupied, 0);

    IF v_occupied >= v_slot.cap_per_day THEN
      RAISE EXCEPTION
        'Ground full on %: "%" already holds % of % students that day. Raise the slot capacity to add more.',
        v_day, v_slot.name, v_occupied, v_slot.cap_per_day
        USING ERRCODE = '23514', HINT = 'batch_capacity';
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION _require_batch_capacity(BIGINT, BIGINT, TEXT, TEXT) TO anon, authenticated;

-- ── 7. triggers — every write path, present and future ────

CREATE OR REPLACE FUNCTION _trg_student_batches_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ON CONFLICT DO UPDATE re-fires this as an UPDATE; only a genuinely new
  -- (student, batch) pair adds a body.
  IF TG_OP = 'UPDATE'
     AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
    RETURN NEW;
  END IF;
  PERFORM _require_batch_capacity(NEW.batch_id, NEW.student_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_batches_capacity ON student_batches;
CREATE TRIGGER trg_student_batches_capacity
  BEFORE INSERT OR UPDATE ON student_batches
  FOR EACH ROW EXECUTE FUNCTION _trg_student_batches_capacity();

CREATE OR REPLACE FUNCTION _trg_students_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_id BIGINT;
BEGIN
  -- Only a change of primary batch matters. Status changes (suspend /
  -- reactivate) and every other column are deliberately not gated — see the
  -- grandfathering note at the top of this migration.
  IF TG_OP = 'UPDATE'
     AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
     AND NEW.batch    IS NOT DISTINCT FROM OLD.batch THEN
    RETURN NEW;
  END IF;

  -- A student switching TO Alternate/Daily changes their seat-days, but they
  -- are already on the ground; only the batch move is gated.
  v_batch_id := NEW.batch_id;
  IF v_batch_id IS NULL AND NEW.batch IS NOT NULL THEN
    SELECT id INTO v_batch_id FROM batches
     WHERE name = NEW.batch AND academy_id IS NOT DISTINCT FROM NEW.academy_id
     LIMIT 1;
  END IF;

  -- NEW.training_type / NEW.status are passed explicitly: on INSERT this row
  -- does not exist in `students` yet, so the function cannot look them up.
  IF v_batch_id IS NOT NULL THEN
    PERFORM _require_batch_capacity(
      v_batch_id, NEW.id,
      COALESCE(NEW.training_type, 'Daily'),
      COALESCE(NEW.status, 'Active'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_capacity ON students;
CREATE TRIGGER trg_students_capacity
  BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION _trg_students_capacity();

-- ── 8. secure_upsert_batch_slot ───────────────────────────

CREATE OR REPLACE FUNCTION secure_upsert_batch_slot(
  p_id          BIGINT DEFAULT NULL,
  p_name        TEXT   DEFAULT NULL,
  p_cap_per_day INTEGER DEFAULT NULL,
  p_branch_id   UUID   DEFAULT NULL,
  p_token       TEXT   DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row batch_slots%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  IF p_cap_per_day IS NULL OR p_cap_per_day < 1 THEN
    RAISE EXCEPTION 'Slot capacity must be at least 1' USING ERRCODE = '23514';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Slot name is required' USING ERRCODE = '23514';
  END IF;

  IF p_id IS NULL THEN
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, p_branch_id, a.actor_id);
    INSERT INTO batch_slots (academy_id, branch_id, name, cap_per_day)
    VALUES (a.academy_id, p_branch_id, trim(p_name), p_cap_per_day)
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row FROM batch_slots WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'slot not found' USING ERRCODE = 'P0002'; END IF;
    IF v_row.academy_id IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: slot belongs to another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_row.branch_id, a.actor_id);

    UPDATE batch_slots
       SET name        = trim(p_name),
           cap_per_day = p_cap_per_day,
           branch_id   = COALESCE(p_branch_id, branch_id),
           updated_at  = now()
     WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_batch_slot(BIGINT, TEXT, INTEGER, UUID, TEXT) TO anon, authenticated;

-- ── 9. secure_set_batch_slot — group / ungroup batches ────
-- p_slot_id NULL detaches. Every batch must belong to the caller's academy
-- and branch scope, so one call cannot quietly pull in another branch's batch.

CREATE OR REPLACE FUNCTION secure_set_batch_slot(
  p_batch_ids BIGINT[],
  p_slot_id   BIGINT DEFAULT NULL,
  p_token     TEXT   DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a        RECORD;
  v_slot   batch_slots%ROWTYPE;
  v_batch  RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  IF p_slot_id IS NOT NULL THEN
    SELECT * INTO v_slot FROM batch_slots WHERE id = p_slot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'slot not found' USING ERRCODE = 'P0002'; END IF;
    IF v_slot.academy_id IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: slot belongs to another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_slot.branch_id, a.actor_id);
  END IF;

  FOR v_batch IN
    SELECT id, academy_id, branch_id FROM batches WHERE id = ANY(COALESCE(p_batch_ids, ARRAY[]::BIGINT[]))
  LOOP
    IF v_batch.academy_id IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch.branch_id, a.actor_id);
  END LOOP;

  UPDATE batches SET slot_id = p_slot_id
   WHERE id = ANY(COALESCE(p_batch_ids, ARRAY[]::BIGINT[]))
     AND academy_id IS NOT DISTINCT FROM a.academy_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_set_batch_slot(BIGINT[], BIGINT, TEXT) TO anon, authenticated;

-- ── 10. secure_delete_batch_slot ──────────────────────────
-- batches.slot_id is ON DELETE SET NULL, so member batches simply revert to
-- standalone capacity rather than disappearing.

CREATE OR REPLACE FUNCTION secure_delete_batch_slot(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a     RECORD;
  v_row batch_slots%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT * INTO v_row FROM batch_slots WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_row.academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: slot belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_row.branch_id, a.actor_id);

  DELETE FROM batch_slots WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_batch_slot(BIGINT, TEXT) TO anon, authenticated;

-- ── 11. secure_slot_day_load — the day table for the UI ───
-- Returns every slot in the caller's academy with its per-day load in one
-- round trip, so the Batches page does not fan out one call per slot.

CREATE OR REPLACE FUNCTION secure_slot_day_load(p_token TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a      RECORD;
  v_out  JSON;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN RETURN '[]'::JSON; END IF;

  SELECT COALESCE(json_agg(x), '[]'::JSON) INTO v_out FROM (
    SELECT sl.id AS slot_id,
           COALESCE(
             (SELECT json_object_agg(l.day, l.occupied) FROM slot_day_load(sl.id) l),
             '{}'::JSON
           ) AS load
      FROM batch_slots sl
     WHERE sl.academy_id = a.academy_id
  ) x;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_slot_day_load(TEXT) TO anon, authenticated;

COMMIT;
