-- 0075 — Close the 3 remaining open anon write policies
--
-- Leftovers the earlier lockdowns missed (same pattern as the old attendance
-- 0044 miss). With these in place, anyone holding the public anon key could
-- INSERT/UPDATE batches and INSERT students via direct REST, bypassing the
-- SECURITY DEFINER RPCs (perm + branch checks). Dropping them forces ALL writes
-- through the RPCs.
--
-- Safe because:
--   • batches_anon_update — no client caller (edits go via secure_update_batch).
--   • batches_anon_insert — batch creation is owner-only (secure_insert_batch);
--     CSV import runs as owner (authenticated → batches_owner_all).
--   • students_anon_insert — normal add-student uses create_student_with_payment
--     (SECURITY DEFINER); CSV import runs as owner (students_owner_all).
--   • RPCs are SECURITY DEFINER → bypass RLS → unaffected.
--   • owner_all (authenticated) policies are untouched.
--
-- Consequence: staff BULK CSV import of students/batches no longer works via anon
-- (it was already inconsistent — trials import has no anon policy). CSV import is
-- effectively owner-only now. Consider gating the Settings → Data tab to owners.

BEGIN;

DROP POLICY IF EXISTS batches_anon_insert  ON public.batches;
DROP POLICY IF EXISTS batches_anon_update  ON public.batches;
DROP POLICY IF EXISTS students_anon_insert ON public.students;

COMMIT;
