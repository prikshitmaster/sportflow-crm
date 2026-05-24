// Verifies backups storage isolation: private bucket, owner-only read policy,
// and no anon access to backup objects. (Storage writes happen via service role.)
import pg from 'pg'; import fs from 'fs'
const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
let pass = 0, fail = 0
const ok = (d, b) => { console.log(`  ${b ? '✓' : '✗ FAIL'}  ${d}`); b ? pass++ : fail++ }

console.log('\n=== backups storage isolation ===')
const b = await c.query("SELECT public FROM storage.buckets WHERE id='backups'")
ok('bucket exists and is private', b.rows[0]?.public === false)

const p = await c.query("SELECT roles, cmd FROM pg_policies WHERE tablename='objects' AND policyname='backups_owner_read'")
ok('owner-read policy exists (authenticated, SELECT)',
   p.rowCount === 1 && p.rows[0].cmd === 'SELECT' && String(p.rows[0].roles).includes('authenticated'))

const anon = await c.query("SELECT 1 FROM pg_policies WHERE tablename='objects' AND 'anon'=ANY(roles) AND qual ILIKE '%backups%'")
ok('no anon policy references the backups bucket', anon.rowCount === 0)

await c.end()
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
