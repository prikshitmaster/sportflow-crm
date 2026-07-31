-- 0127 — Link notifications back to the announcement they were sent for
--
-- Staff notices (sendStaffNotice) fire one notify() per recipient AND persist
-- a single announcements row for history. The two writes had no shared key,
-- so there was no way to ask "who has confirmed this notice" — only "did
-- this specific person's notification get actioned," with no way to look it
-- up by announcement. This column lets the sender query every recipient's
-- read/ack status for a given notice in one shot.
--
-- Nullable + ON DELETE SET NULL: most notifications aren't tied to an
-- announcement (attendance reminders, payment alerts, etc.) and deleting an
-- announcement should not cascade-delete its recipients' notification rows.
-- IDEMPOTENT.

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS announcement_id BIGINT REFERENCES announcements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_announcement_id_idx
  ON notifications (announcement_id)
  WHERE announcement_id IS NOT NULL;

COMMIT;
