-- Server-side tests for migration 0184 (shared ground capacity).
--
-- Run:  supabase db query --linked --file scripts/test-batch-slots.sql
--
-- Everything happens inside a transaction that ROLLS BACK, so this is safe to
-- run against the live project: no slot is created, no student is enrolled.
--
-- The fixture is real data — the "Full Ground" slot (Evening Under 20 Advance
-- MWF + Development TTF). Its live ACTIVE load is Mon 4, Tue 2, Wed 4, Thu 2,
-- Fri 4, Sat 2, which comes from 3 alternates in MWF, 1 alternate in TTF, and
-- 1 DAILY student in TTF who stands on all six days. Cap is set to 4 so Mon /
-- Wed / Fri are exactly full and Tue / Thu / Sat have room — the sharpest
-- possible test of "a daily student is blocked by a day his batch doesn't run".
--
-- The JS mirror of this same rule is checked by scripts/test-batch-capacity.mjs.
-- If you change the rule, both must change together.

BEGIN;

CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO batch_slots (academy_id, branch_id, name, cap_per_day)
SELECT academy_id, branch_id, 'TEST FG', 4 FROM batches WHERE ground = 'Full Ground' LIMIT 1;

UPDATE batches SET slot_id = (SELECT id FROM batch_slots WHERE name = 'TEST FG')
 WHERE ground = 'Full Ground';

-- ── The day table itself ──────────────────────────────────────────────────
INSERT INTO res
SELECT 'day load ' || l.day,
       expected::TEXT,
       l.occupied::TEXT,
       l.occupied = expected
  FROM slot_day_load((SELECT id FROM batch_slots WHERE name = 'TEST FG')) l
  JOIN (VALUES ('Mon',4),('Tue',2),('Wed',4),('Thu',2),('Fri',4),('Sat',2)) AS e(day, expected)
    ON e.day = l.day;

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
    INSERT INTO res VALUES ('alternate into full MWF (Mon 4/4)', 'BLOCK', 'allowed', FALSE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('alternate into full MWF (Mon 4/4)', 'BLOCK', v_msg, TRUE);
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
    INSERT INTO res VALUES ('alternate into open TTF (Tue 2/4)', 'ALLOW', 'allowed', TRUE);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO res VALUES ('alternate into open TTF (Tue 2/4)', 'ALLOW', v_msg, FALSE);
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
