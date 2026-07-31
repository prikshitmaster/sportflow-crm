-- ============================================================
-- 0131 — deleting a student must NOT destroy their payment history
-- ============================================================
-- WHY
--   secure_delete_student ran `DELETE FROM payments WHERE student_id = ...`
--   before removing the student. Consequences:
--
--     • Money that was genuinely collected disappeared from the books with
--       no trace. Total revenue silently dropped.
--     • It only needs 'students.manage' (the receptionist preset has it) —
--       no 'payments.manage' required, so someone who cannot even record a
--       payment could erase years of them.
--     • It is audit-logged as a STUDENT deletion, so reviewing the payment
--       audit trail never surfaces it.
--     • It also wiped the TRIAL fee — collected before the person was even a
--       student — defeating the explicit guard in secure_delete_payment that
--       refuses to delete trial-linked rows precisely to stop that desync.
--     • payments_student_id_fkey is already ON DELETE SET NULL: the schema
--       was designed to PRESERVE payments. The RPC overrode that intent.
--
--   Confirmed in live data: trials TRL-2026-004 and TRL-2026-006 were
--   converted with receipts issued for 590 each, yet no payment rows remain
--   and no matching students exist — 1,180 of receipted cash gone.
--
-- WHAT CHANGES
--   The `DELETE FROM payments` line is removed. The foreign key then nulls
--   student_id on those rows, so the payment survives with its amount, date,
--   invoice id, mode and the student's NAME (payments.student is a TEXT copy)
--   intact. Revenue totals stop moving when someone tidies up a roster.
--
--   Everything else — permission check, cross-academy block, branch scope,
--   student_sessions cleanup — is byte-identical to security-v3/02.
--
-- NOTE: orphaned payment rows (student_id IS NULL, payment_type <> 'trial')
--   are now EXPECTED and correct. Do not "clean them up" — they are the
--   record that the money was received.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

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

  -- Payments are deliberately NOT deleted. payments_student_id_fkey is
  -- ON DELETE SET NULL, so each row keeps its amount/date/invoice id and the
  -- student's name, and collected revenue stays on the books.
  DELETE FROM student_sessions WHERE student_id = p_student_id;
  DELETE FROM students         WHERE id = p_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_student(BIGINT, TEXT) TO anon, authenticated;
