// Throwaway REST test for the public trial self-enrollment RPCs.
// Unlike the other _test-*-rls.mjs scripts, this doesn't connect to Postgres
// directly (secure_public_trial_*_v2 auth on auth.uid(), a real Supabase Auth
// JWT — not the x-staff-token header trick those scripts impersonate). This
// hits the real REST/RPC endpoint over HTTPS instead, exactly like the app
// itself would.
//
// Requires the DEV-only trial-test-login edge function to be deployed with
// ENABLE_TRIAL_TEST_LOGIN=true (see supabase/functions/trial-test-login).
//
// Migration 0139 made this multi-tenant (slug-resolved instead of a
// hardcoded academy constant) — this script tests TWO real academy slugs
// ('ara' = the real live academy, 'ara-test-2' = the pre-existing decoy
// academy, given a slug specifically for this test) and proves academy A's
// slug cannot see or write into academy B's branches/batches/trials, which
// is the actual new thing 0139 introduces over the original single-tenant
// 0136 design.
//
// Usage: node scripts/_test-public-trial-rls.mjs
//   Optional env: TEST_PHONE (10 digits), SLUG_A (default 'ara'),
//   SLUG_B (default 'ara-test-2')

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
const SLUG_A   = env.SLUG_A || 'ara'
const SLUG_B   = env.SLUG_B || 'ara-test-2'

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
  const r = await rpc('secure_public_trial_branches_v2', { p_slug: SLUG_A })
  check('secure_public_trial_branches_v2 rejects unauthenticated caller', !r.ok, JSON.stringify(r.body))
}

console.log('\n## 2. secure_public_academy_branding — the ONE deliberate pre-auth exception')
{
  const known = await rpc('secure_public_academy_branding', { p_slug: SLUG_A })
  check(`branding succeeds with NO JWT for a known slug ('${SLUG_A}')`, known.ok && known.body?.name, JSON.stringify(known.body))

  const unknown = await rpc('secure_public_academy_branding', { p_slug: 'this-slug-does-not-exist-xyz' })
  check('branding returns null (not an error) for an unknown slug', unknown.ok && unknown.body === null, JSON.stringify(unknown.body))
}

console.log(`\n## 3. Real OTP-verified session (via dev test-login) — academy A ('${SLUG_A}')`)
const jwt = await getTestJwt(PHONE)
let branchesA = []
{
  const r = await rpc('secure_public_trial_branches_v2', { p_slug: SLUG_A }, jwt)
  check('secure_public_trial_branches_v2 succeeds once authenticated', r.ok, JSON.stringify(r.body))
  branchesA = r.ok ? r.body : []
  if (r.ok) console.log(`       -> ${branchesA.length} branch row(s) for '${SLUG_A}'`)

  if (branchesA.length > 0) {
    const realBranchId = branchesA[0].id
    const batches = await rpc('secure_public_trial_batches_v2', { p_slug: SLUG_A, p_branch_id: realBranchId }, jwt)
    check('secure_public_trial_batches_v2 succeeds for a real branch', batches.ok, JSON.stringify(batches.body))

    const submit = await rpc('secure_submit_public_trial_v2', {
      p_slug: SLUG_A,
      p_branch_id: realBranchId,
      p_name: 'RLS Test Student',
      p_parent_name: 'RLS Test Parent',
      p_emergency_contact_name: 'RLS Test Emergency',
      p_emergency_contact_phone: '9999999002',
    }, jwt)
    check('secure_submit_public_trial_v2 succeeds on the happy path', submit.ok, JSON.stringify(submit.body))
    if (submit.ok) {
      check('  -> stage is new',              submit.body.stage === 'new',               submit.body.stage)
      check('  -> source is App',             submit.body.source === 'App',              submit.body.source)
      check('  -> trial_fee_mode is Not collected', submit.body.trial_fee_mode === 'Not collected', submit.body.trial_fee_mode)
      console.log(`       -> created trial id ${submit.body.id} — verify manually: SELECT * FROM payments WHERE trial_id = ${submit.body.id} (expect 0 rows)`)
    }

    const badBatch = await rpc('secure_submit_public_trial_v2', {
      p_slug: SLUG_A, p_branch_id: realBranchId, p_batch_id: 99999999,
      p_name: 'Should Fail', p_parent_name: 'Should Fail',
    }, jwt)
    check('secure_submit_public_trial_v2 rejects a batch id that does not exist', !badBatch.ok, JSON.stringify(badBatch.body))
  } else {
    console.log('       (no branches configured for this academy yet — batch/submit checks skipped)')
  }
}

console.log(`\n## 4. Multi-tenant cross-check — academy B ('${SLUG_B}')`)
let branchesB = []
{
  const r = await rpc('secure_public_trial_branches_v2', { p_slug: SLUG_B }, jwt)
  check('secure_public_trial_branches_v2 succeeds for a DIFFERENT slug with the SAME session', r.ok, JSON.stringify(r.body))
  branchesB = r.ok ? r.body : []
  if (r.ok) console.log(`       -> ${branchesB.length} branch row(s) for '${SLUG_B}'`)

  const overlap = branchesA.filter(a => branchesB.some(b => b.id === a.id))
  check('academy A and academy B branch lists are disjoint (no shared branch ids)', overlap.length === 0, JSON.stringify(overlap))
}

console.log('\n## 5. Cross-tenant guard — slug/branch mismatch must be rejected')
if (branchesA.length > 0) {
  const r = await rpc('secure_submit_public_trial_v2', {
    p_slug: SLUG_B, // wrong slug for this branch
    p_branch_id: branchesA[0].id, // belongs to academy A
    p_name: 'Should Fail', p_parent_name: 'Should Fail',
  }, jwt)
  check(`secure_submit_public_trial_v2 rejects academy A's branch when p_slug='${SLUG_B}'`, !r.ok, JSON.stringify(r.body))

  const r2 = await rpc('secure_public_trial_batches_v2', {
    p_slug: SLUG_B, p_branch_id: branchesA[0].id,
  }, jwt)
  check(`secure_public_trial_batches_v2 rejects academy A's branch when p_slug='${SLUG_B}'`, !r2.ok, JSON.stringify(r2.body))
} else {
  console.log('  SKIP — academy A has no branches to test the mismatch against')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
