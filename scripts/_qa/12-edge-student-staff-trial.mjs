import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./edge-state.json', import.meta.url), 'utf8'))
const { academyId, branchId, ownerJwt } = state
const today = new Date().toISOString().slice(0, 10)

function baseStudent(overrides = {}) {
  return {
    p_name: 'Edge Kid', p_parent: 'Parent', p_phone: '9000000001', p_parent_phone: '9000000002', p_age: 12,
    p_dob: null, p_sport: 'Cricket', p_batch: '', p_batch_id: null, p_join_date: null, p_fees: 1000, p_fee_amount: 1000,
    p_fee_due_day: 5, p_paid_till: null, p_training_type: 'Daily', p_fee_plan: 'monthly',
    p_student_code: rid('SA').toUpperCase(), p_join_code: rid('JC').slice(0,6).toUpperCase(), p_academy_id: academyId,
    p_suspend_now: false, p_invoice_id: null, p_payment_amount: null, p_payment_month: null, p_payment_date: null,
    p_months_covered: null, p_token: null, p_branch_id: branchId,
    ...overrides,
  }
}
async function tryStudent(label, overrides) {
  const r = await rpc('create_student_with_payment', baseStudent(overrides), { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,180)}`)
  return r
}

console.log('\n=== ADD STUDENT edge cases ===')
await tryStudent('empty name', { p_name: '' })
await tryStudent('empty phone', { p_phone: '' })
await tryStudent('negative age', { p_age: -5 })
await tryStudent('age 0', { p_age: 0 })
await tryStudent('huge age (999)', { p_age: 999 })
await tryStudent('negative fees', { p_fees: -500, p_fee_amount: -500 })
await tryStudent('fee_due_day out of range (32)', { p_fee_due_day: 32 })
await tryStudent('fee_due_day negative', { p_fee_due_day: -1 })
await tryStudent('XSS payload in name', { p_name: '<script>alert(document.cookie)</script>' })
await tryStudent('SQL-meta name', { p_name: "Robert'); DROP TABLE students;--" })
await tryStudent('extremely long name (20000 chars)', { p_name: 'A'.repeat(20000) })
await tryStudent('malformed dob', { p_dob: 'not-a-date' })
await tryStudent('future dob (2099)', { p_dob: '2099-01-01' })
await tryStudent('null-ish sport (empty string)', { p_sport: '' })
await tryStudent('negative batch_id (nonexistent)', { p_batch_id: -999 })
const dupCode = rid('SADUP').toUpperCase()
const first = await tryStudent('duplicate student_code (1st insert)', { p_student_code: dupCode })
const dup = await tryStudent('duplicate student_code (2nd insert, same code)', { p_student_code: dupCode })
assert(first.ok && !dup.ok, 'duplicate student_code correctly rejected on 2nd insert', dup.body)

console.log('\n=== ADD STAFF edge cases ===')
async function tryStaff(label, overrides) {
  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const base = {
    p_token: null, p_name: 'Edge Staff', p_role: 'Coach', p_phone: '9111111111', p_sports: ['Cricket'],
    p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null,
    p_staff_code: codeR.body, p_join_code: rid('SC').slice(0,6).toUpperCase(), p_staff_type: 'coach', p_branch_id: branchId,
    ...overrides,
  }
  const r = await rpc('secure_insert_staff', base, { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,180)}`)
  return r
}
await tryStaff('empty name', { p_name: '' })
await tryStaff('negative salary', { p_salary: -10000 })
await tryStaff('XSS payload in name', { p_name: '<img src=x onerror=alert(1)>' })
await tryStaff('extremely long role (20000 chars)', { p_role: 'R'.repeat(20000) })
await tryStaff('empty sports array', { p_sports: [] })
await tryStaff('malformed sports (not array-ish string)', { p_sports: 'Cricket' })

console.log('\n=== ADD TRIAL edge cases ===')
async function tryTrial(label, overrides) {
  const payload = {
    name: 'Edge Trial', parent: '', phone: '9222222222', age: null, sport: 'Cricket', trialDate: today,
    source: 'App', batchId: null, trialSessions: '1', followUp: null, notes: null, quotedFee: null,
    sessionStart: null, sessionEnd: null, dob: null, ageGroup: null, programType: 'academy',
    trialFeePaid: '0', trialFeeMode: 'Cash', branchId,
    ...overrides,
  }
  const r = await rpc('secure_insert_trial', { p_payload: payload, p_token: null }, { ownerJwt })
  console.log(`  ${label}: ok=${r.ok} status=${r.status} ${r.ok ? '' : JSON.stringify(r.body).slice(0,180)}`)
  return r
}
await tryTrial('empty phone', { phone: '' })
await tryTrial('missing trialDate', { trialDate: null })
await tryTrial('invalid trialFeeMode', { trialFeeMode: 'Bitcoin' })
await tryTrial('XSS payload in name', { name: '<script>alert(1)</script>' })
await tryTrial('negative trialFeePaid', { trialFeePaid: '-500' })
await tryTrial('huge trialSessions (99999)', { trialSessions: '99999' })
