-- Server-side tests for migrations 0184 + 0185 (shared ground capacity).
--
-- Run:  supabase db query --linked --file scripts/test-batch-slots.sql
--
-- Everything happens inside a transaction that ROLLS BACK, so this is safe to
-- run against the live project: no slot is created, no student is enrolled,
-- and the temporary capacity tweaks below never persist.
--
-- 0185 removed the manually-typed "ground holds X" number (batch_slots still
-- has the cap_per_day COLUMN — kept only to satisfy its NOT NULL constraint,
-- a fixed placeholder is inserted below and never read). Each day's ceiling
-- is now auto-derived: the smallest `capacity` among every batch in the slot
-- that trains that day (`_slot_day_ceiling`). This test temporarily sets the
-- real "Evening Under 20 Advance MWF" / "Development TTF" batches' own
-- capacities to reconstruct the same tight-Monday/open-Tuesday shape the
-- original 0184 test used a manual number for.
--
-- The JS mirror of this same rule is checked by scripts/test-batch-capacity.mjs.
-- If you change the rule, both must change together.

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

-- Save real capacities so the intent here is legible (the ROLLBACK at the
-- bottom is what actually restores them; this is just documentation).
INSERT INTO res
SELECT 'setup: real capacity before override — ' || name, capacity::TEXT, capacity::TEXT, TRUE
  FROM batches WHERE ground = 'Full Ground';

-- MWF → 4 (so Mon/Wed/Fri's auto-ceiling becomes 4, same as the old manual
-- cap_per_day=4). TTF → 10 (so Tue/Thu/Sat's ceiling is a distinct, looser
-- number — proof the ceiling is genuinely per-day, not one flat value).
UPDATE batches SET capacity = 4  WHERE name = 'Evening Under 20 Advance MWF';
UPDATE batches SET capacity = 10 WHERE name = 'Evening Under 20 Development TTF';

INSERT INTO batch_slots (academy_id, branch_id, name, cap_per_day)
SELECT academy_id, branch_id, 'TEST FG', 9999 FROM batches WHERE ground = 'Full Ground' LIMIT 1;

UPDATE batches SET slot_id = (SELECT id FROM batch_slots WHERE name = 'TEST FG')
 WHERE ground = 'Full Ground';

-- ── The auto-derived ceiling itself — no manual number anywhere ───────────
INSERT INTO res
SELECT 'auto ceiling ' || e.day, e.expected::TEXT,
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), e.day)::TEXT,
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), e.day) = e.expected
  FROM (VALUES ('Mon',4),('Tue',10),('Wed',4),('Thu',10),('Fri',4),('Sat',10)) AS e(day, expected);

-- A third, smaller batch sharing only Saturday should tighten JUST Saturday —
-- this is the general "any future batch, any schedule" case, not special-
-- cased to full-week batches. Mirrors the "Weekend Special" example worked
-- out with the owner.
INSERT INTO batches (name, days, capacity, sports, academy_id, branch_id, slot_id)
SELECT 'ZZ TEST Saturday Only', ARRAY['Sat'], 3, sports, academy_id, branch_id,
       (SELECT id FROM batch_slots WHERE name = 'TEST FG')
  FROM batches WHERE name = 'Evening Under 20 Development TTF';

INSERT INTO res
SELECT 'Saturday ceiling drops to 3 once a smaller batch joins it', '3',
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), 'Sat')::TEXT,
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), 'Sat') = 3;
INSERT INTO res
SELECT 'Thursday is untouched by the Saturday-only batch', '10',
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), 'Thu')::TEXT,
       _slot_day_ceiling((SELECT id FROM batch_slots WHERE name = 'TEST FG'), 'Thu') = 10;

-- Remove the throwaway third batch before running the behavioural checks
-- below — they're written against the original 2-batch fixture.
DELETE FROM batches WHERE name = 'ZZ TEST Saturday Only';

DO $do$
DECLARE
  v_mwf   BIGINT := (SELECT id FROM batches WHERE name = 'Evening Under 20 Advance MWF');
  v_ttf   BIGINT := (SELECT id FROM batches WHERE name = 'Evening Under 20 Development TTF');
  v_aca   UUID   := (SELECT academy_id FROM batches WHERE name = 'Evening Under 20 Advance MWF');
  v_other BIGINT := (SELECT id FROM batches WHERE ground IS DISTINCT FROM 'Full Ground'
                       AND slot_id IS NULL LIMIT 1);
  v_alt   BIGINT;
  v_daily BIGINT;
  v_msg   TEXT;
BEGIN
  SELECT id INTO v_alt FROM students s
   WHERE s.status = 'Active' AND lower(s.training_type) = 'alternate'
     AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.ground='Full Ground'
                      AND (s.batch_id=b.id OR s.batch=b.name)) LIMIT 1;
  SELECT id INTO v_daily FROM students s
   WHERE s.status = 'Active' AND lower(s.training_type) = 'daily'
     AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.ground='Full Ground'
                      AND (s.batch_id=b.id OR s.batch=b.name)) LIMIT 1;

  -- ── Existing students being moved ───────────────────────────────────────
  BEGIN
    PERFORM _require_batch_capacity(v_mwf, v_alt);
    INSERT INTO res VALUES ('alternate into full MWF (Mon 4/4, auto-ceiling)', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('alternate into full MWF (Mon 4/4, auto-ceiling)', 'BLOCK', v_msg, TRUE);
  END;

  -- The HINT is a contract, not decoration: Trials.jsx keys off exactly this
  -- string to park an unseatable trial in "enquired" instead of reverting it
  -- to "accepted". ERRCODE cannot carry that decision — 23514 is also raised
  -- by the alternate-day one-batch rule. Change this string and trials will
  -- silently start reverting again.
  BEGIN
    PERFORM _require_batch_capacity(v_mwf, v_alt);
    INSERT INTO res VALUES ('capacity error carries hint=batch_capacity', 'batch_capacity', '(no error)', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = PG_EXCEPTION_HINT;
    INSERT INTO res VALUES ('capacity error carries hint=batch_capacity', 'batch_capacity',
                            COALESCE(v_msg, '(null)'), COALESCE(v_msg, '') = 'batch_capacity');
  END;

  BEGIN
    PERFORM _require_batch_capacity(v_ttf, v_alt);
    INSERT INTO res VALUES ('alternate into open TTF (Tue 2/10, auto-ceiling)', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('alternate into open TTF (Tue 2/10, auto-ceiling)', 'ALLOW', v_msg, FALSE);
  END;

  -- THE case. TTF's own days are wide open, but a daily student also needs
  -- Mon/Wed/Fri, and those are full. Per-batch capacity could never see this.
  BEGIN
    PERFORM _require_batch_capacity(v_ttf, v_daily);
    INSERT INTO res VALUES ('DAILY into open TTF (blocked by Mon)', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('DAILY into open TTF (blocked by Mon)', 'BLOCK', v_msg, TRUE);
  END;

  -- An ungrouped batch must behave exactly as it did before slots existed.
  BEGIN
    PERFORM _require_batch_capacity(v_other, v_daily);
    INSERT INTO res VALUES ('daily into UNGROUPED batch', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('daily into UNGROUPED batch', 'ALLOW', v_msg, FALSE);
  END;

  -- A daily student already on this ground adds no new body when he moves
  -- between two batches of the same slot. Without the "days already held"
  -- check, every such move would be wrongly refused.
  SELECT s.id INTO v_daily FROM students s
    JOIN batches b ON b.ground = 'Full Ground' AND (s.batch_id = b.id OR s.batch = b.name)
   WHERE s.status = 'Active' AND lower(s.training_type) = 'daily' LIMIT 1;
  BEGIN
    PERFORM _require_batch_capacity(v_mwf, v_daily);
    INSERT INTO res VALUES ('existing daily moves batch inside slot', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('existing daily moves batch inside slot', 'ALLOW', v_msg, FALSE);
  END;

  -- ── The triggers, not just the helper ───────────────────────────────────
  BEGIN
    INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
    VALUES (v_alt, v_mwf, 'Evening Under 20 Advance MWF', v_aca);
    INSERT INTO res VALUES ('TRIGGER on student_batches insert', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('TRIGGER on student_batches insert', 'BLOCK', v_msg, TRUE);
  END;

  -- REGRESSION: a brand new student must be gated too. The first version of
  -- this migration looked the student up in `students`, which at BEFORE INSERT
  -- time does not contain them yet — so every newly-created student silently
  -- bypassed the gate. The trigger now passes NEW.training_type / NEW.status.
  BEGIN
    INSERT INTO students (name, parent, phone, sport, batch_id, batch, training_type, status, academy_id)
    VALUES ('ZZ Probe 1','P','0000000000','Cricket', v_mwf, 'Evening Under 20 Advance MWF','Alternate','Active', v_aca);
    INSERT INTO res VALUES ('NEW alternate student into full MWF', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('NEW alternate student into full MWF', 'BLOCK', v_msg, TRUE);
  END;

  BEGIN
    INSERT INTO students (name, parent, phone, sport, batch_id, batch, training_type, status, academy_id)
    VALUES ('ZZ Probe 2','P','0000000000','Cricket', v_ttf, 'Evening Under 20 Development TTF','Daily','Active', v_aca);
    INSERT INTO res VALUES ('NEW daily student into open TTF', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('NEW daily student into open TTF', 'BLOCK', v_msg, TRUE);
  END;

  BEGIN
    INSERT INTO students (name, parent, phone, sport, batch_id, batch, training_type, status, academy_id)
    VALUES ('ZZ Probe 3','P','0000000000','Cricket', v_ttf, 'Evening Under 20 Development TTF','Alternate','Active', v_aca);
    INSERT INTO res VALUES ('NEW alternate student into open TTF', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('NEW alternate student into open TTF', 'ALLOW', v_msg, FALSE);
  END;

  -- Suspended students hold no seat, so a full ground must still accept them.
  -- This is what keeps "parent pays, student reactivates" from ever failing.
  BEGIN
    INSERT INTO students (name, parent, phone, sport, batch_id, batch, training_type, status, academy_id)
    VALUES ('ZZ Probe 4','P','0000000000','Cricket', v_mwf, 'Evening Under 20 Advance MWF','Daily','Suspended', v_aca);
    INSERT INTO res VALUES ('NEW suspended student into full MWF', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('NEW suspended student into full MWF', 'ALLOW', v_msg, FALSE);
  END;
END
$do$;

SELECT count(*) FILTER (WHERE NOT pass) AS failures,
       count(*)                         AS total
  FROM res;

SELECT pass, test, expected, got FROM res ORDER BY pass, test;

ROLLBACK;
