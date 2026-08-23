// Shared helpers for the Playwright QA harness — talks to the real production
// clubcrm Supabase project exactly like the app does (Auth API + PostgREST +
// RPC), scoped to a disposable academy created in global-setup and destroyed
// in global-teardown. Mirrors scripts/_qa/lib.mjs; kept separate because that
// file is plain .mjs and this needs to import cleanly from .ts spec files.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import pg from 'pg'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function readEnvFile(file: string): Record<string, string> {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      })
  )
}

const env = readEnvFile(path.join(ROOT, '.env'))
export const SUPABASE_URL = env.VITE_SUPABASE_URL
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
export const AUTH_API = `${SUPABASE_URL}/auth/v1`
export const REST_API = `${SUPABASE_URL}/rest/v1`
const DB_URL = fs.readFileSync(path.join(ROOT, '.supabase-db-url'), 'utf8').trim()

export const SALT = 'sportflow-2026' // matches src/lib/auth.js

export function hashPassword(password: string) {
  return crypto.createHash('sha256').update(SALT + password).digest('hex')
}

export async function pgQuery(sql: string, params: any[] = []) {
  const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

export async function authSignUp(email: string, password: string) {
  const res = await fetch(`${AUTH_API}/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body: any = await res.json()
  if (!res.ok) throw new Error(`signup failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}

export async function authSignIn(email: string, password: string) {
  const res = await fetch(`${AUTH_API}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body: any = await res.json()
  if (!res.ok) throw new Error(`signin failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}

export async function forceConfirmEmail(userId: string) {
  await pgQuery(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [userId])
}

type Mode = { ownerJwt?: string; staffToken?: string; studentToken?: string }

function headersFor(mode: Mode = {}) {
  const h: Record<string, string> = { apikey: ANON_KEY, 'Content-Type': 'application/json' }
  if (mode.ownerJwt) h['Authorization'] = `Bearer ${mode.ownerJwt}`
  if (mode.staffToken) h['x-staff-token'] = mode.staffToken
  if (mode.studentToken) h['x-student-token'] = mode.studentToken
  return h
}

export async function post(table: string, payload: any, mode: Mode = {}) {
  const res = await fetch(`${REST_API}/${table}`, {
    method: 'POST',
    headers: { ...headersFor(mode), Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body: any; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body }
}

export async function rpc(name: string, args: any = {}, mode: Mode = {}) {
  const res = await fetch(`${REST_API}/rpc/${name}`, {
    method: 'POST',
    headers: headersFor(mode),
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let body: any; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, ok: res.ok, body }
}

export const rid = (p: string) => p + Math.random().toString(16).slice(2, 8)

export const STATE_PATH = path.join(ROOT, 'tests', '.qa-state.json')

export type QaState = {
  stamp: number
  academyId: number
  ownerId: string
  ownerEmail: string
  ownerPassword: string
  branchId: number
  batchId: number
  batchName: string
  coach: { id: number; name: string; email: string; password: string }
  students: { id: number; name: string }[]
}

export function readState(): QaState {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
}
