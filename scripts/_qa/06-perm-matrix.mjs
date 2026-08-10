// The core matrix: for each of the 10 manage-permissions, one representative
// write RPC. Every single-perm staff (+ the zero-perm staff) attempts EVERY
// action, not just their own — this is what actually proves "not more, not
// less": the diagonal must ALLOW, every off-diagonal cell must DENY.
import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { academyId, branchId, batchId, studentId, singlePermStaff, zeroStaff } = state

const today = new Date().toISOString().slice(0, 10)

// One action per permission group. Each returns {ok}. Side effects are fine —
// this is a throwaway academy.
const ACTIONS = {
  'students.manage': (token) => rpc('secure_update_student', {
    p_student_id: studentId, p_payload: { name: 'QA Perm Student ' + rid('') }, p_token: token,
  }, {}),
  'payments.manage': (token) => rpc('secure_insert_payment', {
    p_payload: { id: rid('MXPAY'), studentId, student: 'x', amount: 50, month: 'Test', mode: 'Cash', academyId },
    p_token: token,
  }, {}),
  'attendance.manage': (token) => rpc('secure_save_attendance_date', {
    p_date: today, p_batch_id: null, p_records: { [studentId]: 'Present' }, p_token: token,
  }, {}),
  'batches.manage': (token) => rpc('secure_insert_batch', {
    p_token: token, p_name: rid('MXBatch'), p_time: null, p_sports: ['Cricket'], p_coach: null, p_capacity: 10,
    p_days: [], p_start_time: null, p_end_time: null, p_age_min: 0, p_age_max: 99, p_ground: null, p_code: null,
    p_default_fee: 0, p_default_plan: 'monthly', p_branch_id: branchId,
  }, {}),
  'trials.manage': (token) => rpc('secure_insert_trial', {
    p_payload: {
      name: rid('MXTrial'), parent: '', phone: '9111111111', age: null, sport: 'Cricket', trialDate: today,
      source: 'App', batchId: null, trialSessions: '1', followUp: null, notes: null, quotedFee: null,
      sessionStart: null, sessionEnd: null, dob: null, ageGroup: null, programType: 'academy',
      trialFeePaid: '0', trialFeeMode: 'Cash', branchId,
    },
    p_token: token,
  }, {}),
  'staff.manage': (token) => rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: token }, {}),
  'training.manage': (token) => rpc('secure_upsert_player_goal', {
    p_student_id: studentId, p_month: '2026-08', p_goal_text: 'QA goal ' + rid(''), p_staff_id: null, p_token: token,
  }, {}),
  'settings.manage': (token) => rpc('secure_insert_fee_plan', {
    p_batch_id: batchId, p_name: rid('MXPlan'), p_training_type: 'daily', p_monthly_fee: 500, p_quarterly_fee: 0, p_yearly_fee: 0, p_token: token,
  }, {}),
  'community.manage': (token) => rpc('secure_insert_announcement', {
    p_title: rid('MXAnn'), p_body: 'test', p_type: 'General', p_author: 'QA', p_token: token,
    p_sport: null, p_branch_id: branchId, p_audience_type: 'all', p_audience_ids: [],
  }, {}),
  'events.manage': (token) => rpc('secure_insert_event', {
    p_payload: {
      title: rid('MXEvent'), type: 'Tournament', sport: 'Cricket', date: today, endDate: '', venue: '',
      description: '', status: 'Upcoming', audienceType: 'all', audienceIds: [], flyerUrl: '', bracketType: '',
      participants: [], branchId,
    },
    p_token: token,
  }, {}),
}

const GROUPS = Object.keys(ACTIONS)
const STAFF = [
  ...GROUPS.map(g => ({ label: g, perm: g, token: singlePermStaff[g].token })),
  { label: 'zero-perm', perm: null, token: zeroStaff.token },
]

let matrix = {}   // matrix[staffLabel][actionGroup] = 'ALLOW' | 'DENY' | 'UNEXPECTED-ALLOW' | 'UNEXPECTED-DENY'
let violations = []

for (const s of STAFF) {
  matrix[s.label] = {}
  for (const g of GROUPS) {
    const r = await ACTIONS[g](s.token)
    const shouldAllow = s.perm === g
    const got = r.ok ? 'ALLOW' : 'DENY'
    const want = shouldAllow ? 'ALLOW' : 'DENY'
    const flag = got === want ? got : `${got}!!`
    matrix[s.label][g] = flag
    if (got !== want) {
      violations.push({ staff: s.label, action: g, expected: want, got, body: r.body })
    }
  }
}

// ── Print as a grid ──
console.log('\n=== PERMISSION MATRIX (rows = staff holding ONLY that permission (or none); cols = action) ===')
const colW = 20
const header = 'staff \\ action'.padEnd(colW) + GROUPS.map(g => g.replace('.manage','').slice(0,10).padEnd(12)).join('')
console.log(header)
for (const s of STAFF) {
  const row = s.label.padEnd(colW) + GROUPS.map(g => matrix[s.label][g].padEnd(12)).join('')
  console.log(row)
}

console.log(`\n=== SUMMARY: ${STAFF.length * GROUPS.length - violations.length}/${STAFF.length * GROUPS.length} cells correct ===`)
if (violations.length) {
  console.log(`\n${violations.length} VIOLATION(S):`)
  for (const v of violations) {
    console.log(`  ✗ staff "${v.staff}" on action "${v.action}": expected ${v.expected}, got ${v.got} — ${JSON.stringify(v.body).slice(0,150)}`)
  }
} else {
  console.log('  ✓ Every cell matched expectation — no under- or over-permissioning found in this matrix.')
}
