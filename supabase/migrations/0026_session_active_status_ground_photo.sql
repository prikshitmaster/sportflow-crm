-- ============================================================
-- 0026_session_active_status.sql
-- Adds 'active' phase to session lifecycle
-- SAFE: all ALTER ... IF NOT EXISTS / IF EXISTS
-- ============================================================

-- Allow 'active' status on session_plans
ALTER TABLE session_plans DROP CONSTRAINT IF EXISTS session_plans_status_check;
ALTER TABLE session_plans ADD CONSTRAINT session_plans_status_check
  CHECK (status IN ('draft', 'published', 'active', 'completed'));
