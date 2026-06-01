-- security-v3 / 22 — Gate QR is PER-BRANCH + hard branch-lock on scan
--
-- Before: gate_qr was keyed by academy_id only → one academy-wide QR shared by
-- every branch, and secure_mark_attendance_qr did no branch check, so a student
-- could mark via any branch's posted code.
--
-- After:
--   • gate_qr gains branch_id (NOT NULL). One unique QR per (academy, branch).
--   • get_or_create / regenerate are branch-scoped (owner passes the branch;
--     staff are forced into their own branch).
--   • secure_mark_attendance_qr resolves the token → its branch and HARD-BLOCKS
--     the scan when the student's branch ≠ the QR's branch.
--
-- Cleanup: the 3 legacy academy-wide rows (incl. a NULL-academy orphan and an
-- ARA duplicate) are deleted — they predate the branch model and any printed
-- copies are invalidated by design. New per-branch QRs are created on demand
-- the next time an owner opens the Gate QR page inside a branch.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ── Schema: add branch_id, wipe legacy rows, enforce one-per-branch ──
ALTER TABLE gate_qr ADD COLUMN IF NOT EXISTS branch_id uuid;
DELETE FROM gate_qr WHERE branch_id IS NULL;          -- all legacy academy-wide rows
ALTER TABLE gate_qr ALTER COLUMN branch_id SET NOT NULL;
DROP INDEX IF EXISTS gate_qr_academy_branch_uniq;
CREATE UNIQUE INDEX gate_qr_academy_branch_uniq ON gate_qr (academy_id, branch_id);

-- ════════════════════════════════════════════════════════════════
-- secure_get_or_create_gate_qr — per-branch
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS secure_get_or_create_gate_qr(text, text);
CREATE OR REPLACE FUNCTION secure_get_or_create_gate_qr(
  p_academy_name text DEFAULT 'Academy Gate'::text,
  p_token        text DEFAULT NULL::text,
  p_branch_id    uuid DEFAULT NULL::uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a         RECORD;
  v_row     gate_qr%ROWTYPE;
  v_tok     TEXT;
  v_branch  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Resolve branch: staff are forced into their own; owner uses payload.
  v_branch := p_branch_id;
  IF a.actor_kind = 'staff' AND a.branch_id IS NOT NULL THEN
    v_branch := a.branch_id;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Open a specific branch to view its gate QR' USING ERRCODE = '23502';
  END IF;

  -- Staff with attendance.manage: read their branch's QR, never create.
  IF a.actor_kind = 'staff' THEN
    IF NOT (a.perms ? 'attendance.manage') THEN
      RAISE EXCEPTION 'forbidden: missing attendance.manage permission' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM gate_qr
    WHERE academy_id = a.academy_id AND branch_id = v_branch
    ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate QR not set up for this branch yet — ask the academy owner' USING ERRCODE = 'P0002';
    END IF;
    RETURN row_to_json(v_row);
  END IF;

  IF a.actor_kind != 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Owner: get-or-create for this branch.
  SELECT * INTO v_row FROM gate_qr
  WHERE academy_id = a.academy_id AND branch_id = v_branch
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN row_to_json(v_row); END IF;

  v_tok := encode(gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id, branch_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id, v_branch)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_get_or_create_gate_qr(text, text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_regenerate_gate_qr — per-branch (owner only)
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS secure_regenerate_gate_qr(text, text);
CREATE OR REPLACE FUNCTION secure_regenerate_gate_qr(
  p_academy_name text DEFAULT 'Academy Gate'::text,
  p_token        text DEFAULT NULL::text,
  p_branch_id    uuid DEFAULT NULL::uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a      RECORD;
  v_row  gate_qr%ROWTYPE;
  v_tok  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden: only academy owners can manage gate QR' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Open a specific branch to regenerate its gate QR' USING ERRCODE = '23502';
  END IF;

  -- Only this branch's QR is replaced — other branches keep their codes.
  DELETE FROM gate_qr WHERE academy_id = a.academy_id AND branch_id = p_branch_id;

  v_tok := encode(gen_random_bytes(16), 'hex');
  INSERT INTO gate_qr (token, academy_name, academy_id, branch_id)
  VALUES (v_tok, COALESCE(p_academy_name, 'Academy Gate'), a.academy_id, p_branch_id)
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_regenerate_gate_qr(text, text, uuid) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_mark_attendance_qr — hard branch-lock
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION secure_mark_attendance_qr(
  p_student_id bigint, p_gate_token text, p_batch_id bigint, p_academy_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_qr_branch       UUID;
  v_qr_found        BOOLEAN;
  v_student_academy UUID;
  v_student_branch  UUID;
  v_student_name    TEXT;
  v_student_batch   BIGINT;
  v_effective_batch BIGINT;
BEGIN
  -- Validate gate token against this academy and capture its branch.
  SELECT branch_id, true INTO v_qr_branch, v_qr_found
  FROM gate_qr WHERE token = p_gate_token AND academy_id = p_academy_id
  LIMIT 1;
  IF NOT v_qr_found THEN
    RAISE EXCEPTION 'Invalid gate QR code' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id, branch_id, name, batch_id
    INTO v_student_academy, v_student_branch, v_student_name, v_student_batch
    FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = 'P0002'; END IF;
  IF v_student_academy IS DISTINCT FROM p_academy_id THEN
    RAISE EXCEPTION 'forbidden: student belongs to another academy' USING ERRCODE = '42501';
  END IF;

  -- HARD BRANCH-LOCK: this QR only marks students of its own branch.
  IF v_student_branch IS DISTINCT FROM v_qr_branch THEN
    RAISE EXCEPTION 'This QR is for a different branch — scan your own branch''s gate code'
      USING ERRCODE = '42501';
  END IF;

  v_effective_batch := COALESCE(p_batch_id, v_student_batch);

  IF EXISTS (
    SELECT 1 FROM attendance
    WHERE date = CURRENT_DATE
      AND student_id = p_student_id
      AND batch_id IS NOT DISTINCT FROM v_effective_batch
  ) THEN
    RAISE EXCEPTION 'already marked' USING ERRCODE = '23505';
  END IF;

  INSERT INTO attendance (date, student_id, batch_id, present, status, marked_by)
  VALUES (CURRENT_DATE, p_student_id, v_effective_batch, true, 'Present', v_student_name);
END;
$function$;
GRANT EXECUTE ON FUNCTION secure_mark_attendance_qr(bigint, text, bigint, uuid) TO anon, authenticated;

COMMIT;
