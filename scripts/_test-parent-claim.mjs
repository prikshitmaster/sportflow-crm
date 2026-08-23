// Proves (and after the fix, disproves) the parent-account-takeover hole in
// secure_claim_parent_account. auth.jwt() reads request.jwt.claims, so a JWT can
// be simulated with set_config. Everything is rolled back.
//
//   node scripts/_test-parent-claim.mjs
import pg from 'pg'
import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())

const client = async () => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect(); return c
}

// Call the RPC as a user whose VERIFIED phone is `jwtPhone`, asking to claim `argPhone`.
async function claimAs(jwtPhone, argPhone) {
  const c = await client()
  try {
    await c.query('BEGIN')
    // A REAL auth.users id — parents.auth_user_id has an FK, so a fake uuid
    // fails on 23503 before any security check is reached.
    const claims = { sub: '6ccedd95-d3ab-4015-b549-a0ab0a59fbe4', role: 'authenticated' }
    if (jwtPhone) claims.phone = jwtPhone
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    const r = await c.query(`SELECT secure_claim_parent_account($1) AS j`, [argPhone])
    const j = typeof r.rows[0].j === 'string' ? JSON.parse(r.rows[0].j) : r.rows[0].j
    return { result: 'ALLOWED', claimed: j?.name, phone: j?.phone, academy: j?.academy_id?.slice(0, 8) }
  } catch (e) { return { result: e.code || e.message.slice(0, 70) } }
  finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

const c = await client()
const { rows: victims } = await c.query(
  `SELECT name, phone FROM parents WHERE auth_user_id IS NULL AND phone IS NOT NULL ORDER BY created_at LIMIT 2`)
await c.end()

const victim   = victims[0]
const attacker = '919111100000'   // a phone with NO parent record — the attacker's own

console.log(`\nVictim parent : ${victim.name} (${victim.phone})`)
console.log(`Attacker phone: ${attacker} (no parent row of their own)\n`)

console.log('--- ATTACK: verified as attacker, claim the victim\'s phone ---')
console.log(JSON.stringify(await claimAs(attacker, victim.phone), null, 1))

console.log('\n--- LEGITIMATE: verified as the victim, claim own phone ---')
console.log(JSON.stringify(await claimAs('91' + victim.phone, victim.phone), null, 1))

console.log('\n--- NO PHONE IN JWT (e.g. email/password session) ---')
console.log(JSON.stringify(await claimAs(null, victim.phone), null, 1))
