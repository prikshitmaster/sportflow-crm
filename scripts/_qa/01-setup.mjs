// Phase 0: create a fully isolated QA academy, exactly the way a real owner
// signup does it (Auth API signup -> createAcademy insert -> createProfile
// insert -> initDefaultFlags upsert), then populate 2 sports x branches,
// staff of every role, and students in varied states. Writes results to
// scripts/_qa/state.json for later phases to reuse.
import fs from 'fs'
import { authSignUp, authSignIn, forceConfirmEmail, restGet, rpc, hashPassword, assert, rid, pgQuery } from './lib.mjs'

const stamp = Date.now()
const OWNER_EMAIL = `qa-owner-${stamp}@example.com`
const OWNER_PW = 'QaTest123!'
const ACADEMY_NAME = `QA AUDIT ACADEMY ${stamp}`

console.log(`\n=== PHASE 0: Owner signup (live test of migrations 0121/0122 academies RLS) ===`)
console.log(`owner email: ${OWNER_EMAIL}`)

const signup = await authSignUp(OWNER_EMAIL, OWNER_PW)
assert(!!signup.user?.id, 'auth signup returns user id', signup)
const ownerId = signup.user.id
let ownerJwt = signup.session?.access_token || null

if (!ownerJwt) {
  console.log('  (email confirmation required — confirming directly via DB, matches a real confirmed user)')
  await forceConfirmEmail(ownerId)
  const signin = await authSignIn(OWNER_EMAIL, OWNER_PW)
  ownerJwt = signin.access_token
}
assert(!!ownerJwt, 'owner has a working JWT after signup+confirm', { ownerJwt: !!ownerJwt })

// createAcademy() — raw insert, exactly like db.js
const joinCode = rid('JC').slice(0, 6).toUpperCase()
const { REST_API, ANON_KEY } = await import('./lib.mjs')
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

const acadRes = await post('academies', { name: ACADEMY_NAME, owner_id: ownerId, join_code: joinCode })
assert(acadRes.ok && acadRes.body?.[0]?.id, 'createAcademy insert+select succeeds (RLS 0121/0122 regression check)', acadRes.body)
const academyId = acadRes.body[0].id

const profRes = await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: 'QA Owner' })
assert(profRes.ok, 'createProfile insert succeeds', profRes.body)

const FEATURES = ['attendance','payments','trials','batches','staff','reports','community','events','gate_qr']
const flagsRes = await fetch(`${REST_API}/feature_flags`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(FEATURES.map(f => ({ academy_id: academyId, feature: f, enabled: true }))),
})
assert(flagsRes.ok, 'initDefaultFlags upsert succeeds', await flagsRes.text().catch(()=>''))

console.log(`\n=== PHASE 0b: sport branches (2 sports x branches) ===`)
async function insertSportBranch(sportName, branchName) {
  const r = await rpc('secure_insert_sport_branch', {
    p_sport_name: sportName, p_branch_name: branchName, p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null,
  }, { ownerJwt })
  assert(r.ok, `sport_branch ${sportName}/${branchName} created`, r.body)
  return r.body?.id
}
const cricketB1 = await insertSportBranch('Cricket', 'B1')
const cricketB2 = await insertSportBranch('Cricket', 'B2')
const footballB1 = await insertSportBranch('Football', 'B1')

console.log(`\n=== PHASE 0c: staff (one per role/scope combo) ===`)
async function makeStaff({ name, staffType, sports, branchId }) {
  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: staffType, p_token: null }, { ownerJwt })
  const staffCode = codeR.body
  const joinCode = rid('SC').slice(0, 6).toUpperCase()
  const insR = await rpc('secure_insert_staff', {
    p_token: null, p_name: name, p_role: staffType === 'coach' ? 'Coach' : 'Office Staff',
    p_phone: '9999999999', p_sports: sports, p_salary: 10000, p_join_date: null,
    p_status: 'Active', p_photo_url: null, p_staff_code: staffCode, p_join_code: joinCode,
    p_staff_type: staffType, p_branch_id: branchId,
  }, { ownerJwt })
  if (!assert(insR.ok, `staff ${name} inserted`, insR.body)) return null
  const staffId = insR.body
  const email = `${rid('staff')}@example.com`
  const pwHash = hashPassword('StaffPw123!')
  const actR = await rpc('secure_activate_staff_account', {
    p_staff_code: staffCode, p_join_code: joinCode, p_password_hash: pwHash, p_email: email,
  })
  assert(actR.ok, `staff ${name} activated`, actR.body)
  const loginR = await rpc('secure_login_staff', { p_email: email, p_password_hash: pwHash })
  assert(loginR.ok && loginR.body?.token, `staff ${name} can log in`, loginR.body)
  return { id: staffId, name, email, token: loginR.body?.token, staffCode, sports, branchId }
}

// NOTE: security-v3/19 made branch_id mandatory on staff insert ("there is no
// all-branch") — a NULL branch_id can no longer be created new, only legacy
// rows retain it. So "office staff" here is branch-pinned like everyone else;
// the office/coach distinction is now purely a permission-preset difference.
const officeStaff = await makeStaff({ name: 'QA Office Staff', staffType: 'office_staff', sports: ['Cricket', 'Football'], branchId: cricketB1 })
const cricketB1Coach = await makeStaff({ name: 'QA Cricket B1 Coach', staffType: 'coach', sports: ['Cricket'], branchId: cricketB1 })
const cricketB2Coach = await makeStaff({ name: 'QA Cricket B2 Coach', staffType: 'coach', sports: ['Cricket'], branchId: cricketB2 })
const footballB1Coach = await makeStaff({ name: 'QA Football B1 Coach', staffType: 'coach', sports: ['Football'], branchId: footballB1 })

console.log(`\n=== PHASE 0d: give coaches manage permissions (default preset may be view-only) ===`)
async function grantPerms(staffId, perms) {
  const r = await rpc('secure_update_staff_permissions', { p_staff_id: staffId, p_permissions: perms, p_access_role: 'coach', p_token: null }, { ownerJwt })
  assert(r.ok, `granted perms to staff ${staffId}`, r.body)
}
const FULL_PERMS = ['students.view','students.manage','payments.view','payments.manage','attendance.manage','batches.manage','trials.manage','training.manage','reports.view']
for (const s of [cricketB1Coach, cricketB2Coach, footballB1Coach]) {
  if (s) await grantPerms(s.id, FULL_PERMS)
}

console.log(`\n=== PHASE 0e: students (varied states) ===`)
async function makeStudent({ name, sport, branchId, suspendNow = false, paidTill = null }) {
  const studentCode = rid('SA')
  const joinCode = rid('STJC').slice(0, 6).toUpperCase()
  const r = await rpc('create_student_with_payment', {
    p_name: name, p_parent: 'QA Parent', p_phone: '9000000000', p_parent_phone: '9000000001',
    p_age: 12, p_dob: null, p_sport: sport, p_batch: '', p_batch_id: null, p_join_date: null,
    p_fees: 1000, p_fee_amount: 1000, p_fee_due_day: 5, p_paid_till: paidTill, p_training_type: 'Daily',
    p_fee_plan: 'monthly', p_student_code: studentCode, p_join_code: joinCode, p_academy_id: academyId,
    p_suspend_now: suspendNow, p_invoice_id: null, p_payment_amount: null, p_payment_month: null,
    p_payment_date: null, p_months_covered: null, p_token: null, p_branch_id: branchId,
  }, { ownerJwt })
  if (!assert(r.ok, `student ${name} created`, r.body)) return null
  return { id: r.body, name, studentCode, joinCode, sport, branchId }
}

const studentCricketB1 = await makeStudent({ name: 'QA Student CricketB1', sport: 'Cricket', branchId: cricketB1 })
const studentCricketB2 = await makeStudent({ name: 'QA Student CricketB2', sport: 'Cricket', branchId: cricketB2 })
const studentFootballB1 = await makeStudent({ name: 'QA Student FootballB1', sport: 'Football', branchId: footballB1 })
const studentOverdue = await makeStudent({ name: 'QA Student Overdue', sport: 'Cricket', branchId: cricketB1, paidTill: '2026-01-01' })
const studentSuspended = await makeStudent({ name: 'QA Student Suspended', sport: 'Cricket', branchId: cricketB1, suspendNow: true })

const state = {
  stamp, academyId, ownerId, ownerEmail: OWNER_EMAIL, ownerPw: OWNER_PW, ownerJwt, joinCode,
  branches: { cricketB1, cricketB2, footballB1 },
  staff: { officeStaff, cricketB1Coach, cricketB2Coach, footballB1Coach },
  students: { studentCricketB1, studentCricketB2, studentFootballB1, studentOverdue, studentSuspended },
}
fs.writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify(state, null, 2))
console.log(`\nState saved to scripts/_qa/state.json. academyId=${academyId}`)
