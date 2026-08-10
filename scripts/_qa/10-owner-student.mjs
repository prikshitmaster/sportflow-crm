// Owner JWT must succeed on every gated action with zero explicit permission
// entries (owner bypass is unconditional). A logged-in student token must be
// rejected by every one of them (students never pass _require_perm).
import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { academyId, branchId, batchId, studentId, ownerJwt, studentToken } = state
const today = new Date().toISOString().slice(0, 10)

const ACTIONS = {
  'students.manage': (mode) => rpc('secure_update_student', { p_student_id: studentId, p_payload: { name: 'Owner Test ' + rid('') }, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'payments.manage': (mode) => rpc('secure_insert_payment', { p_payload: { id: rid('OSPAY'), studentId, student: 'x', amount: 50, month: 'Test', mode: 'Cash', academyId }, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'attendance.manage': (mode) => rpc('secure_save_attendance_date', { p_date: today, p_batch_id: null, p_records: { [studentId]: 'Present' }, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'batches.manage': (mode) => rpc('secure_insert_batch', { p_token: mode.token ?? null, p_name: rid('OSBatch'), p_time: null, p_sports: ['Cricket'], p_coach: null, p_capacity: 10, p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99, p_ground: null, p_code: null, p_default_fee: 0, p_default_plan: 'monthly', p_branch_id: branchId }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'trials.manage': (mode) => rpc('secure_insert_trial', { p_payload: { name: rid('OSTrial'), parent: '', phone: '9333333333', age: null, sport: 'Cricket', trialDate: today, source: 'App', batchId: null, trialSessions: '1', followUp: null, notes: null, quotedFee: null, sessionStart: null, sessionEnd: null, dob: null, ageGroup: null, programType: 'academy', trialFeePaid: '0', trialFeeMode: 'Cash', branchId }, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'staff.manage': (mode) => rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'training.manage': (mode) => rpc('secure_upsert_player_goal', { p_student_id: studentId, p_month: '2026-09', p_goal_text: 'Owner goal ' + rid(''), p_staff_id: null, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'settings.manage': (mode) => rpc('secure_insert_fee_plan', { p_batch_id: batchId, p_name: rid('OSPlan'), p_training_type: 'daily', p_monthly_fee: 500, p_quarterly_fee: 0, p_yearly_fee: 0, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'community.manage': (mode) => rpc('secure_insert_announcement', { p_title: rid('OSAnn'), p_body: 'test', p_type: 'General', p_author: 'QA', p_token: mode.token ?? null, p_sport: null, p_branch_id: branchId, p_audience_type: 'all', p_audience_ids: [] }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
  'events.manage': (mode) => rpc('secure_insert_event', { p_payload: { title: rid('OSEvent'), type: 'Tournament', sport: 'Cricket', date: today, endDate: '', venue: '', description: '', status: 'Upcoming', audienceType: 'all', audienceIds: [], flyerUrl: '', bracketType: '', participants: [], branchId }, p_token: mode.token ?? null }, mode.jwt ? { ownerJwt: mode.jwt } : {}),
}

console.log('\n=== Owner JWT: every action must succeed with zero explicit permission entries ===')
for (const [group, run] of Object.entries(ACTIONS)) {
  const r = await run({ jwt: ownerJwt })
  assert(r.ok, `owner ALLOWED: ${group}`, r.body)
}

console.log('\n=== Logged-in student token: every action must be rejected ===')
for (const [group, run] of Object.entries(ACTIONS)) {
  const r = await run({ token: studentToken })
  assert(!r.ok, `student DENIED: ${group}`, r.body)
}
