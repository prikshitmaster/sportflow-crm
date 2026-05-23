-- security-v3 / 05 — Lock session tables (anon SELECT/INSERT/UPDATE/DELETE removed)
--
-- staff_sessions + student_sessions are now ONLY accessed via:
--   - secure_login_staff / secure_login_student     (INSERTs the row)
--   - secure_validate_staff_session / student       (SELECTs the row)
--   - secure_logout_staff / secure_logout_student   (DELETEs by token)
-- All four RPCs are SECURITY DEFINER and bypass RLS. So dropping every
-- anon/authenticated policy makes these tables completely RPC-gated.
--
-- The remaining policies on the tables (none, after this) mean:
--   - RLS is enabled (per pg_tables.rowsecurity = true, already)
--   - No policy grants any role any access
--   - SECURITY DEFINER functions (running as table owner) bypass RLS
-- Net effect: direct .from('staff_sessions').select() returns 0 rows
-- for any non-superuser role, while RPCs continue to work.
--
-- IDEMPOTENT — DROP POLICY IF EXISTS for every known policy name.

BEGIN;

-- staff_sessions: drop every policy
DROP POLICY IF EXISTS "open_access"              ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_anon_full" ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_all"       ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_anon_select" ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_anon_insert" ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_anon_update" ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_anon_delete" ON public.staff_sessions;
DROP POLICY IF EXISTS "staff_sessions_owner_all"   ON public.staff_sessions;

-- student_sessions: drop every policy
DROP POLICY IF EXISTS "open_access"                 ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_anon_full"  ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_all"        ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_anon_select" ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_anon_insert" ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_anon_update" ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_anon_delete" ON public.student_sessions;
DROP POLICY IF EXISTS "student_sessions_owner_all"   ON public.student_sessions;

-- RLS must remain enabled (it already is per pg_tables.rowsecurity = true,
-- but assert explicitly so a future ALTER TABLE ... DISABLE RLS doesn't slip in)
ALTER TABLE public.staff_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_sessions ENABLE ROW LEVEL SECURITY;

COMMIT;
