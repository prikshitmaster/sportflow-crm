-- 0164 — Branch cards on /join gain a batch count
--
-- The "Choose a Branch" step showed just a photo, name and address — a
-- big block of empty space between the address line and the Register
-- button on every card, with nothing to actually help a parent compare
-- branches. secure_public_trial_branches_v2 already returns trial_fee
-- (no change needed there), but has no sense of how many batches exist
-- at a branch for that sport — this adds that as a per-row LATERAL count.
--
-- Correlated per (branch, sport) rather than per branch alone: a
-- sport_branches row is already a (branch, sport) pair, and a batch only
-- counts if that sport is actually in its `sports` array — the same
-- match secure_public_trial_batches_v2 uses one screen later.
--
-- Signature UNCHANGED (p_slug text) — plain CREATE OR REPLACE, no DROP,
-- no PostgREST overload risk. The existing SELECT list and WHERE/ORDER BY
-- are untouched; only the LATERAL join and its new column are added.
--
-- IDEMPOTENT — safe to re-run.

CREATE OR REPLACE FUNCTION public.secure_public_trial_branches_v2(p_slug text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::JSON)
    FROM (
      SELECT sb.id, sb.sport_name, sb.branch_name, sb.photo_url, sb.address,
             sb.trial_fee, sb.kit_fee, sb.tax_percent, sb.tax_on_trial, sb.tax_on_kit,
             COALESCE(bc.batch_count, 0) AS batch_count
      FROM sport_branches sb
      LEFT JOIN LATERAL (
        SELECT count(*) AS batch_count
        FROM batches b
        WHERE b.branch_id = sb.id
          AND EXISTS (SELECT 1 FROM unnest(b.sports) s WHERE lower(s) = lower(sb.sport_name))
      ) bc ON true
      WHERE sb.academy_id = _public_trial_academy_id_v2(p_slug)
      ORDER BY sb.branch_name, sb.sport_name
    ) x
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.secure_public_trial_branches_v2(text) TO anon, authenticated;
