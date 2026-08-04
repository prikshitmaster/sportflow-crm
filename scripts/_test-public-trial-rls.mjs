// Throwaway REST test for the public trial self-enrollment RPCs (0136).
// Unlike the other _test-*-rls.mjs scripts, this doesn't connect to Postgres
// directly (secure_public_trial_* auth on auth.uid(), a real Supabase Auth
// JWT — not the x-staff-token header trick those scripts impersonate). This
// hits the real REST/RPC endpoint over HTTPS instead, exactly like the app
// itself would.
//
// Requires the DEV-only trial-test-login edge function to be deployed with
// ENABLE_TRIAL_TEST_LOGIN=true (see supabase/functions/trial-test-login).
//
// Usage: node scripts/_test-public-trial-rls.mjs
//   Optional env: TEST_PHONE (10 digits), WRONG_ACADEMY_BRANCH_ID (a
//   sport_branches.id belonging to the OTHER live academy, to prove the
//   cross-tenant guard actually rejects it — without this the wrong-academy
//   case is skipped, not silently passed).

import fs from 'fs'

function loadEnv() {
  const out = {}
  try {
    const raw = fs.readFileSync('.env', 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fall through to process.env */ }
  return { ...out, ...process.env }
}

const env      = loadEnv()
const URL      = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const PHONE    = env.TEST_PHONE || '9999999001'
const WRONG_BRANCH = env.WRONG_ACADEMY_BRANCH_ID || null

if (!URL || !ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (checked .env and process.env)')
  process.exit(1)
}

async function rpc(name, payload, jwt) {
  const resp = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        ANON_KEY,
      'Authorization': `Bearer ${jwt || ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  const body = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, body }
}

async function getTestJwt(phone) {
  const login = await fetch(`${URL}/functions/v1/trial-test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ phone }),
  })
  const j = await login.json().catch(() => ({}))
  if (!login.ok) throw new Error(`trial-test-login failed (${login.status}): ${j.error || 'is ENABLE_TRIAL_TEST_LOGIN set?'}`)

  const tok = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ email: j.email, password: j.password }),
  })
  const t = await tok.json().catch(() => ({}))
  if (!tok.ok) throw new Error(`password sign-in failed (${tok.status}): ${JSON.stringify(t)}`)
  return t.access_token
}

let pass = 0, fail = 0
function check(label, condition, detail) {
  if (condition) { console.log(`  OK   ${label}`); pass++ }
  else           { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
}

console.log('## 1. No JWT at all — anon key only')
{
  const r = await rpc('secure_public_trial_branches', {})
  check('secure_public_trial_branches rejects unauthenticated caller', !r.ok, JSON.stringify(r.body))
}

console.log('\n## 2. Real OTP-verified session (via dev test-login)')
const jwt = await getTestJwt(PHONE)
{
  const r = await rpc('secure_public_trial_branches', {}, jwt)
  check('secure_public_trial_branches succeeds once authenticated', r.ok, JSON.stringify(r.body))
  if (r.ok) console.log(`       -> ${r.body.length} branch row(s)`)

  if (r.ok && r.body.length > 0) {
    const realBranchId = r.body[0].id
    const batches = await rpc('secure_public_trial_batches', { p_branch_id: realBranchId }, jwt)
    check('secure_public_trial_batches succeeds for a real branch', batches.ok, JSON.stringify(batches.body))

    const submit = await rpc('secure_submit_public_trial', {
      p_branch_id: realBranchId,
      p_name: 'RLS Test Student',
      p_parent_name: 'RLS Test Parent',
      p_emergency_contact_name: 'RLS Test Emergency',
      p_emergency_contact_phone: '9999999002',
    }, jwt)
    check('secure_submit_public_trial succeeds on the happy path', submit.ok, JSON.stringify(submit.body))
    if (submit.ok) {
      check('  -> stage is new',              submit.body.stage === 'new',               submit.body.stage)
      check('  -> source is App',             submit.body.source === 'App',              submit.body.source)
      check('  -> trial_fee_mode is Not collected', submit.body.trial_fee_mode === 'Not collected', submit.body.trial_fee_mode)
      console.log(`       -> created trial id ${submit.body.id} — verify manually: SELECT * FROM payments WHERE trial_id = ${submit.body.id} (expect 0 rows)`)
    }
  } else {
    console.log('       (no branches configured for this academy yet — batch/submit checks skipped)')
  }

  const badBatch = await rpc('secure_submit_public_trial', {
    p_branch_id: r.body?.[0]?.id,
    p_batch_id: 99999999,
    p_name: 'Should Fail', p_parent_name: 'Should Fail',
  }, jwt)
  check('secure_submit_public_trial rejects a batch id that does not exist', !badBatch.ok, JSON.stringify(badBatch.body))
}

console.log('\n## 3. Cross-tenant guard')
if (WRONG_BRANCH) {
  const r = await rpc('secure_submit_public_trial', {
    p_branch_id: WRONG_BRANCH, p_name: 'Should Fail', p_parent_name: 'Should Fail',
  }, jwt)
  check('secure_submit_public_trial rejects a branch from the other academy', !r.ok, JSON.stringify(r.body))
} else {
  console.log('  SKIP — set WRONG_ACADEMY_BRANCH_ID to a sport_branches.id from the other live academy to test this')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
