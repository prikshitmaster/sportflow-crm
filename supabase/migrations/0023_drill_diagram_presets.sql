-- ============================================================
-- 0023_drill_diagram_presets.sql
-- Assigns diagram_preset to all 30 pre-seeded global drills
-- Safe to re-run — only touches is_global = TRUE rows
-- ============================================================

UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Rondo 4v1';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Possession Keep-Away 5v2';
UPDATE drills SET diagram_preset = 'channel'     WHERE is_global = TRUE AND name = 'Dynamic Movement Warm-Up';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Technical Ball Warm-Up';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Activation Passing Circuit';

UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Pass and Move Triangles';
UPDATE drills SET diagram_preset = 'channel'     WHERE is_global = TRUE AND name = '1v1 Attack and Defend';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Turning with the Ball';
UPDATE drills SET diagram_preset = 'channel'     WHERE is_global = TRUE AND name = 'Wall Pass Combination';
UPDATE drills SET diagram_preset = 'half_pitch'  WHERE is_global = TRUE AND name = 'Third Man Run';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Ball Mastery Circuit';

UPDATE drills SET diagram_preset = 'full_pitch'  WHERE is_global = TRUE AND name = 'Switch of Play';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Diamond Passing Pattern';
UPDATE drills SET diagram_preset = 'thirds'      WHERE is_global = TRUE AND name = 'Progressive Passing Grid';
UPDATE drills SET diagram_preset = 'half_pitch'  WHERE is_global = TRUE AND name = 'Overlapping Run Combination';
UPDATE drills SET diagram_preset = 'channel'     WHERE is_global = TRUE AND name = 'Line Passing with Movement';

UPDATE drills SET diagram_preset = 'penalty_box' WHERE is_global = TRUE AND name = 'Finishing from Crosses';
UPDATE drills SET diagram_preset = 'penalty_box' WHERE is_global = TRUE AND name = '1v1 vs Goalkeeper';
UPDATE drills SET diagram_preset = 'penalty_box' WHERE is_global = TRUE AND name = 'Combination Shooting';
UPDATE drills SET diagram_preset = 'penalty_box' WHERE is_global = TRUE AND name = 'Shot After Pass — Movement Shooting';

UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = '4v4 Possession Game';
UPDATE drills SET diagram_preset = 'full_pitch'  WHERE is_global = TRUE AND name = '5v5 with Target Players';
UPDATE drills SET diagram_preset = 'small_grid'  WHERE is_global = TRUE AND name = 'Transition Game 4v4+2';
UPDATE drills SET diagram_preset = 'half_pitch'  WHERE is_global = TRUE AND name = 'Pressing Trigger SSG';
UPDATE drills SET diagram_preset = 'full_pitch'  WHERE is_global = TRUE AND name = 'Goal to Goal SSG';

UPDATE drills SET diagram_preset = 'channel'     WHERE is_global = TRUE AND name = '1v1 Defending';
UPDATE drills SET diagram_preset = 'half_pitch'  WHERE is_global = TRUE AND name = 'Press and Cover Defending';
UPDATE drills SET diagram_preset = 'thirds'      WHERE is_global = TRUE AND name = 'Defensive Block Shape';

UPDATE drills SET diagram_preset = 'full_pitch'  WHERE is_global = TRUE AND name = 'Static Stretching Routine';
UPDATE drills SET diagram_preset = 'full_pitch'  WHERE is_global = TRUE AND name = 'Debrief Circle and Recovery';
