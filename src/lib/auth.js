// ── SportFlow Auth Helpers ────────────────────────────────
// Owner / Staff → Supabase Auth (supabase.auth.*) — no custom storage needed
// Student      → custom: student_code + hashed password + DB session token

const SALT        = 'sportflow-2026'
const STUDENT_KEY = 'sf_student'

// ── Password hashing (SHA-256 via SubtleCrypto) ───────────
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
