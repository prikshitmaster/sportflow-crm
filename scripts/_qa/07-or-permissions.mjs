// Two RPCs deliberately OR two permissions together instead of requiring one:
// secure_update_student_position (students.manage OR training.manage) and
// secure_link_trial_payment (students.manage OR trials.manage). Confirm the
// OR actually works both ways: either single permission is enough, and
// permissions outside the OR set are still not enough.
import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { singlePermStaff, zeroStaff, studentId, branchId, academyId } = state

console.log('\n=== secure_update_student_position (students.manage OR training.manage) ===')
async function tryPosition(label, token) {
  const r = await rpc('secure_update_student_position', { p_student_id: studentId, p_position: 'Batsman ' + rid(''), p_token: token }, {})
  return r
}
assert((await tryPosition('students.manage', singlePermStaff['students.manage'].token)).ok, 'students.manage holder ALLOWED')
assert((await tryPosition('training.manage', singlePermStaff['training.manage'].token)).ok, 'training.manage holder ALLOWED')
assert(!(await tryPosition('payments.manage', singlePermStaff['payments.manage'].token)).ok, 'payments.manage holder (outside OR set) DENIED')
assert(!(await tryPosition('zero-perm', zeroStaff.token)).ok, 'zero-perm DENIED')

console.log('\n=== secure_link_trial_payment (students.manage OR trials.manage) ===')
async function makeTrial(token) {
  const r = await rpc('secure_insert_trial', {
    p_payload: {
      name: rid('ORTrial'), parent: '', phone: '9222222222', age: null, sport: 'Cricket',
      trialDate: new Date().toISOString().slice(0,10), source: 'App', batchId: null, trialSessions: '1',
      followUp: null, notes: null, quotedFee: null, sessionStart: null, sessionEnd: null, dob: null,
      ageGroup: null, programType: 'academy', trialFeePaid: '0', trialFeeMode: 'Cash', branchId,
    },
    p_token: token,
  }, {})
  const row = r.ok ? (typeof r.body === 'string' ? JSON.parse(r.body) : r.body) : null
  return row?.id
}
async function tryLink(label, token) {
  const trialId = await makeTrial(singlePermStaff['trials.manage'].token) // trial creation itself needs trials.manage; use the trials staff to author it regardless of who links it
  const r = await rpc('secure_link_trial_payment', { p_trial_id: trialId, p_student_id: studentId, p_token: token }, {})
  return r
}
assert((await tryLink('students.manage', singlePermStaff['students.manage'].token)).ok, 'students.manage holder ALLOWED to link')
assert((await tryLink('trials.manage', singlePermStaff['trials.manage'].token)).ok, 'trials.manage holder ALLOWED to link')
assert(!(await tryLink('attendance.manage', singlePermStaff['attendance.manage'].token)).ok, 'attendance.manage holder (outside OR set) DENIED')
assert(!(await tryLink('zero-perm', zeroStaff.token)).ok, 'zero-perm DENIED to link')
