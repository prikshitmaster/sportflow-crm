-- ============================================================
-- 0040 — Phase 2 Stage 6b: lock anon UPDATE on students
-- ============================================================
-- WHY
--   Stage 6a (migration 0039) added 4 SECURITY DEFINER RPCs covering
--   all write paths on the students table. The anon UPDATE policy
--   (students_anon_update, from migration 0031) is now redundant and
--   dangerous — a coach can still bypass the RPCs via DevTools:
--     supabase.from('students').update({ status: 'Active', paid_till: '2030-01-01' }).eq('id', X)
--   This migration closes that hole.
--
-- PRE-CONDITION
--   Apply AFTER migration 0039 AND after deploying the JS changes that
--   route all student updates through the secure RPCs.
--
-- STUDENT WRITE SURFACE AFTER THIS MIGRATION
--   profile/status/financial UPDATE → secure_update_student
--   self-service activation         → secure_activate_student_account
--   password reset                  → secure_reset_student_password
--   photo update                    → secure_update_student_photo
--   SELECT                          → students_anon_select (wide-open, intentional)
--   INSERT                          → create_student_with_payment RPC only
--   DELETE                          → secure_delete_student RPC only
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS students_anon_update ON public.students;

-- Sanity: SELECT policy should remain. Recreate if somehow missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'students'
      AND policyname = 'students_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY students_anon_select ON public.students FOR SELECT TO anon USING (true)';
  END IF;
END $$;
