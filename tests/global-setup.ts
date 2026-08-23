// Creates one disposable QA academy (owner, branch, batch, a coach with
// attendance+payments permissions, two enrolled students) against the real
// production database — the same way scripts/_qa/01-setup.mjs does it, via
// the real Auth API + secure_* RPCs, never raw table writes. Torn down in
// global-teardown.ts. Nothing here ever touches an existing academy's data:
// every row is scoped to a freshly-created academyId.
//
// State is flushed to disk after every step (not just at the end) — if a
// later step throws, global-teardown.ts can still find and delete everything
// created so far by academyId/ownerId. A setup that dies with nothing on
// disk is exactly how a QA academy gets orphaned in production.
import fs from 'fs'
import {
  authSignUp, authSignIn, forceConfirmEmail, post, rpc, hashPassword, rid, STATE_PATH,
} from './support/db'

export default async function globalSetup() {
  const stamp = Date.now()
  const ownerEmail = `qa-pw-owner-${stamp}@example.com`
  const ownerPassword = 'QaTest123!'
  const academyName = `QA PLAYWRIGHT ACADEMY ${stamp}`
  const state: any = { stamp, ownerEmail, ownerPassword }
  const save = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))

  const signup = await authSignUp(ownerEmail, ownerPassword)
  const ownerId = signup.user.id
  state.ownerId = ownerId
  save() // even if everything below fails, teardown can still delete auth.users

  let ownerJwt: string | null = signup.session?.access_token || null
  if (!ownerJwt) {
    await forceConfirmEmail(ownerId)
    const signin = await authSignIn(ownerEmail, ownerPassword)
    ownerJwt = signin.access_token
  }
  if (!ownerJwt) throw new Error('QA setup: owner has no JWT after signup+confirm')

  const joinCode = rid('JC').slice(0, 6).toUpperCase()
  const acadRes = await post('academies', { name: academyName, owner_id: ownerId, join_code: joinCode }, { ownerJwt })
  if (!acadRes.ok || !acadRes.body?.[0]?.id) throw new Error(`QA setup: createAcademy failed: ${JSON.stringify(acadRes.body)}`)
  const academyId = acadRes.body[0].id
  state.academyId = academyId
  save()

  const profRes = await post('profiles', { id: ownerId, role: 'owner', academy_id: academyId, name: 'QA Owner' }, { ownerJwt })
  if (!profRes.ok) throw new Error(`QA setup: createProfile failed: ${JSON.stringify(profRes.body)}`)

  const FEATURES = ['attendance', 'payments', 'trials', 'batches', 'staff', 'reports']
  const { REST_API, ANON_KEY } = await import('./support/db')
  const flagsRes = await fetch(`${REST_API}/feature_flags`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(FEATURES.map(f => ({ academy_id: academyId, feature: f, enabled: true }))),
  })
  if (!flagsRes.ok) throw new Error(`QA setup: feature_flags failed: ${await flagsRes.text()}`)

  const branchRes = await rpc('secure_insert_sport_branch', {
    p_sport_name: 'Cricket', p_branch_name: 'QA B1', p_address: null, p_photo_url: null, p_trial_fee: null, p_token: null,
  }, { ownerJwt })
  if (!branchRes.ok || !branchRes.body?.id) throw new Error(`QA setup: sport_branch failed: ${JSON.stringify(branchRes.body)}`)
  const branchId = branchRes.body.id
  state.branchId = branchId
  save()

  // Coach — real activate + login, exactly like a real staff onboarding.
  const staffCodeRes = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const staffCode = staffCodeRes.body
  const staffJoinCode = rid('SC').slice(0, 6).toUpperCase()
  const coachName = 'QA Coach'
  const staffInsRes = await rpc('secure_insert_staff', {
    p_token: null, p_name: coachName, p_role: 'Coach', p_phone: '9999999999', p_sports: ['Cricket'],
    p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null,
    p_staff_code: staffCode, p_join_code: staffJoinCode, p_staff_type: 'coach', p_branch_id: branchId,
  }, { ownerJwt })
  if (!staffInsRes.ok) throw new Error(`QA setup: insert_staff failed: ${JSON.stringify(staffInsRes.body)}`)
  const coachId = staffInsRes.body
  state.coach = { id: coachId, name: coachName }
  save()

  const coachEmail = `${rid('qa-coach')}@example.com`
  const coachPassword = 'CoachPw123!'
  const activateRes = await rpc('secure_activate_staff_account', {
    p_staff_code: staffCode, p_join_code: staffJoinCode, p_password_hash: hashPassword(coachPassword), p_email: coachEmail,
  })
  if (!activateRes.ok) throw new Error(`QA setup: activate_staff failed: ${JSON.stringify(activateRes.body)}`)
  state.coach.email = coachEmail
  state.coach.password = coachPassword
  save()

  const permsRes = await rpc('secure_update_staff_permissions', {
    p_staff_id: coachId,
    p_permissions: ['students.view', 'students.manage', 'payments.view', 'payments.manage', 'attendance.manage', 'batches.manage'],
    p_access_role: 'coach', p_token: null,
  }, { ownerJwt })
  if (!permsRes.ok) throw new Error(`QA setup: update_permissions failed: ${JSON.stringify(permsRes.body)}`)

  // Batch with no fixed days => always shows as "training today" (see
  // StaffAttendance.jsx batchTrainsToday), so this test is never day-of-week flaky.
  const batchName = 'QA Batch'
  const batchRes = await rpc('secure_insert_batch', {
    p_token: null, p_name: batchName, p_time: null, p_sports: ['Cricket'], p_coach: coachName,
    p_capacity: 30, p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99,
    p_ground: null, p_code: rid('QAB').toUpperCase(), p_default_fee: 1200, p_default_plan: 'monthly',
    p_branch_id: branchId, p_batch_type: 'development',
  }, { ownerJwt })
  if (!batchRes.ok) throw new Error(`QA setup: insert_batch failed: ${JSON.stringify(batchRes.body)}`)
  const batchRow = Array.isArray(batchRes.body) ? batchRes.body[0] : batchRes.body
  const batchId = batchRow.id
  state.batchId = batchId
  state.batchName = batchName
  save()

  async function makeStudent(name: string) {
    const r = await rpc('create_student_with_payment', {
      p_name: name, p_parent: 'QA Parent', p_phone: '9000000000', p_parent_phone: '9000000001',
      p_age: 12, p_dob: null, p_sport: 'Cricket', p_batch: batchName, p_batch_id: batchId, p_join_date: null,
      p_fees: 1200, p_fee_amount: 1200, p_fee_due_day: 5, p_paid_till: null, p_training_type: 'Daily',
      p_fee_plan: 'monthly', p_student_code: rid('SA'), p_join_code: rid('STJC').slice(0, 6).toUpperCase(),
      p_academy_id: academyId, p_suspend_now: false, p_invoice_id: null, p_payment_amount: null,
      p_payment_month: null, p_payment_date: null, p_months_covered: null, p_token: null, p_branch_id: branchId,
    }, { ownerJwt })
    if (!r.ok) throw new Error(`QA setup: create_student failed for ${name}: ${JSON.stringify(r.body)}`)
    return { id: r.body, name }
  }
  state.students = []
  state.students.push(await makeStudent('QA Student Payments')); save()
  state.students.push(await makeStudent('QA Student Attendance')); save()

  console.log(`\n[QA setup] academyId=${academyId} batchId=${batchId} students=${state.students.map((s: any) => s.name).join(', ')}`)
}
