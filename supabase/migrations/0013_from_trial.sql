  -- 0013: Track students converted from trial
  ALTER TABLE students
    ADD COLUMN IF NOT EXISTS from_trial BOOLEAN DEFAULT false;
