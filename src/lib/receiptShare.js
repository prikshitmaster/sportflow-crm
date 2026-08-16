// Generic "get this receipt to a parent" helpers — shared by the student
// registration receipt (Students.jsx) and the trial fee receipt (Trials.jsx,
// TrialEnroll.jsx). Receipt-shape-agnostic: callers hand over already-built
// HTML, this just handles getting it out of the browser.
//
// No backend send exists yet (no WhatsApp Business API / email provider is
// wired up — see lib/whatsapp.js's own note on the same gap). Until one is,
// this is the most automated a static site can get: the Web Share API lets
// the browser's native share sheet hand the actual receipt FILE to whatever
// app the user picks (WhatsApp, Gmail, Drive, …) in one tap, on the
// platforms that support it (Android Chrome, iOS Safari 15+). Everywhere
// else it falls back to a plain download plus a pre-filled wa.me / mailto
// so the file is at least one drag-and-drop away from being sent.
//
// FUTURE: once a real WhatsApp Business API / email provider is connected,
// only sendReceiptViaWhatsApp/sendReceiptViaEmail below need to change to
// call that API instead of opening a share sheet — every call site here
// (the buttons) stays the same.

import { buildWhatsAppLink } from './whatsapp'

function receiptFile(html, filename) {
  return new File([html], filename, { type: 'text/html' })
}

export function downloadReceiptHTML(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously can cancel the download on Safari/WebKit.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** True only when the browser can actually hand this exact file to the native share sheet. */
function canShareFile(file) {
  return typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
}

/**
 * WhatsApp: native share sheet with the receipt attached where supported
 * (picks up WhatsApp automatically since it's installed). Otherwise opens
 * a pre-filled wa.me chat and downloads the file alongside it, so it's
 * ready to attach by hand.
 */
export async function sendReceiptViaWhatsApp(html, filename, { phone, text } = {}) {
  const file = receiptFile(html, filename)
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: filename, text })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'  // user closed the sheet — not a failure
      // fall through to the link fallback below
    }
  }
  downloadReceiptHTML(html, filename)
  openWhatsAppFallback(phone, text)
  return 'fallback'
}

function openWhatsAppFallback(phone, text) {
  const url = buildWhatsAppLink(phone, text)
  const w   = window.open(url, '_blank')
  if (!w) window.location.href = url
}

/**
 * Email: native share sheet where supported (picks up Gmail/Mail apps).
 * Otherwise opens a pre-filled mailto and downloads the file alongside it.
 */
export async function sendReceiptViaEmail(html, filename, { to, subject, body } = {}) {
  const file = receiptFile(html, filename)
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: subject, text: body })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  downloadReceiptHTML(html, filename)
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body)    params.set('body', body)
  window.location.href = `mailto:${to || ''}${params.toString() ? `?${params}` : ''}`
  return 'fallback'
}
