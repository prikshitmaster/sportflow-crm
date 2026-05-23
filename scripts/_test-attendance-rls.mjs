// RLS test for attendance branch isolation (security-v3/17).
// Counts vs admin-computed expected + asserts zero out-of-branch leakage.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

const admin = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await admin.connect()
const branchOf = async (id) => (await admin.query('SELECT branch_id FROM staff WHERE id=$1', [id])).rows[0].branch_id

async function expectedStaff(id) {
  const br = await branchOf(id)
  const r = await admin.query(`
    SELECT count(*)::int n FROM attendance a JOIN students s ON s.id=a.student_id
     WHERE s.academy_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2)`, [ACAD, br])
  return { n: r.rows[0].n, branch: br }
}
async function expectedStudent(sid) {
  return (await admin.query('SELECT count(*)::int n FROM attendance WHERE student_id=$1', [sid])).rows[0].n
}

// returns {n, foreign} — foreign = rows whose student is NOT in the actor's branch
async function actual(kind, id, branch) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const token = 'TT_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    if (kind === 'staff')   await c.query(`INSERT INTO staff_sessions(staff_id,token,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [id, token])
    if (kind === 'student') await c.query(`INSERT INTO student_sessions(student_id,token,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [id, token])
    await c.query('SET LOCAL ROLE anon')
    const hdr = kind === 'staff' ? { 'x-staff-token': token } : kind === 'student' ? { 'x-student-token': token } : {}
    await c.query(`SELECT set_config('request.headers',$1,true)`, [JSON.stringify(hdr)])
    const total = (await c.query('SELECT count(*)::int n FROM attendance')).rows[0].n
    let foreign = 0
    if (kind === 'staff' && branch) {
      foreign = (await c.query(`SELECT count(*)::int n FROM attendance a JOIN students s ON s.id=a.student_id WHERE s.branch_id IS DISTINCT FROM $1`, [branch])).rows[0].n
    }
    return { n: total, foreign }
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

let pass = 0, fail = 0
const check = (desc, cond, info) => { console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${desc}${info ? ' ('+info+')' : ''}`); cond ? pass++ : fail++ }

console.log('\n=== attendance RLS branch isolation ===')
for (const [name, id] of [['Saurabh FB/B1', 28], ['Suresh CR/B1', 90], ['Karthik no-branch', 32]]) {
  const exp = await expectedStaff(id)
  const act = await actual('staff', id, exp.branch)
  check(`${name}: count matches`, act.n === exp.n, `got ${act.n}, want ${exp.n}`)
  check(`${name}: zero out-of-branch rows`, act.foreign === 0, `foreign=${act.foreign}`)
}
const sExp = await expectedStudent(170)
const sAct = await actual('student', 170)
check('Student 170: sees only own attendance', sAct.n === sExp, `got ${sAct.n}, want ${sExp}`)
const none = await actual('none')
check('No token → 0', none.n === 0, `got ${none.n}`)
await admin.end()
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
