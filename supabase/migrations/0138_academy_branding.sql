-- ============================================================
-- 0138 — Academy branding (slug, brand color, app display name)
-- ============================================================
-- WHAT
--   • academies.slug             — URL-safe public identifier, e.g. "ara".
--     Powers /join/:academySlug (see migration 0139). Nullable/opt-in,
--     same posture as the existing academies.logo_url column.
--   • academies.brand_color      — hex color for the public funnel's theme.
--   • academies.app_display_name — public-facing name (falls back to
--     academies.name in the app if unset).
--
-- Backfills the live "ARA" academy (cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf,
-- confirmed the real academy in migration 0136's own comment — 503
-- students, 10 branches, vs. a decoy "ara" academy with 31/1) with
-- slug='ara' so the funnel has a resolvable slug from day one, before
-- 0139 introduces anything that depends on it.
--
-- Purely additive — no existing RLS, RPC, or read path is touched by this
-- migration. Safe standalone.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE academies
  ADD COLUMN IF NOT EXISTS slug             TEXT,
  ADD COLUMN IF NOT EXISTS brand_color      TEXT,
  ADD COLUMN IF NOT EXISTS app_display_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academies_slug_format'
  ) THEN
    ALTER TABLE academies ADD CONSTRAINT academies_slug_format
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academies_brand_color_format'
  ) THEN
    ALTER TABLE academies ADD CONSTRAINT academies_brand_color_format
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END $$;

-- Postgres UNIQUE indexes allow multiple NULLs, so academies without a
-- slug yet don't block each other.
CREATE UNIQUE INDEX IF NOT EXISTS academies_slug_unique ON academies (slug);

COMMENT ON COLUMN academies.slug             IS 'URL-safe public identifier for /join/:academySlug. Lowercase, 3-50 chars, unique. Nullable (opt-in).';
COMMENT ON COLUMN academies.brand_color      IS 'Hex color (#rrggbb) for the public registration funnel theme.';
COMMENT ON COLUMN academies.app_display_name IS 'Public-facing display name for the funnel/app. Falls back to academies.name when unset.';

UPDATE academies SET
  slug             = 'ara',
  brand_color      = '#1B4332',
  app_display_name = 'Ahmedabad Racquet Academy'
WHERE id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'
  AND slug IS NULL;

COMMIT;

-- ============================================================
-- Post-migration verification (run separately AFTER commit):
-- ============================================================
-- SELECT id, name, slug, brand_color, app_display_name FROM academies WHERE slug IS NOT NULL;
-- SELECT conname FROM pg_constraint WHERE conname LIKE 'academies_%format';
