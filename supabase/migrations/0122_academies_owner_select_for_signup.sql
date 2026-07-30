-- 0122: Add an owner-scoped SELECT policy on academies — fixes signup RLS error
-- that 0121 didn't fully resolve.
--
-- 0121 restored the INSERT policy, but createAcademy() in db.js does
-- `.insert(...).select().single()`, which PostgREST executes as an INSERT
-- ... RETURNING *. Postgres evaluates the RETURNING row against the table's
-- SELECT policies too — and the only SELECT policy available to an
-- authenticated user is academies_owner_read: USING (id = get_my_academy_id()),
-- where get_my_academy_id() reads academy_id off the caller's `profiles` row.
--
-- During owner signup, createAcademy() runs BEFORE createProfile() (see
-- AppContext.jsx signupOwner) — so no profiles row exists yet, get_my_academy_id()
-- returns NULL, the RETURNING row is invisible under RLS, and Postgres raises
-- the exact same "new row violates row-level security policy for table
-- academies" error even though the INSERT's WITH CHECK actually passed.
--
-- Fix: an authenticated user can always see an academy they own, independent
-- of whether their profile row exists yet.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

DROP POLICY IF EXISTS academies_owner_select ON public.academies;
CREATE POLICY academies_owner_select ON public.academies FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

COMMIT;
