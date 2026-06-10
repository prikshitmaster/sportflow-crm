-- 0093: Index tuning
-- 1) staff_checkins is queried by (academy_id, date) in fetchStaffAttendanceForDate/Month
--    but only had (staff_id, date) + pkey.
CREATE INDEX IF NOT EXISTS idx_staff_checkins_academy_date
  ON public.staff_checkins (academy_id, date);

-- 2) Duplicate token indexes: the UNIQUE constraints staff_sessions_token_key /
--    student_sessions_token_key already index token. The extra plain btree
--    indexes below are redundant and slow down every session insert/delete.
DROP INDEX IF EXISTS public.idx_staff_sessions_token;
DROP INDEX IF EXISTS public.staff_sessions_token_idx;
DROP INDEX IF EXISTS public.idx_student_sessions_token;
