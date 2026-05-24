// Verifies the anon write holes are closed (security-v3 0075) WITHOUT breaking
// the legit RPC write path. All in rolled-back transactions as the anon role.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

// Run fn as anon with a minted staff session (staffId), rolled back.
async function asStaff(staffId, fn) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const token = 'TT_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    await c.query(`INSERT INTO staff_sessions(staff_id,token,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [staffId, token])
    await c.query('SET LOCAL ROLE anon')
    await c.query(`SELECT set_config('request.headers',$1,true)`, [JSON.stringify({ 'x-staff-token': token })])
    return await fn(c, token)
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

let pass = 0, fail = 0
const check = (desc, ok, info) => { console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${desc}${info ? ' ('+info+')' : ''}`); ok ? pass++ : fail++ }

console.log('\n=== anon direct writes must be BLOCKED (Saurabh #28 token) ===')

// 1. direct batch INSERT → should raise (no insert policy)
await asStaff(28, async (c) => {
  try {
    await c.query(`INSERT INTO batches(name, sports, academy_id) VALUES ($1, ARRAY['Football'], $2)`, ['ZZ_'+Math.random(), ACAD])
    check('direct batches INSERT blocked', false, 'INSERT unexpectedly succeeded')
  } catch (e) { check('direct batches INSERT blocked', e.code === '42501', e.code) }
})

// 2. direct student INSERT → should raise
await asStaff(28, async (c) => {
  try {
    await c.query(`INSERT INTO students(name, academy_id, student_code) VALUES ($1, $2, $3)`, ['ZZ', ACAD, 'ZZ'+Math.random().toString(16).slice(2,8)])
    check('direct students INSERT blocked', false, 'INSERT unexpectedly succeeded')
  } catch (e) { check('direct students INSERT blocked', e.code === '42501', e.code) }
})

// 3. direct batch UPDATE → no UPDATE policy → 0 rows affected
await asStaff(28, async (c) => {
  // No anon UPDATE policy → RLS filters all rows out → UPDATE affects 0 rows.
  const r = await c.query(`UPDATE batches SET coach = 'HACKED' WHERE academy_id = $1`, [ACAD])
  check('direct batches UPDATE affects 0 rows', r.rowCount === 0, `rowCount=${r.rowCount}`)
})

console.log('\n=== legit RPC path still WORKS (Saurabh has students.manage) ===')
await asStaff(28, async (c, token) => {
  try {
    const r = await c.query(`SELECT create_student_with_payment(
      p_name=>'ZZ', p_parent=>'', p_phone=>'', p_parent_phone=>'', p_age=>null, p_dob=>null,
      p_sport=>'Football', p_batch=>'', p_batch_id=>null, p_join_date=>null, p_fees=>0,
      p_fee_amount=>0, p_fee_due_day=>null, p_paid_till=>null, p_training_type=>'Daily',
      p_fee_plan=>'monthly', p_student_code=>$1, p_join_code=>$2, p_academy_id=>$3,
      p_suspend_now=>false, p_invoice_id=>null, p_payment_amount=>null, p_payment_month=>null,
      p_payment_date=>null, p_months_covered=>null, p_token=>$4, p_branch_id=>null) AS id`,
      ['ZZ'+Math.random().toString(16).slice(2,8), 'JC'+Math.random().toString(16).slice(2,6), ACAD, token])
    check('create_student_with_payment RPC works', !!r.rows[0].id, 'new id '+r.rows[0].id)
  } catch (e) { check('create_student_with_payment RPC works', false, e.message.slice(0,50)) }
})

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
