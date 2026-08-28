-- Adversarial test for migration 0196 (push_subscriptions/fcm_tokens RLS).
-- Simulates two different owner JWTs (real Supabase Auth 'authenticated'
-- role) the way PostgREST does internally, via request.jwt.claims.
-- Owner A: ea17ce2d.. (academy cb01cec5..). Owner B: 562453af.. (academy 041b7aad..).
-- Runs inside BEGIN/ROLLBACK — nothing persists.
BEGIN;
CREATE TEMP TABLE res (test TEXT, expected TEXT, got TEXT, pass BOOLEAN);
GRANT INSERT, SELECT, DELETE ON res TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fcm_tokens TO authenticated;

-- Seed one push_subscriptions row + one fcm_tokens row for academy A.
INSERT INTO push_subscriptions (user_type, user_id, academy_id, endpoint, p256dh, auth)
VALUES ('owner', 'zz-owner-a', 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', 'https://zz-test-endpoint-a', 'p', 'a');
INSERT INTO fcm_tokens (user_type, user_id, academy_id, token)
VALUES ('owner', 'zz-owner-a', 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', 'zz-test-fcm-token-a');

-- ── Owner B (academy 041b7aad..) tries to read/write/delete Owner A's rows ──
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"562453af-0ace-4924-a9e1-ad6f03ce7a9f","role":"authenticated"}';

INSERT INTO res
SELECT 'push_subscriptions: cross-academy SELECT blocked', '0 rows', count(*)::text, count(*) = 0
FROM push_subscriptions WHERE academy_id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf';

INSERT INTO res
SELECT 'fcm_tokens: cross-academy SELECT blocked', '0 rows', count(*)::text, count(*) = 0
FROM fcm_tokens WHERE academy_id = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf';

DO $do$
BEGIN
  BEGIN
    INSERT INTO push_subscriptions (user_type, user_id, academy_id, endpoint, p256dh, auth)
    VALUES ('owner', 'zz-owner-b-attack', 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf', 'https://zz-attack-endpoint', 'p', 'a');
    INSERT INTO res VALUES ('push_subscriptions: cross-academy INSERT blocked', 'blocked', 'succeeded (BAD)', FALSE);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO res VALUES ('push_subscriptions: cross-academy INSERT blocked', 'blocked', 'blocked: ' || SQLERRM, TRUE);
  END;

  BEGIN
    DELETE FROM push_subscriptions WHERE endpoint = 'https://zz-test-endpoint-a';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $do$;

RESET ROLE;

-- Verified from the unrestricted (table-owner) role, not the attacker's —
-- RLS would hide the row from Owner B's own SELECT either way, whether or
-- not the DELETE actually went through, so that view can't prove survival.
INSERT INTO res
SELECT 'push_subscriptions: cross-academy DELETE was a no-op (row survives)', '1 row',
       count(*)::text, count(*) = 1
FROM push_subscriptions WHERE endpoint = 'https://zz-test-endpoint-a';

-- ── Owner A (academy cb01cec5..) — legitimate same-academy access still works ──
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"ea17ce2d-75b6-4433-a54c-a65cd4070269","role":"authenticated"}';

INSERT INTO res
SELECT 'push_subscriptions: own-academy SELECT still works', '>=1 row', count(*)::text, count(*) >= 1
FROM push_subscriptions WHERE endpoint = 'https://zz-test-endpoint-a';

INSERT INTO res
SELECT 'fcm_tokens: own-academy SELECT still works', '>=1 row', count(*)::text, count(*) >= 1
FROM fcm_tokens WHERE token = 'zz-test-fcm-token-a';

DELETE FROM push_subscriptions WHERE endpoint = 'https://zz-test-endpoint-a';
INSERT INTO res
SELECT 'push_subscriptions: own-academy DELETE still works', '0 rows', count(*)::text, count(*) = 0
FROM push_subscriptions WHERE endpoint = 'https://zz-test-endpoint-a';

RESET ROLE;

SELECT count(*) FILTER (WHERE pass IS NOT TRUE) AS failures, count(*) AS total FROM res;
SELECT test, expected, got, pass FROM res ORDER BY pass, test;
ROLLBACK;
