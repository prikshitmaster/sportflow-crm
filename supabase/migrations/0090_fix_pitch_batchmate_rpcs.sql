-- 0090: Fix "column reference 'id' is ambiguous" in the student pitch RPCs.
--
-- secure_fetch_student_batchmates and secure_fetch_batch_students both end with
--   SELECT DISTINCT id, name, position, photo_url, status FROM (...) alias
-- The unqualified columns collide with the function's own RETURNS TABLE OUT
-- parameters (id, name, ...), so Postgres raises 42702 "column reference 'id'
-- is ambiguous" and the call throws. The student Stats/pitch ("competition")
-- view swallows the error, so batchmates silently never load.
-- Fix: qualify the final SELECT + ORDER BY with the subquery alias.

CREATE OR REPLACE FUNCTION public.secure_fetch_student_batchmates(p_student_id bigint, p_token text DEFAULT NULL)
RETURNS TABLE(id bigint, name text, "position" text, photo_url text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a               RECORD;
  v_primary_batch BIGINT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind = 'student' AND a.actor_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'forbidden: students may only fetch their own batchmates' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind IN ('staff', 'owner') THEN
    IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p_student_id AND s.academy_id = a.academy_id) THEN
      RAISE EXCEPTION 'forbidden: student not in your academy' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT batch_id INTO v_primary_batch FROM students WHERE students.id = p_student_id;

  RETURN QUERY
    WITH batch_ids AS (
      SELECT v_primary_batch AS batch_id WHERE v_primary_batch IS NOT NULL
      UNION
      SELECT sb.batch_id FROM student_batches sb WHERE sb.student_id = p_student_id
    ),
    primary_mates AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      WHERE s.batch_id IN (SELECT batch_id FROM batch_ids)
        AND COALESCE(s.status, '') <> 'Deleted'
    ),
    secondary_mates AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      JOIN student_batches sb ON sb.student_id = s.id
      WHERE sb.batch_id IN (SELECT batch_id FROM batch_ids)
        AND COALESCE(s.status, '') <> 'Deleted'
    )
    SELECT DISTINCT all_mates.id, all_mates.name, all_mates.position, all_mates.photo_url, all_mates.status
    FROM (
      SELECT * FROM primary_mates
      UNION
      SELECT * FROM secondary_mates
    ) all_mates
    ORDER BY all_mates.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.secure_fetch_batch_students(p_batch_id bigint, p_token text DEFAULT NULL)
RETURNS TABLE(id bigint, name text, "position" text, photo_url text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  a               RECORD;
  v_batch_academy UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_batch_academy FROM batches WHERE batches.id = p_batch_id;
  IF v_batch_academy IS NULL THEN
    RAISE EXCEPTION 'batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden: batch not in your academy' USING ERRCODE = '42501';
  END IF;

  IF a.actor_kind = 'student' THEN
    IF NOT EXISTS (
      SELECT 1 FROM students WHERE students.id = a.actor_id AND students.batch_id = p_batch_id
      UNION
      SELECT 1 FROM student_batches WHERE student_id = a.actor_id AND batch_id = p_batch_id
    ) THEN
      RAISE EXCEPTION 'forbidden: not enrolled in that batch' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
    WITH primary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      WHERE s.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    ),
    secondary_in_batch AS (
      SELECT s.id, s.name, s.position, s.photo_url, s.status
      FROM students s
      JOIN student_batches sb ON sb.student_id = s.id
      WHERE sb.batch_id = p_batch_id
        AND COALESCE(s.status, '') <> 'Deleted'
    )
    SELECT DISTINCT all_in_batch.id, all_in_batch.name, all_in_batch.position, all_in_batch.photo_url, all_in_batch.status
    FROM (
      SELECT * FROM primary_in_batch
      UNION
      SELECT * FROM secondary_in_batch
    ) all_in_batch
    ORDER BY all_in_batch.name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.secure_fetch_student_batchmates(bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_fetch_batch_students(bigint, text) TO anon, authenticated;
