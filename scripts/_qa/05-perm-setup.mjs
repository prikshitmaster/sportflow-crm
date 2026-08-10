// Dense, single-branch academy purpose-built for the permission matrix: one
// staff per manage-permission (holding ONLY that permission), a zero-perm
// staff, and a branch_manager-to-be, all sharing one branch so branch scope
// is never the reason an action is denied — isolates permission as the only
// variable. Also creates rich target data (student/batch/fee-plan/etc.) and
// one activated student login.
import fs from 'fs'
import { authSignUp, authSignIn, forceConfirmEmail, rpc, REST_API, ANON_KEY, hashPassword, assert, rid, pgQuery } from './lib.mjs'

const stamp = Date.now()
const OWNER_EMAIL = `qa-perm-owner-${stamp}@example.com`
const OWNER_PW = 'QaTest123!'
const ACADEMY_NAME = `QA PERM MATRIX ${stamp}`

console.log('=== Owner signup ===')
const signup = await authSignUp(OWNER_EMAIL, OWNER_PW)
const ownerId = signup.user.id
let ownerJwt = signup.session?.access_token || null
if (!ownerJwt) {
  await forceConfirmEmail(ownerId)
  ownerJwt = (await authSignIn(OWNER_EMAIL, OWNER_PW)).access_token
}
assert(!!ownerJwt, 'owner JWT obtained')

async function post(table, payload, prefer = 'return=representation') {
  const res = await fetch(`${REST_API}/${table}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body }
}

const joinCode = rid('JC').slice(0, 6).toUpperCase()
const acadRes = await post('academies', { name: ACADEMY_NAME, owner_id: ownerId, join_code: joinCode })
assert(acadRes.ok, 'academy created', acadRes.body)
const academyId = acadRes.body[0].id
await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: 'QA Perm Owner' })
const FEATURES = ['attendance','payments','trials','batches','staff','reports','community','events','gate_qr']
await fetch(`${REST_API}/feature_flags`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(FEATURES.map(f => ({ academy_id: academyId, feature: f, enabled: true }))),
})

console.log('=== One branch ===')
const branchR = await rpc('secure_insert_sport_branch', {
  p_sport_name: 'Cricket', p_branch_name: 'Main', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null,
}, { ownerJwt })
assert(branchR.ok, 'branch created', branchR.body)
const branchId = branchR.body.id

console.log('=== Target data: batch, student, fee plan, age group ===')
const batchR = await rpc('secure_insert_batch', {
  p_token: null, p_name: rid('Batch'), p_time: null, p_sports: ['Cricket'], p_coach: null, p_capacity: 20,
  p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99, p_ground: null, p_code: null,
  p_default_fee: 0, p_default_plan: 'monthly', p_branch_id: branchId,
}, { ownerJwt })
assert(batchR.ok, 'batch created', batchR.body)
const batchId = batchR.body.id

const studentR = await rpc('create_student_with_payment', {
  p_name: 'QA Perm Student', p_parent: '', p_phone: '9000000000', p_parent_phone: '9000000001', p_age: 12,
  p_dob: null, p_sport: 'Cricket', p_batch: '', p_batch_id: null, p_join_date: null, p_fees: 1000, p_fee_amount: 1000,
  p_fee_due_day: 5, p_paid_till: null, p_training_type: 'Daily', p_fee_plan: 'monthly',
  p_student_code: rid('SA').toUpperCase(), p_join_code: rid('STJC').slice(0,6).toUpperCase(), p_academy_id: academyId,
  p_suspend_now: false, p_invoice_id: null, p_payment_amount: null, p_payment_month: null, p_payment_date: null,
  p_months_covered: null, p_token: null, p_branch_id: branchId,
}, { ownerJwt })
assert(studentR.ok, 'student created', studentR.body)
const studentId = studentR.body

const feePlanR = await rpc('secure_insert_fee_plan', {
  p_batch_id: batchId, p_name: rid('Plan'), p_training_type: 'daily', p_monthly_fee: 1000, p_quarterly_fee: 0, p_yearly_fee: 0, p_token: null,
}, { ownerJwt })
assert(feePlanR.ok, 'fee plan created', feePlanR.body)

// ── Staff: 10 single-permission + 1 zero-permission + 1 branch_manager-to-be ──
const PERMS = ['students.manage','payments.manage','attendance.manage','batches.manage','trials.manage',
               'staff.manage','training.manage','settings.manage','community.manage','events.manage']

async function makeStaff(label, staffType, perms) {
  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: staffType, p_token: null }, { ownerJwt })
  const staffCode = codeR.body
  const jc = rid('SC').slice(0, 6).toUpperCase()
  const insR = await rpc('secure_insert_staff', {
    p_token: null, p_name: `QA ${label}`, p_role: 'Coach', p_phone: '9' + String(Math.floor(Math.random()*1e9)).padStart(9,'0'),
    p_sports: ['Cricket'], p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null,
    p_staff_code: staffCode, p_join_code: jc, p_staff_type: staffType, p_branch_id: branchId,
  }, { ownerJwt })
  if (!assert(insR.ok, `staff "${label}" inserted`, insR.body)) return null
  const staffId = insR.body
  const email = `${rid('staff')}@example.com`
  const pwHash = hashPassword('StaffPw123!')
  await rpc('secure_activate_staff_account', { p_staff_code: staffCode, p_join_code: jc, p_password_hash: pwHash, p_email: email }, {})
  const loginR = await rpc('secure_login_staff', { p_email: email, p_password_hash: pwHash }, {})
  if (!assert(loginR.ok && loginR.body?.token, `staff "${label}" logged in`, loginR.body)) return null
  const token = loginR.body.token
  if (perms.length) {
    const permR = await rpc('secure_update_staff_permissions', { p_staff_id: staffId, p_permissions: perms, p_access_role: 'coach', p_token: null }, { ownerJwt })
    assert(permR.ok, `staff "${label}" granted [${perms.join(',')}]`, permR.body)
  }
  return { id: staffId, name: label, email, token, perms }
}

console.log('\n=== 10 single-permission staff ===')
const singlePermStaff = {}
for (const p of PERMS) {
  singlePermStaff[p] = await makeStaff(p, 'coach', [p])
}

console.log('\n=== Zero-permission staff ===')
const zeroStaff = await makeStaff('zero-perm', 'coach', [])

console.log('\n=== Branch-manager-to-be (starts zero-perm, promoted later) ===')
const bmStaff = await makeStaff('bm-candidate', 'coach', [])

console.log('\n=== Student login (for student-always-rejected tests) ===')
const stRow = await pgQuery('select student_code, join_code from students where id = $1', [studentId])
const { student_code, join_code } = stRow.rows[0]
const stPwHash = hashPassword('StudentPw123!')
await rpc('secure_activate_student_account', { p_student_code: student_code, p_join_code: join_code, p_password_hash: stPwHash }, {})
const stLoginR = await rpc('secure_login_student', { p_student_code: student_code, p_password_hash: stPwHash }, {})
assert(stLoginR.ok && stLoginR.body?.token, 'student logged in', stLoginR.body)
const studentToken = stLoginR.body?.token || null

const state = {
  stamp, academyId, ownerId, ownerEmail: OWNER_EMAIL, ownerPw: OWNER_PW, ownerJwt,
  branchId, batchId, studentId, studentToken,
  singlePermStaff, zeroStaff, bmStaff,
}
fs.writeFileSync(new URL('./perm-state.json', import.meta.url), JSON.stringify(state, null, 2))
console.log(`\nSaved to scripts/_qa/perm-state.json. academyId=${academyId}`)
