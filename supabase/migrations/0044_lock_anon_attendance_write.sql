-- ============================================================
-- 0044 — Phase 6b: lock anon write on attendance
-- ============================================================
-- WHY
--   Phase 6a (migration 0043) added 4 SECURITY DEFINER RPCs covering
--   all write paths on the attendance table. The anon ALL policy
--   (attendance_anon_all, from 0032) still lets any anon caller forge
--   attendance directly:
--     supabase.from('attendance').insert({ student_id: X, date: '...', status: 'Present' })
--   This migration closes that hole.
--
-- ATTENDANCE WRITE SURFACE AFTER THIS MIGRATION
--   date-level save    → secure_save_attendance_date
--   month bulk upsert  → secure_upsert_attendance
--   live class mark    → secure_mark_attendance (coach/owner)
--   QR gate mark       → secure_mark_attendance_qr (gate token credential)
--   SELECT             → attendance_anon_select (wide-open, intentional)
--   INSERT/UPDATE/DELETE → all locked (RPC-only via SECURITY DEFINER)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS attendance_anon_all ON public.attendance;

-- Sanity: SELECT policy should remain. Recreate if somehow missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'attendance'
      AND policyname = 'attendance_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY attendance_anon_select ON public.attendance FOR SELECT TO anon USING (true)';
  END IF;
END $$;
