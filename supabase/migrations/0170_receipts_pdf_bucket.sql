-- ============================================================
-- 0170 — Receipts PDF bucket (WhatsApp auto-receipt spike)
-- ============================================================
-- WHAT
--   New storage bucket 'receipts', path `{paymentId}.pdf`. Needed so the
--   Twilio (later: Meta) WhatsApp send can attach the actual receipt PDF via
--   a MediaUrl the provider's servers fetch over plain HTTPS — that fetch
--   cannot carry a session token, so the bucket must be public=true for
--   reads, same tradeoff already made for student-photos/staff-photos/
--   branch-photos/drill-diagrams in security-v3/28_storage_lockdown.sql.
--
--   Writes are NOT open — security-v3/28 exists specifically because two
--   buckets were once public+open-write and became world-writable. Here,
--   write is scoped to a staff/owner session for the payment's own academy
--   (payments.manage permission for staff), mirroring branch_photos_write /
--   student_photos_all.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS receipts_write ON storage.objects;

CREATE POLICY receipts_write ON storage.objects
  FOR ALL TO anon, authenticated
  USING (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM payments pmt
      WHERE pmt.id::text = regexp_replace(objects.name, '\.pdf$', '')
        AND (
          pmt.academy_id = get_my_academy_id()
          OR (pmt.academy_id = current_staff_academy() AND current_staff_has_perm('payments.manage'))
        )
    )
  )
  WITH CHECK (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM payments pmt
      WHERE pmt.id::text = regexp_replace(objects.name, '\.pdf$', '')
        AND (
          pmt.academy_id = get_my_academy_id()
          OR (pmt.academy_id = current_staff_academy() AND current_staff_has_perm('payments.manage'))
        )
    )
  );

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT id, public FROM storage.buckets WHERE id = 'receipts';
-- SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='receipts_write';
