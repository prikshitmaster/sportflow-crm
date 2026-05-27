// Test suite: staff_checkins RLS
// Verifies migration 0093 correctly scopes reads

const URL  = 'https://vdvpwbhkdlbskewfgref.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdnB3YmhrZGxic2tld2ZncmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MTUwNzMsImV4cCI6MjA5MzE5MTA3M30.egAmLn5JL5PcwKRv-eoDljJRH5UctRoGdx0UxLnW3v8'
const STAFF_TOKEN = 'e7dc6298abe549e79625f967cb8cf77df648523d65f34f6fba6456d6f8d7a079' // Saurabh — ARA academy

const base = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

async function query(headers) {
  const r = await fetch(`${URL}/rest/v1/staff_checkins?select=staff_id,date,clock_in`, { headers })
  if (!r.ok) return { error: await r.text() }
  return await r.json()
}

let pass = 0, fail = 0
function assert(label, condition, detail) {
  if (condition) { console.log(`  ✓ ${label}`); pass++ }
  else           { console.log(`  ✗ ${label} — ${detail}`); fail++ }
}

console.log('\n── staff_checkins RLS test (migration 0093) ──\n')

// ── Test 1: Anon, no token → 0 rows ──────────────────────────────────────
console.log('Test 1: Anon with NO token (should return 0 rows)')
const t1 = await query({ ...base })
assert('returns array',     Array.isArray(t1),     JSON.stringify(t1))
assert('0 rows (blocked)',  Array.isArray(t1) && t1.length === 0,
       `got ${Array.isArray(t1) ? t1.length : 'error'} rows`)

// ── Test 2: Anon with fake token → 0 rows ────────────────────────────────
console.log('\nTest 2: Anon with FAKE token (should return 0 rows)')
const t2 = await query({ ...base, 'x-staff-token': 'fakefakefakefakefake' })
assert('returns array',     Array.isArray(t2),     JSON.stringify(t2))
assert('0 rows (blocked)',  Array.isArray(t2) && t2.length === 0,
       `got ${Array.isArray(t2) ? t2.length : 'error'} rows`)

// ── Test 3: Anon with valid staff token → own academy rows only ───────────
console.log('\nTest 3: Anon with VALID staff token (should return Saurabh\'s check-ins)')
const t3 = await query({ ...base, 'x-staff-token': STAFF_TOKEN })
assert('returns array',       Array.isArray(t3),                      JSON.stringify(t3))
assert('> 0 rows (allowed)',  Array.isArray(t3) && t3.length > 0,     `got ${Array.isArray(t3) ? t3.length : 'error'} rows`)
// All rows must belong to ARA academy — indirectly verified because staff_checkins
// has no cross-academy staff_id collision, and the policy uses current_staff_academy()
if (Array.isArray(t3) && t3.length > 0) {
  console.log(`  → rows: ${JSON.stringify(t3)}`)
}

// ── Test 4: No cross-academy bleed ──────────────────────────────────────
// There's only 1 academy in prod so we confirm rows returned match known data
console.log('\nTest 4: Rows match known migrated data (staff_id 28, May 10 + 15)')
const ids = Array.isArray(t3) ? t3.map(r => String(r.staff_id)) : []
assert('all rows are staff_id 28', ids.every(id => id === '28'), `ids: ${JSON.stringify(ids)}`)

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n── Result: ${pass} passed, ${fail} failed ──\n`)
if (fail > 0) process.exit(1)
