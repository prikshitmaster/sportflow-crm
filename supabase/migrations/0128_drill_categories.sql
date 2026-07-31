-- ============================================================
-- 0128 — drill_categories: replaces hardcoded CATEGORIES list on Drills
-- ============================================================
-- WHY
--   Drills.jsx / SessionPlanner.jsx (coach drill library) had a hardcoded
--   CATEGORIES object (warm_up, technical, passing, shooting, defending,
--   ssg, match, cool_down) with no way for a coach or owner to add a
--   custom category — reported: "no way to create category like warmup,
--   [only able to save drill using existing ones]". Mirrors the
--   age_groups pattern (0123) end-to-end.
--
-- WRITE SURFACE
--   drill_categories → secure_insert/delete_drill_category, same actor
--                       gate as secure_create_drill/secure_delete_drill
--                       (any non-student actor; no granular permission
--                       key exists for drills specifically, so this
--                       matches its sibling RPCs rather than inventing one).
--
-- drills.category previously had a CHECK constraint enumerating the 8
-- fixed values — dropped here since categories are now open-ended per
-- academy. The column stays NOT NULL.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drill_categories (
  id         BIGSERIAL    PRIMARY KEY,
  academy_id UUID         NOT NULL,
  key        TEXT         NOT NULL,
  label      TEXT         NOT NULL,
  color      TEXT         NOT NULL DEFAULT 'slate',
  sort_order INTEGER      DEFAULT 0,
  created_at TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (academy_id, key)
);

ALTER TABLE drill_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_drill_categories_academy ON drill_categories (academy_id);

-- ── 2. RLS ────────────────────────────────────────────────

DROP POLICY IF EXISTS drill_categories_anon_select ON public.drill_categories;
CREATE POLICY drill_categories_anon_select ON public.drill_categories FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS drill_categories_auth_all ON public.drill_categories;
CREATE POLICY drill_categories_auth_all ON public.drill_categories FOR ALL TO authenticated
  USING      (academy_id = get_my_academy_id())
  WITH CHECK (academy_id = get_my_academy_id());

-- ── 3. drop the old fixed-enum CHECK on drills.category ────
-- Named implicitly by Postgres at table-creation time (0021_session_planner.sql
-- didn't name it) — look it up by definition rather than guessing the name.

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'drills'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%category%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE drills DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- ── 4. secure_insert_drill_category ───────────────────────
-- Color is chosen client-side (rotates through a fixed Tailwind-safe
-- palette) and passed in, rather than hardcoding a palette twice.

CREATE OR REPLACE FUNCTION secure_insert_drill_category(
  p_label TEXT,
  p_color TEXT DEFAULT 'slate',
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a       RECORD;
  v_row   drill_categories%ROWTYPE;
  v_base  TEXT;
  v_key   TEXT;
  v_n     INT := 1;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_base := lower(regexp_replace(trim(p_label), '[^a-zA-Z0-9]+', '_', 'g'));
  v_base := regexp_replace(v_base, '^_+|_+$', '', 'g');
  IF v_base = '' THEN v_base := 'category'; END IF;

  v_key := v_base;
  WHILE EXISTS (SELECT 1 FROM drill_categories WHERE academy_id = a.academy_id AND key = v_key) LOOP
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  END LOOP;

  INSERT INTO drill_categories (academy_id, key, label, color)
  VALUES (a.academy_id, v_key, trim(p_label), coalesce(p_color, 'slate'))
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION secure_insert_drill_category(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 5. secure_delete_drill_category ───────────────────────

CREATE OR REPLACE FUNCTION secure_delete_drill_category(
  p_id    BIGINT,
  p_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a    RECORD;
  v_ac UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS NULL OR a.actor_kind = 'student' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT academy_id INTO v_ac FROM drill_categories WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_ac IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM drill_categories WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION secure_delete_drill_category(BIGINT, TEXT) TO anon, authenticated;

-- ── 6. seed defaults for existing academies ──────────────
-- Backfills the old hardcoded list (same keys, so existing drills' category
-- values keep resolving) so nothing regresses, while leaving it editable
-- going forward. Colors match the original hardcoded Tailwind theme names.

INSERT INTO drill_categories (academy_id, key, label, color, sort_order)
SELECT DISTINCT a.id, g.key, g.label, g.color, g.sort_order
FROM academies a
CROSS JOIN (VALUES
  ('warm_up',   'Warm-up',   'orange', 1),
  ('technical', 'Technical', 'blue',   2),
  ('passing',   'Passing',   'purple', 3),
  ('shooting',  'Shooting',  'red',    4),
  ('defending', 'Defending', 'slate',  5),
  ('ssg',       'SSG',       'green',  6),
  ('match',     'Match',     'indigo', 7),
  ('cool_down', 'Cool-down', 'teal',   8)
) AS g(key, label, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM drill_categories existing
  WHERE existing.academy_id = a.id AND existing.key = g.key
);
