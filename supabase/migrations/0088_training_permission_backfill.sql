-- 0088: Backfill the new 'training.manage' permission (Session & Drill Plans).
--
-- A dedicated permission now gates the football-only Session Planner + Drill
-- Library (previously gated by 'dashboard.view', so it couldn't be controlled
-- separately). Coaches / admins / branch managers used these tools, so grant
-- the new permission to already-configured staff in those roles to avoid
-- stripping access they currently have. Staff with no explicit permissions fall
-- back to their role preset at login, which now includes training.manage.
--
-- SAFE + IDEMPOTENT: only adds the permission where it's missing.

UPDATE staff_auth
SET permissions = permissions || '["training.manage"]'::jsonb
WHERE access_role IN ('admin', 'branch_manager', 'coach')
  AND permissions IS NOT NULL
  AND jsonb_array_length(permissions) > 0
  AND NOT (permissions ? 'training.manage');
