    -- ============================================================
    -- 0024_drill_sport_name.sql
    -- Adds sport_name to drills for cross-sport isolation
    -- Global drills seeded as Football; custom drills inherit sport at creation
    -- SAFE: IF NOT EXISTS, only touches drills table
    -- ============================================================

    ALTER TABLE drills ADD COLUMN IF NOT EXISTS sport_name text;

    -- Tag all 30 global football drills
    UPDATE drills SET sport_name = 'Football' WHERE is_global = TRUE;
