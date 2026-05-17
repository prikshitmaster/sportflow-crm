-- ============================================================
-- 0014 — Atomic counters & sequences (fixes QA_AUDIT C2, C3, C4)
-- ============================================================
-- Replaces three client-side race-prone patterns with atomic SQL:
--
--   C2 — `updateBatchEnrolled` did SELECT-then-UPDATE → +1 lost under concurrent assigns
--   C3 — `fetchNextInvoiceNum` did regex-max-client-side → INV-2026-117 collisions
--   C4 — `fetchNextStudentCode` did the same → SA122 collisions
--
-- All three are now done inside SECURITY DEFINER functions that hold no race window.
--
-- Idempotent: safe to run multiple times.
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║ bump_batch_enrolled — atomic increment / decrement       ║
-- ║                                                          ║
-- ║ Replaces: db.js  updateBatchEnrolled (lines 314-321)     ║
-- ║                                                          ║
-- ║ Before: two concurrent +1 calls both read enrolled=10,   ║
-- ║         both write 11 → counter drifts low.              ║
-- ║ After:  Postgres serialises the UPDATE; both deltas      ║
-- ║         apply atomically (10 → 11 → 12).                 ║
-- ╚══════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION bump_batch_enrolled(
  p_batch_id BIGINT,
  p_delta    INT
)
RETURNS INT  -- new enrolled value
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new INT;
BEGIN
  UPDATE batches
     SET enrolled = GREATEST(0, COALESCE(enrolled, 0) + p_delta)
   WHERE id = p_batch_id
  RETURNING enrolled INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'Batch % not found', p_batch_id;
  END IF;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION bump_batch_enrolled(BIGINT, INT) TO authenticated, anon;


-- ╔══════════════════════════════════════════════════════════╗
-- ║ next_invoice_id — sequential, race-free invoice numbers  ║
-- ║                                                          ║
-- ║ Replaces: db.js  fetchNextInvoiceNum (lines 927-939)     ║
-- ║                                                          ║
-- ║ Format: INV-YYYY-NNN (3-digit zero-padded). Sequence is  ║
-- ║ global, monotonic, never reused. Year prefix is just for ║
-- ║ readability — sequence does NOT reset annually (avoids   ║
-- ║ Jan-1 collision with last year's INV-YYYY-999).          ║
-- ╚══════════════════════════════════════════════════════════╝

-- Seed sequence ABOVE the current max so we don't collide with existing rows.
DO $$
DECLARE
  v_max INT := 0;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN id ~ '^INV-\d{4}-\d+$'
      THEN (regexp_match(id, '^INV-\d{4}-(\d+)$'))[1]::INT
      ELSE 0
    END
  ), 0)
    INTO v_max
    FROM payments;

  -- Create or advance the sequence to v_max + 1
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'invoice_num_seq') THEN
    EXECUTE format('CREATE SEQUENCE invoice_num_seq START WITH %s', v_max + 1);
  ELSE
    PERFORM setval('invoice_num_seq', GREATEST(v_max, (SELECT last_value FROM invoice_num_seq)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION next_invoice_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' ||
         lpad(nextval('invoice_num_seq')::TEXT, 3, '0');
$$;

GRANT EXECUTE ON FUNCTION next_invoice_id() TO authenticated, anon;


-- ╔══════════════════════════════════════════════════════════╗
-- ║ next_student_code — sequential, race-free SA codes       ║
-- ║                                                          ║
-- ║ Replaces: db.js  fetchNextStudentCode (lines 906-917)    ║
-- ║                                                          ║
-- ║ Format: SAnnn (3-digit zero-padded, grows to 4/5 digits  ║
-- ║ automatically as the academy scales).                    ║
-- ║                                                          ║
-- ║ Note: This is a GLOBAL sequence, not per-academy. That   ║
-- ║ matches existing behaviour (fetchNextStudentCode also    ║
-- ║ looked at all 'SA%' codes regardless of tenant). If you  ║
-- ║ later need per-academy codes, partition the sequence.    ║
-- ╚══════════════════════════════════════════════════════════╝

DO $$
DECLARE
  v_max INT := 0;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN student_code ~ '^SA\d+$'
      THEN substring(student_code FROM 3)::INT
      ELSE 0
    END
  ), 0)
    INTO v_max
    FROM students;

  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'student_code_seq') THEN
    EXECUTE format('CREATE SEQUENCE student_code_seq START WITH %s', v_max + 1);
  ELSE
    PERFORM setval('student_code_seq', GREATEST(v_max, (SELECT last_value FROM student_code_seq)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION next_student_code()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'SA' || lpad(nextval('student_code_seq')::TEXT, 3, '0');
$$;

GRANT EXECUTE ON FUNCTION next_student_code() TO authenticated, anon;


-- ============================================================
-- Verification queries (run after applying)
-- ============================================================
-- 1. Functions exist:
--    SELECT proname FROM pg_proc
--     WHERE proname IN ('bump_batch_enrolled', 'next_invoice_id', 'next_student_code');
--    → 3 rows
--
-- 2. Sequences seeded above current max:
--    SELECT last_value FROM invoice_num_seq;    -- should be ≥ existing max INV num
--    SELECT last_value FROM student_code_seq;   -- should be ≥ existing max SA num
--
-- 3. Smoke tests (read-only — these advance the seq, so only run once each):
--    SELECT next_invoice_id();    -- expect 'INV-2026-NNN'
--    SELECT next_student_code();  -- expect 'SAnnn'
--    SELECT bump_batch_enrolled(<existing batch_id>, 0); -- expect current enrolled, no change
--
-- 4. Race test (open 5 psql tabs, run simultaneously):
--    SELECT next_invoice_id();
--    → 5 distinct values, no duplicates
--
-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS bump_batch_enrolled(BIGINT, INT);
-- DROP FUNCTION IF EXISTS next_invoice_id();
-- DROP FUNCTION IF EXISTS next_student_code();
-- DROP SEQUENCE IF EXISTS invoice_num_seq;
-- DROP SEQUENCE IF EXISTS student_code_seq;
