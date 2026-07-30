-- ============================================================
-- 0123 — age_groups: replaces hardcoded AGE_GROUPS list on Trials
-- ============================================================
-- WHY
--   Trials.jsx had a hardcoded AGE_GROUPS = ['U6','U8',...,'Open'] array
--   with no way for an academy to add a custom age group. Mirrors the
--   trial_sources pattern (0010/0051/0052/0102) end-to-end so the same
--   security lessons (anon write lockdown, owner authenticated access)
--   apply from the start instead of being patched in later.
--
-- WRITE SURFACE
--   age_groups → secure_insert/delete_age_group (trials.manage), owner
--                (authenticated) full access scoped to their academy,
--                anon SELECT only.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS age_groups (
  id         BIGSERIAL    PRIMARY KEY,
  academy_id UUID         NOT NULL,
  label      TEXT         NOT NULL,
  sort_order INTEGER      DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE age_groups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_age_groups_academy ON age_groups (academy_id);

-- ── 2. RLS ────────────────────────────────────────────────

DROP POLICY IF EXISTS age_groups_anon_select ON public.age_groups;
CREATE POLICY age_groups_anon_select ON public.age_groups FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS age_groups_auth_all ON public.age_groups;
CREATE POLICY age_groups_auth_all ON public.age_groups FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── 3. secure_insert_age_group ────────────────────────────

CREATE OR REPLACE FUNCTION secure_insert_age_group(
  p_label TEXT,
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a     RECORD;
  v_row age_groups%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  INSERT INTO age_groups (academy_id, label)
  VALUES (a.academy_id, trim(p_label))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_age_group(TEXT, TEXT) TO anon, authenticated;

-- ── 4. secure_delete_age_group ────────────────────────────

CREATE OR REPLACE FUNCTION secure_delete_age_group(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a                RECORD;
  v_group_academy  UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'trials.manage');

  SELECT academy_id INTO v_group_academy FROM age_groups WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_group_academy IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM age_groups WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_age_group(BIGINT, TEXT) TO anon, authenticated;

-- ── 5. seed defaults for existing academies ──────────────
-- Backfills the old hardcoded list so nothing regresses for academies
-- that already use these labels, while leaving the list editable going
-- forward.

INSERT INTO age_groups (academy_id, label, sort_order)
SELECT DISTINCT a.id, g.label, g.sort_order
FROM academies a
CROSS JOIN (VALUES
  ('U6', 1), ('U8', 2), ('U10', 3), ('U12', 4),
  ('U14', 5), ('U16', 6), ('U18', 7), ('Open', 8)
) AS g(label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM age_groups existing
  WHERE existing.academy_id = a.id
);
