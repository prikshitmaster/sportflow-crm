// Odoo-style A4 payment receipt — the shared builder behind Payments.jsx's
// print/download flow AND the registration-time receipt slip shown right
// after Add Student collects a payment (Students.jsx). Split out of
// Payments.jsx so both can import it without creating a circular dependency
// (Payments.jsx already imports { Modal } from Students.jsx).
//
// Moved from Payments.jsx's buildReceiptHTML, with one addition: every
// interpolated value is now escaped (see esc() below) — the original never
// was, which was a latent gap even for the print-only path this came from,
// and became a real one once RegistrationReceiptModal started handing this
// same HTML to ReceiptActions' one-tap WhatsApp/Email share, i.e. actually
// leaving the app for a parent to open on another device. student.name and
// academyName are both free text a staff member types in.

// Everything interpolated below can contain a student's name, an academy
// name, or similar staff/owner-typed free text — escaped for the same
// reason lib/trialReceipt.js's esc() exists.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildReceiptHTML(p, student, academyName, logoUrl) {
  const logo     = logoUrl || ''
  const initials = esc((academyName || 'A').charAt(0).toUpperCase())
  const fmtDate  = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const today    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  // Amount breakdown logic (same as DetailModal)
  const trialMatch   = (p.notes || '').match(/Trial fee deducted[^₹]*₹([\d,]+)/)
  const joiningMatch = (p.notes || '').match(/Joining fee included[^₹]*₹([\d,]+)/)
  const trialAmt   = trialMatch   ? Number(trialMatch[1].replace(/,/g,''))  : 0
  const joiningAmt = joiningMatch ? Number(joiningMatch[1].replace(/,/g,'')) : 0
  const months     = p.monthsCovered || 1
  const baseFee    = (p.amount ?? 0) + trialAmt - joiningAmt
  const planLabel  = { monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly', custom:'Custom' }[student?.feePlan] || 'Monthly'

  const lineItems = []
  if (p.paymentType === 'trial') {
    // Trial receipts have no student, batch or fee plan — the generic
    // branch would print "Monthly Training Fee" with an empty ' · ' subtitle.
    lineItems.push({ desc: 'Trial Registration Fee', sub: p.sport || student?.sport || '', qty: '', unit: '', total: p.amount ?? 0 })
  } else {
    lineItems.push({ desc: `${planLabel} Training Fee${months > 1 ? ` × ${months} months` : ''}`, sub: `${student?.sport || ''} · ${student?.batch || ''}`, qty: months, unit: Math.round(baseFee / months), total: baseFee })
    if (trialAmt > 0)   lineItems.push({ desc: 'Trial Fee Adjustment', sub: 'Paid separately at trial — see trial receipt', qty: '', unit: '', total: -trialAmt, cls: 'red' })
    if (joiningAmt > 0) lineItems.push({ desc: 'Joining Fee', sub: 'One-time registration', qty: '', unit: '', total: joiningAmt, cls: 'purple' })
  }

  const subtotal = lineItems.reduce((s, l) => s + l.total, 0)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${esc(p.id)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; background: #fff; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; position: relative; }

  /* ── Top bar ── */
  .topbar { height: 6px; background: linear-gradient(90deg, #1d4ed8 0%, #7c3aed 100%); }

  /* ── Header ── */
  .header { display: flex; align-items: flex-start; justify-content: space-between; padding: 28px 36px 20px; border-bottom: 1px solid #e5e7eb; }
  .logo-area { display: flex; align-items: center; gap: 14px; }
  .logo-wrap { width: 52px; height: 52px; border-radius: 10px; background: #1d4ed8; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }
  .logo-wrap img { width: 100%; height: 100%; object-fit: contain; }
  .logo-init { font-size: 20px; font-weight: 900; color: #fff; }
  .acad-name { font-size: 17px; font-weight: 800; color: #111827; letter-spacing: -0.3px; }
  .acad-tag  { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .receipt-meta { text-align: right; }
  .receipt-title { font-size: 22px; font-weight: 900; color: #1d4ed8; letter-spacing: -0.5px; text-transform: uppercase; }
  .receipt-no { font-size: 11px; color: #6b7280; margin-top: 4px; font-family: 'Courier New', monospace; }
  .receipt-dates { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
  .date-row { font-size: 10px; color: #374151; }
  .date-lbl { color: #9ca3af; margin-right: 6px; }

  /* ── Two-col section: Bill To + Payment Info ── */
  .info-section { display: flex; gap: 0; padding: 20px 36px; border-bottom: 1px solid #f3f4f6; }
  .bill-to { flex: 1; padding-right: 24px; border-right: 1px solid #f3f4f6; }
  .pay-info { flex: 1; padding-left: 24px; }
  .section-label { font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .student-name { font-size: 14px; font-weight: 800; color: #111827; margin-bottom: 2px; }
  .student-sub { font-size: 11px; color: #6b7280; line-height: 1.6; }
  .pi-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #f9fafb; }
  .pi-row:last-child { border-bottom: none; }
  .pi-lbl { font-size: 10px; color: #9ca3af; }
  .pi-val { font-size: 10px; font-weight: 700; color: #374151; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
  .badge-paid { background: #dcfce7; color: #166534; }
  .badge-pending { background: #fef3c7; color: #92400e; }

  /* ── Line items table ── */
  .table-section { padding: 20px 36px; flex: 1; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #1d4ed8; }
  thead th { padding: 9px 12px; font-size: 9.5px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.8px; text-align: left; }
  thead th:last-child, thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f3f4f6; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  td { padding: 10px 12px; font-size: 10.5px; color: #374151; vertical-align: top; }
  td.r { text-align: right; }
  .item-name { font-weight: 700; color: #111827; font-size: 11px; }
  .item-sub { font-size: 9px; color: #9ca3af; margin-top: 2px; }
  .td-red { color: #dc2626; font-weight: 700; }
  .td-purple { color: #7c3aed; font-weight: 700; }

  /* ── Totals box ── */
  .totals { display: flex; justify-content: flex-end; padding: 0 36px 16px; }
  .totals-box { width: 200px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .tot-row { display: flex; justify-content: space-between; padding: 7px 14px; border-bottom: 1px solid #f3f4f6; font-size: 10.5px; }
  .tot-row:last-child { border-bottom: none; }
  .tot-lbl { color: #6b7280; }
  .tot-val { font-weight: 700; color: #111827; }
  .tot-final { background: #1d4ed8; }
  .tot-final .tot-lbl, .tot-final .tot-val { color: #fff; font-weight: 800; font-size: 12px; }

  /* ── Signature ── */
  .sig-section { display: flex; gap: 0; padding: 16px 36px; border-top: 1px solid #f3f4f6; }
  .sig-block { flex: 1; text-align: center; padding: 0 12px; }
  .sig-line { height: 36px; border-bottom: 1.5px solid #d1d5db; margin-bottom: 4px; }
  .sig-lbl { font-size: 9px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Footer ── */
  .footer { padding: 10px 36px 14px; border-top: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between; }
  .ft-msg { font-size: 9px; color: #9ca3af; }
  .ft-stamp { font-size: 9px; font-weight: 800; color: #1d4ed8; letter-spacing: 1px; text-transform: uppercase; display: flex; align-items: center; gap: 5px; }
  .ft-stamp::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #1d4ed8; }
  .bottombar { height: 4px; background: linear-gradient(90deg, #1d4ed8 0%, #7c3aed 100%); }
</style>
</head><body>
<div class="page">
  <div class="topbar"></div>

  <!-- Header -->
  <div class="header">
    <div class="logo-area">
      <div class="logo-wrap">
        ${logo ? `<img src="${esc(logo)}" />` : `<span class="logo-init">${initials}</span>`}
      </div>
      <div>
        <div class="acad-name">${esc(academyName) || 'Academy'}</div>
        <div class="acad-tag">Sports Academy · CRM</div>
      </div>
    </div>
    <div class="receipt-meta">
      <div class="receipt-title">Receipt</div>
      <div class="receipt-no">${esc(p.id) || '—'}</div>
      <div class="receipt-dates">
        <div class="date-row"><span class="date-lbl">Payment Date</span>${fmtDate(p.date)}</div>
        <div class="date-row"><span class="date-lbl">Print Date</span>${today}</div>
      </div>
    </div>
  </div>

  <!-- Bill To + Payment Info -->
  <div class="info-section">
    <div class="bill-to">
      <div class="section-label">Bill To</div>
      <div class="student-name">${esc(p.student) || '—'}</div>
      <div class="student-sub">
        ${student?.studentCode ? `ID: ${esc(student.studentCode)}<br>` : ''}
        ${student?.sport ? `${esc(student.sport)}` : ''}${student?.batch ? ` · ${esc(student.batch)}` : ''}<br>
        ${esc(student?.trainingType) || 'Regular'} Training
      </div>
    </div>
    <div class="pay-info">
      <div class="section-label">Payment Info</div>
      <div class="pi-row"><span class="pi-lbl">Status</span><span class="badge badge-${p.status === 'Paid' ? 'paid' : 'pending'}">${esc(p.status) || 'Paid'}</span></div>
      <div class="pi-row"><span class="pi-lbl">Payment Mode</span><span class="pi-val">${esc(p.mode) || 'Cash'}</span></div>
      <div class="pi-row"><span class="pi-lbl">Period Covered</span><span class="pi-val">${esc(p.month) || '—'}</span></div>
      ${months > 1 ? `<div class="pi-row"><span class="pi-lbl">Months</span><span class="pi-val">${months}</span></div>` : ''}
    </div>
  </div>

  <!-- Line items -->
  <div class="table-section">
    <table>
      <thead>
        <tr>
          <th style="width:50%">Description</th>
          <th class="r" style="width:15%">Qty</th>
          <th class="r" style="width:17%">Unit Price</th>
          <th class="r" style="width:18%">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(l => `
        <tr>
          <td><div class="item-name">${esc(l.desc)}</div>${l.sub ? `<div class="item-sub">${esc(l.sub)}</div>` : ''}</td>
          <td class="r">${l.qty !== '' ? l.qty : '—'}</td>
          <td class="r">${l.unit !== '' ? `₹${Number(l.unit).toLocaleString('en-IN')}` : '—'}</td>
          <td class="r ${l.cls === 'red' ? 'td-red' : l.cls === 'purple' ? 'td-purple' : ''}">
            ${l.cls === 'red' ? `− ₹${Math.abs(l.total).toLocaleString('en-IN')}` : `₹${l.total.toLocaleString('en-IN')}`}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Totals -->
  <div class="totals">
    <div class="totals-box">
      <div class="tot-row"><span class="tot-lbl">Subtotal</span><span class="tot-val">₹${subtotal.toLocaleString('en-IN')}</span></div>
      <div class="tot-row tot-final"><span class="tot-lbl">Total Paid</span><span class="tot-val">₹${(p.amount ?? 0).toLocaleString('en-IN')}</span></div>
    </div>
  </div>

  <!-- Signatures -->
  <div class="sig-section">
    <div class="sig-block"><div class="sig-line"></div><div class="sig-lbl">Authorised Signatory</div></div>
    <div class="sig-block"><div class="sig-line"></div><div class="sig-lbl">Parent / Guardian</div></div>
    <div class="sig-block"><div class="sig-line"></div><div class="sig-lbl">Student</div></div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="ft-msg">Thank you for your payment. Please retain this receipt for your records.</div>
    <div class="ft-stamp">Official Receipt</div>
  </div>
  <div class="bottombar"></div>
</div>
</body></html>`
}
