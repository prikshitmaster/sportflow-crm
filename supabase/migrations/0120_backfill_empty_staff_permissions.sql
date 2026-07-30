-- 0120: Backfill empty/NULL staff_auth.permissions from the role preset.
--
-- Root cause of "give assessment / session pulse, submit fails with a
-- permission error": secure_insert_staff() never sets access_role or
-- permissions on the staff_auth row it creates, so new staff take the table
-- defaults (access_role='coach', permissions='[]'). If the owner didn't
-- toggle "give portal access" in the Add Staff modal, that empty array was
-- never overwritten — yet staffCode + joinCode are issued regardless, so the
-- coach can still log in.
--
-- On login, the client's hasPermission() falls back to ROLE_PRESETS[access_role]
-- whenever permissions is empty (AppContext.jsx) — so the UI shows the full
-- coach toolset (Assess, Session Pulse, Sessions, Drills...). But every
-- secure_* write RPC checks the REAL permissions column via _require_perm()
-- (server is authoritative — see comment in src/lib/permissions.js), which is
-- still '[]', so every write is rejected with 42501 'forbidden'. Net effect:
-- the coach can open the assessment/pulse screen, fill it in, hit Save, and
-- get a permission-denied error with nothing wrong visible beforehand.
--
-- 0088 fixed this same class of bug for staff who already had a *non-empty*
-- permissions array missing just 'training.manage'. This covers the NULL /
-- '[]' stragglers 0088 deliberately excluded (it only touched rows with
-- jsonb_array_length(permissions) > 0).
--
-- Presets mirror src/lib/permissions.js ROLE_PRESETS exactly — keep in sync
-- if that file changes.
--
-- SAFE + IDEMPOTENT: only touches rows with NULL or empty-array permissions.

BEGIN;

UPDATE staff_auth
SET permissions = CASE access_role
  WHEN 'coach'          THEN '["attendance.manage","students.view","batches.view","training.manage","trials.manage"]'::jsonb
  WHEN 'receptionist'   THEN '["students.view","students.manage","trials.manage"]'::jsonb
  WHEN 'accountant'     THEN '["payments.view","payments.manage","reports.view"]'::jsonb
  WHEN 'staff'          THEN '["attendance.manage","students.view"]'::jsonb
  WHEN 'admin'          THEN '["dashboard.view","students.view","students.manage","attendance.manage","payments.view","payments.manage","trials.manage","batches.view","batches.manage","training.manage","reports.view","staff.manage","settings.manage","community.manage","events.manage","documents.view"]'::jsonb
  WHEN 'branch_manager' THEN '["dashboard.view","students.view","students.manage","attendance.manage","payments.view","payments.manage","trials.manage","batches.view","batches.manage","training.manage","reports.view","staff.manage","settings.manage","community.manage","events.manage","documents.view"]'::jsonb
  ELSE '["attendance.manage","students.view","batches.view","training.manage","trials.manage"]'::jsonb -- unknown/NULL role → coach preset (matches client fallback)
END
WHERE permissions IS NULL OR jsonb_array_length(permissions) = 0;

COMMIT;
