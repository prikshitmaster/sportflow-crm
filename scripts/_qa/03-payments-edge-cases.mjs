import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'))
const { staff, students, branches, academyId } = state

console.log('\n=== secure_link_trial_payment: cross-branch trial link (code-review flagged as missing branch check) ===')
// Create a trial in Cricket B1 as the B1 coach, then try to link it to a Cricket B2 student as the B1 coach.
const trialIns = await rpc('secure_insert_trial', {
  p_payload: {
    name: 'QA Trial Kid', parent: '', phone: '9111111111', sport: 'Cricket', branchId: branches.cricketB1,
    trialDate: new Date().toISOString().slice(0,10),
    source: 'App', trialSessions: '1', trialFeePaid: '0', trialFeeMode: 'Cash', programType: 'academy',
  },
  p_token: staff.cricketB1Coach.token,
}, {})
assert(trialIns.ok, 'trial created in Cricket B1', trialIns.body)
const trialRow = trialIns.ok ? (typeof trialIns.body === 'string' ? JSON.parse(trialIns.body) : trialIns.body) : null
const trialId = trialRow?.id

if (trialIns.ok && trialId) {
  const link = await rpc('secure_link_trial_payment', {
    p_trial_id: trialId, p_student_id: students.studentCricketB2.id, p_token: staff.cricketB1Coach.token,
  }, {})
  assert(!link.ok, 'Cricket B1 coach BLOCKED from linking B1 trial to a Cricket B2 student', link.body)
}

console.log('\n=== payment amount edge cases (owner JWT — permission is not the variable here) ===')
async function ownerPay(amount, label) {
  const r = await rpc('secure_insert_payment', {
    p_payload: { id: rid('QAEDGE'), studentId: students.studentCricketB1.id, student: 'x', amount, month: 'Feb', mode: 'Cash', academyId },
    p_token: null,
  }, { ownerJwt: state.ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} body=${JSON.stringify(r.body).slice(0,150)}`)
  return r
}
await ownerPay(0, 'zero amount')
await ownerPay(-500, 'negative amount')
await ownerPay(99999999, 'huge amount (99,999,999)')
