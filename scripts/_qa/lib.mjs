// QA harness shared helpers — talks to production clubcrm exactly like the
// real frontend does (Auth API + PostgREST + RPC), so RLS/permission
// enforcement is exercised for real, not mocked.
import fs from 'fs'
import crypto from 'crypto'
import pg from 'pg'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)
export const SUPABASE_URL = env.VITE_SUPABASE_URL
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
export const AUTH_API = `${SUPABASE_URL}/auth/v1`
export const REST_API = `${SUPABASE_URL}/rest/v1`
const DB_URL = fs.readFileSync(new URL('../../.supabase-db-url', import.meta.url), 'utf8').trim()

export const SALT = 'sportflow-2026' // matches src/lib/auth.js
export function hashPassword(password) {
  return crypto.createHash('sha256').update(SALT + password).digest('hex')
}

export async function pgQuery(sql, params = []) {
  const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

// ── Auth API (owner + parent — real Supabase Auth) ─────────────────────────
export async function authSignUp(email, password) {
  const res = await fetch(`${AUTH_API}/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`signup failed: ${res.status} ${JSON.stringify(body)}`)
  return body // { user, session (maybe null if confirmation required) }
}

export async function authSignIn(email, password) {
  const res = await fetch(`${AUTH_API}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`signin failed: ${res.status} ${JSON.stringify(body)}`)
  return body // { access_token, refresh_token, user, ... }
}

export async function forceConfirmEmail(userId) {
  await pgQuery(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [userId])
}

// ── Generic REST / RPC callers ──────────────────────────────────────────────
// mode: { ownerJwt } | { staffToken } | { studentToken } | {} (pure anon)
function headersFor(mode = {}) {
  const h = { apikey: ANON_KEY, 'Content-Type': 'application/json' }
  if (mode.ownerJwt) h['Authorization'] = `Bearer ${mode.ownerJwt}`
  if (mode.staffToken) h['x-staff-token'] = mode.staffToken
  if (mode.studentToken) h['x-student-token'] = mode.studentToken
  return h
}

export async function restGet(table, query = '', mode = {}) {
  const res = await fetch(`${REST_API}/${table}${query}`, { headers: headersFor(mode) })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

export async function rpc(name, args = {}, mode = {}) {
  const res = await fetch(`${REST_API}/rpc/${name}`, {
    method: 'POST',
    headers: headersFor(mode),
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body }
}

export function assert(cond, label, detail) {
  if (cond) { console.log(`  ✓ ${label}`); return true }
  console.log(`  ✗ FAIL ${label}${detail ? '  (' + JSON.stringify(detail).slice(0,200) + ')' : ''}`)
  return false
}

export const rid = (p) => p + Math.random().toString(16).slice(2, 8)
