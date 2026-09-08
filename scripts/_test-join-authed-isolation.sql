-- Authenticated cross-phone isolation test for the public /join funnel.
--
-- The anon probe (scripts/_test-join-isolation.mjs) proves an unauthenticated
-- caller is refused. This proves the harder half: that a caller who IS
-- verified still cannot reach another phone's or another academy's data.
--
-- SAFETY: everything runs inside one DO block that ends in RAISE EXCEPTION,
-- so every write it makes — trial rows, and the "New Registration" owner
-- notification the submit RPC fires — is rolled back. The results ride out in
-- the exception message. Nothing survives; the owner is never notified.
-- Sessions are forged with set_config('request.jwt.claims'), which is what
-- auth.uid() reads, against two REAL existing phone identities.
DO $$
DECLARE
  log        TEXT := E'\n';
  uid_a      UUID := '7ce8aaa5-384d-4bfe-a76b-e69b30edc3ca';  -- phone A
  uid_b      UUID := '5643aceb-75ba-45f8-a5d7-39a7d9132cd6';  -- phone B
  p10_a      TEXT;
  p10_b      TEXT;
  own_branch UUID := 'b32308fc-3bf7-463f-a456-59a13a67cd17';  -- ara / Football
  foreign_br UUID := '75d92eaf-7ed7-445c-a4fe-54d8db5b06dd';  -- ara-test-2
  res        JSON;
  new_id     BIGINT;
  a_trial    BIGINT;
  n          INT;
  bad        INT;
  sib        BIGINT;
  pass       INT := 0;
  fail       INT := 0;

BEGIN
  SELECT right(regexp_replace(phone,'\D','','g'),10) INTO p10_a FROM auth.users WHERE id = uid_a;
  SELECT right(regexp_replace(phone,'\D','','g'),10) INTO p10_b FROM auth.users WHERE id = uid_b;
  SELECT id INTO a_trial FROM trials WHERE phone = p10_a ORDER BY id DESC LIMIT 1;

  -- ── 1. As A, my_trials returns ONLY A's rows ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a)::TEXT, TRUE);
  res := secure_my_trials_v1('ara');
  SELECT count(*) INTO n   FROM json_array_elements(res);
  SELECT count(*) INTO bad FROM json_array_elements(res) e
    WHERE (e->>'phone') IS NOT NULL AND (e->>'phone') <> p10_a;
  IF bad = 0 THEN pass := pass+1; log := log || format('PASS  A sees only A rows (%s rows, 0 foreign)%s', n, E'\n');
  ELSE fail := fail+1; log := log || format('FAIL  A saw %s rows belonging to another phone%s', bad, E'\n'); END IF;

  -- ── 2. As B, my_trials must not contain A's newest trial ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_b)::TEXT, TRUE);
  res := secure_my_trials_v1('ara');
  SELECT count(*) INTO bad FROM json_array_elements(res) e WHERE (e->>'id')::BIGINT = a_trial;
  IF bad = 0 THEN pass := pass+1; log := log || format('PASS  B cannot see A trial #%s%s', a_trial, E'\n');
  ELSE fail := fail+1; log := log || format('FAIL  B could see A trial #%s%s', a_trial, E'\n'); END IF;

  -- ── 3. Cross-academy submit is refused ────────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a)::TEXT, TRUE);
    res := secure_submit_public_trial_v2(
      p_slug => 'ara', p_branch_id => foreign_br, p_batch_id => NULL,
      p_name => 'ROLLBACK PROBE', p_parent_name => 'ROLLBACK PROBE',
      p_emergency_contact_name => NULL, p_emergency_contact_phone => NULL,
      p_dob => NULL, p_age => NULL, p_medical_notes => NULL, p_document_path => NULL,
      p_trial_fee_mode => 'Not collected', p_trial_fee_amount => 0,
      p_relationship => NULL, p_sibling_of_trial_id => NULL, p_mother_name => NULL,
      p_address => NULL, p_gender => NULL, p_occupation => NULL,
      p_alternate_contact_phone => NULL, p_email => NULL, p_preferred_days => NULL);
    fail := fail+1; log := log || E'FAIL  cross-academy submit ACCEPTED\n';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%wrong academy%' THEN
      pass := pass+1; log := log || E'PASS  cross-academy submit refused (wrong academy)\n';
    ELSE
      fail := fail+1; log := log || format('FAIL  cross-academy submit raised unexpected: %s%s', SQLERRM, E'\n');
    END IF;
  END;

  -- ── 4. A submits legitimately; the row is stamped with A's
  --       SERVER-side phone, not anything the client sent ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_a)::TEXT, TRUE);
  res := secure_submit_public_trial_v2(
    p_slug => 'ara', p_branch_id => own_branch, p_batch_id => NULL,
    p_name => 'ROLLBACK PROBE A', p_parent_name => 'ROLLBACK PROBE',
    p_emergency_contact_name => 'x', p_emergency_contact_phone => '9999999999',
    p_dob => NULL, p_age => NULL, p_medical_notes => NULL, p_document_path => NULL,
    p_trial_fee_mode => 'Not collected', p_trial_fee_amount => 0,
    p_relationship => NULL, p_sibling_of_trial_id => NULL, p_mother_name => NULL,
    p_address => NULL, p_gender => NULL, p_occupation => NULL,
    p_alternate_contact_phone => NULL, p_email => NULL, p_preferred_days => NULL);
  new_id := (res->>'id')::BIGINT;
  SELECT count(*) INTO bad FROM trials WHERE id = new_id AND phone = p10_a;
  IF bad = 1 THEN pass := pass+1; log := log || format('PASS  new trial #%s stamped with A server phone%s', new_id, E'\n');
  ELSE fail := fail+1; log := log || E'FAIL  new trial not stamped with the session phone\n'; END IF;

  -- ── 5. B must not see the trial A just created ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid_b)::TEXT, TRUE);
  res := secure_my_trials_v1('ara');
  SELECT count(*) INTO bad FROM json_array_elements(res) e WHERE (e->>'id')::BIGINT = new_id;
  IF bad = 0 THEN pass := pass+1; log := log || format('PASS  B cannot see A brand-new trial #%s%s', new_id, E'\n');
  ELSE fail := fail+1; log := log || E'FAIL  B could see A brand-new trial\n'; END IF;

  -- ── 6. B cannot sibling-link to A's trial — the link must be
  --       silently dropped, not accepted ─────────────────────────
  res := secure_submit_public_trial_v2(
    p_slug => 'ara', p_branch_id => own_branch, p_batch_id => NULL,
    p_name => 'ROLLBACK PROBE B', p_parent_name => 'ROLLBACK PROBE',
    p_emergency_contact_name => 'x', p_emergency_contact_phone => '9999999999',
    p_dob => NULL, p_age => NULL, p_medical_notes => NULL, p_document_path => NULL,
    p_trial_fee_mode => 'Not collected', p_trial_fee_amount => 0,
    p_relationship => NULL, p_sibling_of_trial_id => new_id, p_mother_name => NULL,
    p_address => NULL, p_gender => NULL, p_occupation => NULL,
    p_alternate_contact_phone => NULL, p_email => NULL, p_preferred_days => NULL);
  SELECT sibling_of_trial_id INTO sib FROM trials WHERE id = (res->>'id')::BIGINT;
  IF sib IS NULL THEN pass := pass+1; log := log || E'PASS  B sibling-link to A trial dropped\n';
  ELSE fail := fail+1; log := log || format('FAIL  B linked as sibling of A trial #%s%s', sib, E'\n'); END IF;

  -- ── 7. Session with no sub at all is refused ──────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims', '{}', TRUE);
    res := secure_my_trials_v1('ara');
    fail := fail+1; log := log || E'FAIL  my_trials ACCEPTED with no session\n';
  EXCEPTION WHEN OTHERS THEN
    pass := pass+1; log := log || format('PASS  no-session my_trials refused (%s)%s', left(SQLERRM,40), E'\n');
  END;

  -- RAISE's placeholder is a bare %, not %s — using %s prints "7s passed".
  RAISE EXCEPTION E'TESTRESULTS%\n% passed, % failed  — ALL WRITES ROLLED BACK', log, pass, fail;
END $$;
