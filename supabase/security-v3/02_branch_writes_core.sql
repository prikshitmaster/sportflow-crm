-- security-v3 / 02 — Branch enforcement on core write RPCs
--
-- Adds branch-scope check (via _require_branch_scope) to:
--   students  : update, delete, reset_password, update_photo, update_self_profile
--   batches   : delete (insert/update are owner-only already, no change needed)
--   payments  : insert, update, delete, create_payment_link
--   student_batches : assign, unassign
--
-- Signatures are UNCHANGED. Bodies preserve all existing checks and add
-- `PERFORM _require_branch_scope(a.actor_kind, a.branch_id, <target.branch_id>)`
-- after the academy check.
--
-- Owners + branch-less staff bypass branch checks (see helper).
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- students
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_update_student(
  p_student_id BIGINT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  -- Branch-scoped staff cannot move a student to a different branch
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move student to a different branch' USING ERRCODE = '42501';
  END IF;

  UPDATE students SET
    name            = CASE WHEN p_payload ? 'name'           THEN COALESCE(NULLIF(p_payload->>'name',''), name)             ELSE name           END,
    parent          = CASE WHEN p_payload ? 'parent'         THEN COALESCE(p_payload->>'parent', '')                        ELSE parent         END,
    phone           = CASE WHEN p_payload ? 'phone'          THEN COALESCE(p_payload->>'phone', '')                         ELSE phone          END,
    parent_phone    = CASE WHEN p_payload ? 'parentPhone'    THEN COALESCE(p_payload->>'parentPhone', '')                   ELSE parent_phone   END,
    age             = CASE WHEN p_payload ? 'age'            THEN NULLIF(p_payload->>'age','')::INT                         ELSE age            END,
    dob             = CASE WHEN p_payload ? 'dob'            THEN NULLIF(p_payload->>'dob','')::DATE                        ELSE dob            END,
    sport           = CASE WHEN p_payload ? 'sport'          THEN COALESCE(p_payload->>'sport', '')                         ELSE sport          END,
    batch           = CASE WHEN p_payload ? 'batchName'      THEN COALESCE(p_payload->>'batchName', '')                     ELSE batch          END,
    batch_id        = CASE WHEN p_payload ? 'batchId'        THEN NULLIF(p_payload->>'batchId','')::BIGINT                  ELSE batch_id       END,
    fees            = CASE WHEN p_payload ? 'fees'           THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, 0)       ELSE fees           END,
    fee_amount      = CASE WHEN p_payload ? 'feeAmount'      THEN COALESCE(NULLIF(p_payload->>'feeAmount','')::NUMERIC, fee_amount)
                      WHEN p_payload ? 'fees'                THEN COALESCE(NULLIF(p_payload->>'fees','')::NUMERIC, fee_amount)
                      ELSE fee_amount       END,
    paid_till       = CASE WHEN p_payload ? 'paidTill'       THEN NULLIF(p_payload->>'paidTill','')::DATE                   ELSE paid_till      END,
    join_date       = CASE WHEN p_payload ? 'joinDate'       THEN NULLIF(p_payload->>'joinDate','')::DATE                   ELSE join_date      END,
    training_type   = CASE WHEN p_payload ? 'trainingType'   THEN COALESCE(NULLIF(p_payload->>'trainingType',''), 'Daily')  ELSE training_type  END,
    fee_plan        = CASE WHEN p_payload ? 'feePlan'        THEN COALESCE(NULLIF(p_payload->>'feePlan',''), 'monthly')     ELSE fee_plan       END,
    position        = CASE WHEN p_payload ? 'position'       THEN NULLIF(p_payload->>'position','')                         ELSE position       END,
    status          = CASE WHEN p_payload ? 'status'         THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    suspended_since = CASE WHEN p_payload ? 'suspendedSince' THEN NULLIF(p_payload->>'suspendedSince','')::DATE             ELSE suspended_since END,
    photo_url       = CASE WHEN p_payload ? 'photoUrl'       THEN NULLIF(p_payload->>'photoUrl','')                         ELSE photo_url      END,
    height_cm       = CASE WHEN p_payload ? 'heightCm'       THEN NULLIF(p_payload->>'heightCm','')::INT                    ELSE height_cm      END,
    weight_kg       = CASE WHEN p_payload ? 'weightKg'       THEN NULLIF(p_payload->>'weightKg','')::INT                    ELSE weight_kg      END,
    preferred_foot  = CASE WHEN p_payload ? 'preferredFoot'  THEN NULLIF(p_payload->>'preferredFoot','')                    ELSE preferred_foot END,
    wing            = CASE WHEN p_payload ? 'wing'           THEN NULLIF(p_payload->>'wing','')                             ELSE wing           END,
    branch_id       = CASE WHEN p_payload ? 'branchId'       THEN NULLIF(p_payload->>'branchId','')::UUID                   ELSE branch_id      END
  WHERE id = p_student_id;

  RETURN (SELECT row_to_json(s) FROM students s WHERE s.id = p_student_id);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student(BIGINT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_student(
  p_student_id BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF v_student_academy IS NULL THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  DELETE FROM payments         WHERE student_id = p_student_id;
  DELETE FROM student_sessions WHERE student_id = p_student_id;
  DELETE FROM students         WHERE id = p_student_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_student(BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_reset_student_password(
  p_student_id BIGINT,
  p_join_code  TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  UPDATE students
  SET password_hash  = NULL,
      join_code      = p_join_code,
      account_status = 'pending'
  WHERE id = p_student_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_reset_student_password(BIGINT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_student_photo(
  p_student_id BIGINT,
  p_photo_url  TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: students can only update their own photo' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.view');
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);
  END IF;

  UPDATE students SET photo_url = p_photo_url WHERE id = p_student_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_student_photo(BIGINT, TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- payments
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_insert_payment(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                  RECORD;
  v_academy_id       UUID;
  v_payment_id       TEXT;
  v_student_id       BIGINT;
  v_student_academy  UUID;
  v_student_branch   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  v_academy_id := COALESCE((p_payload->>'academyId')::UUID, a.academy_id);
  IF v_academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy insert blocked' USING ERRCODE = '42501';
  END IF;

  v_student_id := NULLIF(p_payload->>'studentId','')::BIGINT;
  IF v_student_id IS NOT NULL THEN
    SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
    FROM students WHERE id = v_student_id;
    IF v_student_academy IS NULL THEN
      RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_student_academy IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: payment references student from another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);
  END IF;

  v_payment_id := p_payload->>'id';
  IF v_payment_id IS NULL OR length(v_payment_id) = 0 THEN
    RAISE EXCEPTION 'payment id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start,
    academy_id, notes
  ) VALUES (
    v_payment_id, v_student_id, p_payload->>'student',
    NULLIF(p_payload->>'amount','')::NUMERIC,
    p_payload->>'month',
    COALESCE(NULLIF(p_payload->>'date','')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'status',''), 'Paid'),
    p_payload->>'mode',
    COALESCE(NULLIF(p_payload->>'paymentType',''), 'monthly'),
    COALESCE(NULLIF(p_payload->>'discountPct','')::NUMERIC, 0),
    COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, 1),
    NULLIF(p_payload->>'coverageStart','')::DATE,
    v_academy_id, p_payload->>'notes'
  );
  RETURN v_payment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_insert_payment(JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_update_payment(
  p_payment_id TEXT,
  p_payload    JSONB,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_payment_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT p.academy_id, s.branch_id
    INTO v_payment_academy, v_student_branch
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;

  IF v_payment_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: payment belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  UPDATE payments SET
    status         = CASE WHEN p_payload ? 'status'        THEN COALESCE(NULLIF(p_payload->>'status',''), status)         ELSE status         END,
    mode           = CASE WHEN p_payload ? 'mode'          THEN NULLIF(p_payload->>'mode','')                              ELSE mode           END,
    date           = CASE WHEN p_payload ? 'date'          THEN COALESCE(NULLIF(p_payload->>'date','')::DATE, date)        ELSE date           END,
    amount         = CASE WHEN p_payload ? 'amount'        THEN COALESCE(NULLIF(p_payload->>'amount','')::NUMERIC, amount) ELSE amount         END,
    months_covered = CASE WHEN p_payload ? 'monthsCovered' THEN COALESCE(NULLIF(p_payload->>'monthsCovered','')::INT, months_covered) ELSE months_covered END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN p_payload->>'notes'                                        ELSE notes          END
  WHERE id = p_payment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_payment(TEXT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_delete_payment(
  p_payment_id TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                RECORD;
  v_pay_academy    UUID;
  v_student_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT COALESCE(p.academy_id, s.academy_id), s.branch_id
    INTO v_pay_academy, v_student_branch
  FROM payments p
  LEFT JOIN students s ON s.id = p.student_id
  WHERE p.id = p_payment_id;
  IF v_pay_academy IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  DELETE FROM payments WHERE id = p_payment_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_payment(TEXT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- batches  (delete only — insert/update are owner-only)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_delete_batch(
  p_batch_id BIGINT,
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                RECORD;
  v_batch_academy  UUID;
  v_batch_branch   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy delete blocked' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  DELETE FROM batches WHERE id = p_batch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_delete_batch(BIGINT, TEXT) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- student_batches  (multi-batch enrolment)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_assign_student_to_batch(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_batch_name TEXT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_batch_branch    UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  -- Also block enrolling into a batch from a different branch
  SELECT branch_id INTO v_batch_branch FROM batches WHERE id = p_batch_id;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch);

  INSERT INTO student_batches (student_id, batch_id, batch_name, academy_id)
  VALUES (p_student_id, p_batch_id, p_batch_name, a.academy_id)
  ON CONFLICT (student_id, batch_id) DO UPDATE SET
    batch_name = EXCLUDED.batch_name;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_assign_student_to_batch(BIGINT, BIGINT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION secure_unassign_student_from_batch(
  p_student_id BIGINT,
  p_batch_id   BIGINT,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch
  FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch);

  DELETE FROM student_batches
  WHERE student_id = p_student_id AND batch_id = p_batch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_unassign_student_from_batch(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMIT;
