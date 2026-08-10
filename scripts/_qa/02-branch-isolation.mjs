// Phase 1: branch isolation — reads (RLS via x-staff-token) and writes (RPC
// branch enforcement) across the QA academy's Cricket/B1, Cricket/B2,
// Football/B1 sport-branches.
import fs from 'fs'
import { restGet, rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'))
const { staff, students, branches } = state

console.log('\n=== READS: staff token -> students table visibility ===')
async function visibleStudentIds(staffToken) {
  const r = await restGet('students', `?select=id,name,branch_id&academy_id=eq.${state.academyId}`, { staffToken })
  return Array.isArray(r.body) ? r.body : []
}

const b1Visible = await visibleStudentIds(staff.cricketB1Coach.token)
assert(b1Visible.some(s => s.id === students.studentCricketB1.id), 'Cricket B1 coach sees Cricket B1 student', b1Visible.map(s=>s.name))
assert(!b1Visible.some(s => s.id === students.studentCricketB2.id), 'Cricket B1 coach does NOT see Cricket B2 student', b1Visible.map(s=>s.name))
assert(!b1Visible.some(s => s.id === students.studentFootballB1.id), 'Cricket B1 coach does NOT see Football B1 student', b1Visible.map(s=>s.name))

const b2Visible = await visibleStudentIds(staff.cricketB2Coach.token)
assert(b2Visible.some(s => s.id === students.studentCricketB2.id), 'Cricket B2 coach sees Cricket B2 student', b2Visible.map(s=>s.name))
assert(!b2Visible.some(s => s.id === students.studentCricketB1.id), 'Cricket B2 coach does NOT see Cricket B1 student', b2Visible.map(s=>s.name))

const fbVisible = await visibleStudentIds(staff.footballB1Coach.token)
assert(fbVisible.some(s => s.id === students.studentFootballB1.id), 'Football B1 coach sees Football B1 student', fbVisible.map(s=>s.name))
assert(!fbVisible.some(s => s.id === students.studentCricketB1.id), 'Football B1 coach does NOT see Cricket B1 student (cross-sport)', fbVisible.map(s=>s.name))

console.log('\n=== READS: "office_staff" with sports=[Cricket,Football] but branch_id=CricketB1 ===')
const officeVisible = await visibleStudentIds(staff.officeStaff.token)
const officeSeesFootball = officeVisible.some(s => s.id === students.studentFootballB1.id)
const officeSeesCricketB2 = officeVisible.some(s => s.id === students.studentCricketB2.id)
console.log(`  officeStaff.sports=${JSON.stringify(staff.officeStaff.sports)} branch_id=${staff.officeStaff.branchId}`)
console.log(`  → sees Football B1 student: ${officeSeesFootball} | sees Cricket B2 student: ${officeSeesCricketB2}`)
console.log(`  (EXPECTED per security-v3/19: branch_id now hard-limits regardless of sports[] — 'office staff' no longer means cross-branch visibility once branch-pinned. This confirms the policy-drift finding: only legacy NULL-branch rows retain true all-branch access.)`)

console.log('\n=== WRITES: cross-branch payment blocked ===')
async function tryPayment(staffToken, studentId, label) {
  const r = await rpc('secure_insert_payment', {
    p_payload: { id: rid('QAPAY'), studentId, student: 'x', amount: 50, month: 'Jan', mode: 'Cash', academyId: state.academyId },
    p_token: staffToken,
  }, {})
  return r
}
const crossPay = await tryPayment(staff.cricketB1Coach.token, students.studentCricketB2.id, 'B1 coach -> B2 student')
assert(!crossPay.ok, 'Cricket B1 coach BLOCKED from paying Cricket B2 student', crossPay.body)
const samePay = await tryPayment(staff.cricketB1Coach.token, students.studentCricketB1.id, 'B1 coach -> B1 student')
assert(samePay.ok, 'Cricket B1 coach ALLOWED to pay own-branch student', samePay.body)

console.log('\n=== WRITES: cross-branch attendance blocked ===')
async function tryAttendance(staffToken, studentId) {
  return rpc('secure_save_attendance_date', {
    p_date: new Date().toISOString().slice(0,10), p_batch_id: null,
    p_records: { [studentId]: 'Present' }, p_token: staffToken,
  }, {})
}
const crossAtt = await tryAttendance(staff.cricketB2Coach.token, students.studentCricketB1.id)
assert(!crossAtt.ok, 'Cricket B2 coach BLOCKED from marking Cricket B1 student attendance', crossAtt.body)
const sameAtt = await tryAttendance(staff.cricketB2Coach.token, students.studentCricketB2.id)
assert(sameAtt.ok, 'Cricket B2 coach ALLOWED to mark own-branch student attendance', sameAtt.body)

console.log('\n=== WRITES: cross-sport write blocked ===')
const crossSportPay = await tryPayment(staff.footballB1Coach.token, students.studentCricketB1.id, 'FB coach -> Cricket student')
assert(!crossSportPay.ok, 'Football B1 coach BLOCKED from paying Cricket B1 student', crossSportPay.body)

console.log('\n=== READS: unauthenticated / wrong-academy isolation sanity ===')
const noAuth = await restGet('students', `?select=id&academy_id=eq.${state.academyId}`, {})
assert(Array.isArray(noAuth.body) && noAuth.body.length === 0, 'No token at all -> zero students visible', noAuth.body)
