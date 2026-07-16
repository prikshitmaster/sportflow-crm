-- ============================================================
-- 0105 — Restore writes to session_feedback (coach pulse/spotlight,
--        student self-reflection) via SECURITY DEFINER RPCs
-- ============================================================
-- WHY
--   security-v3/12_lock_final_stragglers.sql dropped the old
--   USING(true) policy on session_feedback (which allowed every role
--   to read AND write) and replaced it with an anon SELECT-only
--   policy. No INSERT/UPDATE policy — for anon OR authenticated — was
--   ever added back, and the app writes directly via
--   supabase.from('session_feedback').upsert(...) (db.js:
--   saveSessionPulse, upsertSpotlight, saveSelfReflection), not
--   through an RPC. Every one of those three write paths has been
--   completely broken since that migration ran: "new row violates
--   row-level security policy for table session_feedback".
--
-- FIX
--   Add three SECURITY DEFINER RPCs, following this codebase's
--   standard write pattern (current_actor + _require_perm), and
--   repoint db.js's three writer functions at them instead of the
--   raw .upsert() calls. academy_id is always taken from the
--   resolved actor server-side, never trusted from the client.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. Coach pulse — bulk upsert for a whole batch on one date ──
CREATE OR REPLACE FUNCTION secure_save_session_pulse(
  p_date     DATE,
  p_batch_id BIGINT,
  p_records  JSONB,     -- [{ studentId, effort, execution, focus }, ...]
  p_token    TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    WHERE EXISTS (SELECT 1 FROM students s WHERE s.id = (rec->>'studentId')::BIGINT AND s.academy_id = a.academy_id)
    ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
      effort    = EXCLUDED.effort,
      execution = EXCLUDED.execution,
      focus     = EXCLUDED.focus,
      staff_id  = EXCLUDED.staff_id;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_save_session_pulse(DATE, BIGINT, JSONB, TEXT) TO anon, authenticated;

-- ── 2. Coach spotlight — detailed 4-corner rating for one student ──
CREATE OR REPLACE FUNCTION secure_upsert_spotlight(
  p_date       DATE,
  p_batch_id   BIGINT,
  p_student_id BIGINT,
  p_technical  SMALLINT,
  p_tactical   SMALLINT,
  p_physical   SMALLINT,
  p_mental     SMALLINT,
  p_note       TEXT DEFAULT NULL,
  p_token      TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p_student_id AND s.academy_id = a.academy_id) THEN
    RAISE EXCEPTION 'forbidden: student not in your academy' USING ERRCODE = '42501';
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
$$;
GRANT EXECUTE ON FUNCTION secure_upsert_spotlight(DATE, BIGINT, BIGINT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. Student self-reflection — own row only ────────────────
CREATE OR REPLACE FUNCTION secure_save_self_reflection(
  p_date        DATE,
  p_batch_id    BIGINT,
  p_student_id  BIGINT,
  p_energy      SMALLINT,
  p_performance SMALLINT,
  p_focus       SMALLINT,
  p_token       TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'forbidden: students only' USING ERRCODE = '42501';
  END IF;
  IF a.actor_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'forbidden: can only reflect on own sessions' USING ERRCODE = '42501';
  END IF;

  INSERT INTO session_feedback (date, batch_id, student_id, academy_id, self_energy, self_performance, self_focus, self_at)
  VALUES (p_date, p_batch_id, p_student_id, a.academy_id, p_energy, p_performance, p_focus, now())
  ON CONFLICT (date, student_id, batch_id) DO UPDATE SET
    self_energy      = EXCLUDED.self_energy,
    self_performance = EXCLUDED.self_performance,
    self_focus       = EXCLUDED.self_focus,
    self_at          = EXCLUDED.self_at;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_save_self_reflection(DATE, BIGINT, BIGINT, SMALLINT, SMALLINT, SMALLINT, TEXT) TO anon, authenticated;
