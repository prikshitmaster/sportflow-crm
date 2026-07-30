-- ============================================================
-- 0126b — Trial fee backfill (WRITES)
-- ============================================================
-- ⚠️  DO NOT RUN THIS until you have run 0126a and confirmed
--     TOTAL_REVENUE_DELTA matches the trial receipts your academy
--     actually issued. Every trial row defaults to ₹590 whether or not
--     the money was ever taken — see the 0126a header.
--
-- Books one payments row per fee-paying trial that does not already have
-- one, dated the trial date (the month the cash was actually taken).
--
-- IDEMPOTENT on two levels:
--   1. NOT EXISTS (... p.trial_id = t.id) skips already-booked trials
--   2. payments_trial_id_uniq (0124) makes a double-insert impossible
--      even if this file is run concurrently with itself
--
-- NO DOUBLE-COUNT WITH CONVERTED STUDENTS: their first-month row was
-- stored NET of the trial fee (AppContext.jsx:913 `amount - trialDeduct`),
-- so adding ₹590 back lands on exactly the full fee. Trials that converted
-- on a custom fee plan got no payment row at all (AppContext.jsx:910 skips
-- it when paidTill is empty) — for those this row is the only booking,
-- which is also correct.
-- ============================================================

BEGIN;

-- ── 1. Insert the missing receipts ───────────────────────────
WITH candidates AS (
  SELECT t.id,
         t.name,
         t.sport,
         t.academy_id,
         t.branch_id,
         t.trial_fee_paid,
         COALESCE(t.trial_fee_mode, 'Cash')            AS mode,
         COALESCE(t.trial_date, t.created_at::DATE)    AS fee_date,
         regexp_replace(COALESCE(t.phone,''), '\D', '', 'g') AS phone10
  FROM trials t
  WHERE COALESCE(t.trial_fee_paid, 0) > 0
    AND COALESCE(t.trial_fee_mode, 'Cash') <> 'Not collected'
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id)
),
-- Every student that plausibly came from each candidate trial.
-- Matched on academy + normalised phone + name rather than by parsing the
-- 'Trial fee deducted' note, because that note never identifies WHICH
-- trial, is missing wherever its fire-and-forget write failed
-- (AppContext.jsx:936-943 swallows errors), and is wholesale-overwritten
-- by secure_update_payment. Phone is a validated 10-digit string on both
-- sides (Trials.jsx:864 and the ConvertModal prefill at :799).
matches AS (
  SELECT c.id AS trial_id, s.id AS student_id,
         COUNT(*) OVER (PARTITION BY c.id) AS n_matches,
         ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY s.join_date) AS rn
  FROM candidates c
  JOIN students s
    ON s.academy_id = c.academy_id
   AND regexp_replace(COALESCE(s.phone,''), '\D', '', 'g') = c.phone10
   AND lower(btrim(s.name)) = lower(btrim(c.name))
   AND s.join_date >= c.fee_date - INTERVAL '1 day'
  WHERE c.phone10 <> ''
),
-- Link ONLY where exactly one student matches. Ambiguous or absent →
-- student_id stays NULL. Revenue is right either way; only the
-- per-student attribution is missing, and trial_id remains as a durable
-- link for manual reconciliation later. Never guess.
resolved AS (
  SELECT c.*, m.student_id
  FROM candidates c
  LEFT JOIN matches m ON m.trial_id = c.id AND m.n_matches = 1 AND m.rn = 1
)
INSERT INTO payments (
  id, student_id, student, amount, month, date, status, mode,
  payment_type, discount_pct, months_covered, academy_id,
  trial_id, branch_id, sport, notes
)
SELECT
  next_trial_receipt_id(),
  r.student_id,
  r.name,
  r.trial_fee_paid,
  to_char(r.fee_date, 'Mon YYYY'),
  r.fee_date,
  'Paid',
  r.mode,
  'trial',
  0,
  1,
  r.academy_id,
  r.id,
  r.branch_id,
  r.sport,
  'Trial fee — trial on ' || to_char(r.fee_date, 'DD Mon YYYY') || ' (backfilled)'
FROM resolved r
ON CONFLICT (trial_id) WHERE trial_id IS NOT NULL DO NOTHING;


-- ── 2. Mirror the receipt number back onto the trial ─────────
UPDATE trials t
   SET receipt_no = p.id
  FROM payments p
 WHERE p.trial_id = t.id
   AND t.receipt_no IS DISTINCT FROM p.id;

COMMIT;


-- ── 3. Verify (all must return 0) ────────────────────────────
-- Run after committing.

-- every fee-paying trial now has exactly one payment
SELECT COUNT(*) AS unbooked_trials FROM trials t
 WHERE COALESCE(t.trial_fee_paid,0) > 0
   AND COALESCE(t.trial_fee_mode,'Cash') <> 'Not collected'
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.trial_id = t.id);

-- amounts agree between the two sides
SELECT COUNT(*) AS amount_mismatches FROM payments p
  JOIN trials t ON t.id = p.trial_id
 WHERE p.amount <> t.trial_fee_paid;

-- no unscoped trial rows (these would be invisible in branch/sport views)
SELECT COUNT(*) AS unscoped_trial_rows FROM payments
 WHERE payment_type = 'trial' AND (branch_id IS NULL OR sport IS NULL);

-- legacy orphan payments must NOT have acquired scope
SELECT COUNT(*) AS legacy_orphans_touched FROM payments
 WHERE student_id IS NULL AND trial_id IS NULL
   AND (branch_id IS NOT NULL OR sport IS NOT NULL);

-- the golden number: compare against section 6 of the dry run.
-- difference must equal TOTAL_REVENUE_DELTA exactly.
SELECT '₹' || COALESCE(SUM(amount),0)::TEXT AS paid_revenue_after_backfill
  FROM payments WHERE status = 'Paid';
