-- ============================================================
-- 0124 — Trial fees as real revenue: schema
-- ============================================================
-- WHY
--   Academies collect a trial fee (default ₹590) and print a receipt
--   slip, but the money is recorded ONLY as an integer on
--   trials.trial_fee_paid. No payments row is ever created.
--
--   Worse, at conversion AppContext.jsx:913 does
--     payAmount = amount - trialDeduct + joiningFee
--   so a ₹21,000 fee stores ₹20,410 and the ₹590 is booked nowhere.
--   The money is double-invisible: never added, then subtracted.
--   Every revenue figure in the app is understated by the trial fee.
--
--   Fix shape: book a real payments row at TRIAL CREATION, and LINK it
--   to the student at conversion. Never create a second row. Because
--   every aggregation in the app already sums payments.amount, a real
--   row flows into all of them with zero per-page changes.
--
-- THE SCOPING PROBLEM THIS SOLVES
--   payments has no branch_id / sport — every scoped view derives them
--   by joining through student_id. An unconverted trial has no student,
--   so its payment row would be invisible everywhere. These columns let
--   such a row scope itself.
--
-- THIS MIGRATION IS BEHAVIOUR-NEUTRAL. It only adds columns, indexes
-- and a sequence. Nothing writes to them until 0125 ships.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ── 1. payments: self-scoping + trial link ───────────────────
-- branch_id/sport are populated ONLY on trial-originated rows.
-- Legacy orphan rows (student deleted → student_id NULL via the
-- ON DELETE SET NULL at schema.sql:63) must keep both NULL so they
-- stay invisible exactly as they are today.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS trial_id  BIGINT REFERENCES trials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS sport     TEXT;

COMMENT ON COLUMN payments.trial_id IS
  'Set when this row books a trial fee. The trial''s payment is created at trial time with student_id NULL, then linked on conversion.';
COMMENT ON COLUMN payments.branch_id IS
  'Self-scoping fallback. Populated ONLY for trial-originated rows (student_id NULL). Student-linked rows scope via students.branch_id as before.';


-- ── 2. THE double-book guard ─────────────────────────────────
-- Partial unique index: at most one payment per trial, ever.
-- Makes double-click, backfill-run-twice, and conversion-inserts-
-- instead-of-links structurally impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS payments_trial_id_uniq
  ON payments(trial_id) WHERE trial_id IS NOT NULL;

-- Scoping lookups (mirrors 0001_indexes.sql)
CREATE INDEX IF NOT EXISTS payments_branch_id_idx ON payments(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_sport_idx     ON payments(sport)     WHERE sport     IS NOT NULL;


-- ── 3. payment_type: allow 'trial' ───────────────────────────
-- schema_v4.sql:20-21 restricted this to monthly|quarterly|yearly.
DO $$
DECLARE
  v_con TEXT;
BEGIN
  SELECT conname INTO v_con
    FROM pg_constraint
   WHERE conrelid = 'payments'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%payment_type%';

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN ('monthly', 'quarterly', 'yearly', 'trial'));


-- ── 4. trials: receipt number + collection flag ──────────────
-- BLOCKER THIS ADDRESSES: trial_fee_paid DEFAULTS to 590 on every
-- trial row (0012_trial_slip_fields.sql:6, Trials.jsx:455 uses
-- `Number(form.trialFeePaid) || 590`). A phone enquiry that never
-- showed up still reads ₹590. Without a "was it actually collected?"
-- flag, booking every trial would overstate revenue.
--
-- Default 'Cash' preserves today's implicit assumption for new rows;
-- the backfill (0126) is separately gated on a dry-run.
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS receipt_no     TEXT,
  ADD COLUMN IF NOT EXISTS trial_fee_mode TEXT DEFAULT 'Cash';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'trials'::regclass AND conname = 'trials_trial_fee_mode_check'
  ) THEN
    ALTER TABLE trials ADD CONSTRAINT trials_trial_fee_mode_check
      CHECK (trial_fee_mode IN ('Cash', 'UPI', 'Card', 'Not collected'));
  END IF;
END $$;

COMMENT ON COLUMN trials.trial_fee_mode IS
  'How the trial fee was collected. ''Not collected'' means no payments row is booked — used for enquiry-only leads.';


-- ── 5. TRL- receipt sequence ─────────────────────────────────
-- A series separate from next_invoice_id (0014) so trial receipts do
-- not interleave with the student invoice run, are self-identifying in
-- every export, and are trivially reversible (DELETE ... LIKE 'TRL-%').
--
-- Also replaces genReceiptNo (Trials.jsx:101-105), which builds slip
-- numbers from name-initials + date and therefore collides for two
-- same-initial trials on the same day.
--
-- nextval() is genuinely race-free — no read-modify-write window.
DO $$
DECLARE
  v_max INT := 0;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN id ~ '^TRL-\d{4}-\d+$' THEN split_part(id, '-', 3)::INT ELSE 0 END
  ), 0) INTO v_max
  FROM payments;

  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'trial_receipt_seq') THEN
    EXECUTE format('CREATE SEQUENCE trial_receipt_seq START WITH %s', v_max + 1);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION next_trial_receipt_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'TRL-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' ||
         lpad(nextval('trial_receipt_seq')::TEXT, 3, '0');
$$;

GRANT EXECUTE ON FUNCTION next_trial_receipt_id() TO authenticated, anon;
