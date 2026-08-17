// Receipt for a trial fee paid online through the public /join funnel.
//
// Deliberately standalone rather than reusing Payments.jsx's buildReceiptHTML:
// that one renders a `payments` row for an enrolled student (batch, fee plan,
// coverage months), and an online trial payment has none of those — no student
// record exists yet, only a trial. It also has to run on the public page, where
// there is no session and no AppContext.
//
// The download is a self-contained .html file: it opens in any browser, prints
// to PDF from there, and survives being forwarded or kept offline. No popup is
// opened, so a blocker can't silently swallow it the way window.open can.

import { Capacitor } from '@capacitor/core'
import { taxRowLabel } from './tax'
import { saveOrShareFile } from './nativeSave'

// Everything interpolated below is parent-supplied (names, phone) or academy
// config, so it is escaped — a stray & or < would otherwise corrupt the file.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

/**
 * @param r.academyName    display name of the academy
 * @param r.logoUrl        optional remote logo
 * @param r.academyAddress optional full academy/branch address line
 * @param r.academyPhone   optional academy contact phone, shown in the footer
 * @param r.academyEmail   optional academy contact email, shown in the footer
 * @param r.academyGstin   optional GSTIN — shown in the footer when present;
 *                         never fabricated when absent (no fake tax ID)
 * @param r.receiptNo     human receipt/application id (e.g. ARA-2026-482)
 * @param r.paymentRef    Razorpay payment id — the authoritative proof of payment
 * @param r.paidOn        Date the payment succeeded
 * @param r.studentName   who the trial is for
 * @param r.parentName    who paid
 * @param r.phone         10-digit contact, no +91
 * @param r.sport         sport name
 * @param r.branchName    branch name
 * @param r.batchName     batch name, or null when unassigned
 * @param r.fee           the computeTrialTotal() result
 * @param r.method        'UPI' | 'Cash' | 'Card' | … however it was actually paid
 * @param r.paidOnline    true for a Razorpay /join payment, false for cash/UPI
 *                        collected in person — changes the total row's caption
 */
export function buildTrialReceiptHTML(r) {
  const f = r.fee || {}
  const paidOn = r.paidOn instanceof Date ? r.paidOn : new Date()
  const dateStr = paidOn.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = paidOn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  const rows = []
  if (f.trialFee > 0) rows.push({ desc: 'Trial session fee', sub: esc(r.sport || ''), amt: f.trialFee })
  if (f.kitFee > 0)   rows.push({ desc: 'Kit fee', sub: 'One-time', amt: f.kitFee })
  if (f.taxAmount > 0) rows.push({ desc: taxRowLabel(f.taxPct, f.taxedLabel), sub: '', amt: f.taxAmount })
  // No itemized trial/kit split is available (e.g. reconstructed later from
  // just a stored total + tax) — still show something better than a bare
  // total row, without inventing numbers that were never actually broken out.
  if (!rows.length && f.total > 0) {
    const base = f.total - (f.taxAmount || 0)
    if (base > 0) rows.push({ desc: 'Registration fee', sub: esc(r.sport || ''), amt: base })
    if (f.taxAmount > 0) rows.push({ desc: taxRowLabel(f.taxPct, f.taxedLabel), sub: '', amt: f.taxAmount })
  }

  const bizLine = [r.academyGstin ? `GSTIN ${r.academyGstin}` : '', r.academyPhone ? `+91 ${r.academyPhone}` : '', r.academyEmail]
    .filter(Boolean).join('  ·  ')

  const meta = [
    ['Student', r.studentName],
    ['Parent / Guardian', r.parentName],
    ['Contact', r.phone ? `+91 ${r.phone}` : ''],
    ['Sport', r.sport],
    ['Branch', r.branchName],
    ['Batch', r.batchName || 'To be assigned'],
  ].filter(([, v]) => v)

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(r.receiptNo)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 18px; background: #F4F6F4;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         color: #14281B; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 620px; margin: 0 auto; background: #fff; border-radius: 16px;
           box-shadow: 0 8px 28px rgba(20,40,27,0.10); overflow: hidden; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; padding: 26px 30px 22px; border-bottom: 1px solid #E6EBE7; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img { width: 44px; height: 44px; border-radius: 999px; object-fit: cover; }
  .brand-name { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; }
  .brand-sub { font-size: 11.5px; color: #6E8677; margin-top: 2px; }
  .brand-addr { font-size: 10.5px; color: #8AA093; margin-top: 3px; max-width: 260px; }
  .biz-line { font-size: 10.5px; color: #6E8677; font-weight: 600; margin-top: 8px; }
  .rt { text-align: right; flex-shrink: 0; }
  .rt-title { font-size: 19px; font-weight: 900; color: #17683C;
              text-transform: uppercase; letter-spacing: 0.5px; }
  .rt-no { font-size: 11px; color: #6E8677; margin-top: 4px;
           font-family: ui-monospace, 'Courier New', monospace; }
  .paid { display: inline-block; margin-top: 8px; padding: 4px 10px; border-radius: 999px;
          background: #E4F5EA; color: #17683C; font-size: 10.5px; font-weight: 800;
          text-transform: uppercase; letter-spacing: 0.6px; }
  .meta { padding: 20px 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
  .meta div { min-width: 0; }
  .k { font-size: 10.5px; color: #6E8677; text-transform: uppercase;
       letter-spacing: 0.5px; font-weight: 700; }
  .v { font-size: 13.5px; font-weight: 700; margin-top: 3px; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 10.5px; color: #6E8677; text-transform: uppercase;
             letter-spacing: 0.5px; text-align: left; padding: 10px 30px;
             background: #F7F9F7; border-top: 1px solid #E6EBE7;
             border-bottom: 1px solid #E6EBE7; font-weight: 700; }
  thead th.r, td.r { text-align: right; }
  td { padding: 13px 30px; border-bottom: 1px solid #F0F3F1; font-size: 13.5px; }
  td .sub { display: block; font-size: 11px; color: #6E8677; font-weight: 500; margin-top: 2px; }
  .amt { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total td { border-bottom: none; padding-top: 18px; font-size: 16px; font-weight: 900; }
  .total td.r { color: #17683C; font-size: 19px; }
  .foot { padding: 20px 30px 26px; border-top: 1px solid #E6EBE7; background: #FAFBFA; }
  .foot p { margin: 0; font-size: 11.5px; color: #6E8677; line-height: 1.6; }
  .ref { font-family: ui-monospace, 'Courier New', monospace; font-size: 10.5px;
         color: #8AA093; margin-top: 10px; word-break: break-all; }
  @media print { body { background: #fff; padding: 0; }
                 .sheet { box-shadow: none; border-radius: 0; max-width: none; } }
  @media (max-width: 520px) { .meta { grid-template-columns: 1fr; }
                              .head, .meta, td, thead th, .foot { padding-left: 18px; padding-right: 18px; } }
</style></head>
<body>
<div class="sheet">
  <div class="head">
    <div class="brand">
      ${r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="">` : ''}
      <div>
        <div class="brand-name">${esc(r.academyName)}</div>
        <div class="brand-sub">${esc(r.branchName || '')}</div>
        ${r.academyAddress ? `<div class="brand-addr">${esc(r.academyAddress)}</div>` : ''}
      </div>
    </div>
    <div class="rt">
      <div class="rt-title">Receipt</div>
      <div class="rt-no">${esc(r.receiptNo)}</div>
      <div class="rt-no">${esc(dateStr)} · ${esc(timeStr)}</div>
      <span class="paid">Paid</span>
    </div>
  </div>

  <div class="meta">
    ${meta.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}
  </div>

  <table>
    <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
    <tbody>
      ${rows.map(row => `<tr>
        <td>${esc(row.desc)}${row.sub ? `<span class="sub">${esc(row.sub)}</span>` : ''}</td>
        <td class="r amt">${inr(row.amt)}</td>
      </tr>`).join('')}
      <tr class="total">
        <td>Total paid${r.method ? ` <span class="sub">${r.paidOnline ? 'Paid online' : 'Collected at academy'} · ${esc(r.method)}</span>` : ''}</td>
        <td class="r">${inr(f.total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="foot">
    <p>Please retain this receipt for your records.</p>
    ${bizLine ? `<div class="biz-line">${esc(bizLine)}</div>` : ''}
    ${r.paymentRef ? `<div class="ref">Payment reference: ${esc(r.paymentRef)}</div>` : ''}
  </div>
</div>
</body></html>`
}

// blob: URLs are scoped to the document that created them — the embedded
// WebView the enroll-app APK runs in (no @capacitor/filesystem or
// @capacitor/share compiled into that already-shipped build, only bare
// @capacitor/core) can't hand one off to a real "download" the way a normal
// browser tab does, so the <a download> click below silently did nothing.
// A data: URL has no such scoping — Capacitor's WebView intercepts
// target=_blank / window.open navigation and routes it to the system
// browser via an Android intent (core Capacitor behavior, no plugin
// needed), where the user gets real Save/Print/Share options.
function toDataUrl(html) {
  const bytes = new TextEncoder().encode(html)
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return `data:text/html;charset=utf-8;base64,${btoa(binary)}`
}

/** Opens the receipt in a new tab (web) or the system browser (native app). */
export function viewTrialReceipt(r) {
  window.open(toDataUrl(buildTrialReceiptHTML(r)), '_blank')
}

/** Hands the receipt to the browser as a downloadable file. On the native
 * enroll-app, falls back to viewTrialReceipt() — see toDataUrl() above for why. */
export function downloadTrialReceipt(r) {
  if (Capacitor.isNativePlatform()) { viewTrialReceipt(r); return }
  const html = buildTrialReceiptHTML(r)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `Receipt-${String(r.receiptNo || 'trial').replace(/[^A-Za-z0-9-]/g, '')}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously can cancel the download on Safari/WebKit.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** Actually saves the receipt on native (enroll-app / com.khelit.app) — writes
 * it to the app cache dir and hands it to the OS Share sheet, so the user can
 * save to Files/Drive or send it via WhatsApp/email. This is the same proven
 * Filesystem+Share pattern already used for every other native download in
 * the app (see lib/nativeSave.js) — the inline iframe (setReceiptHtml in
 * TrialEnroll.jsx) only ever let the user *view* the receipt, never actually
 * save a file, since window.print() isn't implemented by Android's bare
 * WebView without extra native wiring this app doesn't have. */
export async function saveTrialReceiptNative(r) {
  const html = buildTrialReceiptHTML(r)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const filename = `Receipt-${String(r.receiptNo || 'trial').replace(/[^A-Za-z0-9-]/g, '')}.html`
  await saveOrShareFile(blob, filename)
}
