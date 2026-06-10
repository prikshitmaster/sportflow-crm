// ─────────────────────────────────────────────────────────────────────────────
// supabase.js — creates the ONE shared connection to our backend.
//
// Supabase = hosted PostgreSQL + auto-generated REST API + auth. This client
// object is imported everywhere (`import { supabase } from './supabase'`) and
// gives us:
//   supabase.from('students').select('*')   → read a table (PostgREST)
//   supabase.rpc('secure_update_student')   → call a Postgres function
//   supabase.auth.signInWithPassword(...)   → owner login (JWT)
//
// The ANON key is PUBLIC by design — anyone can see it in the browser. It is
// safe because Row Level Security policies inside the database decide what
// each request may actually read or write. Secrets never live in frontend code.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { getStaffSession, getStudentSession } from './auth'

// import.meta.env.* = environment variables from .env (Vite only exposes
// variables that start with VITE_). The .env file is gitignored.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('Supabase env vars missing — running in offline/mock mode')
}

// Inject session tokens as request headers so PostgREST RLS policies can
// validate them server-side (see 0004_session_header_rls.sql).
// Harmless before 0004 is applied — the DB ignores unrecognised headers.
function fetchWithSessionHeaders(input, init = {}) {
  const headers = new Headers(init.headers || {})

  const staffSession = getStaffSession()
  if (staffSession?.token) headers.set('x-staff-token', staffSession.token)

  const studentSession = getStudentSession()
  if (studentSession?.token) headers.set('x-student-token', studentSession.token)

  return fetch(input, { ...init, headers })
}

export const supabase = createClient(url || 'http://localhost', key || 'placeholder', {
  global: { fetch: fetchWithSessionHeaders },
})
