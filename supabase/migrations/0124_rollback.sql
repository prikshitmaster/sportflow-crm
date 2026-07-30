-- ============================================================
-- 0124 ROLLBACK — undo trial-fee-as-revenue schema
-- ============================================================
-- Run 0126_rollback.sql FIRST if the backfill has been applied,
-- and 0125_rollback.sql to restore the original RPCs. Otherwise
-- secure_insert_trial will fail on the missing columns.
--
-- Dropping payments.trial_id also drops payments_trial_id_uniq.
-- Any trial-typed payment rows must be removed before the CHECK
-- constraint is narrowed again, or the ADD CONSTRAINT will fail.
-- ============================================================

DELETE FROM payments WHERE payment_type = 'trial';

ALTER TABLE payments
  DROP COLUMN IF EXISTS trial_id,
  DROP COLUMN IF EXISTS branch_id,
  DROP COLUMN IF EXISTS sport;

DROP INDEX IF EXISTS payments_branch_id_idx;
DROP INDEX IF EXISTS payments_sport_idx;

-- Restore the schema_v4.sql:20-21 constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE payments ADD  CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN ('monthly', 'quarterly', 'yearly'));

ALTER TABLE trials
  DROP CONSTRAINT IF EXISTS trials_trial_fee_mode_check;
ALTER TABLE trials
  DROP COLUMN IF EXISTS receipt_no,
  DROP COLUMN IF EXISTS trial_fee_mode;

DROP FUNCTION IF EXISTS next_trial_receipt_id();
DROP SEQUENCE IF EXISTS trial_receipt_seq;
