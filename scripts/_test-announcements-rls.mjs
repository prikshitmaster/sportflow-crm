// RLS test for announcements branch+sport isolation (security-v3/18).
// Academy-wide (branch_id NULL) must stay visible to all staff. Set-exact vs admin.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

const admin = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await admin.connect()
async function staff(id) { return (await admin.query('SELECT branch_id, sports FROM staff WHERE id=$1', [id])).rows[0] }
async function expectedStaff(id) {
  const s = await staff(id)
  const sports = (s.sports && s.sports.length) ? s.sports : null
  const r = await admin.query(`
    SELECT id FROM announcements
     WHERE academy_id=$1
       AND (branch_id IS NULL OR $2::uuid IS NULL OR branch_id=$2)
       AND (sport IS NULL OR sport='' OR $3::text[] IS NULL
            OR EXISTS (SELECT 1 FROM unnest($3::text[]) sp WHERE lower(sp)=lower(announcements.sport)))
     ORDER BY id`, [ACAD, s.branch_id, sports])
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
    const r = await c.query('SELECT id FROM announcements ORDER BY id')
    return r.rows.map(x => String(x.id))
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}
const allAcademy = async () => (await admin.query('SELECT id FROM announcements WHERE academy_id=$1 ORDER BY id', [ACAD])).rows.map(x => String(x.id))

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
let pass = 0, fail = 0
const check = (d, got, want) => { const ok = eq(got, want); console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${d}: ${got.length} (expected ${want.length})`); ok ? pass++ : fail++ }

console.log('\n=== announcements RLS (academy-wide stays visible) ===')
for (const [n, id] of [['Saurabh FB/B1', 28], ['Suresh CR/B1', 90], ['Karthik no-branch', 32]])
  check(n, await actual('staff', id), await expectedStaff(id))
check('Student 170 → all academy announcements', await actual('student', 170), await allAcademy())
check('No token → 0', await actual('none'), [])
await admin.end()
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
