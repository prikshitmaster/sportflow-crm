-- ROLLBACK for the branch-scope policy rewrite (captured 2026-08-20T19:45:40.312Z)
-- Re-applying this file restores every policy to its exact pre-change definition.
BEGIN;

DROP POLICY IF EXISTS announcements_anon_read ON public.announcements;
CREATE POLICY announcements_anon_read ON public.announcements
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((branch_id IS NULL) OR (current_staff_branch() IS NULL) OR (branch_id = current_staff_branch())) AND ((sport IS NULL) OR (sport = ''::text) OR (current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
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
  WHERE ((s.id = attendance.student_id) AND (((s.academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (s.branch_id = current_staff_branch()))) OR (s.id = current_student_id()))))));

DROP POLICY IF EXISTS audit_logs_anon_read ON public.audit_logs;
CREATE POLICY audit_logs_anon_read ON public.audit_logs
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (branch_id IS NULL) OR (branch_id = current_staff_branch()))));

DROP POLICY IF EXISTS batches_anon_read ON public.batches;
CREATE POLICY batches_anon_read ON public.batches
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (branch_id = current_staff_branch())) AND ((current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
   FROM (unnest(batches.sports) bsport(bsport)
     JOIN unnest(current_staff_sports()) ssport(ssport) ON ((lower(bsport.bsport) = lower(ssport.ssport)))))))) OR (academy_id = current_student_academy())));

DROP POLICY IF EXISTS events_anon_read ON public.events;
CREATE POLICY events_anon_read ON public.events
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((branch_id IS NULL) OR (current_staff_branch() IS NULL) OR (branch_id = current_staff_branch()))) OR ((academy_id = current_student_academy()) AND ((branch_id IS NULL) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = current_student_id()) AND (s.branch_id = events.branch_id))))))));

DROP POLICY IF EXISTS leave_requests_anon_read ON public.leave_requests;
CREATE POLICY leave_requests_anon_read ON public.leave_requests
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (EXISTS ( SELECT 1
   FROM staff st
  WHERE ((st.id = leave_requests.staff_id) AND ((st.branch_id IS NULL) OR (st.branch_id = current_staff_branch()))))))));

DROP POLICY IF EXISTS payments_anon_read ON public.payments;
CREATE POLICY payments_anon_read ON public.payments
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (student_id IN ( SELECT students.id
   FROM students
  WHERE ((students.academy_id = current_staff_academy()) AND (students.branch_id = current_staff_branch())))) OR ((student_id IS NULL) AND (branch_id = current_staff_branch())))) OR (student_id = current_student_id())));

DROP POLICY IF EXISTS staff_checkins_anon_read ON public.staff_checkins;
CREATE POLICY staff_checkins_anon_read ON public.staff_checkins
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (EXISTS ( SELECT 1
   FROM staff st
  WHERE ((st.id = staff_checkins.staff_id) AND ((st.branch_id IS NULL) OR (st.branch_id = current_staff_branch()))))))));

DROP POLICY IF EXISTS students_anon_read ON public.students;
CREATE POLICY students_anon_read ON public.students
  AS PERMISSIVE
  FOR SELECT TO anon
  USING ((((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (branch_id = current_staff_branch()))) OR (id = current_student_id())));

DROP POLICY IF EXISTS trials_anon_read ON public.trials;
CREATE POLICY trials_anon_read ON public.trials
  AS PERMISSIVE
  FOR SELECT TO anon
  USING (((academy_id = current_staff_academy()) AND ((current_staff_branch() IS NULL) OR (branch_id = current_staff_branch())) AND ((current_staff_sports() IS NULL) OR (EXISTS ( SELECT 1
   FROM unnest(current_staff_sports()) sp(sp)
  WHERE (lower(sp.sp) = lower(trials.sport)))))));

COMMIT;
