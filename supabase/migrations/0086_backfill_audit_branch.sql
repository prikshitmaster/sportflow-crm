-- 0086: Backfill branch_id (and sport) on legacy audit_logs rows.
--
-- Older audit entries were written before audit entries were branch-tagged, so
-- their branch_id is NULL. Under strict branch isolation those rows are hidden
-- from every branch view. This re-derives each row's branch from the entity it
-- refers to (or, for auth events, from the actor) so historical activity shows
-- up in the correct branch.
--
-- entity_id / actor_id are TEXT; entity tables use BIGINT ids → compare as text.
-- SAFE + IDEMPOTENT: only fills rows where branch_id IS NULL, so it never
-- overwrites correctly-tagged rows and can be re-run.

-- ── Students (student.* actions) ─────────────────────────────────────────────
-- Prefer the student's own branch_id; fall back to their batch's branch.
UPDATE audit_logs al SET branch_id = COALESCE(s.branch_id, b.branch_id)
FROM students s
LEFT JOIN batches b ON b.id = s.batch_id
WHERE al.branch_id IS NULL
  AND al.entity_type = 'student'
  AND s.id::text = al.entity_id
  AND COALESCE(s.branch_id, b.branch_id) IS NOT NULL;

-- ── Attendance + assessments (entity_id is the student id) ───────────────────
UPDATE audit_logs al SET branch_id = COALESCE(s.branch_id, b.branch_id)
FROM students s
LEFT JOIN batches b ON b.id = s.batch_id
WHERE al.branch_id IS NULL
  AND al.entity_type IN ('attendance', 'assessment')
  AND s.id::text = al.entity_id
  AND COALESCE(s.branch_id, b.branch_id) IS NOT NULL;

-- ── Batches (batch.* actions, when entity_id is a real batch id) ─────────────
UPDATE audit_logs al SET branch_id = b.branch_id
FROM batches b
WHERE al.branch_id IS NULL
  AND al.entity_type = 'batch'
  AND b.id::text = al.entity_id
  AND b.branch_id IS NOT NULL;

-- ── Trials ───────────────────────────────────────────────────────────────────
UPDATE audit_logs al SET branch_id = t.branch_id
FROM trials t
WHERE al.branch_id IS NULL
  AND al.entity_type = 'trial'
  AND t.id::text = al.entity_id
  AND t.branch_id IS NOT NULL;

-- ── Events / announcements: those tables are sport-scoped only (no branch_id
-- column), so their audit rows can't be branch-attributed — they remain visible
-- under "All branches". Nothing to backfill here.

-- ── Staff (staff.* actions, entity_id is the staff id) ───────────────────────
UPDATE audit_logs al SET branch_id = st.branch_id
FROM staff st
WHERE al.branch_id IS NULL
  AND al.entity_type = 'staff'
  AND st.id::text = al.entity_id
  AND st.branch_id IS NOT NULL;

-- ── Payments (entity_id is the invoice id → join to its student) ─────────────
UPDATE audit_logs al SET branch_id = COALESCE(s.branch_id, b.branch_id)
FROM payments p
JOIN students s ON s.id = p.student_id
LEFT JOIN batches b ON b.id = s.batch_id
WHERE al.branch_id IS NULL
  AND al.entity_type = 'payment'
  AND p.id::text = al.entity_id
  AND COALESCE(s.branch_id, b.branch_id) IS NOT NULL;

-- ── Auth events (actor is either a staff member or a student) ────────────────
-- Staff actor:
UPDATE audit_logs al SET branch_id = st.branch_id
FROM staff st
WHERE al.branch_id IS NULL
  AND al.entity_type = 'auth'
  AND st.id::text = al.actor_id
  AND st.branch_id IS NOT NULL;
-- Student actor:
UPDATE audit_logs al SET branch_id = COALESCE(s.branch_id, b.branch_id)
FROM students s
LEFT JOIN batches b ON b.id = s.batch_id
WHERE al.branch_id IS NULL
  AND al.entity_type = 'auth'
  AND s.id::text = al.actor_id
  AND COALESCE(s.branch_id, b.branch_id) IS NOT NULL;

-- NOTE: rows that remain NULL after this are genuinely academy-wide (e.g. owner
-- logins) or refer to deleted entities — those correctly stay out of any single
-- branch's view and only appear under "All branches".
