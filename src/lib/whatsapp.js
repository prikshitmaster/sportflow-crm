// WhatsApp click-to-send helpers (v1 — wa.me link approach).
//
// True automated sending requires a WhatsApp Business API provider
// (MSG91, AiSensy, Meta Cloud API). Until that's wired up, owner taps
// each reminder and WhatsApp Web does the actual send.
//
// When MSG91 goes live, only this file changes — the buttons stay the
// same: just swap openWhatsAppLink() for an API call.

const COUNTRY_CODE = '91'   // India

// Normalize to E.164-ish: digits only, prepend 91 if 10-digit local
export function normalizePhoneForWhatsApp(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return COUNTRY_CODE + digits
  if (digits.startsWith(COUNTRY_CODE)) return digits
  return digits
}

// Build a wa.me click-to-chat URL. Empty phone → links to "choose contact" picker.
export function buildWhatsAppLink(phone, message) {
  const p = normalizePhoneForWhatsApp(phone)
  const t = encodeURIComponent(message || '')
  return p ? `https://wa.me/${p}?text=${t}` : `https://wa.me/?text=${t}`
}

// Open in a new tab (or current if popup blocked).
export function openWhatsAppLink(phone, message) {
  const url = buildWhatsAppLink(phone, message)
  const w   = window.open(url, '_blank')
  if (!w) window.location.href = url
  return url
}

// Days between paid_till and today (positive = overdue, 0 = due today)
export function daysOverdue(paidTill, today = new Date()) {
  if (!paidTill) return 0
  const p = new Date(paidTill + (paidTill.length === 7 ? '-01' : '') + 'T00:00:00')
  const t = new Date(today); t.setHours(0, 0, 0, 0); p.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((t - p) / 86400000))
}

const inrFmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')

// Standard fees-overdue reminder. Keep short — WhatsApp text msgs work
// best at <3 lines. Tone: polite, factual, not threatening.
export function buildFeesReminderMessage({ student, academy }) {
  const parent  = student.parent || 'Parent'
  const name    = student.name   || 'Student'
  const amount  = inrFmt(student.fees || 0)
  const days    = daysOverdue(student.paidTill)
  const daysStr = days > 0 ? ` (${days} day${days === 1 ? '' : 's'} overdue)` : ''

  return [
    `Hi ${parent},`,
    ``,
    `Reminder: ${name}'s fees of ${amount} are due${daysStr}.`,
    ``,
    `Please clear at the academy office or message us if you've already paid.`,
    ``,
    `— ${academy || 'Academy'}`,
  ].join('\n')
}

// Generic "today's pulse" or custom message — fallback template for the
// per-row tap when there's no specific reason.
export function buildGenericMessage({ student, academy, body }) {
  const parent = student.parent || 'Parent'
  return [
    `Hi ${parent},`,
    ``,
    body || `Quick update regarding ${student.name || 'your child'}.`,
    ``,
    `— ${academy || 'Academy'}`,
  ].join('\n')
}

// localStorage marker so the bulk-send queue doesn't nag the same parent twice today
const SENT_KEY = (studentId) => `wa_sent_${studentId}_${new Date().toISOString().slice(0, 10)}`

export const wasSentToday = (studentId) => {
  try { return !!localStorage.getItem(SENT_KEY(studentId)) } catch { return false }
}
export const markSentToday = (studentId) => {
  try { localStorage.setItem(SENT_KEY(studentId), '1') } catch { /* ignore */ }
}
