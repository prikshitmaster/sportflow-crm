-- security-v3 / 29 — Close cross-tenant/cross-branch gaps found by a full
-- audit of every UPDATE/DELETE RPC (2026-08-10).
--
-- Two CONFIRMED cross-tenant vulnerabilities: secure_delete_session_phase
-- and secure_update_session_phase checked only "is the caller staff/owner",
-- never whether the session_phase row belonged to their own academy. Any
-- authenticated staff member from ANY academy could delete or rewrite ANY
-- other academy's session-plan content by id. Their sibling functions
-- (secure_delete_session_plan, secure_update_session_plan) had the check
-- correctly — these two just didn't.
--
-- Also closes two narrower gaps found in the same pass:
--   • secure_save_session_pulse / secure_upsert_spotlight checked academy
--     but not branch — a branch-scoped coach could rate/feedback a student
--     in a different branch of their own academy.
--   • secure_toggle_drill_favorite let the caller pass ANY staff_id (not
--     forced to their own), so staff could toggle favorites on someone
--     else's behalf, and never checked the drill belonged to their academy.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- secure_delete_session_phase — add the missing academy check, via
-- session_phases.session_id -> session_plans.academy_id (session_phases
-- has no academy_id column of its own).
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_delete_session_phase(p_id uuid, p_token text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a      RECORD;
  v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT sp.academy_id INTO v_acad
  FROM session_phases ph JOIN session_plans sp ON sp.id = ph.session_id
  WHERE ph.id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM session_phases WHERE id = p_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_delete_session_phase(uuid, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_update_session_phase — same fix, applied before the UPDATE.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_update_session_phase(p_id uuid, p_updates jsonb, p_token text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a      RECORD;
  v_acad UUID;
  v_row  session_phases%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT sp.academy_id INTO v_acad
  FROM session_phases ph JOIN session_plans sp ON sp.id = ph.session_id
  WHERE ph.id = p_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE session_phases sp SET
    phase_name      = COALESCE(p_updates->>'phase_name', sp.phase_name),
    area            = COALESCE(p_updates->>'area',       sp.area),
    context_ct      = COALESCE(p_updates->>'context_ct', sp.context_ct),
    context_mt      = COALESCE(p_updates->>'context_mt', sp.context_mt),
    duration        = COALESCE(NULLIF(p_updates->>'duration','')::INTEGER, sp.duration),
    position        = COALESCE(NULLIF(p_updates->>'position','')::INTEGER, sp.position),
    drill_id        = CASE WHEN p_updates ? 'drill_id'
                      THEN NULLIF(p_updates->>'drill_id','')::UUID
                      ELSE sp.drill_id END,
    procedure       = CASE WHEN p_updates ? 'procedure'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'procedure'))
                      ELSE sp.procedure END,
    coaching_points = CASE WHEN p_updates ? 'coaching_points'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'coaching_points'))
                      ELSE sp.coaching_points END,
    diagram_url     = COALESCE(NULLIF(p_updates->>'diagram_url',''), sp.diagram_url)
  WHERE sp.id = p_id
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_update_session_phase(uuid, jsonb, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_save_session_pulse — add branch check per record (was academy-only)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_save_session_pulse(p_date date, p_batch_id bigint, p_records jsonb, p_token text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a   RECORD;
  rec JSONB;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');
  END IF;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_records, '[]'::jsonb)) LOOP
    INSERT INTO session_feedback (date, batch_id, student_id, academy_id, staff_id, effort, execution, focus)
    SELECT p_date, p_batch_id, (rec->>'studentId')::BIGINT, a.academy_id,
           CASE WHEN a.actor_kind = 'staff' THEN a.actor_id ELSE NULL END,
           NULLIF(rec->>'effort','')::SMALLINT,
           NULLIF(rec->>'execution','')::SMALLINT,
           NULLIF(rec->>'focus','')::SMALLINT
    WHERE EXISTS (
      SELECT 1 FROM students s WHERE s.id = (rec->>'studentId')::BIGINT
        AND s.academy_id = a.academy_id
        AND (a.actor_kind = 'owner' OR a.branch_id IS NULL OR s.branch_id = a.branch_id)
    )
    ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
      effort    = EXCLUDED.effort,
      execution = EXCLUDED.execution,
      focus     = EXCLUDED.focus,
      staff_id  = EXCLUDED.staff_id;
  END LOOP;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_save_session_pulse(date, bigint, jsonb, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_upsert_spotlight — same branch-check addition.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_upsert_spotlight(
  p_date date, p_batch_id bigint, p_student_id bigint, p_technical smallint,
  p_tactical smallint, p_physical smallint, p_mental smallint,
  p_note text DEFAULT NULL::text, p_token text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    PERFORM _require_perm(a.actor_kind, a.perms, 'training.manage');
  END IF;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM students s WHERE s.id = p_student_id AND s.academy_id = a.academy_id
      AND (a.actor_kind = 'owner' OR a.branch_id IS NULL OR s.branch_id = a.branch_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: student not in your academy/branch' USING ERRCODE = '42501';
  END IF;

  INSERT INTO session_feedback (date, batch_id, student_id, academy_id, staff_id, technical, tactical, physical, mental, note, spotlight_at)
  VALUES (p_date, p_batch_id, p_student_id, a.academy_id,
          CASE WHEN a.actor_kind = 'staff' THEN a.actor_id ELSE NULL END,
          p_technical, p_tactical, p_physical, p_mental, NULLIF(p_note,''), now())
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    technical    = EXCLUDED.technical,
    tactical     = EXCLUDED.tactical,
    physical     = EXCLUDED.physical,
    mental       = EXCLUDED.mental,
    note         = EXCLUDED.note,
    spotlight_at = EXCLUDED.spotlight_at,
    staff_id     = EXCLUDED.staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_upsert_spotlight(date, bigint, bigint, smallint, smallint, smallint, smallint, text, text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- secure_toggle_drill_favorite — force p_staff_id to the caller's own id
-- for staff actors (was accepting any staff_id unchecked), and verify the
-- drill belongs to the caller's academy.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_toggle_drill_favorite(p_drill_id uuid, p_staff_id bigint, p_token text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a          RECORD;
  v_staff_id BIGINT;
  v_existing UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM drills d WHERE d.id = p_drill_id AND (d.is_global OR d.academy_id = a.academy_id)) THEN
    RAISE EXCEPTION 'forbidden: drill not in your academy' USING ERRCODE = '42501';
  END IF;
  -- Staff can only toggle their own favorites; owners may act on behalf of
  -- any staff id but it must belong to their academy.
  v_staff_id := p_staff_id;
  IF a.actor_kind = 'staff' THEN
    v_staff_id := a.actor_id;
  ELSIF NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = p_staff_id AND s.academy_id = a.academy_id) THEN
    RAISE EXCEPTION 'forbidden: staff not in your academy' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing FROM drill_favorites
  WHERE drill_id = p_drill_id AND staff_id = v_staff_id;
  IF FOUND THEN
    DELETE FROM drill_favorites WHERE id = v_existing;
    RETURN false;
  ELSE
    INSERT INTO drill_favorites (drill_id, staff_id, academy_id) VALUES (p_drill_id, v_staff_id, a.academy_id);
    RETURN true;
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.secure_toggle_drill_favorite(uuid, bigint, text) TO anon, authenticated;

COMMIT;
