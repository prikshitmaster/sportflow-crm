-- 0012: Trial slip fields — DOB, age group, program type, trial fee paid
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS dob             DATE,
  ADD COLUMN IF NOT EXISTS age_group       TEXT,
  ADD COLUMN IF NOT EXISTS program_type    TEXT DEFAULT 'academy',
  ADD COLUMN IF NOT EXISTS trial_fee_paid  INTEGER DEFAULT 590;
