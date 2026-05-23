// scripts/db-fast.mjs — Direct Postgres migration runner via Supavisor pooler
// Replaces scripts/db.ps1. Connection string cached in .supabase-db-url (gitignored).
//
// Speed: ~2400ms (db.ps1) → ~400ms (this). Connect + query happens in one TCP roundtrip.
//
// Usage:
//   node scripts/db-fast.mjs apply supabase/security-v3/01_foo.sql
//   node scripts/db-fast.mjs apply-dir supabase/security-v3
//   node scripts/db-fast.mjs query "SELECT version()"
//   node scripts/db-fast.mjs status

import pg from 'pg'
import fs from 'fs'
import path from 'path'

const url = process.env.SUPA_DB_URL || (() => {
  try { return fs.readFileSync('.supabase-db-url', 'utf8').trim() } catch { return null }
})()
if (!url) {
  console.error('ERROR: No connection URL. Set $env:SUPA_DB_URL or create .supabase-db-url')
  process.exit(1)
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try { return await fn(client) } finally { await client.end() }
}

async function applyFile(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8')
  const t0 = Date.now()
  await client.query(sql)
  const ms = Date.now() - t0

  const fname = path.basename(filePath, path.extname(filePath))
  const version = fname.match(/^(\d+)/)?.[1]
  if (version) {
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations(version, statements, name)
       VALUES ($1, ARRAY[]::text[], $2) ON CONFLICT(version) DO NOTHING`,
      [version, fname]
    )
  }
  console.log(`✓ ${path.basename(filePath)} (${ms}ms)`)
}

const [, , cmd, arg] = process.argv
const wallStart = Date.now()

try {
  await withClient(async (client) => {
    if (cmd === 'apply') {
      if (!arg) throw new Error('apply needs a file path')
      await applyFile(client, arg)
    } else if (cmd === 'apply-dir') {
      if (!arg) throw new Error('apply-dir needs a directory')
      const files = fs.readdirSync(arg).filter(f => f.endsWith('.sql')).sort()
      if (files.length === 0) { console.log('No .sql files in', arg); return }
      for (const f of files) await applyFile(client, path.join(arg, f))
      console.log(`Applied ${files.length} files (total ${Date.now() - wallStart}ms)`)
    } else if (cmd === 'query') {
      if (!arg) throw new Error('query needs a SQL string')
      const r = await client.query(arg)
      if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2))
      console.log(`(${r.rows?.length ?? r.rowCount ?? 0} rows)`)
    } else if (cmd === 'status') {
      const r = await client.query(
        'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
      )
      console.log(`Tracked migrations (${r.rows.length}):`)
      console.log(r.rows.map(x => x.version).join('  '))
    } else {
      console.error('Usage: node scripts/db-fast.mjs <apply|apply-dir|query|status> [arg]')
      process.exit(1)
    }
  })
} catch (e) {
  console.error('FAILED:', e.message)
  if (e.position) console.error('SQL position:', e.position)
  if (e.detail) console.error('Detail:', e.detail)
  if (e.hint) console.error('Hint:', e.hint)
  process.exit(1)
}
