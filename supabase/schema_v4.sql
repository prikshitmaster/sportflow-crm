-- ============================================================
-- SportFlow CRM — Schema v4
-- Run AFTER schema_v3.sql
-- Adds: student suspension flow + payment plan types
-- ============================================================

-- ── Students: suspension tracking ───────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS last_batch_id   BIGINT REFERENCES batches(id),
  ADD COLUMN IF NOT EXISTS last_batch_name TEXT,
  ADD COLUMN IF NOT EXISTS suspended_since DATE;

-- Extend status to include Suspended
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('Active', 'Inactive', 'Suspended'));

-- ── Payments: plan type + discount ──────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_type   TEXT DEFAULT 'monthly'
    CHECK (payment_type IN ('monthly', 'quarterly', 'yearly')),
  ADD COLUMN IF NOT EXISTS discount_pct   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS months_covered INTEGER DEFAULT 1;
