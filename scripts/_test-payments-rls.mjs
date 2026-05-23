// RLS test for payments branch isolation (security-v3/16). Set-exact vs admin.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

const admin = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await admin.connect()

async function staffBranch(id) { return (await admin.query('SELECT branch_id FROM staff WHERE id=$1', [id])).rows[0].branch_id }
async function expectedStaff(id) {
  const br = await staffBranch(id)
  const r = await admin.query(`
    SELECT id FROM payments
     WHERE academy_id=$1
       AND ($2::uuid IS NULL OR student_id IN (SELECT id FROM students WHERE academy_id=$1 AND branch_id=$2))
     ORDER BY id`, [ACAD, br])
  return r.rows.map(x => String(x.id))
}
async function expectedStudent(sid) {
  const r = await admin.query('SELECT id FROM payments WHERE student_id=$1 ORDER BY id', [sid])
  return r.rows.map(x => String(x.id))
}
async function actual(kind, id) {
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
    const r = await c.query('SELECT id FROM payments ORDER BY id')
    return r.rows.map(x => String(x.id))
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
let pass = 0, fail = 0
const check = (desc, got, want) => { const ok = eq(got, want); console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${desc}: ${got.length} visible (expected ${want.length})`); ok ? pass++ : fail++ }

console.log('\n=== payments RLS branch isolation (set-exact) ===')
for (const [name, id] of [['Saurabh FB/B1', 28], ['Suresh CR/B1', 90], ['Karthik no-branch', 32]])
  check(name, await actual('staff', id), await expectedStaff(id))
check('Student 170 → own payments only', await actual('student', 170), await expectedStudent(170))
check('No token → none', await actual('none'), [])
await admin.end()
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
