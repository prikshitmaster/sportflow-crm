import fs from 'fs'
import { authSignUp, rpc, hashPassword, assert } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./edge-state.json', import.meta.url), 'utf8'))

console.log('\n=== SIGNUP edge cases ===')
try {
  const dup = await authSignUp(state.ownerEmail, 'AnotherPass123!')
  console.log(`  duplicate email signup: unexpectedly succeeded — ${JSON.stringify(dup).slice(0,150)}`)
} catch (e) {
  console.log(`  ✓ duplicate email signup rejected: ${e.message.slice(0,150)}`)
}
try {
  const bad = await authSignUp('not-an-email', 'Pass123456!')
  console.log(`  malformed email signup: status ${JSON.stringify(bad).slice(0,150)}`)
} catch (e) {
  console.log(`  ✓ malformed email signup rejected: ${e.message.slice(0,150)}`)
}

console.log('\n=== STAFF LOGIN edge cases (enumeration risk check) ===')
const wrongPass  = await rpc('secure_login_staff', { p_email: 'definitely-not-registered@example.com', p_password_hash: hashPassword('whatever') }, {})
const wrongPass2 = await rpc('secure_login_staff', { p_email: 'also-not-real@example.com',            p_password_hash: hashPassword('whatever') }, {})
console.log(`  unknown email #1: status=${wrongPass.status} msg="${JSON.stringify(wrongPass.body).slice(0,100)}"`)
console.log(`  unknown email #2: status=${wrongPass2.status} msg="${JSON.stringify(wrongPass2.body).slice(0,100)}"`)
assert(JSON.stringify(wrongPass.body) === JSON.stringify(wrongPass2.body), 'identical error for different unknown emails (no user-enumeration signal)', { wrongPass: wrongPass.body, wrongPass2: wrongPass2.body })

console.log('\n=== SQL-meta / injection-shaped input in login (must be safely rejected, not error out oddly) ===')
const injection = await rpc('secure_login_staff', { p_email: "' OR '1'='1", p_password_hash: hashPassword('x') }, {})
assert(!injection.ok, 'SQL-meta email input safely rejected as invalid login (parameterized, not injected)', injection.body)

console.log('\n=== Rapid repeated failed logins (any throttling/lockout?) ===')
const attempts = []
for (let i = 0; i < 8; i++) {
  const r = await rpc('secure_login_staff', { p_email: 'brute-force-target@example.com', p_password_hash: hashPassword('guess' + i) }, {})
  attempts.push(r.status)
}
console.log(`  8 rapid failed attempts, statuses: [${attempts.join(', ')}] — ${new Set(attempts).size === 1 ? 'no visible throttling (all same status/speed)' : 'mixed — possible throttling'}`)
