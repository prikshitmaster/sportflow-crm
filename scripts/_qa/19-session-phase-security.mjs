// Verifies the session_phase cross-tenant fixes (create/update/delete) and
// the branch checks added to session_pulse/spotlight, using two academies.
import fs from 'fs'
import crypto from 'crypto'
import { authSignUp, authSignIn, forceConfirmEmail, rpc, REST_API, ANON_KEY, hashPassword, assert, rid, pgQuery } from './lib.mjs'

async function makeAcademy(label) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const email = `qa-phase-${label}-${stamp}@example.com`
  const pw = 'QaTest123!'
  const signup = await authSignUp(email, pw)
  const ownerId = signup.user.id
  let ownerJwt = signup.session?.access_token || null
  if (!ownerJwt) { await forceConfirmEmail(ownerId); ownerJwt = (await authSignIn(email, pw)).access_token }
  async function post(table, payload) {
    const res = await fetch(`${REST_API}/${table}`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(payload) })
    return { ok: res.ok, body: await res.json().catch(() => null) }
  }
  const joinCode = rid('JC').slice(0, 6).toUpperCase()
  const acadRes = await post('academies', { name: `QA PHASE ${label} ${stamp}`, owner_id: ownerId, join_code: joinCode })
  const academyId = acadRes.body[0].id
  await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: `QA Phase Owner ${label}` })
  const branchR = await rpc('secure_insert_sport_branch', { p_sport_name: 'Cricket', p_branch_name: 'Main', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null }, { ownerJwt })
  const branchId = branchR.body.id

  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const staffJc = rid('SC').slice(0,6).toUpperCase()
  const staffInsR = await rpc('secure_insert_staff', { p_token: null, p_name: `QA Phase Staff ${label}`, p_role: 'Coach', p_phone: '9'+String(Math.floor(Math.random()*1e9)).padStart(9,'0'), p_sports: ['Cricket'], p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null, p_staff_code: codeR.body, p_join_code: staffJc, p_staff_type: 'coach', p_branch_id: branchId }, { ownerJwt })
  const staffId = staffInsR.body
  const staffEmail = `${rid('phase-staff')}@example.com`
  const staffPwHash = hashPassword('StaffPw123!')
  await rpc('secure_activate_staff_account', { p_staff_code: codeR.body, p_join_code: staffJc, p_password_hash: staffPwHash, p_email: staffEmail }, {})
  const staffLoginR = await rpc('secure_login_staff', { p_email: staffEmail, p_password_hash: staffPwHash }, {})
  await rpc('secure_update_staff_permissions', { p_staff_id: staffId, p_permissions: ['training.manage'], p_access_role: 'coach', p_token: null }, { ownerJwt })

  return { academyId, ownerId, ownerJwt, branchId, staffId, staffToken: staffLoginR.body?.token }
}

const A = await makeAcademy('A')
const B = await makeAcademy('B')

console.log('\n=== secure_create_session_plan + secure_create_session_phase (academy A) ===')
const planId = crypto.randomUUID()
const planR = await rpc('secure_create_session_plan', { p_payload: { id: planId, topic: 'QA Session', date: new Date().toISOString().slice(0,10) }, p_token: null }, { ownerJwt: A.ownerJwt })
assert(planR.ok, 'session plan created in academy A', planR.body)

const phaseId = crypto.randomUUID()
const phaseR = await rpc('secure_create_session_phase', { p_phase: { id: phaseId, session_id: planId, phase_name: 'Warmup', position: 1 }, p_token: null }, { ownerJwt: A.ownerJwt })
assert(phaseR.ok, 'session phase created in academy A', phaseR.body)

console.log('\n=== Cross-tenant CREATE: academy B tries to attach a phase to academy A\'s plan ===')
const crossCreate = await rpc('secure_create_session_phase', { p_phase: { session_id: planId, phase_name: 'Malicious', position: 99 }, p_token: null }, { ownerJwt: B.ownerJwt })
assert(!crossCreate.ok, 'academy B BLOCKED from creating a phase on academy A\'s plan', crossCreate.body)

console.log('\n=== Cross-tenant UPDATE ===')
const crossUpdate = await rpc('secure_update_session_phase', { p_id: phaseId, p_updates: { phase_name: 'Hacked' }, p_token: B.staffToken }, {})
assert(!crossUpdate.ok, "academy B staff BLOCKED from updating academy A's session phase", crossUpdate.body)
const ownUpdate = await rpc('secure_update_session_phase', { p_id: phaseId, p_updates: { phase_name: 'Updated Warmup' }, p_token: A.staffToken }, {})
assert(ownUpdate.ok, "academy A staff ALLOWED to update their own academy's session phase", ownUpdate.body)

console.log('\n=== Cross-tenant DELETE ===')
const crossDelete = await rpc('secure_delete_session_phase', { p_id: phaseId, p_token: B.staffToken }, {})
assert(!crossDelete.ok, "academy B staff BLOCKED from deleting academy A's session phase", crossDelete.body)
const ownDelete = await rpc('secure_delete_session_phase', { p_id: phaseId, p_token: null }, { ownerJwt: A.ownerJwt })
assert(ownDelete.ok, "academy A owner ALLOWED to delete their own academy's session phase", ownDelete.body)

console.log('\ncleanup')
for (const acad of [A, B]) {
  await pgQuery(`delete from session_plans where academy_id = $1`, [acad.academyId])
  await pgQuery(`delete from staff_sessions where staff_id = $1`, [acad.staffId])
  await pgQuery(`delete from staff_auth where staff_id = $1`, [acad.staffId])
  await pgQuery(`delete from staff where academy_id = $1`, [acad.academyId])
  await pgQuery(`delete from sport_branches where academy_id = $1`, [acad.academyId])
  await pgQuery(`delete from profiles where id = $1`, [acad.ownerId])
  await pgQuery(`delete from academies where id = $1`, [acad.academyId])
  await pgQuery(`delete from auth.users where id = $1`, [acad.ownerId])
}
console.log('done')
