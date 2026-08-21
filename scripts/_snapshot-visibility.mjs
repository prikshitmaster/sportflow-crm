// Captures exactly what EVERY staff member (and a sample of students) can see
// through RLS, as a JSON fingerprint. Run before and after a policy change and
// diff the two files — any difference is a behaviour change.
//
//   node scripts/_snapshot-visibility.mjs before.json
//   ...apply migration...
//   node scripts/_snapshot-visibility.mjs after.json
//   node scripts/_snapshot-visibility.mjs --diff before.json after.json
import pg from 'pg'
import fs from 'fs'

const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const TABLES = ['students', 'payments', 'batches', 'trials', 'announcements',
                'attendance', 'leave_requests', 'audit_logs', 'staff_checkins', 'events']

if (process.argv[2] === '--diff') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  let diffs = 0
  for (const k of keys) {
    const av = JSON.stringify(a[k]), bv = JSON.stringify(b[k])
    if (av !== bv) { console.log(`DIFF ${k}\n  before ${av}\n  after  ${bv}`); diffs++ }
  }
  console.log(diffs ? `\n${diffs} actor(s) CHANGED` : `\nIDENTICAL across ${keys.length} actors — no behaviour change`)
  process.exit(diffs ? 1 : 0)
}

const outFile = process.argv[2] || 'visibility.json'
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const staff = (await c.query(`SELECT id FROM staff ORDER BY id`)).rows.map(r => r.id)
const students = (await c.query(`SELECT id FROM students ORDER BY id LIMIT 10`)).rows.map(r => r.id)
const snap = {}

const counts = TABLES.map(t => `(SELECT count(*)::int FROM ${t}) AS ${t}`).join(', ')

async function capture(kind, id) {
  const token = 'SNAP_' + Math.random().toString(16).slice(2)
  await c.query('BEGIN')
  try {
    const hdr = {}
    if (kind === 'staff') {
      await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-staff-token'] = token
    } else {
      await c.query(`INSERT INTO student_sessions(student_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-student-token'] = token
    }
    await c.query('SET LOCAL ROLE anon')
    await c.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(hdr)])
    const r = await c.query(`SELECT ${counts}`)
    snap[`${kind}:${id}`] = r.rows[0]
  } finally {
    await c.query('ROLLBACK')   // nothing is ever persisted
  }
}

for (const id of staff)    await capture('staff', id)
for (const id of students) await capture('student', id)

fs.writeFileSync(outFile, JSON.stringify(snap, null, 1))
console.log(`captured ${Object.keys(snap).length} actors × ${TABLES.length} tables → ${outFile}`)
await c.end()
