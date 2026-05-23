// Throwaway RLS test for the trials branch+sport pilot (security-v3/13).
// Connects, SET ROLE anon (so RLS applies), sets the x-staff-token header,
// and lists the trials each persona can SELECT. Compares to expectations.
import pg from 'pg'
import fs from 'fs'

const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())

const personas = [
  { name: 'Saurabh (field Football/B1)', tokenName: 'Saurabh Panchal', branch: 'b32308fc-3bf7-463f-a456-59a13a67cd17' },
  { name: 'Karthik (no-branch Cricket)', tokenName: 'Karthik Sharma',  branch: null },
]

async function tokenFor(client, staffName) {
  const r = await client.query(
    `SELECT ss.token FROM staff_sessions ss JOIN staff s ON s.id=ss.staff_id
     WHERE s.name=$1 AND ss.expires_at > now() ORDER BY ss.id DESC LIMIT 1`, [staffName])
  return r.rows[0]?.token
}

async function readAs(token) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('SET ROLE anon')
    await client.query(`SELECT set_config('request.headers', $1, false)`,
      [JSON.stringify({ 'x-staff-token': token || '' })])
    const r = await client.query('SELECT id, name, sport, branch_id FROM trials ORDER BY id')
    return r.rows
  } finally { await client.end() }
}

const meta = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await meta.connect()
for (const p of personas) {
  const token = await tokenFor(meta, p.tokenName)
  const rows = await readAs(token)
  console.log(`\n## ${p.name}  (${rows.length} trials)`)
  rows.forEach(r => console.log(`   #${r.id} ${r.name?.trim()} [${r.sport}] branch=${r.branch_id ?? 'NULL'}`))
}
// no-token persona (should be 0 — academy resolves NULL)
const none = await readAs('')
console.log(`\n## no token  (${none.length} trials — expect 0)`)
await meta.end()
