-- Adversarial + regression test for migration 0194 (full branch/sport
-- isolation audit). Uses staff #123 (academy cb01cec5, branch 047b75b3
-- "Football") as the attacker, and staff #121 (location-scoped, location
-- ee1d7b92, own branch b32308fc) for the secure_update_batch regression
-- check. Runs inside BEGIN/ROLLBACK — nothing is persisted.
BEGIN;
CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);

INSERT INTO staff_sessions (staff_id, token, expires_at) VALUES
  (123, 'zz-iso-attacker', now() + interval '1 hour'),
  (121, 'zz-iso-locmgr',   now() + interval '1 hour');

-- Give the location-scoped staff batches.manage for the regression check
-- (rolled back with everything else).
UPDATE staff_auth SET permissions = permissions || '["batches.manage"]'::jsonb
WHERE staff_id = 121 AND NOT (permissions ? 'batches.manage');

DO $do$
DECLARE
  v_attacker TEXT := 'zz-iso-attacker';
  v_locmgr   TEXT := 'zz-iso-locmgr';
  v_err      TEXT;
  v_plan_own UUID;
  v_plan_foreign UUID := 'a07be6fe-cca5-4c1a-8237-01d04bdbb8df';
  v_phase_id UUID;
  v_row      RECORD;
BEGIN
  -- ── student documents ──────────────────────────────────────────────
  BEGIN
    PERFORM secure_add_student_document(94, 'other', 'x', '/x.pdf', NULL, NULL, NULL, v_attacker);
    INSERT INTO res VALUES ('doc add: foreign-branch student blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('doc add: foreign-branch student blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_add_student_document(2872, 'other', 'x', '/x.pdf', NULL, NULL, NULL, v_attacker);
    INSERT INTO res VALUES ('doc add: own-branch student still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('doc add: own-branch student still works', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_delete_student_document('71cf2d23-5fa5-4200-bca9-eb96a75e0627', v_attacker);
    INSERT INTO res VALUES ('doc delete: foreign-branch doc blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('doc delete: foreign-branch doc blocked', '42501', v_err, v_err = '42501');
  END;

  -- ── payment links ──────────────────────────────────────────────────
  BEGIN
    PERFORM secure_create_payment_link(94, 500, 'x', 1, NULL, v_attacker);
    INSERT INTO res VALUES ('payment link: foreign-branch student blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('payment link: foreign-branch student blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_create_payment_link(2872, 500, 'x', 1, NULL, v_attacker);
    INSERT INTO res VALUES ('payment link: own-branch student still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('payment link: own-branch student still works', 'succeeds', SQLERRM, FALSE);
  END;

  -- ── trials ─────────────────────────────────────────────────────────
  BEGIN
    PERFORM secure_delete_trial(172, v_attacker);
    INSERT INTO res VALUES ('trial delete: foreign-branch trial blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('trial delete: foreign-branch trial blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_update_trial(172, jsonb_build_object('notes','hacked'), v_attacker);
    INSERT INTO res VALUES ('trial update: foreign-branch trial blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('trial update: foreign-branch trial blocked', '42501', v_err, v_err = '42501');
  END;

  -- own-academy, own-branch trial exists? use any trial in branch 047b75b3
  PERFORM 1 FROM trials WHERE branch_id = '047b75b3-ded0-4792-8fb2-68c781a0c3e8';
  IF FOUND THEN
    DECLARE v_own_trial BIGINT;
    BEGIN
      SELECT id INTO v_own_trial FROM trials WHERE branch_id = '047b75b3-ded0-4792-8fb2-68c781a0c3e8' LIMIT 1;
      BEGIN
        PERFORM secure_update_trial(v_own_trial, jsonb_build_object('batchId', 138), v_attacker);
        INSERT INTO res VALUES ('trial update: reassign to foreign-branch batch blocked', '42501', 'no error', FALSE);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
        INSERT INTO res VALUES ('trial update: reassign to foreign-branch batch blocked', '42501', v_err, v_err = '42501');
      END;
    END;
  END IF;

  -- ── student position ───────────────────────────────────────────────
  BEGIN
    PERFORM secure_update_student_position(94, 'GK', v_attacker);
    INSERT INTO res VALUES ('position: foreign-branch student blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('position: foreign-branch student blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_update_student_position(2872, 'GK', v_attacker);
    INSERT INTO res VALUES ('position: own-branch student still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('position: own-branch student still works', 'succeeds', SQLERRM, FALSE);
  END;

  -- ── batch roster read ──────────────────────────────────────────────
  BEGIN
    PERFORM * FROM secure_fetch_batch_students(138, v_attacker);
    INSERT INTO res VALUES ('roster read: foreign-branch batch blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('roster read: foreign-branch batch blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM * FROM secure_fetch_batch_students(106, v_attacker);
    INSERT INTO res VALUES ('roster read: own-branch batch still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('roster read: own-branch batch still works', 'succeeds', SQLERRM, FALSE);
  END;

  -- ── session plans / phases / weekly schedules ─────────────────────
  -- create a temp own-branch session plan (batch 106) and grab the
  -- existing foreign-branch one (a07be6fe.., batch 138) found earlier.
  INSERT INTO session_plans (id, academy_id, batch_id, topic, date)
  VALUES (gen_random_uuid(), 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', 106, 'zz-own-plan', public.ist_today())
  RETURNING id INTO v_plan_own;

  BEGIN
    PERFORM secure_create_session_phase(jsonb_build_object('session_id', v_plan_foreign::text, 'title','x'), v_attacker);
    INSERT INTO res VALUES ('session phase create: foreign-branch plan blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('session phase create: foreign-branch plan blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    SELECT (secure_create_session_phase(jsonb_build_object('session_id', v_plan_own::text, 'title','x', 'position', 1, 'phase_name', 'Warmup'), v_attacker)->>'id')::UUID INTO v_phase_id;
    INSERT INTO res VALUES ('session phase create: own-branch plan still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('session phase create: own-branch plan still works', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_delete_session_phase('0c6a1a00-72fe-4893-a0b4-5f7a3b545d76', v_attacker);
    INSERT INTO res VALUES ('session phase delete: foreign-branch phase blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('session phase delete: foreign-branch phase blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_update_session_plan(v_plan_foreign, jsonb_build_object('notes','hacked'), v_attacker);
    INSERT INTO res VALUES ('session plan update: foreign-branch plan blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('session plan update: foreign-branch plan blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_update_session_plan(v_plan_own, jsonb_build_object('batch_id','138'), v_attacker);
    INSERT INTO res VALUES ('session plan update: reassign to foreign batch blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('session plan update: reassign to foreign batch blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_update_session_plan(v_plan_own, jsonb_build_object('notes','still mine'), v_attacker);
    INSERT INTO res VALUES ('session plan update: own-branch plan still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('session plan update: own-branch plan still works', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_reorder_session_phases(jsonb_build_array(jsonb_build_object('id','0c6a1a00-72fe-4893-a0b4-5f7a3b545d76','position',1)), v_attacker);
    INSERT INTO res VALUES ('reorder phases: foreign-branch phase blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('reorder phases: foreign-branch phase blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_insert_session_phases(jsonb_build_array(jsonb_build_object('session_id', v_plan_foreign::text, 'title','y')), v_attacker);
    INSERT INTO res VALUES ('bulk insert phases: foreign-branch plan blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('bulk insert phases: foreign-branch plan blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_delete_session_plan(v_plan_foreign, v_attacker);
    INSERT INTO res VALUES ('session plan delete: foreign-branch plan blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('session plan delete: foreign-branch plan blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_delete_session_plan(v_plan_own, v_attacker);
    INSERT INTO res VALUES ('session plan delete: own-branch plan still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('session plan delete: own-branch plan still works', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_update_weekly_schedule('59699890-747f-4872-a4f6-980e772926e6', jsonb_build_object('team_name','hacked'), v_attacker);
    INSERT INTO res VALUES ('weekly schedule update: foreign-branch schedule blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('weekly schedule update: foreign-branch schedule blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_delete_weekly_schedule('59699890-747f-4872-a4f6-980e772926e6', v_attacker);
    INSERT INTO res VALUES ('weekly schedule delete: foreign-branch schedule blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('weekly schedule delete: foreign-branch schedule blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_create_weekly_schedule(jsonb_build_object('team_name','x','batch_id','138'), v_attacker);
    INSERT INTO res VALUES ('weekly schedule create: foreign batch_id blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('weekly schedule create: foreign batch_id blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_create_weekly_schedule(jsonb_build_object('id', gen_random_uuid()::text, 'team_name','x','coach_name','x','week_start', public.ist_today()::text, 'grid', '{}'::jsonb, 'batch_id','106'), v_attacker);
    INSERT INTO res VALUES ('weekly schedule create: own batch_id still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('weekly schedule create: own batch_id still works', 'succeeds', SQLERRM, FALSE);
  END;

  -- ── pre-existing pgcrypto schema-qualifier bug (0195), found via the ──
  -- adversarial test above raising a real error for a legitimate call.
  BEGIN
    PERFORM secure_create_payment_link(2872, 250, 'zz-verify-0195', 1, NULL, v_attacker);
    INSERT INTO res VALUES ('payment link: gen_random_bytes now resolves (0195)', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('payment link: gen_random_bytes now resolves (0195)', 'succeeds', SQLERRM, FALSE);
  END;

  -- ── attendance: cross-academy batch_id ────────────────────────────
  BEGIN
    PERFORM secure_mark_attendance(2872, 1, v_attacker);
    INSERT INTO res VALUES ('mark attendance: cross-academy batch blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('mark attendance: cross-academy batch blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_mark_attendance(2872, 106, v_attacker);
    INSERT INTO res VALUES ('mark attendance: own-academy batch still works', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('mark attendance: own-academy batch still works', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_save_attendance_date(public.ist_today(), 1, jsonb_build_object('2872','Present'), v_attacker);
    INSERT INTO res VALUES ('save attendance date: cross-academy batch blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('save attendance date: cross-academy batch blocked', '42501', v_err, v_err = '42501');
  END;

  BEGIN
    PERFORM secure_upsert_attendance(
      jsonb_build_array(jsonb_build_object('date', public.ist_today()::text, 'student_id', 2872, 'batch_id', 1, 'present', true, 'status', 'Present')),
      v_attacker
    );
    INSERT INTO res VALUES ('upsert attendance: cross-academy batch blocked', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('upsert attendance: cross-academy batch blocked', '42501', v_err, v_err = '42501');
  END;

  -- ── secure_update_batch: location-scoped staff regression fix ─────
  BEGIN
    PERFORM secure_update_batch(138, jsonb_build_object('coach','Test Coach'), v_locmgr);
    INSERT INTO res VALUES ('update_batch: location-scoped staff CAN edit sibling-branch batch', 'succeeds', 'succeeded', TRUE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('update_batch: location-scoped staff CAN edit sibling-branch batch', 'succeeds', SQLERRM, FALSE);
  END;

  BEGIN
    PERFORM secure_update_batch(106, jsonb_build_object('coach','Test Coach'), v_locmgr);
    INSERT INTO res VALUES ('update_batch: location-scoped staff still blocked outside location', '42501', 'no error', FALSE);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
    INSERT INTO res VALUES ('update_batch: location-scoped staff still blocked outside location', '42501', v_err, v_err = '42501');
  END;
END $do$;

DELETE FROM staff_sessions WHERE token IN ('zz-iso-attacker','zz-iso-locmgr');
SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY pass, test;
ROLLBACK;
