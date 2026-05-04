const SALT       = 'sportflow-2026'
const ADMIN_KEY  = 'sf_admin'
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

// ── One-time join code (6 unambiguous chars) ─────────────
export function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

// ── Cryptographic token (64 hex chars) ───────────────────
export function generateToken() {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Admin session (localStorage, simple) ─────────────────
export function getAdminSession() {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(ADMIN_KEY)
      return null
    }
    return s
  } catch { return null }
}

export function setAdminSession(userData) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  localStorage.setItem(ADMIN_KEY, JSON.stringify({ ...userData, expiresAt }))
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_KEY)
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
