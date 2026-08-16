-- 0163 — Drop the now-redundant case-sensitive batch-code unique index
--
-- Found during a post-session audit: 0160 added
-- batches_academy_code_unique on (academy_id, lower(code)) without
-- checking whether a similar constraint already existed. It did —
-- 0055_fix_batch_code_unique.sql created batches_code_academy_unique on
-- (code, academy_id), case-SENSITIVE, back near the start of this
-- project's history. Both were live side by side: harmless (0160's index
-- is a strict superset — anything 0055's case-sensitive index blocks,
-- 0160's case-insensitive one already blocks too, plus case variants
-- like "U15" vs "u15" that 0055's never caught), but redundant — two
-- unique indexes maintained on every batch insert/update for the same
-- underlying invariant.
--
-- Safe to drop 0055's: 0160's index is strictly stronger, so nothing that
-- currently passes validation was relying on the weaker one specifically.
--
-- IDEMPOTENT — safe to re-run.

DROP INDEX IF EXISTS batches_code_academy_unique;
