// ═════════════════════════════════════════════════════════════════════════════
// auth.js — low-level auth building blocks (no React, no UI).
//
// TWO AUTH SYSTEMS COEXIST:
//   Owner & Parent → Supabase Auth (JWT). Handled by supabase.auth.* directly;
//                    nothing custom needed here.
//   Staff & Student → CUSTOM sessions, built from these helpers:
//        password ──hashPassword()──▶ SHA-256 hash stored in DB
//        login OK ──generateToken()─▶ random 64-char token, stored BOTH in a
//                    DB sessions table (server can verify/revoke) AND in
//                    localStorage ('sf_staff' / 'sf_student') so a page reload
//                    keeps you logged in. Every RPC call sends this token.
//
// WHY hash WITH A SALT? The salt is mixed into the password before hashing so
// identical passwords don't produce identical hashes, and generic rainbow
// tables don't match. (Production upgrade path: bcrypt/Argon2 server-side.)
// ═════════════════════════════════════════════════════════════════════════════

const SALT        = 'sportflow-2026'
const STUDENT_KEY = 'sf_student'

// SHA-256 via the browser's built-in WebCrypto (crypto.subtle). Returns the
// hash as a hex string ("a3f9…"). Async because WebCrypto is promise-based.
export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(SALT + password)
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Student code generator (SA001, SA002 …) ───────────────
export function generateStudentCode(existingCount) {
  return 'SA' + String(existingCount + 1).padStart(3, '0')
}

// ── One-time student join code (6 unambiguous chars) ──────
export function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

// ── Academy join code (staff use this to link to an academy)
// Same charset, reuses generateJoinCode logic
export const generateAcademyCode = generateJoinCode

// ── Cryptographic token (64 hex chars, for student sessions)
export function generateToken() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Student session (localStorage + DB token) ────────────
export function getStudentSession() {
  try {
    const raw = localStorage.getItem(STUDENT_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(STUDENT_KEY)
      return null
    }
    return s
  } catch { return null }
}

export function setStudentSession(token, expiresAt, studentData) {
  localStorage.setItem(STUDENT_KEY, JSON.stringify({ token, expiresAt, ...studentData }))
}

export function clearStudentSession() {
  localStorage.removeItem(STUDENT_KEY)
}

// ── Staff session (localStorage + DB token) ──────────────
const STAFF_KEY = 'sf_staff'

export function getStaffSession() {
  try {
    const raw = localStorage.getItem(STAFF_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(STAFF_KEY)
      return null
    }
    return s
  } catch { return null }
}

export function setStaffSession(token, expiresAt, staffData) {
  localStorage.setItem(STAFF_KEY, JSON.stringify({ token, expiresAt, ...staffData }))
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_KEY)
}

// ── Staff code generator ──────────────────────────────────
export function generateStaffCode(prefix, existingCount) {
  return prefix + String(existingCount + 1).padStart(3, '0')
}

// ── Optimistic session cache (instant restore without DB round-trip) ──
const STUDENT_CACHE_KEY = 'sf_student_cache'
const STAFF_CACHE_KEY   = 'sf_staff_cache'

export function setCachedStudentUser(data) {
  try { localStorage.setItem(STUDENT_CACHE_KEY, JSON.stringify(data)) } catch {}
}
export function getCachedStudentUser() {
  try { const r = localStorage.getItem(STUDENT_CACHE_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
export function clearCachedStudentUser() {
  try { localStorage.removeItem(STUDENT_CACHE_KEY) } catch {}
}

export function setCachedStaffUser(data) {
  try { localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(data)) } catch {}
}
export function getCachedStaffUser() {
  try { const r = localStorage.getItem(STAFF_CACHE_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
export function clearCachedStaffUser() {
  try { localStorage.removeItem(STAFF_CACHE_KEY) } catch {}
}
