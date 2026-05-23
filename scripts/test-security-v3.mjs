// Phase 3.1 + 3.2 verification.
// Run with: node scripts/_test-phase3-lockdown.mjs

import fs from 'fs'

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdnB3YmhrZGxic2tld2ZncmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MTUwNzMsImV4cCI6MjA5MzE5MTA3M30.egAmLn5JL5PcwKRv-eoDljJRH5UctRoGdx0UxLnW3v8'
const API = 'https://vdvpwbhkdlbskewfgref.supabase.co/rest/v1'

let pass = 0, fail = 0

function ok(label)   { console.log(`  ✓ ${label}`); pass++ }
function bad(label, why) { console.log(`  ✗ ${label} — ${why}`); fail++ }

async function anonGet(table, query='') {
  const res = await fetch(`${API}/${table}${query}`, { headers: { apikey: ANON_KEY } })
  const body = await res.text()
  return { status: res.status, body }
}

async function anonRpc(name, args) {
  const res = await fetch(`${API}/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.text()
  return { status: res.status, body }
}

async function anonDelete(table, query) {
  const res = await fetch(`${API}/${table}${query}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, 'Prefer': 'return=representation' },
  })
  return { status: res.status, body: await res.text() }
}

console.log('\n=== PHASE 3.1: session tables ===')

{
  const r = await anonGet('staff_sessions', '?select=token&limit=3')
  if (r.body === '[]') ok('anon GET staff_sessions returns []')
  else bad('anon GET staff_sessions', `expected [] got ${r.body}`)
}

{
  const r = await anonGet('student_sessions', '?select=token&limit=3')
  if (r.body === '[]') ok('anon GET student_sessions returns []')
  else bad('anon GET student_sessions', `expected [] got ${r.body}`)
}

{
  const r = await anonDelete('staff_sessions', '?id=gt.0')
  // After lockdown, anon can't delete. Should get 0 rows touched (status 204 with no body) OR 403.
  if (r.status === 204 || r.status === 403 || r.body === '[]') ok('anon DELETE staff_sessions blocked')
  else bad('anon DELETE staff_sessions', `status ${r.status} body ${r.body.slice(0,80)}`)
}

console.log('\n=== PHASE 3.2: staff_auth + staff_profiles ===')

{
  const r = await anonGet('staff_auth', '?select=email,password_hash&limit=3')
  if (r.body === '[]') ok('anon GET staff_auth returns [] (password_hash leak SEALED)')
  else bad('anon GET staff_auth', `expected [] got ${r.body.slice(0,120)}`)
}

{
  const r = await anonGet('staff_profiles', '?select=staff_id,age&limit=3')
  if (r.body === '[]') ok('anon GET staff_profiles returns []')
  else bad('anon GET staff_profiles', `expected [] got ${r.body.slice(0,120)}`)
}

console.log('\n=== RPCs that MUST still work ===')

{
  const r = await anonRpc('secure_validate_staff_session', { p_token: 'bogus-token-123' })
  if (r.body === 'null') ok('secure_validate_staff_session(bad) → null')
  else bad('validate_staff_session(bad)', `got ${r.body.slice(0,80)}`)
}

{
  const r = await anonRpc('secure_validate_student_session', { p_token: 'bogus-token-123' })
  if (r.body === 'null') ok('secure_validate_student_session(bad) → null')
  else bad('validate_student_session(bad)', `got ${r.body.slice(0,80)}`)
}

{
  const r = await anonRpc('secure_login_staff', { p_email: 'noreply@example.com', p_password_hash: 'wrong' })
  if (r.status >= 400 && r.body.includes('Invalid')) ok('secure_login_staff(bad creds) raises Invalid')
  else bad('login_staff bad creds', `status ${r.status} body ${r.body.slice(0,120)}`)
}

{
  const r = await anonRpc('secure_login_student', { p_student_code: 'INVALID999', p_password_hash: 'wrong' })
  if (r.status >= 400 && (r.body.includes('Invalid') || r.body.includes('not activated'))) ok('secure_login_student(bad creds) raises Invalid')
  else bad('login_student bad creds', `status ${r.status} body ${r.body.slice(0,120)}`)
}

{
  const r = await anonRpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null })
  if (r.status >= 400 && r.body.includes('forbidden')) ok('secure_fetch_next_staff_code(no token) forbidden')
  else bad('fetch_next_staff_code(no token)', `status ${r.status} body ${r.body.slice(0,120)}`)
}

console.log('\n=== POSITIVE: validate against a real session ===')
{
  // Find a real active session via direct DB connection, then validate it through the RPC
  const { default: pg } = await import('pg')
  const url = fs.readFileSync('.supabase-db-url', 'utf8').trim()
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query('SELECT token FROM staff_sessions WHERE expires_at > now() LIMIT 1')
  await c.end()
  if (!rows.length) { console.log('  (skip: no live sessions to test against)'); }
  else {
    const r = await anonRpc('secure_validate_staff_session', { p_token: rows[0].token })
    const obj = JSON.parse(r.body)
    if (obj && obj.id && obj.name) ok(`secure_validate_staff_session(real) returns staff ${obj.name}`)
    else bad('validate real session', `got ${r.body.slice(0,160)}`)
  }
}

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
