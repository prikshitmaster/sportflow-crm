-- 0199 — Let staff with settings.manage toggle feature flags, not owners only
--
-- feature_flags had only feature_flags_owner_write (RLS, `authenticated` role
-- only) — a raw client-side .upsert() call, so ANY staff session (which never
-- carries a real Supabase Auth JWT, regardless of permissions) hit a bare
-- "new row violates row-level security policy" on every single toggle. The
-- Settings → Feature Toggles page itself has no PermRequired gate on the
-- owner route (/settings — office staff render it directly, same as Fee
-- Plans before 0135), so a staff member with settings.manage could see every
-- toggle, click it, and it would silently fail with a DB-internal error
-- instead of an intentional permission message.
--
-- Same pattern as 0135 (fee plans): add a secure_* RPC gated by
-- _require_perm(..., 'settings.manage') instead of widening the raw RLS
-- policy — owners keep unconditional access, staff need the permission,
-- students are never allowed (current_actor returns NULL perms for them,
-- and _require_perm rejects actor_kind = 'student' outright).
--
-- IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION secure_toggle_feature_flag(
  p_feature TEXT,
  p_enabled BOOLEAN,
  p_token   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'settings.manage');

  INSERT INTO feature_flags (academy_id, feature, enabled)
  VALUES (a.academy_id, p_feature, p_enabled)
  ON CONFLICT (academy_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_toggle_feature_flag(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

COMMIT;
