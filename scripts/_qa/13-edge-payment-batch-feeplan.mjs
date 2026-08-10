import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./edge-state.json', import.meta.url), 'utf8'))
const { academyId, branchId, batchId, ownerJwt } = state

// Need a real student to hang payments off of
const studentR = await rpc('create_student_with_payment', {
  p_name: 'Edge Payer', p_parent: 'P', p_phone: '9333333333', p_parent_phone: '9333333334', p_age: 12,
  p_dob: null, p_sport: 'Cricket', p_batch: '', p_batch_id: null, p_join_date: null, p_fees: 1000, p_fee_amount: 1000,
  p_fee_due_day: 5, p_paid_till: null, p_training_type: 'Daily', p_fee_plan: 'monthly',
  p_student_code: rid('SA').toUpperCase(), p_join_code: rid('JC').slice(0,6).toUpperCase(), p_academy_id: academyId,
  p_suspend_now: false, p_invoice_id: null, p_payment_amount: null, p_payment_month: null, p_payment_date: null,
  p_months_covered: null, p_token: null, p_branch_id: branchId,
}, { ownerJwt })
assert(studentR.ok, 'target student created', studentR.body)
const studentId = studentR.body

console.log('\n=== PAYMENT edge cases ===')
async function tryPay(label, overrides) {
  const r = await rpc('secure_insert_payment', {
    p_payload: { id: rid('EDGEPAY'), studentId, student: 'Edge Payer', amount: 500, month: 'Aug 2026', mode: 'Cash', academyId, ...overrides },
    p_token: null,
  }, { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,150)}`)
  return r
}
await tryPay('missing id', { id: '' })
await tryPay('nonexistent studentId', { studentId: 999999999 })
await tryPay('invalid mode (not in enum, if any)', { mode: 'Bitcoin' })
await tryPay('malformed date', { date: 'not-a-date' })
await tryPay('extremely long notes (50000 chars)', { notes: 'N'.repeat(50000) })
await tryPay('discountPct > 100', { discountPct: 150 })
await tryPay('discountPct negative', { discountPct: -20 })
await tryPay('monthsCovered 0', { monthsCovered: 0 })
await tryPay('monthsCovered negative', { monthsCovered: -3 })
const dupId = rid('EDGEDUP')
const p1 = await tryPay('duplicate payment id (1st)', { id: dupId })
const p2 = await tryPay('duplicate payment id (2nd, same id)', { id: dupId })
assert(p1.ok && !p2.ok, 'duplicate payment id correctly rejected', p2.body)

console.log('\n=== BATCH edge cases ===')
async function tryBatch(label, overrides) {
  const r = await rpc('secure_insert_batch', {
    p_token: null, p_name: 'Edge Batch X', p_time: null, p_sports: ['Cricket'], p_coach: null, p_capacity: 20,
    p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99, p_ground: null, p_code: null,
    p_default_fee: 0, p_default_plan: 'monthly', p_branch_id: branchId,
    ...overrides,
  }, { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,150)}`)
  return r
}
await tryBatch('empty name', { p_name: '' })
await tryBatch('negative capacity', { p_capacity: -5 })
await tryBatch('capacity 0', { p_capacity: 0 })
await tryBatch('age_min > age_max', { p_age_min: 50, p_age_max: 10 })
await tryBatch('negative default_fee', { p_default_fee: -1000 })
await tryBatch('empty sports array', { p_sports: [] })

console.log('\n=== FEE PLAN edge cases ===')
async function tryFeePlan(label, overrides) {
  const r = await rpc('secure_insert_fee_plan', {
    p_batch_id: batchId, p_name: 'Edge Plan', p_training_type: 'daily', p_monthly_fee: 500, p_quarterly_fee: 1400, p_yearly_fee: 5000, p_token: null,
    ...overrides,
  }, { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,150)}`)
  return r
}
await tryFeePlan('negative monthly fee', { p_monthly_fee: -500 })
await tryFeePlan('nonexistent batch_id', { p_batch_id: -999 })
await tryFeePlan('empty name', { p_name: '' })
await tryFeePlan('invalid training_type', { p_training_type: 'yearly-ish-bogus' })
