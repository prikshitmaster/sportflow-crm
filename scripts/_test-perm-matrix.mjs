// Permission × branch-isolation matrix test (no data written — every case runs
// in a transaction that is ROLLED BACK). For each persona we mint a temp staff
// session token, call the real write RPC, and check allow/deny matches intent.
import pg from 'pg'
import fs from 'fs'

const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

const P = {
  saurabh: { id: 28, label: 'Saurabh (field FB/B1, FULL perms)' },
  karthik: { id: 32, label: 'Karthik (no-branch Cricket, FULL perms)' },
  suresh:  { id: 90, label: 'Suresh (Cricket/B1, view + attendance.manage)' },
  neha:    { id: 93, label: 'Neha (Cricket/B1, students+payments.manage, NO attendance)' },
  nikhil:  { id: 31, label: 'Nikhil (Squash no-branch, perms [])' },
}

let pass = 0, fail = 0
function check(desc, expectAllow, r) {
  const ok = r.ok
  const good = expectAllow ? ok : !ok
  console.log(`  ${good ? '✓' : '✗ FAIL'}  ${desc} → ${ok ? 'ALLOWED' : 'DENIED'}` +
              `${ok && r.val ? '  ('+JSON.stringify(r.val)+')' : ''}${!ok ? '  ('+(r.msg||'').slice(0,60)+')' : ''}`)
  good ? pass++ : fail++
}

async function tryRpc(staffId, build) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const token = 'TESTTOK_' + staffId + '_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [staffId, token])
    const [sql, params] = build(token)
    try {
      const res = await c.query(sql, params)
      return { ok: true, val: res.rows[0] }
    } catch (e) { return { ok: false, code: e.code, msg: e.message } }
  } finally {
    try { await c.query('ROLLBACK') } catch {}
    await c.end()
  }
}

const rid = (p) => p + Math.random().toString(16).slice(2, 8)
const ADD_STUDENT = (branchArg) => (token) => [
  `SELECT create_student_with_payment(
     p_name=>'ZZ Test', p_parent=>'', p_phone=>'', p_parent_phone=>'', p_age=>null,
     p_dob=>null, p_sport=>'Football', p_batch=>'', p_batch_id=>null, p_join_date=>null,
     p_fees=>0, p_fee_amount=>0, p_fee_due_day=>null, p_paid_till=>null, p_training_type=>'Daily',
     p_fee_plan=>'monthly', p_student_code=>$1, p_join_code=>$2, p_academy_id=>$3,
     p_suspend_now=>false, p_invoice_id=>null, p_payment_amount=>null, p_payment_month=>null,
     p_payment_date=>null, p_months_covered=>null, p_token=>$4, p_branch_id=>$5) AS new_id`,
  [rid('ZZ'), rid('JC'), ACAD, token, branchArg],
]
const PAY = (studentId) => (token) => [
  `SELECT secure_insert_payment(p_payload=>$1::jsonb, p_token=>$2) AS pid`,
  [JSON.stringify({ id: rid('ZZPAY'), studentId, student: 'ZZ', amount: 100, month: 'Jan', mode: 'Cash', academyId: ACAD }), token],
]
const ATT = (studentId) => (token) => [
  `SELECT secure_save_attendance_date(p_date=>current_date, p_batch_id=>null, p_records=>$1::jsonb, p_token=>$2)`,
  [JSON.stringify({ [studentId]: 'Present' }), token],
]

console.log('\n=== ADD STUDENT (needs students.manage; field staff branch forced) ===')
check(P.saurabh.label,                         true,  await tryRpc(P.saurabh.id, ADD_STUDENT(null)))
check(P.suresh.label + ' [no students.manage]', false, await tryRpc(P.suresh.id, ADD_STUDENT(null)))
check(P.neha.label,                            true,  await tryRpc(P.neha.id,   ADD_STUDENT(null)))
check(P.karthik.label,                         true,  await tryRpc(P.karthik.id, ADD_STUDENT(null)))

console.log('\n=== RECORD PAYMENT (needs payments.manage + same-branch student) ===')
check(P.saurabh.label + ' pays FB/B1 student 170',        true,  await tryRpc(P.saurabh.id, PAY(170)))
check(P.saurabh.label + ' pays OTHER-branch student 182', false, await tryRpc(P.saurabh.id, PAY(182)))
check(P.suresh.label + ' [no payments.manage]',           false, await tryRpc(P.suresh.id,  PAY(184)))
check(P.neha.label + ' pays CR/B1 student 184',           true,  await tryRpc(P.neha.id,    PAY(184)))
check(P.neha.label + ' pays OTHER-branch student 170',    false, await tryRpc(P.neha.id,    PAY(170)))

console.log('\n=== MARK ATTENDANCE (needs attendance.manage + same-branch student) ===')
check(P.suresh.label + ' marks CR/B1 student 184',        true,  await tryRpc(P.suresh.id, ATT(184)))
check(P.suresh.label + ' marks OTHER-branch student 170', false, await tryRpc(P.suresh.id, ATT(170)))
check(P.neha.label + ' [no attendance.manage]',           false, await tryRpc(P.neha.id,   ATT(184)))
check(P.nikhil.label + ' [perms empty]',                  false, await tryRpc(P.nikhil.id, ATT(184)))

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
