// RLS test for batches branch+sport isolation (security-v3/15).
// Gold standard: the set anon+token returns must EXACTLY equal the set computed
// by the same predicate as a superuser (no RLS). Temp sessions, rolled back.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const ACAD = 'cb01cec5-a307-4c95-b9ab-6f6b4e7e9fcf'

const admin = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await admin.connect()

async function staffRow(id) {
  const r = await admin.query('SELECT branch_id, sports FROM staff WHERE id=$1', [id])
  return r.rows[0]
}
// expected batch ids for a staff persona, computed without RLS
async function expectedStaff(id) {
  const s = await staffRow(id)
  const sports = (s.sports && s.sports.length) ? s.sports : null
  const r = await admin.query(`
    SELECT id FROM batches
     WHERE academy_id = $1
       AND ($2::uuid IS NULL OR branch_id = $2)
       AND ($3::text[] IS NULL OR EXISTS (
             SELECT 1 FROM unnest(sports) b JOIN unnest($3::text[]) ss ON lower(b)=lower(ss)))
     ORDER BY id`, [ACAD, s.branch_id, sports])
  return r.rows.map(x => String(x.id))
}
async function allAcademyBatchIds() {
  const r = await admin.query('SELECT id FROM batches WHERE academy_id=$1 ORDER BY id', [ACAD])
  return r.rows.map(x => String(x.id))
}

// actual ids visible to a minted session (RLS as anon)
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
    const r = await c.query('SELECT id FROM batches ORDER BY id')
    return r.rows.map(x => String(x.id))
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
let pass = 0, fail = 0
function check(desc, got, want) {
  const ok = eq(got, want)
  console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${desc}: ${got.length} visible (expected ${want.length})` + (ok ? '' : `\n      got=${got}\n      want=${want}`))
  ok ? pass++ : fail++
}

console.log('\n=== batches RLS branch+sport isolation (set-exact) ===')
for (const [name, id] of [['Saurabh FB/B1', 28], ['Suresh CR/B1', 90], ['Karthik no-branch/Cricket', 32]]) {
  check(`${name}`, await actual('staff', id), await expectedStaff(id))
}
check('Student 170 → all academy batches', await actual('student', 170), await allAcademyBatchIds())
check('No token → none', await actual('none'), [])

await admin.end()
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
