// RLS test for students branch isolation (security-v3/14).
// Mints a temp session (rolled back) so it doesn't depend on live logins.
// Uses SET LOCAL ROLE anon + request.headers to exercise RLS as the app does.
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())

// kind: 'staff' | 'student' | 'none'; id: staff_id or student_id
async function countAs(kind, id) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const token = 'TT_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    const hdr = {}
    if (kind === 'staff') {
      await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-staff-token'] = token
    } else if (kind === 'student') {
      await c.query(`INSERT INTO student_sessions(student_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-student-token'] = token
    }
    await c.query('SET LOCAL ROLE anon')
    await c.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(hdr)])
    const r = await c.query('SELECT count(*)::int AS n, count(DISTINCT branch_id)::int AS branches, min(id) AS only_id, max(id) AS max_id FROM students')
    return r.rows[0]
  } finally {
    try { await c.query('ROLLBACK') } catch {}
    await c.end()
  }
}

let pass = 0, fail = 0
const expect = (desc, got, want) => { const ok = got === want; console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${desc}: got ${got}, want ${want}`); ok ? pass++ : fail++ }

console.log('\n=== students RLS branch isolation ===')
let r = await countAs('staff', 28); expect('Saurabh (FB/B1) count', r.n, 62);  expect('  → single branch', r.branches, 1)
r = await countAs('staff', 90);     expect('Suresh (CR/B1) count', r.n, 212); expect('  → single branch', r.branches, 1)
r = await countAs('staff', 32);     expect('Karthik (no branch) = academy total', r.n, 281)
r = await countAs('student', 170);  expect('Student self sees only own row', r.n, 1); expect('  → id 170', Number(r.only_id), 170)
r = await countAs('none');          expect('No token → 0', r.n, 0)
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
