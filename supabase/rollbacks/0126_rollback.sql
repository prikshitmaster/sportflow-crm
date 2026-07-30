-- ============================================================
-- 0126 ROLLBACK — remove backfilled trial fee receipts
-- ============================================================
-- Removes every trial-originated payment row, reverting revenue to its
-- pre-backfill total. Safe and precise: trial rows are the only ones with
-- payment_type = 'trial', and the partial unique index guarantees at most
-- one per trial.
--
-- Converted students' first-month rows are NOT touched — they were always
-- stored net of the trial fee, so removing these rows simply restores the
-- original (understated) numbers.
--
-- This does NOT undo the schema or the RPCs. New trials will keep booking
-- fees until 0125_rollback.sql is applied as well.
-- ============================================================

BEGIN;

UPDATE trials SET receipt_no = NULL
 WHERE id IN (SELECT trial_id FROM payments WHERE payment_type = 'trial' AND trial_id IS NOT NULL);

DELETE FROM payments WHERE payment_type = 'trial';

COMMIT;

-- Verify: expect 0
SELECT COUNT(*) AS remaining_trial_payments FROM payments WHERE payment_type = 'trial';

-- The golden number should now match section 6 of the dry run again.
SELECT '₹' || COALESCE(SUM(amount),0)::TEXT AS paid_revenue_after_rollback
  FROM payments WHERE status = 'Paid';
