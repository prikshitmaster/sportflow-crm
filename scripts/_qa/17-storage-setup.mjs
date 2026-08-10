// Two academies (A and B) each with a branch, student, and staff member —
// needed to test cross-tenant storage isolation, not just "logged in or not".
import fs from 'fs'
import { authSignUp, authSignIn, forceConfirmEmail, rpc, REST_API, ANON_KEY, hashPassword, assert, rid } from './lib.mjs'

async function makeAcademy(label) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const email = `qa-storage-${label}-${stamp}@example.com`
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
  const acadRes = await post('academies', { name: `QA STORAGE ${label} ${stamp}`, owner_id: ownerId, join_code: joinCode })
  const academyId = acadRes.body[0].id
  await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: `QA Storage Owner ${label}` })

  const branchR = await rpc('secure_insert_sport_branch', { p_sport_name: 'Cricket', p_branch_name: 'Main', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null }, { ownerJwt })
  const branchId = branchR.body.id

  const studentR = await rpc('create_student_with_payment', {
    p_name: `QA Storage Student ${label}`, p_parent: '', p_phone: '9' + String(Math.floor(Math.random()*1e9)).padStart(9,'0'), p_parent_phone: '9000000000', p_age: 12,
    p_dob: null, p_sport: 'Cricket', p_batch: '', p_batch_id: null, p_join_date: null, p_fees: 1000, p_fee_amount: 1000,
    p_fee_due_day: 5, p_paid_till: null, p_training_type: 'Daily', p_fee_plan: 'monthly',
    p_student_code: rid('SA').toUpperCase(), p_join_code: rid('JC').slice(0,6).toUpperCase(), p_academy_id: academyId,
    p_suspend_now: false, p_invoice_id: null, p_payment_amount: null, p_payment_month: null, p_payment_date: null,
    p_months_covered: null, p_token: null, p_branch_id: branchId,
  }, { ownerJwt })
  const studentId = studentR.body

  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const staffJc = rid('SC').slice(0,6).toUpperCase()
  const staffInsR = await rpc('secure_insert_staff', {
    p_token: null, p_name: `QA Storage Staff ${label}`, p_role: 'Coach', p_phone: '9' + String(Math.floor(Math.random()*1e9)).padStart(9,'0'),
    p_sports: ['Cricket'], p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null,
    p_staff_code: codeR.body, p_join_code: staffJc, p_staff_type: 'coach', p_branch_id: branchId,
  }, { ownerJwt })
  const staffId = staffInsR.body
  const staffEmail = `${rid('storage-staff')}@example.com`
  const staffPwHash = hashPassword('StaffPw123!')
  await rpc('secure_activate_staff_account', { p_staff_code: codeR.body, p_join_code: staffJc, p_password_hash: staffPwHash, p_email: staffEmail }, {})
  const staffLoginR = await rpc('secure_login_staff', { p_email: staffEmail, p_password_hash: staffPwHash }, {})
  await rpc('secure_update_staff_permissions', { p_staff_id: staffId, p_permissions: ['students.manage','staff.manage','documents.view'], p_access_role: 'coach', p_token: null }, { ownerJwt })
  // re-login to pick up fresh perms in the session bundle isn't required — perms are read live from staff_auth each call

  const stRow = await (await import('./lib.mjs')).pgQuery('select student_code, join_code from students where id = $1', [studentId])
  const { student_code, join_code } = stRow.rows[0]
  const stPwHash = hashPassword('StudentPw123!')
  await rpc('secure_activate_student_account', { p_student_code: student_code, p_join_code: join_code, p_password_hash: stPwHash }, {})
  const stLoginR = await rpc('secure_login_student', { p_student_code: student_code, p_password_hash: stPwHash }, {})

  return {
    academyId, ownerId, ownerJwt, branchId, studentId, staffId,
    staffToken: staffLoginR.body?.token, studentToken: stLoginR.body?.token,
  }
}

const A = await makeAcademy('A')
const B = await makeAcademy('B')
assert(!!A.staffToken && !!A.studentToken, 'academy A staff+student logged in', A)
assert(!!B.staffToken && !!B.studentToken, 'academy B staff+student logged in', B)

fs.writeFileSync(new URL('./storage-state.json', import.meta.url), JSON.stringify({ A, B }, null, 2))
console.log('Saved scripts/_qa/storage-state.json')
