-- Phase D: Add sport column to audit_logs for branch isolation
-- Every new audit entry will be tagged with the sport/branch context.
-- Historical entries (sport = NULL) will appear in ALL sport views.
-- Going forward, Football actions will not appear in Football_ARA_branch_2 and vice versa.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS sport TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_sport
  ON audit_logs(sport)
  WHERE sport IS NOT NULL;
