-- 0011: Trial extras — office notes, quoted fee, session times
ALTER TABLE trials
  ADD COLUMN IF NOT EXISTS notes          TEXT,
  ADD COLUMN IF NOT EXISTS quoted_fee     INTEGER,
  ADD COLUMN IF NOT EXISTS session_start  TIME,
  ADD COLUMN IF NOT EXISTS session_end    TIME;
