-- 0175 — Phase 3: branch scope becomes a SET (one login covers a whole place)
--
-- WHY: sport_branches rows are (sport × location) pairs, so staff.branch_id pins
-- a person to ONE sport at ONE place. Four different managers at "ARA SG Highway"
-- can each see only their own sport; nobody sees the branch. This makes the read
-- scope a SET of branch rows, resolved from the new staff.location_id (0174).
--
-- BEHAVIOUR IS UNCHANGED until an owner sets staff.location_id: with it NULL,
-- current_staff_branch_ids() returns exactly ARRAY[branch_id], which makes every
-- rewritten predicate equivalent to the old single-branch equality.
--
-- Each policy below is its CURRENT definition (read back from pg_policies) with
-- ONLY the branch predicate substituted. Student arms, sport arms and audience
-- clauses are carried over byte-for-byte rather than retyped.
--
-- Rollback: supabase/rollbacks/0175_branch_scope_policies_ROLLBACK.sql
-- IDEMPOTENT.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- current_staff_branch_ids() → the caller's branch rows (NULL = all)
--
--   location_id set → every sport_branches row at that location
--   else branch_id  → ARRAY[branch_id]        (today's behaviour)
--   else            → NULL                    (office staff, academy-wide)
--
-- FAIL-CLOSED: a location with no sport rows yields an EMPTY array, not NULL —
-- empty matches nothing, whereas NULL would silently mean "see everything".
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION current_staff_branch_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN s.location_id IS NOT NULL THEN
             COALESCE((SELECT array_agg(sb.id) FROM sport_branches sb
                        WHERE sb.location_id = s.location_id), ARRAY[]::uuid[])
           WHEN s.branch_id IS NOT NULL THEN ARRAY[s.branch_id]
           ELSE NULL
         END
    FROM staff s
    JOIN staff_sessions ss ON ss.staff_id = s.id
   WHERE ss.token = current_setting('request.headers', true)::json->>'x-staff-token'
     AND ss.expires_at > now()
   LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION current_staff_branch_ids() TO anon, authenticated;

-- Mirrors "(current_staff_branch() IS NULL OR X = current_staff_branch())"
-- EXACTLY, including that a NULL X fails the equality — so substituting it into
-- the policies below preserves their semantics precisely.
CREATE OR REPLACE FUNCTION _branch_in_scope(p_target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_staff_branch_ids() IS NULL
      OR (p_target IS NOT NULL AND p_target = ANY(current_staff_branch_ids()))
$$;
GRANT EXECUTE ON FUNCTION _branch_in_scope(uuid) TO anon, authenticated;

-- "This caller has no branch restriction at all" — the office-staff bypass.
CREATE OR REPLACE FUNCTION _branch_scope_is_all()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_staff_branch_ids() IS NULL
$$;
GRANT EXECUTE ON FUNCTION _branch_scope_is_all() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Read policies — branch predicate swapped, everything else verbatim
-- ════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS announcements_anon_read ON public.announcements;
CREATE POLICY announcements_anon_read ON public.announcements
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((branch_id IS NULL) OR _branch_in_scope(branch_id)) AND ((sport IS NULL) OR (sport = ''::text) OR (current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
   FROM unnest(current_staff_sports()) sp(sp)
  WHERE (lower(sp.sp) = lower(announcements.sport)))))) OR ((academy_id = current_student_academy()) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = current_student_id()) AND (s.academy_id = announcements.academy_id) AND ((announcements.branch_id IS NULL) OR (s.branch_id = announcements.branch_id)) AND ((announcements.sport IS NULL) OR (announcements.sport = ''::text) OR (lower(COALESCE(s.sport, ''::text)) = lower(announcements.sport)))))))));

DROP POLICY IF EXISTS attendance_anon_read ON public.attendance;
CREATE POLICY attendance_anon_read ON public.attendance
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = attendance.student_id) AND (((s.academy_id = current_staff_academy()) AND _branch_in_scope(s.branch_id)) OR (s.id = current_student_id()))))));

DROP POLICY IF EXISTS audit_logs_anon_read ON public.audit_logs;
CREATE POLICY audit_logs_anon_read ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND ((branch_id IS NULL) OR _branch_in_scope(branch_id))));

DROP POLICY IF EXISTS batches_anon_read ON public.batches;
CREATE POLICY batches_anon_read ON public.batches
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND _branch_in_scope(branch_id) AND ((current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
   FROM (unnest(batches.sports) bsport(bsport)
     JOIN unnest(current_staff_sports()) ssport(ssport) ON ((lower(bsport.bsport) = lower(ssport.ssport)))))))) OR (academy_id = current_student_academy())));

DROP POLICY IF EXISTS events_anon_read ON public.events;
CREATE POLICY events_anon_read ON public.events
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((branch_id IS NULL) OR _branch_in_scope(branch_id))) OR ((academy_id = current_student_academy()) AND ((branch_id IS NULL) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = current_student_id()) AND (s.branch_id = events.branch_id))))))));

DROP POLICY IF EXISTS leave_requests_anon_read ON public.leave_requests;
CREATE POLICY leave_requests_anon_read ON public.leave_requests
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND (_branch_scope_is_all() OR (EXISTS ( SELECT 1
   FROM staff st
  WHERE ((st.id = leave_requests.staff_id) AND ((st.branch_id IS NULL) OR _branch_in_scope(st.branch_id))))))));

DROP POLICY IF EXISTS payments_anon_read ON public.payments;
CREATE POLICY payments_anon_read ON public.payments
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND (_branch_scope_is_all() OR (student_id IN ( SELECT students.id
   FROM students
  WHERE ((students.academy_id = current_staff_academy()) AND _branch_in_scope(students.branch_id)))) OR ((student_id IS NULL) AND _branch_in_scope(branch_id)))) OR (student_id = current_student_id())));

DROP POLICY IF EXISTS staff_checkins_anon_read ON public.staff_checkins;
CREATE POLICY staff_checkins_anon_read ON public.staff_checkins
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND (_branch_scope_is_all() OR (EXISTS ( SELECT 1
   FROM staff st
  WHERE ((st.id = staff_checkins.staff_id) AND ((st.branch_id IS NULL) OR _branch_in_scope(st.branch_id))))))));

DROP POLICY IF EXISTS students_anon_read ON public.students;
CREATE POLICY students_anon_read ON public.students
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND _branch_in_scope(branch_id)) OR (id = current_student_id())));

DROP POLICY IF EXISTS trials_anon_read ON public.trials;
CREATE POLICY trials_anon_read ON public.trials
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND _branch_in_scope(branch_id) AND ((current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
   FROM unnest(current_staff_sports()) sp(sp)
  WHERE (lower(sp.sp) = lower(trials.sport)))))));

COMMIT;
