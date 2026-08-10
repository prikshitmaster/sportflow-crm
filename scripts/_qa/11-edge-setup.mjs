// Minimal academy for form-submission edge-case testing — owner-only actor
// (permission variable already fully covered in rounds 1-2), one branch, one
// batch as a target for fee plans / students.
import fs from 'fs'
import { authSignUp, authSignIn, forceConfirmEmail, rpc, REST_API, ANON_KEY, assert, rid } from './lib.mjs'

const stamp = Date.now()
const OWNER_EMAIL = `qa-edge-owner-${stamp}@example.com`
const OWNER_PW = 'QaTest123!'

const signup = await authSignUp(OWNER_EMAIL, OWNER_PW)
const ownerId = signup.user.id
let ownerJwt = signup.session?.access_token || null
if (!ownerJwt) {
  await forceConfirmEmail(ownerId)
  ownerJwt = (await authSignIn(OWNER_EMAIL, OWNER_PW)).access_token
}
assert(!!ownerJwt, 'owner JWT obtained')

async function post(table, payload) {
  const res = await fetch(`${REST_API}/${table}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body }
}

const joinCode = rid('JC').slice(0, 6).toUpperCase()
const acadRes = await post('academies', { name: `QA EDGE ${stamp}`, owner_id: ownerId, join_code: joinCode })
assert(acadRes.ok, 'academy created', acadRes.body)
const academyId = acadRes.body[0].id
await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: 'QA Edge Owner' })
const FEATURES = ['attendance','payments','trials','batches','staff','reports','community','events','gate_qr']
await fetch(`${REST_API}/feature_flags`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(FEATURES.map(f => ({ academy_id: academyId, feature: f, enabled: true }))),
})

const branchR = await rpc('secure_insert_sport_branch', {
  p_sport_name: 'Cricket', p_branch_name: 'Main', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null,
}, { ownerJwt })
assert(branchR.ok, 'branch created', branchR.body)
const branchId = branchR.body.id

const batchR = await rpc('secure_insert_batch', {
  p_token: null, p_name: 'Edge Batch', p_time: null, p_sports: ['Cricket'], p_coach: null, p_capacity: 20,
  p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99, p_ground: null, p_code: null,
  p_default_fee: 0, p_default_plan: 'monthly', p_branch_id: branchId,
}, { ownerJwt })
assert(batchR.ok, 'batch created', batchR.body)
const batchId = batchR.body.id

const state = { stamp, academyId, ownerId, ownerEmail: OWNER_EMAIL, ownerPw: OWNER_PW, ownerJwt, branchId, batchId }
fs.writeFileSync(new URL('./edge-state.json', import.meta.url), JSON.stringify(state, null, 2))
console.log(`\nSaved. academyId=${academyId}`)
