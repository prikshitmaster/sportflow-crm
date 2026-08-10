// Verifies the rate-limit fix: lockout after 5 fails, scoped per-identifier
// (not global), success clears the counter, same error message throughout.
import fs from 'fs'
import { authSignUp, authSignIn, forceConfirmEmail, rpc, REST_API, ANON_KEY, hashPassword, assert, rid } from './lib.mjs'

const stamp = Date.now()
const OWNER_EMAIL = `qa-rl-owner-${stamp}@example.com`
const OWNER_PW = 'QaTest123!'

const signup = await authSignUp(OWNER_EMAIL, OWNER_PW)
const ownerId = signup.user.id
let ownerJwt = signup.session?.access_token || null
if (!ownerJwt) { await forceConfirmEmail(ownerId); ownerJwt = (await authSignIn(OWNER_EMAIL, OWNER_PW)).access_token }

async function post(table, payload) {
  const res = await fetch(`${REST_API}/${table}`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(payload) })
  return { ok: res.ok, body: await res.json().catch(() => null) }
}
const joinCode = rid('JC').slice(0, 6).toUpperCase()
const acadRes = await post('academies', { name: `QA RL ${stamp}`, owner_id: ownerId, join_code: joinCode })
const academyId = acadRes.body[0].id
await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: 'QA RL Owner' })
const branchR = await rpc('secure_insert_sport_branch', { p_sport_name: 'Cricket', p_branch_name: 'Main', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null }, { ownerJwt })
const branchId = branchR.body.id

async function makeStaff(name) {
  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const jc = rid('SC').slice(0,6).toUpperCase()
  const insR = await rpc('secure_insert_staff', { p_token: null, p_name: name, p_role: 'Coach', p_phone: '9'+String(Math.floor(Math.random()*1e9)).padStart(9,'0'), p_sports: ['Cricket'], p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null, p_staff_code: codeR.body, p_join_code: jc, p_staff_type: 'coach', p_branch_id: branchId }, { ownerJwt })
  const email = `${rid('rl-staff')}@example.com`
  const pwHash = hashPassword('CorrectPw123!')
  await rpc('secure_activate_staff_account', { p_staff_code: codeR.body, p_join_code: jc, p_password_hash: pwHash, p_email: email }, {})
  return { id: insR.body, email, pwHash }
}

const staffA = await makeStaff('RL Staff A')
const staffB = await makeStaff('RL Staff B')

// A failed login now returns HTTP 200 with a null body (RETURN NULL), not an
// error — matches db.js's existing `if (!data) throw new Error(...)` path.
// A real login success returns a JSON object with a .token field.
const loggedIn = (r) => r.ok && r.body && typeof r.body === 'object' && !!r.body.token

console.log('\n=== Lockout after 5 failed attempts ===')
let lastBody
for (let i = 1; i <= 5; i++) {
  const r = await rpc('secure_login_staff', { p_email: staffA.email, p_password_hash: hashPassword('wrong'+i) }, {})
  lastBody = r.body
  console.log(`  attempt ${i}: status=${r.status} body=${JSON.stringify(r.body)}`)
}
const sixthWithCorrectPw = await rpc('secure_login_staff', { p_email: staffA.email, p_password_hash: staffA.pwHash }, {})
assert(!loggedIn(sixthWithCorrectPw), '6th attempt LOCKED OUT even with the CORRECT password', sixthWithCorrectPw.body)
assert(JSON.stringify(sixthWithCorrectPw.body) === JSON.stringify(lastBody), 'lockout response is byte-identical to a normal wrong-password response (both null — no new enumeration signal)', { lockout: sixthWithCorrectPw.body, normal: lastBody })

console.log('\n=== Lockout is scoped per-account, not global ===')
const staffBLogin = await rpc('secure_login_staff', { p_email: staffB.email, p_password_hash: staffB.pwHash }, {})
assert(loggedIn(staffBLogin), 'a DIFFERENT staff member can still log in normally while staffA is locked', staffBLogin.body)

console.log('\n=== A successful login clears the failure counter ===')
const staffC = await makeStaff('RL Staff C')
for (let i = 1; i <= 3; i++) {
  await rpc('secure_login_staff', { p_email: staffC.email, p_password_hash: hashPassword('wrong'+i) }, {})
}
const midSuccess = await rpc('secure_login_staff', { p_email: staffC.email, p_password_hash: staffC.pwHash }, {})
assert(loggedIn(midSuccess), 'staffC logs in successfully after 3 fails (below threshold)', midSuccess.body)
for (let i = 1; i <= 4; i++) {
  await rpc('secure_login_staff', { p_email: staffC.email, p_password_hash: hashPassword('wrong-again'+i) }, {})
}
const afterMoreFails = await rpc('secure_login_staff', { p_email: staffC.email, p_password_hash: staffC.pwHash }, {})
assert(loggedIn(afterMoreFails), 'staffC can STILL log in after 4 more fails post-success (counter was cleared, not accumulated to 7)', afterMoreFails.body)

console.log('\ncleanup')
const { pgQuery } = await import('./lib.mjs')
await pgQuery(`delete from staff_sessions where staff_id in (select id from staff where academy_id = $1)`, [academyId])
await pgQuery(`delete from staff_auth where staff_id in (select id from staff where academy_id = $1)`, [academyId])
await pgQuery(`delete from staff where academy_id = $1`, [academyId])
await pgQuery(`delete from sport_branches where academy_id = $1`, [academyId])
await pgQuery(`delete from login_rate_limits where key like 'staff:%rl-staff%'`, [])
await pgQuery(`delete from profiles where id = $1`, [ownerId])
await pgQuery(`delete from academies where id = $1`, [academyId])
await pgQuery(`delete from auth.users where id = $1`, [ownerId])
console.log('done')
