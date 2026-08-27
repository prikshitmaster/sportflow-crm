-- 0194: full branch/sport isolation audit — close every remaining gap of the
-- same class as 0193 (a write path trusting a foreign-key id — batch_id,
-- into another branch-scoped table — without checking it belongs to the
-- actor's own branch scope, or in the worst cases, even the same academy).
--
-- Every function below is CREATE OR REPLACE with an UNCHANGED signature —
-- only body logic (added validation) changes, so no DROP FUNCTION is needed.

-- ── student documents: only checked academy, not branch ────────────────
CREATE OR REPLACE FUNCTION public.secure_add_student_document(p_student_id bigint, p_doc_type text, p_title text, p_file_path text, p_file_name text DEFAULT NULL::text, p_mime_type text DEFAULT NULL::text, p_size_bytes bigint DEFAULT NULL::bigint, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a       RECORD;
  v_acad  UUID;
  v_branch UUID;
  v_row   student_documents%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT academy_id, branch_id INTO v_acad, v_branch FROM students WHERE id = p_student_id;
  IF v_acad IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'forbidden: own documents only' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'staff' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    IF a.academy_id IS DISTINCT FROM v_acad THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  ELSIF a.actor_kind = 'owner' THEN
    IF a.academy_id IS DISTINCT FROM v_acad THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO student_documents
    (academy_id, student_id, doc_type, title, file_path, file_name, mime_type, size_bytes, uploaded_by)
  VALUES
    (v_acad, p_student_id, COALESCE(NULLIF(p_doc_type, ''), 'other'),
     COALESCE(NULLIF(p_title, ''), COALESCE(p_file_name, 'Document')),
     p_file_path, p_file_name, p_mime_type, p_size_bytes, a.actor_kind)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_delete_student_document(p_doc_id uuid, p_token text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_doc  student_documents%ROWTYPE;
  v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  SELECT * INTO v_doc FROM student_documents WHERE id = p_doc_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'document not found';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF a.actor_id IS DISTINCT FROM v_doc.student_id THEN
      RAISE EXCEPTION 'forbidden: own documents only' USING ERRCODE = '42501';
    END IF;
  ELSIF a.actor_kind = 'staff' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'students.manage');
    IF a.academy_id IS DISTINCT FROM v_doc.academy_id THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
    SELECT branch_id INTO v_branch FROM students WHERE id = v_doc.student_id;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  ELSIF a.actor_kind = 'owner' THEN
    IF a.academy_id IS DISTINCT FROM v_doc.academy_id THEN
      RAISE EXCEPTION 'forbidden: wrong academy' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM student_documents WHERE id = p_doc_id;
  RETURN v_doc.file_path;
END;
$function$;

-- ── payment links: money-adjacent, only checked academy ─────────────────
CREATE OR REPLACE FUNCTION public.secure_create_payment_link(p_student_id bigint, p_amount numeric, p_description text DEFAULT NULL::text, p_months integer DEFAULT 1, p_coverage_start date DEFAULT NULL::date, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a       RECORD;
  v_stud  RECORD;
  v_row   payment_links%ROWTYPE;
  v_code  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT id, academy_id, branch_id INTO v_stud FROM students WHERE id = p_student_id;
  IF v_stud.academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'student not found in this academy' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_stud.branch_id, a.actor_id);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = '22023';
  END IF;

  v_code := encode(gen_random_bytes(6), 'base64');
  v_code := translate(v_code, '+/=', 'AB_');

  INSERT INTO payment_links (
    academy_id, student_id, amount, description,
    months_covered, coverage_start, short_code, created_by
  ) VALUES (
    a.academy_id, p_student_id, p_amount, p_description,
    COALESCE(p_months, 1), p_coverage_start, v_code,
    COALESCE((SELECT name FROM profiles WHERE id = auth.uid()), 'Staff')
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

-- ── trials: only checked academy; update also let batchId through unvalidated ──
CREATE OR REPLACE FUNCTION public.secure_delete_trial(p_trial_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_trial_academy UUID;
  v_trial_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id, branch_id INTO v_trial_academy, v_trial_branch FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial delete' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch, a.actor_id);

  DELETE FROM payments WHERE trial_id = p_trial_id AND student_id IS NULL;

  DELETE FROM trials WHERE id = p_trial_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_update_trial(p_trial_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                  RECORD;
  v_trial_academy    UUID;
  v_trial_branch     UUID;
  v_was_converted    BOOLEAN;
  v_old_fee          NUMERIC;
  v_new_fee          NUMERIC;
  v_mode             TEXT;
  v_date             DATE;
  v_sport            TEXT;
  v_name             TEXT;
  v_branch           UUID;
  v_pay_id           TEXT;
  v_pay_student      BIGINT;
  v_receipt          TEXT;
  v_should_book      BOOLEAN;
  v_new_batch_id     BIGINT;
  v_new_batch_acad   UUID;
  v_new_batch_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id, branch_id, converted, trial_fee_paid
    INTO v_trial_academy, v_trial_branch, v_was_converted, v_old_fee
  FROM trials WHERE id = p_trial_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trial not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_trial_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy trial edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_trial_branch, a.actor_id);

  IF p_payload ? 'batchId' THEN
    v_new_batch_id := NULLIF(p_payload->>'batchId','')::BIGINT;
    IF v_new_batch_id IS NOT NULL THEN
      SELECT academy_id, branch_id INTO v_new_batch_acad, v_new_batch_branch FROM batches WHERE id = v_new_batch_id;
      IF v_new_batch_acad IS NULL THEN
        RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
      END IF;
      IF v_new_batch_acad IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_new_batch_branch, a.actor_id);
    END IF;
  END IF;

  IF v_was_converted
     AND p_payload ? 'trialFeePaid'
     AND (p_payload->>'trialFeePaid')::NUMERIC IS DISTINCT FROM v_old_fee THEN
    RAISE EXCEPTION 'Trial fee cannot be changed after the trial is converted — the student''s first payment was already adjusted by ₹%', v_old_fee
      USING ERRCODE = '22023';
  END IF;

  UPDATE trials SET
    name           = CASE WHEN p_payload ? 'name'          THEN p_payload->>'name'                              ELSE name           END,
    phone          = CASE WHEN p_payload ? 'phone'         THEN p_payload->>'phone'                             ELSE phone          END,
    parent         = CASE WHEN p_payload ? 'parent'        THEN p_payload->>'parent'                            ELSE parent         END,
    age            = CASE WHEN p_payload ? 'age'           THEN NULLIF(p_payload->>'age','')::INTEGER           ELSE age            END,
    sport          = CASE WHEN p_payload ? 'sport'         THEN p_payload->>'sport'                             ELSE sport          END,
    status         = CASE WHEN p_payload ? 'status'        THEN p_payload->>'status'                            ELSE status         END,
    stage          = CASE WHEN p_payload ? 'stage'         THEN p_payload->>'stage'                             ELSE stage          END,
    converted      = CASE WHEN p_payload ? 'converted'     THEN (p_payload->>'converted')::BOOLEAN              ELSE converted      END,
    follow_up      = CASE WHEN p_payload ? 'followUp'      THEN NULLIF(p_payload->>'followUp','')::DATE          ELSE follow_up      END,
    batch_id       = CASE WHEN p_payload ? 'batchId'       THEN NULLIF(p_payload->>'batchId','')::BIGINT        ELSE batch_id       END,
    trial_date     = CASE WHEN p_payload ? 'trialDate'     THEN (p_payload->>'trialDate')::DATE                 ELSE trial_date     END,
    trial_sessions = CASE WHEN p_payload ? 'trialSessions' THEN (p_payload->>'trialSessions')::INTEGER          ELSE trial_sessions END,
    sessions_done  = CASE WHEN p_payload ? 'sessionsDone'  THEN (p_payload->>'sessionsDone')::INTEGER           ELSE sessions_done  END,
    coach_note     = CASE WHEN p_payload ? 'coachNote'     THEN NULLIF(p_payload->>'coachNote','')              ELSE coach_note     END,
    coach_rec      = CASE WHEN p_payload ? 'coachRec'      THEN NULLIF(p_payload->>'coachRec','')               ELSE coach_rec      END,
    notes          = CASE WHEN p_payload ? 'notes'         THEN NULLIF(p_payload->>'notes','')                  ELSE notes          END,
    quoted_fee     = CASE WHEN p_payload ? 'quotedFee'     THEN NULLIF(p_payload->>'quotedFee','')::NUMERIC     ELSE quoted_fee     END,
    session_start  = CASE WHEN p_payload ? 'sessionStart'  THEN NULLIF(p_payload->>'sessionStart','')::TIME      ELSE session_start  END,
    session_end    = CASE WHEN p_payload ? 'sessionEnd'    THEN NULLIF(p_payload->>'sessionEnd','')::TIME        ELSE session_end    END,
    dob            = CASE WHEN p_payload ? 'dob'           THEN NULLIF(p_payload->>'dob','')::DATE              ELSE dob            END,
    age_group      = CASE WHEN p_payload ? 'ageGroup'      THEN NULLIF(p_payload->>'ageGroup','')               ELSE age_group      END,
    program_type   = CASE WHEN p_payload ? 'programType'   THEN COALESCE(NULLIF(p_payload->>'programType',''),'academy') ELSE program_type END,
    trial_fee_paid = CASE WHEN p_payload ? 'trialFeePaid'  THEN (p_payload->>'trialFeePaid')::NUMERIC           ELSE trial_fee_paid END,
    trial_fee_mode = CASE WHEN p_payload ? 'trialFeeMode'  THEN COALESCE(NULLIF(p_payload->>'trialFeeMode',''),'Not collected') ELSE trial_fee_mode END,
    tax_percent    = CASE WHEN p_payload ? 'taxPercent'    THEN NULLIF(p_payload->>'taxPercent','')::NUMERIC    ELSE tax_percent    END,
    tax_amount     = CASE WHEN p_payload ? 'taxAmount'     THEN NULLIF(p_payload->>'taxAmount','')::NUMERIC     ELSE tax_amount     END
  WHERE id = p_trial_id;

  SELECT trial_fee_paid, COALESCE(trial_fee_mode,'Not collected'), trial_date, sport, name, branch_id
    INTO v_new_fee, v_mode, v_date, v_sport, v_name, v_branch
  FROM trials WHERE id = p_trial_id;

  SELECT id, student_id INTO v_pay_id, v_pay_student
  FROM payments WHERE trial_id = p_trial_id;

  v_should_book := (COALESCE(v_new_fee,0) > 0 AND v_mode <> 'Not collected');

  IF v_should_book AND v_pay_id IS NOT NULL THEN
    UPDATE payments SET
      amount = v_new_fee,
      date   = v_date,
      month  = to_char(v_date, 'Mon YYYY'),
      mode   = v_mode,
      sport  = v_sport,
      student = v_name,
      notes  = 'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    WHERE id = v_pay_id;

  ELSIF v_should_book AND v_pay_id IS NULL THEN
    v_receipt := next_trial_receipt_id();
    INSERT INTO payments (
      id, student_id, student, amount, month, date, status, mode,
      payment_type, discount_pct, months_covered, academy_id,
      trial_id, branch_id, sport, notes
    ) VALUES (
      v_receipt, NULL, v_name, v_new_fee,
      to_char(v_date, 'Mon YYYY'), v_date, 'Paid', v_mode,
      'trial', 0, 1, v_trial_academy,
      p_trial_id, v_branch, v_sport,
      'Trial fee — trial on ' || to_char(v_date, 'DD Mon YYYY')
    );
    UPDATE trials SET receipt_no = v_receipt WHERE id = p_trial_id;

  ELSIF NOT v_should_book AND v_pay_id IS NOT NULL THEN
    IF v_pay_student IS NULL THEN
      DELETE FROM payments WHERE id = v_pay_id;
      UPDATE trials SET receipt_no = NULL WHERE id = p_trial_id;
    END IF;
  END IF;
END;
$function$;

-- ── student position: only checked academy, not branch ─────────────────
CREATE OR REPLACE FUNCTION public.secure_update_student_position(p_student_id bigint, p_position text, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_student_academy UUID;
  v_student_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;

  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_student_academy, v_student_branch FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy update' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind = 'staff' AND NOT (a.perms ? 'students.manage' OR a.perms ? 'training.manage') THEN
    RAISE EXCEPTION 'forbidden: missing permission students.manage or training.manage' USING ERRCODE = '42501';
  END IF;

  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_student_branch, a.actor_id);

  UPDATE students SET position = p_position WHERE id = p_student_id;
END;
$function$;

-- ── batch roster read: only checked academy, not branch (info disclosure) ──
CREATE OR REPLACE FUNCTION public.secure_fetch_batch_students(p_batch_id bigint, p_token text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, name text, "position" text, photo_url text, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_batch_academy UUID;
  v_batch_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch FROM batches WHERE batches.id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: batch not in your academy' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE students.id = a.actor_id AND students.batch_id = p_batch_id
      UNION
      SELECT 1 FROM student_batches WHERE student_id = a.actor_id AND batch_id = p_batch_id
    ) THEN
      RAISE EXCEPTION 'forbidden: not enrolled in that batch' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);
  END IF;

  RETURN QUERY
    WITH primary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      WHERE s.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    ),
    secondary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      JOIN student_batches sb ON sb.student_id = s.id
      WHERE sb.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    )
    SELECT DISTINCT all_in_batch.id, all_in_batch.name, all_in_batch.position, all_in_batch.photo_url, all_in_batch.status
    FROM (
      SELECT * FROM primary_in_batch
      UNION
      SELECT * FROM secondary_in_batch
    ) all_in_batch
    ORDER BY all_in_batch.name;
END;
$function$;

-- ── secure_update_batch: branch check was missing its 4th arg, silently ──
-- falling back to the legacy single-branch comparison instead of the
-- location-aware multi-branch scope — too STRICT for location-scoped staff
-- (blocks legitimate same-location cross-branch edits), a correctness bug
-- rather than a security hole, but inconsistent with every sibling function.
CREATE OR REPLACE FUNCTION public.secure_update_batch(p_batch_id bigint, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a               RECORD;
  v_batch_academy UUID;
  v_batch_branch  UUID;
  v_row           batches%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'batches.manage');

  SELECT academy_id, branch_id INTO v_batch_academy, v_batch_branch
  FROM batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: cross-academy batch edit' USING ERRCODE = '42501';
  END IF;
  PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);

  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL
     AND p_payload ? 'branchId'
     AND NULLIF(p_payload->>'branchId','')::UUID IS DISTINCT FROM a.branch_id
  THEN
    RAISE EXCEPTION 'forbidden: cannot move batch to a different branch' USING ERRCODE = '42501';
  END IF;

  IF p_payload ? 'batchType'
     AND lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development'))
         NOT IN ('development', 'advance')
  THEN
    RAISE EXCEPTION 'batch_type must be development or advance' USING ERRCODE = '23514';
  END IF;

  IF p_payload ? 'scheduleType'
     AND lower(COALESCE(NULLIF(trim(p_payload->>'scheduleType'), ''), 'alternate'))
         NOT IN ('alternate', 'daily')
  THEN
    RAISE EXCEPTION 'schedule_type must be alternate or daily' USING ERRCODE = '23514';
  END IF;

  UPDATE batches SET
    name          = CASE WHEN p_payload ? 'name'         THEN p_payload->>'name'                            ELSE name          END,
    time          = CASE WHEN p_payload ? 'time'         THEN p_payload->>'time'                            ELSE time          END,
    sports        = CASE WHEN p_payload ? 'sports'       THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'sports')) ELSE sports       END,
    coach         = CASE WHEN p_payload ? 'coach'        THEN p_payload->>'coach'                           ELSE coach         END,
    capacity      = CASE WHEN p_payload ? 'capacity'     THEN (p_payload->>'capacity')::INTEGER             ELSE capacity      END,
    days          = CASE WHEN p_payload ? 'days'         THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'days'))   ELSE days         END,
    start_time    = CASE WHEN p_payload ? 'startTime'    THEN NULLIF(p_payload->>'startTime', '')           ELSE start_time    END,
    end_time      = CASE WHEN p_payload ? 'endTime'      THEN NULLIF(p_payload->>'endTime', '')             ELSE end_time      END,
    age_min       = CASE WHEN p_payload ? 'ageMin'       THEN COALESCE((p_payload->>'ageMin')::INTEGER, 0) ELSE age_min      END,
    age_max       = CASE WHEN p_payload ? 'ageMax'       THEN COALESCE((p_payload->>'ageMax')::INTEGER, 99) ELSE age_max     END,
    ground        = CASE WHEN p_payload ? 'ground'       THEN NULLIF(p_payload->>'ground', '')              ELSE ground        END,
    code          = CASE WHEN p_payload ? 'code'         THEN NULLIF(p_payload->>'code', '')               ELSE code          END,
    default_fee   = CASE WHEN p_payload ? 'defaultFee'   THEN COALESCE((p_payload->>'defaultFee')::INTEGER, 0)  ELSE default_fee  END,
    default_plan  = CASE WHEN p_payload ? 'defaultPlan'  THEN COALESCE(p_payload->>'defaultPlan', 'monthly')    ELSE default_plan END,
    batch_type    = CASE WHEN p_payload ? 'batchType'    THEN lower(COALESCE(NULLIF(trim(p_payload->>'batchType'), ''), 'development')) ELSE batch_type END,
    schedule_type = CASE WHEN p_payload ? 'scheduleType' THEN lower(COALESCE(NULLIF(trim(p_payload->>'scheduleType'), ''), 'alternate')) ELSE schedule_type END,
    branch_id     = CASE WHEN p_payload ? 'branchId'     THEN NULLIF(p_payload->>'branchId','')::UUID            ELSE branch_id    END
  WHERE id = p_batch_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

-- ── session plans / phases / weekly schedules: only checked the row's own ──
-- academy_id column directly; none of these tables carry branch_id, it's
-- only reachable via batch_id -> batches.branch_id, and nothing traversed
-- that link. Reorder/bulk-insert had NO scope check at all.
CREATE OR REPLACE FUNCTION public.secure_create_session_phase(p_phase jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a       RECORD;
  v_row   session_phases%ROWTYPE;
  v_phase JSONB;
  v_acad  UUID;
  v_batch BIGINT;
  v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT sp.academy_id, sp.batch_id INTO v_acad, v_batch FROM session_plans sp WHERE sp.id = (p_phase->>'session_id')::UUID;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: session plan not in your academy' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;

  v_phase := p_phase;
  IF NOT (v_phase ? 'id') OR v_phase->>'id' IS NULL THEN
    v_phase := v_phase || jsonb_build_object('id', gen_random_uuid());
  END IF;
  INSERT INTO session_phases SELECT * FROM jsonb_populate_record(null::session_phases, v_phase)
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_delete_session_phase(p_id uuid, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_acad UUID;
  v_batch BIGINT;
  v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT sp.academy_id, sp.batch_id INTO v_acad, v_batch
  FROM session_phases ph JOIN session_plans sp ON sp.id = ph.session_id
  WHERE ph.id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;

  DELETE FROM session_phases WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_create_session_plan(p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_row session_plans%ROWTYPE;
  v_batch BIGINT; v_batch_acad UUID; v_batch_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_batch := NULLIF(p_payload->>'batch_id','')::BIGINT;
  IF v_batch IS NOT NULL THEN
    SELECT academy_id, branch_id INTO v_batch_acad, v_batch_branch FROM batches WHERE id = v_batch;
    IF v_batch_acad IS NULL THEN
      RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_batch_acad IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);
  END IF;

  INSERT INTO session_plans SELECT * FROM jsonb_populate_record(null::session_plans,
    p_payload || jsonb_build_object('academy_id', a.academy_id))
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_update_session_plan(p_id uuid, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_acad UUID; v_batch BIGINT; v_branch UUID;
  v_new_batch BIGINT; v_new_branch UUID; v_new_batch_acad UUID;
  v_row session_plans%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id, batch_id INTO v_acad, v_batch FROM session_plans WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;

  IF p_payload ? 'batch_id' THEN
    v_new_batch := NULLIF(p_payload->>'batch_id','')::BIGINT;
    IF v_new_batch IS NOT NULL THEN
      SELECT academy_id, branch_id INTO v_new_batch_acad, v_new_branch FROM batches WHERE id = v_new_batch;
      IF v_new_batch_acad IS NULL THEN
        RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
      END IF;
      IF v_new_batch_acad IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_new_branch, a.actor_id);
    END IF;
  END IF;

  UPDATE session_plans sp SET
    topic          = COALESCE(p_payload->>'topic',        sp.topic),
    objective      = COALESCE(p_payload->>'objective',    sp.objective),
    venue          = COALESCE(p_payload->>'venue',        sp.venue),
    status         = COALESCE(p_payload->>'status',       sp.status),
    notes          = COALESCE(p_payload->>'notes',        sp.notes),
    formation      = COALESCE(p_payload->>'formation',    sp.formation),
    grid_size      = COALESCE(p_payload->>'grid_size',    sp.grid_size),
    num_players    = COALESCE(NULLIF(p_payload->>'num_players','')::INTEGER,  sp.num_players),
    total_duration = COALESCE(NULLIF(p_payload->>'total_duration','')::INTEGER, sp.total_duration),
    date           = COALESCE(NULLIF(p_payload->>'date','')::DATE, sp.date),
    batch_id       = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, sp.batch_id),
    coach_id       = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, sp.coach_id),
    equipment      = CASE WHEN p_payload ? 'equipment'
                     THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'equipment'))
                     ELSE sp.equipment END,
    is_template    = COALESCE(NULLIF(p_payload->>'is_template','')::BOOLEAN, sp.is_template),
    template_name  = COALESCE(p_payload->>'template_name', sp.template_name),
    completed_at   = CASE WHEN p_payload ? 'completed_at'
                     THEN NULLIF(p_payload->>'completed_at','')::TIMESTAMPTZ
                     ELSE sp.completed_at END,
    updated_at     = now()
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_delete_session_plan(p_id uuid, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a RECORD; v_acad UUID; v_batch BIGINT; v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id, batch_id INTO v_acad, v_batch FROM session_plans WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;
  DELETE FROM session_plans WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_reorder_session_phases(p_updates jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; r RECORD;
  v_acad UUID; v_batch BIGINT; v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR r IN SELECT (u->>'id')::UUID AS id, (u->>'position')::INTEGER AS pos
           FROM jsonb_array_elements(p_updates) u
  LOOP
    SELECT sp.academy_id, sp.batch_id INTO v_acad, v_batch
    FROM session_phases ph JOIN session_plans sp ON sp.id = ph.session_id
    WHERE ph.id = r.id;
    IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: phase not in your academy' USING ERRCODE = '42501';
    END IF;
    IF v_batch IS NOT NULL THEN
      SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
    END IF;
    UPDATE session_phases SET position = r.pos WHERE id = r.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_insert_session_phases(p_phases jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_phase JSONB; v_phases JSONB := '[]'::JSONB;
  v_sid UUID; v_acad UUID; v_batch BIGINT; v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_phase IN SELECT value FROM jsonb_array_elements(p_phases) LOOP
    v_sid := (v_phase->>'session_id')::UUID;
    SELECT sp.academy_id, sp.batch_id INTO v_acad, v_batch FROM session_plans sp WHERE sp.id = v_sid;
    IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: session plan not in your academy' USING ERRCODE = '42501';
    END IF;
    IF v_batch IS NOT NULL THEN
      SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
    END IF;

    IF NOT (v_phase ? 'id') OR v_phase->>'id' IS NULL THEN
      v_phase := v_phase || jsonb_build_object('id', gen_random_uuid());
    END IF;
    v_phases := v_phases || jsonb_build_array(v_phase);
  END LOOP;
  INSERT INTO session_phases
  SELECT * FROM jsonb_populate_recordset(null::session_phases, v_phases);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_create_weekly_schedule(p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_row weekly_schedules%ROWTYPE;
  v_batch BIGINT; v_batch_acad UUID; v_batch_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  v_batch := NULLIF(p_payload->>'batch_id','')::BIGINT;
  IF v_batch IS NOT NULL THEN
    SELECT academy_id, branch_id INTO v_batch_acad, v_batch_branch FROM batches WHERE id = v_batch;
    IF v_batch_acad IS NULL THEN
      RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_batch_acad IS DISTINCT FROM a.academy_id THEN
      RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
    END IF;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_batch_branch, a.actor_id);
  END IF;

  INSERT INTO weekly_schedules SELECT * FROM jsonb_populate_record(null::weekly_schedules,
    p_payload
    || jsonb_build_object('academy_id', a.academy_id)
    || jsonb_build_object('created_at', now())
    || jsonb_build_object('updated_at', now())
  )
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_update_weekly_schedule(p_id uuid, p_payload jsonb, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD; v_acad UUID; v_batch BIGINT; v_branch UUID;
  v_new_batch BIGINT; v_new_batch_acad UUID; v_new_branch UUID;
  v_row weekly_schedules%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id, batch_id INTO v_acad, v_batch FROM weekly_schedules WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;

  IF p_payload ? 'batch_id' THEN
    v_new_batch := NULLIF(p_payload->>'batch_id','')::BIGINT;
    IF v_new_batch IS NOT NULL THEN
      SELECT academy_id, branch_id INTO v_new_batch_acad, v_new_branch FROM batches WHERE id = v_new_batch;
      IF v_new_batch_acad IS NULL THEN
        RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
      END IF;
      IF v_new_batch_acad IS DISTINCT FROM a.academy_id THEN
        RAISE EXCEPTION 'forbidden: batch belongs to another academy' USING ERRCODE = '42501';
      END IF;
      PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_new_branch, a.actor_id);
    END IF;
  END IF;

  UPDATE weekly_schedules ws SET
    team_name  = COALESCE(p_payload->>'team_name',  ws.team_name),
    coach_name = COALESCE(p_payload->>'coach_name', ws.coach_name),
    batch_id   = COALESCE(NULLIF(p_payload->>'batch_id','')::BIGINT, ws.batch_id),
    coach_id   = COALESCE(NULLIF(p_payload->>'coach_id','')::BIGINT, ws.coach_id),
    week_start = COALESCE(NULLIF(p_payload->>'week_start','')::DATE, ws.week_start),
    grid       = COALESCE(p_payload->'grid', ws.grid),
    updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_delete_weekly_schedule(p_id uuid, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a RECORD; v_acad UUID; v_batch BIGINT; v_branch UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');

  SELECT academy_id, batch_id INTO v_acad, v_batch FROM weekly_schedules WHERE id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_batch IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM batches WHERE id = v_batch;
    PERFORM _require_branch_scope(a.actor_kind, a.branch_id, v_branch, a.actor_id);
  END IF;

  DELETE FROM weekly_schedules WHERE id = p_id;
END;
$function$;

-- ── attendance writers: batch_id from the client was never validated ────
-- against ANY tenant boundary — could reference a batch in a different
-- academy entirely, not just a different branch. Deliberately checks only
-- academy here (not branch) since alternate-schedule/cross-batch attendance
-- is a legitimate real business flow this session hasn't fully mapped —
-- blocking cross-academy is the unambiguous, zero-risk fix.
CREATE OR REPLACE FUNCTION public.secure_mark_attendance(p_student_id bigint, p_batch_id bigint, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a                 RECORD;
  v_actor_name      TEXT;
  v_actor_br        UUID;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_student_batch   BIGINT;
  v_effective_batch BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  SELECT academy_id, branch_id, batch_id
    INTO v_student_academy, v_student_branch, v_student_batch
    FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;
  IF v_actor_br IS NOT NULL
     AND v_student_branch IS NOT NULL
     AND v_student_branch IS DISTINCT FROM v_actor_br THEN
    RAISE EXCEPTION 'forbidden: student in different branch' USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE id = p_batch_id AND academy_id = a.academy_id
  ) THEN
    RAISE EXCEPTION 'forbidden: batch not in your academy' USING ERRCODE = '42501';
  END IF;

  v_effective_batch := COALESCE(p_batch_id, v_student_batch);

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (public.ist_today(), p_student_id, v_effective_batch, true, 'Present', v_actor_name)
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.present   ELSE EXCLUDED.present   END,
    status    = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.status    ELSE EXCLUDED.status    END,
    marked_by = CASE WHEN attendance.status IN ('Present', 'Late') THEN attendance.marked_by ELSE EXCLUDED.marked_by END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_save_attendance_date(p_date date, p_batch_id bigint, p_records jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a            RECORD;
  v_actor_name TEXT;
  v_actor_br   UUID;
  v_to_delete  BIGINT[];
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_records) k
    JOIN students s ON s.id = k::BIGINT
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
       OR (v_actor_br IS NOT NULL
           AND s.branch_id IS NOT NULL
           AND s.branch_id IS DISTINCT FROM v_actor_br)
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance references student outside actor scope'
      USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM batches WHERE id = p_batch_id AND academy_id = a.academy_id
  ) THEN
    RAISE EXCEPTION 'forbidden: batch not in your academy' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(k::BIGINT) INTO v_to_delete
  FROM jsonb_each_text(p_records) r(k, v)
  WHERE r.v IS NULL OR r.v = '';

  IF v_to_delete IS NOT NULL AND array_length(v_to_delete, 1) > 0 THEN
    IF p_batch_id IS NOT NULL THEN
      DELETE FROM attendance
       WHERE date = p_date AND batch_id = p_batch_id AND student_id = ANY(v_to_delete);
    ELSE
      DELETE FROM attendance
       WHERE date = p_date AND student_id = ANY(v_to_delete)
         AND batch_id = (SELECT batch_id FROM students WHERE id = attendance.student_id);
    END IF;
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  SELECT
    p_date,
    r.k::BIGINT,
    COALESCE(p_batch_id, s.batch_id),
    r.v = 'Present',
    r.v,
    v_actor_name
  FROM jsonb_each_text(p_records) r(k, v)
  JOIN students s ON s.id = r.k::BIGINT
  WHERE r.v IS NOT NULL AND r.v != ''
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_upsert_attendance(p_rows jsonb, p_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a            RECORD;
  v_actor_name TEXT;
  v_actor_br   UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'attendance.manage');

  v_actor_br := _actor_branch(a.actor_kind, a.actor_id);

  IF a.actor_kind = 'owner' THEN
    SELECT name INTO v_actor_name FROM profiles WHERE id = auth.uid();
  ELSIF a.actor_kind = 'staff' THEN
    SELECT name INTO v_actor_name FROM staff WHERE id = a.actor_id;
  ELSIF a.actor_kind = 'student' THEN
    SELECT name INTO v_actor_name FROM students WHERE id = a.actor_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(student_id BIGINT)
    JOIN students s ON s.id = r.student_id
    WHERE s.academy_id IS DISTINCT FROM a.academy_id
       OR (v_actor_br IS NOT NULL
           AND s.branch_id IS NOT NULL
           AND s.branch_id IS DISTINCT FROM v_actor_br)
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance row references student outside actor scope'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(batch_id BIGINT)
    WHERE r.batch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.id = r.batch_id AND b.academy_id = a.academy_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: attendance row references a batch outside your academy'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  SELECT
    (r.date)::DATE,
    r.student_id,
    COALESCE(r.batch_id, s.batch_id),
    COALESCE(r.present, true),
    COALESCE(NULLIF(r.status, ''), 'Present'),
    v_actor_name
  FROM jsonb_to_recordset(p_rows) AS r(
    date       TEXT,
    student_id BIGINT,
    batch_id   BIGINT,
    present    BOOLEAN,
    status     TEXT
  )
  JOIN students s ON s.id = r.student_id
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    present   = EXCLUDED.present,
    status    = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;
END;
$function$;
