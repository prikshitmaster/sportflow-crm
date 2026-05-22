-- 0065 — Branch manager assignment
-- Adds manager_id (FK → staff) to sport_branches and updates the update RPC.

BEGIN;

ALTER TABLE sport_branches
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES staff(id) ON DELETE SET NULL;

-- Drop old 4-arg signature before replacing with 5-arg version.
-- (Postgres treats different arg-type lists as separate overloads.)
DROP FUNCTION IF EXISTS secure_update_sport_branch(BIGINT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION secure_update_sport_branch(
  p_branch_id   BIGINT,
  p_branch_name TEXT    DEFAULT NULL,
  p_address     TEXT    DEFAULT NULL,
  p_manager_id  UUID    DEFAULT NULL,
  p_token       TEXT    DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; v_acad UUID;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT academy_id INTO v_acad FROM sport_branches WHERE id = p_branch_id;
  IF NOT FOUND OR v_acad IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Verify that the chosen manager belongs to this academy
  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM staff WHERE id = p_manager_id AND academy_id = a.academy_id
    ) THEN
      RAISE EXCEPTION 'forbidden: manager not in academy' USING ERRCODE = '42501';
    END IF;
  END IF;
  UPDATE sport_branches SET
    branch_name = COALESCE(p_branch_name, branch_name),
    address     = p_address,
    manager_id  = p_manager_id
  WHERE id = p_branch_id;
END;
$$;
GRANT EXECUTE ON FUNCTION secure_update_sport_branch(BIGINT, TEXT, TEXT, UUID, TEXT) TO anon, authenticated;

COMMIT;
