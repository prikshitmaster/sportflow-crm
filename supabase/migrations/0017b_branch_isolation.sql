-- ============================================================
-- 0017b — Full Branch Isolation — APPLY (additive + backfill)
-- ============================================================
-- Prerequisites:
--   • Migration 0016b already applied (creates sport_branches table)
--   • Dryrun 0017a reviewed
--
-- Guarantees:
--   • Wrapped in BEGIN/COMMIT — atomic
--   • Fully idempotent — safe to re-run
--   • NO destructive changes:
--       - No DROP, no column rename, no row deletion
--       - New columns are NULLABLE — old code paths unaffected
--   • Backfill creates Branch 1 + (when needed) Branch 2 per sport
--   • Existing 71 students etc. → assigned to Branch 1 of their sport
--   • Legacy "Football _ARA _ branch 2" students → reassigned to Branch 2
--   • Payment / attendance / fee logic UNTOUCHED
--
-- Rollback: see 0017_rollback.sql
-- ============================================================

BEGIN;

-- ── Step 1: Add branch_id columns (all nullable)
ALTER TABLE students    ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE batches     ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE staff       ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE trials      ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE audit_logs  ADD COLUMN IF NOT EXISTS branch_id uuid;

-- Indexes for fast scoped queries
CREATE INDEX IF NOT EXISTS students_branch_id_idx   ON students  (branch_id);
CREATE INDEX IF NOT EXISTS batches_branch_id_idx    ON batches   (branch_id);
CREATE INDEX IF NOT EXISTS staff_branch_id_idx      ON staff     (branch_id);
CREATE INDEX IF NOT EXISTS trials_branch_id_idx     ON trials    (branch_id);
CREATE INDEX IF NOT EXISTS audit_logs_branch_id_idx ON audit_logs(branch_id);

-- ── Step 2: Normalize sport names to canonical Title Case
-- For students/trials only — these are scalar text columns.
-- We do NOT touch batches.sports[] / staff.sports[] arrays (riskier).
-- This step is conditional: only renames if value is a known catalog lowercase.
UPDATE students SET sport = INITCAP(LOWER(sport))
 WHERE sport IS NOT NULL
   AND sport <> ''
   AND LOWER(sport) IN ('football','cricket','tennis','squash','table tennis',
                        'basketball','badminton','swimming','volleyball','hockey')
   AND sport <> INITCAP(LOWER(sport));   -- skip rows already canonical

UPDATE trials SET sport = INITCAP(LOWER(sport))
 WHERE sport IS NOT NULL
   AND sport <> ''
   AND LOWER(sport) IN ('football','cricket','tennis','squash','table tennis',
                        'basketball','badminton','swimming','volleyball','hockey')
   AND sport <> INITCAP(LOWER(sport));

-- ── Step 3: Create "Branch 1" row in sport_branches for every distinct sport
-- that exists in students.sport (after normalization).
INSERT INTO sport_branches (academy_id, sport_name, branch_name)
SELECT DISTINCT s.academy_id, s.sport, 'Branch 1'
  FROM students s
 WHERE s.academy_id IS NOT NULL
   AND s.sport IS NOT NULL
   AND s.sport <> ''
   AND LOWER(s.sport) IN ('football','cricket','tennis','squash','table tennis',
                          'basketball','badminton','swimming','volleyball','hockey')
ON CONFLICT (academy_id, sport_name, branch_name) DO NOTHING;

-- ── Step 4: Special case — convert legacy "Football _ARA _ branch 2" to a real Branch 2
-- For every academy that has any student with that pattern → create Branch 2 under Football
INSERT INTO sport_branches (academy_id, sport_name, branch_name)
SELECT DISTINCT s.academy_id, 'Football', 'Branch 2'
  FROM students s
 WHERE s.academy_id IS NOT NULL
   AND LOWER(s.sport) LIKE 'football%branch%2%'
ON CONFLICT (academy_id, sport_name, branch_name) DO NOTHING;

-- ── Step 5: Assign students to branches
-- Pass 1: Legacy "Football _ARA _ branch 2" → Football / Branch 2
UPDATE students s
   SET sport     = 'Football',
       branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = s.academy_id
   AND sb.sport_name = 'Football'
   AND sb.branch_name = 'Branch 2'
   AND LOWER(s.sport) LIKE 'football%branch%2%'
   AND s.branch_id IS NULL;

-- Pass 2: Everyone else → Branch 1 of their sport
UPDATE students s
   SET branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = s.academy_id
   AND sb.sport_name = s.sport
   AND sb.branch_name = 'Branch 1'
   AND s.branch_id IS NULL;

-- ── Step 6a: Batches — legacy "Football _ARA _ branch 2" handling
-- Replace 'Football _ARA _ branch 2' inside the sports[] array with 'Football',
-- then DEDUPE the array (since some rows already contain both values),
-- then assign branch_id = Football/Branch 2.
UPDATE batches b
   SET sports    = ARRAY(
                     SELECT DISTINCT unnest(
                       array_replace(b.sports, 'Football _ARA _ branch 2', 'Football')
                     )
                   ),
       branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = b.academy_id
   AND sb.sport_name = 'Football'
   AND sb.branch_name = 'Branch 2'
   AND b.branch_id IS NULL
   AND b.sports IS NOT NULL
   AND 'Football _ARA _ branch 2' = ANY(b.sports);

-- ── Step 6b: Assign remaining batches to Branch 1 of their primary sport
UPDATE batches b
   SET branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = b.academy_id
   AND sb.sport_name = (b.sports)[1]
   AND sb.branch_name = 'Branch 1'
   AND b.branch_id IS NULL
   AND b.sports IS NOT NULL
   AND array_length(b.sports, 1) >= 1;

-- ── Step 7: Assign staff to branches via their primary sport
UPDATE staff st
   SET branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = st.academy_id
   AND sb.sport_name = (st.sports)[1]
   AND sb.branch_name = 'Branch 1'
   AND st.branch_id IS NULL
   AND st.sports IS NOT NULL
   AND array_length(st.sports, 1) >= 1;

-- ── Step 8a: Trials — legacy "Football _ARA _ branch 2" handling
UPDATE trials t
   SET sport     = 'Football',
       branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = t.academy_id
   AND sb.sport_name = 'Football'
   AND sb.branch_name = 'Branch 2'
   AND LOWER(t.sport) LIKE 'football%branch%2%'
   AND t.branch_id IS NULL;

-- ── Step 8b: Assign remaining trials to Branch 1 of their sport
UPDATE trials t
   SET branch_id = sb.id
  FROM sport_branches sb
 WHERE sb.academy_id = t.academy_id
   AND sb.sport_name = t.sport
   AND sb.branch_name = 'Branch 1'
   AND t.branch_id IS NULL
   AND t.sport IS NOT NULL
   AND t.sport <> '';

-- ── Step 9: Backfill audit_logs.branch_id from students.branch_id where possible
-- Only for audit rows whose entity_id matches a student id (safe lookup).
UPDATE audit_logs al
   SET branch_id = s.branch_id
  FROM students s
 WHERE al.entity_type = 'student'
   AND al.branch_id IS NULL
   AND al.entity_id  = s.id::text
   AND s.branch_id IS NOT NULL;

-- ── Step 10: Comments for future-you
COMMENT ON COLUMN students.branch_id  IS 'Branch within a sport (sport_branches.id). Nullable for legacy rows.';
COMMENT ON COLUMN batches.branch_id   IS 'Branch within the batch primary sport (sport_branches.id).';
COMMENT ON COLUMN staff.branch_id     IS 'Branch the staff member belongs to (sport_branches.id).';
COMMENT ON COLUMN trials.branch_id    IS 'Branch the trial lead is for (sport_branches.id).';
COMMENT ON COLUMN audit_logs.branch_id IS 'Branch context of the audited action; populated when entity links to a branch.';

COMMIT;

-- ============================================================
-- Verification (run separately AFTER commit):
-- ============================================================
-- SELECT sport_name, branch_name, COUNT(*) AS rows
--   FROM sport_branches GROUP BY 1,2 ORDER BY 1,2;
--
-- SELECT branch_id IS NULL AS unassigned, COUNT(*)
--   FROM students GROUP BY 1;
--
-- SELECT sb.sport_name, sb.branch_name, COUNT(s.id) AS students
--   FROM sport_branches sb LEFT JOIN students s ON s.branch_id = sb.id
--  GROUP BY 1,2 ORDER BY 1,2;
