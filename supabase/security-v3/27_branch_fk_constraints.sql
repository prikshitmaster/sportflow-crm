-- security-v3 / 27 — Real FK constraints from students/staff back to sport_branches
--
-- Round-3 QA (2026-08-10) found students.branch_id and staff.branch_id had no
-- foreign key back to sport_branches at all — only announcements.branch_id
-- did (ON DELETE SET NULL). The only thing stopping a deleted branch from
-- orphaning real students/staff was a client-side count-check in
-- SportSelect.jsx's delete flow, racy against another tab/device.
--
-- Checked production first: zero students, zero staff currently have a
-- branch_id that doesn't resolve to a real sport_branches row, so this adds
-- cleanly with no backfill needed.
--
-- ON DELETE RESTRICT (the default), not SET NULL like announcements — since
-- security-v3/19 "there is no all-branch", a deleted branch silently
-- SET NULL-ing its students/staff would manufacture brand new grandfathered
-- all-branch accounts through a side door, exactly what 19 closed off at
-- creation time. A branch with students/staff still on it must fail to
-- delete, not quietly orphan them.
--
-- IDEMPOTENT — safe to re-run (constraints added only if missing).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_branch_id_fkey'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.sport_branches(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_branch_id_fkey'
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.sport_branches(id);
  END IF;
END $$;

COMMIT;
