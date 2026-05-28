// Test: sport_branches.address column exists and insert works
// Run AFTER applying migration 0094 in Supabase SQL Editor

const URL   = 'https://vdvpwbhkdlbskewfgref.supabase.co'
const ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdnB3YmhrZGxic2tld2ZncmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MTUwNzMsImV4cCI6MjA5MzE5MTA3M30.egAmLn5JL5PcwKRv-eoDljJRH5UctRoGdx0UxLnW3v8'

// vikram's owner token — replace if expired
const OWNER_TOKEN = 'REPLACE_WITH_OWNER_SESSION_TOKEN'

const base = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

let pass = 0, fail = 0
function assert(label, condition, detail) {
  if (condition) { console.log(`  ✓ ${label}`); pass++ }
  else           { console.log(`  ✗ ${label} — ${detail}`); fail++ }
}

console.log('\n── sport_branches address column test (migration 0094) ──\n')

// Test 1: column exists — SELECT it
console.log('Test 1: address column exists on sport_branches')
const r1 = await fetch(`${URL}/rest/v1/sport_branches?select=id,branch_name,address&limit=1`, { headers: base })
const d1 = await r1.json()
const hasAddress = r1.ok && !d1?.message?.includes('address')
assert('SELECT address succeeds', hasAddress, JSON.stringify(d1))

// Test 2: RPC insert with address (dry-run with invalid token — expect 403 not column error)
console.log('\nTest 2: secure_insert_sport_branch accepts p_address param (no column error)')
const r2 = await fetch(`${URL}/rest/v1/rpc/secure_insert_sport_branch`, {
  method: 'POST',
  headers: base,
  body: JSON.stringify({ p_sport_name: 'TestSport', p_branch_name: 'TestBranch', p_address: '123 Test St', p_token: 'invalidtoken' }),
})
const d2 = await r2.json()
const noColumnError = !JSON.stringify(d2).toLowerCase().includes('column') && !JSON.stringify(d2).toLowerCase().includes('does not exist')
assert('no "column does not exist" error', noColumnError, JSON.stringify(d2))
// 403/forbidden is expected with invalid token — that's correct RLS behaviour
const isForbidden = r2.status === 403 || JSON.stringify(d2).includes('forbidden') || JSON.stringify(d2).includes('42501')
assert('rejected with forbidden (not column error)', isForbidden, `status ${r2.status}: ${JSON.stringify(d2)}`)

console.log(`\n── Result: ${pass} passed, ${fail} failed ──\n`)
if (fail > 0) process.exit(1)
