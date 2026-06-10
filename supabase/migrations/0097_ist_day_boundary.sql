-- 0094: Fix UTC vs IST day boundary
-- Problem: RPCs stamped dates with CURRENT_DATE, which is the UTC day.
-- India is UTC+5:30, so anything before 05:30 IST (e.g. 5 AM sessions)
-- was recorded under the PREVIOUS day, while owner views read by IST date.
--
-- Fix: ist_today() = today's date in Asia/Kolkata. All date-stamping RPCs
-- are rewritten from their LIVE definitions (not migration sources) with
-- CURRENT_DATE -> public.ist_today(), so no behavior other than the day
-- boundary changes.

CREATE OR REPLACE FUNCTION public.ist_today()
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

DO $fix$
DECLARE
  fn  record;
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'secure_clock_in',
        'secure_get_today_checkin',
        'secure_mark_attendance',
        'secure_mark_attendance_qr',
        'create_student_with_payment',
        'secure_complete_invite_signup',
        'secure_insert_announcement',
        'secure_insert_payment',
        'secure_insert_staff',
        'secure_record_gateway_payment'
      )
      AND p.prosrc ~* 'CURRENT_DATE'
  LOOP
    def := regexp_replace(
      pg_get_functiondef(fn.oid),
      '\mCURRENT_DATE\M',
      'public.ist_today()',
      'gi'
    );
    EXECUTE def;
    RAISE NOTICE 'patched %', fn.proname;
  END LOOP;
END
$fix$;
