-- 0182 — Trial data integrity: fee default, age drift, state fields, parent phone
--
-- Four data problems found in review, all of which cost something real:
--
--   1. trials.trial_fee_paid DEFAULT 590 — a hardcoded rupee amount as a column
--      default, so every trial claimed Rs 590 collected whether or not it was.
--      64 of 68 rows sat at exactly 590 while 12 were marked 'Not collected'.
--      The app defends against this with the identical
--      `trialFeeMode !== 'Not collected'` check in 9 places across 5 files, and
--      the comments there record it slipping through twice and costing revenue.
--
--   2. trials.age and trials.dob disagreed on 20 of 55 rows with both set. The
--      public /join form derives age and never lets it be typed, but the
--      owner-side form has a free-text age box that wins over dob.
--
--   3. trials.status was written once at creation and never updated — 43
--      converted trials still read 'Scheduled'. trials.converted duplicates
--      stage = 'converted'. Neither is dropped: secure_insert_trial,
--      secure_update_trial, secure_submit_public_trial and
--      secure_submit_public_trial_v2 all reference status, and rewriting the
--      live public registration path to drop a dead column is not a trade worth
--      making. They become derived instead of dead.
--
--   4. students.parent_phone was empty on 490 of 569 students, including all 25
--      converted from trials, because ConvertModal put the OTP-verified parent
--      number into students.phone and left parent_phone blank.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 1. Trial fee default
--
-- 0, not 590. A default that asserts money changed hands is a lie the rest of
-- the codebase then has to work around. Existing rows explicitly marked
-- 'Not collected' are corrected to match what actually happened.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.trials ALTER COLUMN trial_fee_paid SET DEFAULT 0;

UPDATE public.trials
   SET trial_fee_paid = 0
 WHERE trial_fee_mode = 'Not collected'
   AND COALESCE(trial_fee_paid, 0) <> 0;

COMMENT ON COLUMN public.trials.trial_fee_paid IS
  'Amount actually collected. Defaults to 0 — never assume a fee was taken. '
  'trial_fee_mode = ''Not collected'' means this must be 0.';

-- ════════════════════════════════════════════════════════════════
-- 2. Age is derived from date of birth
--
-- Recompute every row where both exist and disagree. dob wins: it is the fact,
-- age is the cache.
-- ════════════════════════════════════════════════════════════════
UPDATE public.trials
   SET age = EXTRACT(YEAR FROM age(dob))::INT
 WHERE dob IS NOT NULL
   AND (age IS NULL OR age <> EXTRACT(YEAR FROM age(dob))::INT);

COMMENT ON COLUMN public.trials.age IS
  'Derived from dob by the trials_sync_state trigger whenever dob is set. '
  'Only meaningful on its own when dob is unknown (legacy/imported rows).';

-- ════════════════════════════════════════════════════════════════
-- 3. stage is the single source of truth for pipeline state
--
-- status and converted are kept in step with it by trigger rather than by
-- every caller remembering to set all three.
--
-- The converted sync is deliberately bidirectional and change-guarded: a
-- caller updating ONLY `converted` (without touching stage) must not have it
-- silently reset from the unchanged stage value. handleConvert in Trials.jsx
-- sets both together, but secure_update_trial does partial updates and a
-- one-way sync would break it.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trials_sync_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- age follows dob
  IF NEW.dob IS NOT NULL THEN
    NEW.age := EXTRACT(YEAR FROM age(NEW.dob))::INT;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.converted := COALESCE(NEW.converted, FALSE) OR NEW.stage = 'converted';
  ELSE
    IF NEW.stage IS DISTINCT FROM OLD.stage THEN
      NEW.converted := (NEW.stage = 'converted');
    ELSIF NEW.converted IS DISTINCT FROM OLD.converted AND NEW.converted THEN
      NEW.stage := 'converted';
    END IF;
  END IF;

  -- status is legacy: still written by four RPCs, read by nothing meaningful.
  -- Deriving it keeps those RPCs working while stopping it from reporting
  -- 'Scheduled' for a trial that converted months ago.
  NEW.status := CASE COALESCE(NEW.stage, 'new')
    WHEN 'new'       THEN 'Scheduled'
    WHEN 'scheduled' THEN 'Scheduled'
    ELSE 'Completed'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trials_sync_state ON public.trials;
CREATE TRIGGER trials_sync_state
  BEFORE INSERT OR UPDATE ON public.trials
  FOR EACH ROW EXECUTE FUNCTION public._trials_sync_state();

-- Bring existing rows in line. The trigger fires on this UPDATE and does the
-- work, so the SET is a no-op touch.
UPDATE public.trials SET stage = COALESCE(stage, 'new');

COMMENT ON COLUMN public.trials.status IS
  'DEPRECATED — derived from stage by trials_sync_state. Kept only because '
  'secure_insert_trial / secure_update_trial / secure_submit_public_trial(_v2) '
  'still reference it. Read stage instead.';

COMMENT ON COLUMN public.trials.converted IS
  'Derived from stage by trials_sync_state (stage = ''converted''). Setting '
  'this true directly also moves stage, so the two can no longer disagree.';

COMMENT ON COLUMN public.trials.stage IS
  'The pipeline state machine and the only field that should be written: '
  'new -> scheduled -> attended -> accepted/followup/rejected -> converted.';

-- ════════════════════════════════════════════════════════════════
-- 4. Backfill students.parent_phone
--
-- For a trial-converted student, students.phone holds the parent's
-- OTP-verified number — ConvertModal labelled it "Student Phone". Anything
-- keyed on parent_phone therefore did nothing for them: the automatic WhatsApp
-- payment receipt (AppContext addPayment) reads parent_phone with no fallback,
-- and the parent-account auto-link requires 10 digits there.
--
-- Only fills where parent_phone is empty, so a genuinely separate parent number
-- already on file is never overwritten. This mirrors what SendPayLinkModal and
-- WhatsAppBulkModal already do at read time (`parentPhone || phone`).
-- ════════════════════════════════════════════════════════════════
UPDATE public.students
   SET parent_phone = phone
 WHERE COALESCE(parent_phone, '') = ''
   AND COALESCE(phone, '') <> '';

COMMIT;
