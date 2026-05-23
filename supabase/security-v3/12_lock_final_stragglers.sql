-- security-v3 / 12 — Phase 3.4b: lock the final 8 stragglers
--
-- After this, the only remaining wide-open SELECT on any tenant table
-- is gate_qr (intentional — gate scan must work pre-auth, validated
-- by token equality in secure_mark_attendance_qr).
--
-- Each table:
--   audit_logs          → drop anon_all; add anon SELECT scoped to academy
--   academies           → drop open_access; add SELECT scoped to academy
--   feature_flags       → drop anon_all; add SELECT scoped to academy
--   notifications       → drop anon_all; add SELECT scoped to recipient/academy
--   push_subscriptions  → drop anon_all; add SELECT scoped to user_id/academy
--   session_feedback    → drop both wide-open; add SELECT scoped to academy
--   student_badges      → drop open_access; add SELECT scoped to academy
--   payment_links       → drop wide-open SELECT (already RPC-gated via
--                         secure_fetch_payment_link)
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ═══ audit_logs ══════════════════════════════════════════════════
DROP POLICY IF EXISTS audit_logs_anon_all  ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_anon_read ON public.audit_logs;
CREATE POLICY audit_logs_anon_read ON public.audit_logs FOR SELECT TO anon
  USING (academy_id = current_staff_academy());
-- existing authenticated audit_logs_select remains in place

-- ═══ academies ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS open_access            ON public.academies;
DROP POLICY IF EXISTS academies_anon_read    ON public.academies;
DROP POLICY IF EXISTS academies_owner_read   ON public.academies;
CREATE POLICY academies_anon_read ON public.academies FOR SELECT TO anon
  USING (
    id = current_staff_academy()
    OR id = current_student_academy()
  );
CREATE POLICY academies_owner_read ON public.academies FOR SELECT TO authenticated
  USING (id = get_my_academy_id());
-- writes are owner-only via secure_update_academy / etc. (RPCs bypass RLS)

-- ═══ feature_flags ═══════════════════════════════════════════════
DROP POLICY IF EXISTS feature_flags_anon_all  ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_anon_read ON public.feature_flags;
CREATE POLICY feature_flags_anon_read ON public.feature_flags FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

-- ═══ notifications ═══════════════════════════════════════════════
DROP POLICY IF EXISTS notifications_anon_all  ON public.notifications;
DROP POLICY IF EXISTS notifications_anon_read ON public.notifications;
CREATE POLICY notifications_anon_read ON public.notifications FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

-- ═══ push_subscriptions ══════════════════════════════════════════
DROP POLICY IF EXISTS push_subscriptions_anon_all  ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_anon_read ON public.push_subscriptions;
CREATE POLICY push_subscriptions_anon_read ON public.push_subscriptions FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

-- ═══ session_feedback ════════════════════════════════════════════
DROP POLICY IF EXISTS session_feedback_anon_all  ON public.session_feedback;
DROP POLICY IF EXISTS session_feedback_all       ON public.session_feedback;
DROP POLICY IF EXISTS session_feedback_anon_read ON public.session_feedback;
CREATE POLICY session_feedback_anon_read ON public.session_feedback FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

-- ═══ student_badges ══════════════════════════════════════════════
DROP POLICY IF EXISTS open_access              ON public.student_badges;
DROP POLICY IF EXISTS student_badges_anon_read ON public.student_badges;
CREATE POLICY student_badges_anon_read ON public.student_badges FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR academy_id = current_student_academy()
  );

-- ═══ payment_links ═══════════════════════════════════════════════
-- Drop the wide-open SELECT. Public reads go through
-- secure_fetch_payment_link(short_code) which bypasses RLS as SECURITY
-- DEFINER. Direct .from('payment_links').select() now returns []
-- for anon — eliminates the short_code enumeration vector.
DROP POLICY IF EXISTS payment_links_select_anon ON public.payment_links;
DROP POLICY IF EXISTS payment_links_anon_read   ON public.payment_links;
CREATE POLICY payment_links_anon_read ON public.payment_links FOR SELECT TO anon
  USING (
    academy_id = current_staff_academy()
    OR student_id = current_student_id()
  );

COMMIT;
