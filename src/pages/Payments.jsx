import { useState, useMemo, useRef, useEffect } from 'react'
import Paginator, { PAGE_SIZE } from '../components/Paginator'
import { useApp } from '../context/AppContext'
import { CreditCard, Plus, Search, CheckCircle, Clock, AlertCircle, X, Pencil, Trash2, Printer } from 'lucide-react'
import { Modal } from './Students'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { isOutstanding } from '../lib/studentRules'

// ── Payment Receipt Printer ───────────────────────────────────

function buildReceiptHTML(p, student, academyName, logoUrl) {
  const logo     = logoUrl || ''
  const fmtDate  = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
  const today    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const initials = (academyName || 'A').charAt(0).toUpperCase()

  const rows = [
    ['Receipt No.',   p.id || '—'],
    ['Student Name',  p.student || '—'],
    ['Student ID',    student?.studentCode || '—'],
    ['Sport',         student?.sport || '—'],
    ['Batch',         student?.batch || '—'],
    ['Period',        p.month || '—'],
    ['Months Covered', p.monthsCovered > 1 ? `${p.monthsCovered} months` : '1 month'],
    ['Payment Mode',  p.mode || 'Cash'],
    ['Payment Date',  fmtDate(p.date)],
    ['Receipt Date',  today],
  ]

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt — ${p.id}</title>
<style>
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1a1a2e; }
  .page { width: 148mm; min-height: 210mm; position: relative; overflow: hidden; display: flex; flex-direction: column; }

  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%); padding: 20px 24px 16px; color: #fff; display: flex; align-items: center; gap: 16px; }
  .logo-wrap { width: 60px; height: 60px; background: rgba(255,255,255,0.12); border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,0.2); flex-shrink: 0; overflow: hidden; }
  .logo-wrap img { width: 100%; height: 100%; object-fit: contain; }
  .logo-init { font-size: 22px; font-weight: 900; color: rgba(255,255,255,0.75); }
  .acad-name { font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
  .acad-sub { font-size: 9px; color: rgba(255,255,255,0.5); margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }

  .title-band { background: #16a34a; padding: 7px 24px; display: flex; align-items: center; justify-content: space-between; }
  .band-title { color: #fff; font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .band-inv { color: rgba(255,255,255,0.8); font-size: 10px; font-family: monospace; }

  .body { flex: 1; padding: 20px 24px; }

  .info-box { border: 1.5px solid #e8eaf0; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
  .info-box-hd { background: #f5f6fa; padding: 5px 14px; font-size: 8.5px; font-weight: 700; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; border-bottom: 1px solid #e8eaf0; }
  .row { display: flex; border-bottom: 1px solid #f0f0f5; }
  .row:last-child { border-bottom: none; }
  .lbl { width: 110px; padding: 7px 14px; font-size: 9.5px; color: #6b7280; font-weight: 600; background: #fafafa; border-right: 1px solid #f0f0f5; flex-shrink: 0; display: flex; align-items: center; }
  .val { flex: 1; padding: 7px 14px; font-size: 10.5px; font-weight: 700; color: #1a1a2e; display: flex; align-items: center; }

  .amt-box { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 1.5px solid #86efac; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
  .amt-lbl { font-size: 9px; color: #166534; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }
  .amt-val { font-size: 26px; font-weight: 900; color: #15803d; }
  .paid-badge { background: #15803d; color: #fff; font-size: 10px; font-weight: 900; padding: 4px 14px; border-radius: 20px; letter-spacing: 1px; }

  .sig-row { display: flex; gap: 14px; margin-bottom: 10px; }
  .sig-block { flex: 1; text-align: center; }
  .sig-space { height: 32px; border-bottom: 1.5px solid #374151; margin-bottom: 3px; }
  .sig-lbl { font-size: 8.5px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

  .footer { background: #1a1a2e; padding: 7px 24px; display: flex; align-items: center; justify-content: space-between; }
  .ft-txt { font-size: 8px; color: rgba(255,255,255,0.4); }
  .ft-official { font-size: 8px; color: #4ade80; font-weight: 700; letter-spacing: 1px; }

  .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 72px; font-weight: 900; color: rgba(0,0,0,0.025); pointer-events: none; white-space: nowrap; z-index: 0; text-transform: uppercase; }
</style>
</head><body>
<div class="page">
  <div class="watermark">${(academyName || '').split(' ')[0]}</div>

  <div class="header">
    <div class="logo-wrap">
      ${logo ? `<img src="${logo}" />` : `<span class="logo-init">${initials}</span>`}
    </div>
    <div>
      <div class="acad-name">${academyName || 'Academy'}</div>
      <div class="acad-sub">Payment Receipt</div>
    </div>
  </div>

  <div class="title-band">
    <span class="band-title">Payment Receipt</span>
    <span class="band-inv">${p.id || '—'}</span>
  </div>

  <div class="body">
    <div class="info-box">
      <div class="info-box-hd">Payment Details</div>
      ${rows.map(([l, v]) => `
      <div class="row">
        <div class="lbl">${l}</div>
        <div class="val">${v}</div>
      </div>`).join('')}
    </div>

    <div class="amt-box">
      <div>
        <div class="amt-lbl">Amount Received</div>
        <div class="amt-val">₹${(p.amount ?? 0).toLocaleString('en-IN')}</div>
      </div>
      <div class="paid-badge">PAID</div>
    </div>

    <div class="sig-row">
      <div class="sig-block"><div class="sig-space"></div><div class="sig-lbl">Received By</div></div>
      <div class="sig-block"><div class="sig-space"></div><div class="sig-lbl">Parent / Guardian</div></div>
    </div>
  </div>

  <div class="footer">
    <span class="ft-txt">Thank you for your payment. Please retain this receipt.</span>
    <span class="ft-official">OFFICIAL RECEIPT</span>
  </div>
</div>
</body></html>`
}

function printReceipt(p, student, academyName, logoUrl) {
  const html = buildReceiptHTML(p, student, academyName, logoUrl)
  const w = window.open('', '_blank', 'width=600,height=850')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}

const STATUS_MAP = {
  Paid:    { cls: 'badge-green',  icon: CheckCircle, iconCls: 'text-emerald-500' },
  Pending: { cls: 'badge-yellow', icon: Clock,       iconCls: 'text-amber-500' },
  Overdue: { cls: 'badge-red',    icon: AlertCircle, iconCls: 'text-red-500' },
}

export default function Payments() {
  const { payments, students, batches, feePlans, addPayment, markPaymentPaid, removePayment, updatePaymentDate, selectedSport, selectedBranch, user } = useApp()
  const [editingDate, setEditingDate] = useState(null) // paymentId being edited
  const [markingPaid, setMarkingPaid] = useState(null) // paymentId currently being marked Paid
  const [deleteTarget, setDeleteTarget] = useState(null) // payment pending deletion
  const [deleteNote,   setDeleteNote]   = useState('')
  const [deleting,     setDeleting]     = useState(false)

  const handleMarkPaid = async (id) => {
    if (markingPaid) return
    setMarkingPaid(id)
    try { await markPaymentPaid(id, 'UPI') }
    finally { setMarkingPaid(null) }
  }

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('All')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
  const [monthFilter,     setMonthFilter]     = useState(new Date().toISOString().slice(0, 7))
  const [showModal,       setShowModal]       = useState(false)
  const [payForStudent,   setPayForStudent]   = useState(null)
  const [detailPayment,   setDetailPayment]   = useState(null)
  const [page,            setPage]            = useState(1)

  const now          = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

  // Build studentId → student lookup for filter joins
  const studentMap = useMemo(() => {
    const m = {}
    students.forEach(s => { m[s.id] = s })
    return m
  }, [students])

  const sportOptions = useMemo(() =>
    [...new Set(students.map(s => s.sport).filter(Boolean))].sort()
  , [students])

  // Build last 8 months of real collected revenue from actual Paid payments
  const revenueData = useMemo(() => {
    const months = []
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-IN', { month: 'short' })
      months.push({ key, month: label, revenue: 0 })
    }
    payments.filter(p => p.status === 'Paid' && p.date).forEach(p => {
      const key = p.date.slice(0, 7)
      const m = months.find(m => m.key === key)
      if (m) m.revenue += p.amount ?? 0
    })
    return months
  }, [payments])

  // Virtual overdue rows: active students with an expired paid_till and no pending payment already recorded
  const overdueRows = useMemo(() => {
    const studentsWithPendingRecord = new Set(
      payments.filter(p => p.status === 'Overdue' || p.status === 'Pending').map(p => p.studentId)
    )
    return students
      .filter(s => isOutstanding(s, firstOfMonth) && !studentsWithPendingRecord.has(s.id))
      .map(s => ({
        id:          `DUE-${s.id}`,
        studentId:   s.id,
        student:     s.name,
        amount:      s.fees || 0,
        month:       `Due — paid till ${new Date(s.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
        date:        null,
        status:      'Overdue',
        mode:        null,
        isVirtual:   true,
        isSuspended: s.status === 'Suspended',
      }))
  }, [students, payments, firstOfMonth])

  const allRecords = useMemo(() => [...overdueRows, ...payments], [overdueRows, payments])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [statusFilter, sportFilter, batchFilter, monthFilter])

  // Clear batch/sport filters when the owner switches sport or branch so stale
  // filter values don't hide all payments in the new scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setBatchFilter('All'); setSportFilter('All') }, [selectedSport, selectedBranch])

  const filtered = allRecords.filter(p => {
    const q       = search.toLowerCase()
    const matchQ  = !q || (p.student || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q)
    const matchS  = statusFilter === 'All' || p.status === statusFilter
    const stu     = studentMap[p.studentId]
    const matchSport = sportFilter === 'All' || stu?.sport === sportFilter
    const matchBatch = batchFilter === 'All' || stu?.batch === batchFilter || String(stu?.batchId) === batchFilter
    const matchMonth = !monthFilter || p.isVirtual || (p.date && p.date.slice(0, 7) === monthFilter)
    return matchQ && matchS && matchSport && matchBatch && matchMonth
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Summary cards — filter by selected month when active
  const paidBase    = monthFilter
    ? payments.filter(p => p.status === 'Paid'    && p.date?.slice(0,7) === monthFilter)
    : payments.filter(p => p.status === 'Paid')
  const pendingBase = monthFilter
    ? payments.filter(p => p.status === 'Pending' && p.date?.slice(0,7) === monthFilter)
    : payments.filter(p => p.status === 'Pending')
  // Overdue is always all-time — not filtered by month
  const overdueBase  = [...payments.filter(p => p.status === 'Overdue'), ...overdueRows]

  const paid         = paidBase.reduce((s, p) => s + (p.amount ?? 0), 0)
  const pending      = pendingBase.reduce((s, p) => s + (p.amount ?? 0), 0)
  const overdueAmt   = overdueBase.reduce((s, p) => s + (p.amount ?? 0), 0)
  const overdueCount = overdueBase.length

  const monthLabel = monthFilter
    ? new Date(monthFilter + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : null

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Payments</h2>
          <p className="text-sm text-gray-500">Track fees, generate receipts, manage collections</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Record Payment
        </button>
      </div>

      {/* Summary cards */}
      {monthLabel && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-brand-600 bg-brand-50 border border-brand-100 px-3 py-1 rounded-full">
            Showing: {monthLabel}
          </span>
          <button onClick={() => setMonthFilter('')} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition">
            <X size={12} /> Clear
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Collected" value={`₹${paid.toLocaleString('en-IN')}`} count={paidBase.length} color="emerald" period={monthLabel} />
        <SummaryCard label="Pending"   value={`₹${pending.toLocaleString('en-IN')}`} count={pendingBase.length} color="amber" period={monthLabel} />
        <SummaryCard label="Overdue"   value={`₹${overdueAmt.toLocaleString('en-IN')}`} count={overdueCount} color="red" period={monthLabel} />
      </div>

      {/* Revenue chart */}
      <div className="card p-5">
        <h3 className="font-bold text-gray-900 mb-4">Monthly Revenue (₹)</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={revenueData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, '']} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            <Bar dataKey="revenue" fill="#2563eb" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Row 1: search + month picker + status pills */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-48">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
              placeholder="Search by student or invoice..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input type="month" className="input w-auto text-xs"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              title="Filter by month"
            />
            {monthFilter && (
              <button onClick={() => setMonthFilter('')} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 transition">
                <X size={12} />
              </button>
            )}
          </div>
          {['All','Paid','Pending','Overdue'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition ${statusFilter===s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {s}
            </button>
          ))}
        </div>
        {/* Row 2: Sport + Batch dropdowns */}
        <div className="flex flex-wrap gap-3 items-center">
          {selectedSport === 'All' && (
            <select className="input w-auto" value={sportFilter}
              onChange={e => { setSportFilter(e.target.value); setBatchFilter('All') }}>
              <option value="All">All Sports</option>
              {sportOptions.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
          <select className="input w-auto" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="All">All Batches</option>
            {batches.map(b => <option key={b.id} value={String(b.id)}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
          </select>
          {(batchFilter !== 'All' || (selectedSport === 'All' && sportFilter !== 'All')) && (
            <button onClick={() => { setSportFilter('All'); setBatchFilter('All') }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition font-medium">
              <X size={12} /> Clear filters
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Invoice', 'Student', 'Month', 'Amount', 'Mode', 'Date', 'Status', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged.map(p => {
                const sm = STATUS_MAP[p.status] || STATUS_MAP.Overdue
                return (
                  <tr key={p.id} className={`group hover:bg-gray-50/60 transition cursor-pointer ${p.isVirtual ? 'bg-red-50/30' : ''}`}
                    onClick={() => !p.isVirtual && setDetailPayment({ payment: p, student: studentMap[p.studentId] })}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.isVirtual ? '—' : p.id}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {p.student}
                      {p.isSuspended && <span className="ml-2 text-[10px] font-bold bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">Suspended</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.month}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">₹{(p.amount ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.mode || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {!p.isVirtual && editingDate === p.id ? (
                        <input
                          type="date"
                          className="input py-0.5 px-1.5 text-xs w-36"
                          defaultValue={p.date || ''}
                          max={new Date().toISOString().split('T')[0]}
                          autoFocus
                          onBlur={async (e) => {
                            if (e.target.value && e.target.value !== p.date) {
                              await updatePaymentDate(p.id, e.target.value)
                            }
                            setEditingDate(null)
                          }}
                          onKeyDown={e => { if (e.key === 'Escape') setEditingDate(null) }}
                        />
                      ) : (
                        <span className="flex items-center gap-1 group/date">
                          {p.date || '—'}
                          {!p.isVirtual && (
                            <button
                              onClick={() => setEditingDate(p.id)}
                              className="opacity-0 group-hover/date:opacity-100 transition p-0.5 rounded hover:bg-gray-100"
                              title="Edit date"
                            >
                              <Pencil size={10} className="text-gray-400" />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${sm.cls}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      {p.isVirtual ? (
                        <button
                          className="text-xs text-red-600 font-semibold hover:underline"
                          onClick={() => setPayForStudent(studentMap[p.studentId])}
                        >
                          Record Payment
                        </button>
                      ) : p.status !== 'Paid' ? (
                        <button
                          className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleMarkPaid(p.id)}
                          disabled={markingPaid === p.id}
                        >
                          {markingPaid === p.id ? 'Marking…' : 'Mark Paid'}
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => printReceipt(p, studentMap[p.studentId], user?.academy, user?.academyLogo)}
                            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                            <Printer size={12} /> Receipt
                          </button>
                          <button
                            onClick={() => { setDeleteTarget(p); setDeleteNote('') }}
                            className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition"
                            title="Delete payment"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100">
          <Paginator page={page} total={filtered.length} onChange={setPage} />
        </div>
      </div>

      {showModal && (
        <RecordPaymentModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addPayment(data); setShowModal(false) }}
          students={students}
          batches={batches}
          feePlans={feePlans}
          payments={payments}
        />
      )}
      {payForStudent && (
        <RecordPaymentModal
          onClose={() => setPayForStudent(null)}
          onSave={async (data) => { await addPayment(data); setPayForStudent(null) }}
          students={students}
          batches={batches}
          feePlans={feePlans}
          payments={payments}
          initialStudentId={payForStudent.id}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Trash2 size={18} className="text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm">Delete Payment</h3>
                  <p className="text-xs text-gray-400">This cannot be undone</p>
                </div>
              </div>
              <button onClick={() => !deleting && setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={15} />
              </button>
            </div>

            {/* Payment summary */}
            <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Invoice</span><span className="font-mono font-semibold text-gray-800">{deleteTarget.id}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Student</span><span className="font-semibold text-gray-800">{deleteTarget.student}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold text-gray-900">₹{deleteTarget.amount?.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Month</span><span className="text-gray-700">{deleteTarget.month}</span></div>
            </div>

            {/* Warning */}
            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4">
              <span className="text-amber-500 text-sm flex-shrink-0">⚠</span>
              <p className="text-xs text-amber-800">Deleting this will revert the student's payment status to the previous record.</p>
            </div>

            {/* Reason / notes */}
            <div className="mb-5">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reason for deletion <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea
                value={deleteNote}
                onChange={e => setDeleteNote(e.target.value)}
                placeholder="e.g. Entered wrong amount, duplicate entry…"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none placeholder-gray-400"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="btn-secondary flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try { await removePayment(deleteTarget) }
                  finally { setDeleting(false); setDeleteTarget(null); setDeleteNote('') }
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50"
              >
                {deleting
                  ? <><svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Deleting…</>
                  : <><Trash2 size={13}/> Delete Payment</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {detailPayment && (
        <PaymentDetailModal
          payment={detailPayment.payment}
          student={detailPayment.student}
          onClose={() => setDetailPayment(null)}
          onPrint={() => printReceipt(detailPayment.payment, detailPayment.student, user?.academy, user?.academyLogo)}
        />
      )}
    </div>
  )
}

function PaymentDetailModal({ payment: p, student, onClose, onPrint }) {
  const fmtDate   = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const planLabel = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom' }

  // Parse amounts from notes
  const trialMatch   = (p.notes || '').match(/Trial fee deducted[^₹]*₹([\d,]+)/)
  const joiningMatch = (p.notes || '').match(/Joining fee included[^₹]*₹([\d,]+)/)
  const trialAmt   = trialMatch   ? Number(trialMatch[1].replace(/,/g, ''))   : 0
  const joiningAmt = joiningMatch ? Number(joiningMatch[1].replace(/,/g, '')) : 0
  const hasBreakdown = trialAmt > 0 || joiningAmt > 0
  const baseFee = hasBreakdown ? (p.amount ?? 0) + trialAmt - joiningAmt : (p.amount ?? 0)

  const infoRow = (label, value, cls) => value ? (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-sm font-semibold ${cls || 'text-gray-800'}`}>{value}</span>
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="font-bold text-gray-900 text-base">{p.student}</p>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{p.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onPrint} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 transition">
              <Printer size={13} /> Receipt
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition"><X size={16} /></button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Amount breakdown */}
          <div className="rounded-xl border border-emerald-100 overflow-hidden">
            <div className="bg-emerald-600 px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-black text-white uppercase tracking-widest">Payment Breakdown</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.status === 'Paid' ? 'bg-white text-emerald-700' : 'bg-amber-400 text-white'}`}>{p.status}</span>
            </div>
            <div className="bg-white px-4 py-3 space-y-1 text-sm">
              {hasBreakdown ? (<>
                <div className="flex justify-between text-gray-600">
                  <span>{planLabel[student?.feePlan] || 'Base'} Fee
                    {(p.monthsCovered > 1) && <span className="text-xs text-gray-400 ml-1">× {p.monthsCovered} months</span>}
                  </span>
                  <span className="font-semibold">₹{baseFee.toLocaleString('en-IN')}</span>
                </div>
                {trialAmt > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Trial Fee Deduction</span>
                    <span className="font-bold">− ₹{trialAmt.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {joiningAmt > 0 && (
                  <div className="flex justify-between text-purple-600">
                    <span>Joining Fee</span>
                    <span className="font-bold">+ ₹{joiningAmt.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-gray-900 border-t border-gray-100 pt-2 mt-1 text-base">
                  <span>Total Paid</span>
                  <span className="text-emerald-700">₹{(p.amount ?? 0).toLocaleString('en-IN')}</span>
                </div>
              </>) : (
                <div className="flex justify-between font-black text-gray-900 text-base">
                  <span>{planLabel[student?.feePlan] || 'Monthly'} Fee
                    {(p.monthsCovered > 1) && <span className="text-xs font-normal text-gray-400 ml-1">× {p.monthsCovered} months</span>}
                  </span>
                  <span className="text-emerald-700">₹{(p.amount ?? 0).toLocaleString('en-IN')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment details */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Payment Info</p>
            {infoRow('Coverage', p.month)}
            {infoRow('Mode', p.mode || 'Cash')}
            {infoRow('Paid Date', fmtDate(p.date))}
          </div>

          {/* Student details */}
          {student && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Student</p>
              {infoRow('Sport', student.sport)}
              {infoRow('Batch', student.batch)}
              {infoRow('Training', student.trainingType)}
              {infoRow('Fee Plan', planLabel[student.feePlan] || student.feePlan)}
              {student.fromTrial && infoRow('Source', 'Converted from Trial', 'text-amber-600')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, count, color, period }) {
  const c = { emerald: 'text-emerald-600 bg-emerald-50', amber: 'text-amber-600 bg-amber-50', red: 'text-red-600 bg-red-50' }[color]
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-black ${c.split(' ')[0]}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{count} {count === 1 ? 'payment' : 'payments'}{period ? ` · ${period}` : ''}</p>
    </div>
  )
}

export function RecordPaymentModal({ onClose, onSave, students, batches = [], feePlans = [], payments = [], initialStudentId }) {
  const initStudent = initialStudentId
    ? (students.find(s => s.id === initialStudentId) || {})
    : {}
  const [form, setForm] = useState({
    studentId:   initStudent.id       || '',
    student:     initStudent.name     || '',
    baseAmount:  initStudent.fees     || 0,
    paymentType: initStudent.feePlan  || 'monthly',
    discountPct: 0,
    batchId:     String(initStudent.batchId || initStudent.lastBatchId || ''),
    batchName:   initStudent.batch || initStudent.lastBatchName || '',
    mode:        'UPI',
    notes:       '',
  })
  const [loading,        setLoading]       = useState(false)
  const [studentSearch,  setStudentSearch] = useState(initStudent.name || '')
  const [showDropdown,   setShowDropdown]  = useState(false)
  const [amountOverride, setAmountOverride] = useState(null)
  const [paymentDate,    setPaymentDate]   = useState(new Date().toISOString().split('T')[0])
  const [customMonths,   setCustomMonths]  = useState(2)
  const [lateFee,        setLateFee]       = useState(0)
  const [showLateFee,    setShowLateFee]   = useState(false)
  // Required when amount is >30% off the expected total — staff must type CONFIRM
  const [confirmText,    setConfirmText]   = useState('')

  const months = form.paymentType === 'quarterly' ? 3
               : form.paymentType === 'yearly'    ? 12
               : form.paymentType === 'custom'    ? customMonths
               : 1
  // monthly & custom: fee × months; quarterly/yearly: entered amount is the flat total
  const subtotal    = (form.paymentType === 'monthly' || form.paymentType === 'custom')
    ? form.baseAmount * months
    : form.baseAmount
  const discountAmt = Math.round(subtotal * form.discountPct / 100)
  const lateFeeAmt  = Number(lateFee) || 0
  const calcAmount  = subtotal - discountAmt + lateFeeAmt
  const finalAmount = amountOverride !== null ? amountOverride : calcAmount

  const filteredStudents = studentSearch
    ? students.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
    : students

  const getFeePlanRate = (batchId, trainingType, paymentType) => {
    // 1. Named fee plan for batch + training type
    const batchPlans = feePlans.filter(p => String(p.batchId) === String(batchId))
    // Only fall back to first plan if trainingType matches, or there's exactly one plan (no ambiguity).
    const plan = batchPlans.find(p => p.trainingType === trainingType)
              || (batchPlans.length === 1 ? batchPlans[0] : null)
    if (plan) {
      const rate = paymentType === 'quarterly' ? plan.quarterlyFee
                 : paymentType === 'yearly'    ? plan.yearlyFee
                 : plan.monthlyFee
      return { plan, rate: rate || 0, source: 'plan' }
    }
    // 2. Fallback: batch default fee (only meaningful for monthly; skip for quarterly/yearly)
    const batch = batches.find(b => String(b.id) === String(batchId))
    if (batch?.defaultFee > 0 && paymentType === 'monthly') {
      return {
        plan: { name: batch.name, trainingType: null, monthlyFee: batch.defaultFee, quarterlyFee: 0, yearlyFee: 0 },
        rate: batch.defaultFee,
        source: 'batch',
      }
    }
    return null
  }

  const handleStudentChange = (id) => {
    const s = students.find(x => String(x.id) === String(id))
    if (!s) return
    setAmountOverride(null)
    const batchId = String(s.batchId || s.lastBatchId || '')
    const paymentType = s.feePlan || 'monthly'
    const planData = getFeePlanRate(batchId, s.trainingType, paymentType)
    setForm(f => ({
      ...f,
      studentId:   s.id,
      student:     s.name,
      baseAmount:  planData?.rate ?? s.fees ?? 0,
      paymentType,
      batchId,
      batchName:   s.batch || s.lastBatchName || '',
    }))
  }

  const handleBatchChange = (id) => {
    const b = batches.find(x => String(x.id) === String(id))
    setForm(f => ({ ...f, batchId: id, batchName: b?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.studentId || finalAmount <= 0) return
    setLoading(true)
    try {
      await onSave({ ...form, amount: finalAmount, monthsCovered: months, lateFee: lateFeeAmt, paymentDate, advanceStart })
    } finally {
      setLoading(false)
    }
  }

  const selectedStudent = students.find(s => String(s.id) === String(form.studentId))
  const isSuspended = selectedStudent?.status === 'Suspended'

  // Advance payment: student is up-to-date, coverage should start after their current paidTill
  const _now = new Date()
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
  const firstOfMonth = todayStr.slice(0, 7) + '-01'
  const isUpToDate = !isSuspended && selectedStudent?.paidTill && selectedStudent.paidTill >= firstOfMonth
  const advanceStart = isUpToDate
    ? (() => {
        const [yr, mo] = selectedStudent.paidTill.split('-').map(Number)
        // Build string directly to avoid toISOString() UTC rollback in IST (UTC+5:30)
        const nextMo = mo === 12 ? 1 : mo + 1
        const nextYr = mo === 12 ? yr + 1 : yr
        return `${nextYr}-${String(nextMo).padStart(2, '0')}-01`
      })()
    : null

  // Mismatch warnings
  const PLAN_LABELS = { daily: 'Daily', alternate: 'Alternate Day', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', custom: 'Custom' }
  const studentPlan = selectedStudent?.feePlan || 'monthly'
  const planMismatch = form.studentId && selectedStudent && !isSuspended
    && form.paymentType !== studentPlan
    && !['custom'].includes(form.paymentType)
    && !['custom'].includes(studentPlan)
  // Amount looks like a different plan's multiple
  const monthlyFee = selectedStudent?.fees || 0
  const amountMismatch = form.studentId && form.paymentType === 'monthly' && monthlyFee > 0
    && (finalAmount === monthlyFee * 3 || finalAmount === monthlyFee * 12)
  const amountMismatchMsg = finalAmount === monthlyFee * 3
    ? `Amount ₹${finalAmount.toLocaleString('en-IN')} = 3 months — did you mean Quarterly?`
    : `Amount ₹${finalAmount.toLocaleString('en-IN')} = 12 months — did you mean Yearly?`

  // Fee plan for selected student's batch + training type
  const activePlanData = form.studentId
    ? getFeePlanRate(form.batchId, selectedStudent?.trainingType, form.paymentType)
    : null

  // Fallback reference: median fee of other students in same batch
  const batchmateFees = form.studentId
    ? students
        .filter(s => {
          if (String(s.id) === String(form.studentId)) return false
          if ((s.fees || 0) <= 0) return false
          // Match by batchId FK when available, else fall back to batch name string
          if (form.batchId && String(form.batchId) !== '')
            return String(s.batchId || s.lastBatchId || '') === String(form.batchId)
          if (form.batchName && form.batchName !== '')
            return (s.batch || s.lastBatchName || '') === form.batchName
          return false
        })
        .map(s => s.fees)
        .sort((a, b) => a - b)
    : []
  const typicalBatchFee = batchmateFees.length > 0
    ? batchmateFees[Math.floor(batchmateFees.length / 2)]
    : 0



  const planExpectedRate = activePlanData?.rate || 0
  const referenceRate = planExpectedRate || typicalBatchFee
  const feePlanMismatch = !!(
    form.studentId &&
    referenceRate > 0 &&
    form.baseAmount !== referenceRate &&
    !['custom'].includes(form.paymentType) &&
    // Only warn if entered amount is >20% off the reference
    Math.abs(form.baseAmount - referenceRate) / referenceRate > 0.20
  )

  // Recent payments timeline — show this student's last 3 payments so staff
  // can spot duplicates / wrong-month entries visually before saving.
  const studentRecentPayments = form.studentId
    ? payments
        .filter(p => String(p.studentId) === String(form.studentId))
        .slice()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 3)
    : []

  // Sanity check — block save if amount is >30% off the expected total.
  // Catches typos (₹800 vs ₹8,000) and wrong-plan amounts that the soft
  // warnings above let through. Custom plan and plans without a reference
  // rate are excluded since we can't reliably compute "expected".
  const expectedSubtotal = (form.paymentType === 'monthly' || form.paymentType === 'custom')
    ? referenceRate * months
    : referenceRate
  const expectedTotal = expectedSubtotal - Math.round(expectedSubtotal * form.discountPct / 100) + lateFeeAmt
  const sanityMismatch = !!(
    form.studentId &&
    referenceRate > 0 &&
    expectedTotal > 0 &&
    form.paymentType !== 'custom' &&
    Math.abs(finalAmount - expectedTotal) / expectedTotal > 0.30
  )
  const sanityRatio = sanityMismatch ? (finalAmount / expectedTotal) : 1

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const coverageBase = advanceStart ? new Date(advanceStart + 'T00:00:00') : new Date(paymentDate + 'T00:00:00')

  // Duplicate guard: paidTill already covers the start of the new coverage period
  const coverageStartStr = `${coverageBase.getFullYear()}-${String(coverageBase.getMonth() + 1).padStart(2, '0')}-01`
  const isDuplicate = !!(form.studentId && selectedStudent?.paidTill && selectedStudent.paidTill >= coverageStartStr)
  // CONFIRM gate covers BOTH soft duplicate (paidTill already covers this period) and sanity mismatch.
  // Without this, the duplicate warning was visual-only — server-side 60s dedupe only catches rapid double-clicks.
  const confirmTyped = confirmText.trim().toUpperCase() === 'CONFIRM'
  const confirmOk = (!sanityMismatch && !isDuplicate) || confirmTyped
  const coverageEnd  = new Date(coverageBase.getFullYear(), coverageBase.getMonth() + months, 0)
  const coverageLabel = months === 1
    ? `${MO[coverageBase.getMonth()]} ${coverageBase.getFullYear()}`
    : `${MO[coverageBase.getMonth()]}–${MO[coverageEnd.getMonth()]} ${
        coverageBase.getFullYear() === coverageEnd.getFullYear()
          ? coverageBase.getFullYear()
          : `${coverageBase.getFullYear()}/${String(coverageEnd.getFullYear()).slice(2)}`
      }`

  const PLAN_OPTS = [
    { key: 'monthly',   label: 'Monthly',   sub: '1 month'    },
    { key: 'quarterly', label: 'Quarterly', sub: '3 months'   },
    { key: 'yearly',    label: 'Yearly',    sub: '12 months'  },
    { key: 'custom',    label: 'Custom',    sub: 'any months' },
  ]

  const feeLabel = {
    monthly:   'Monthly Fee (₹)',
    quarterly: 'Quarterly Fee (₹)',
    yearly:    'Yearly Fee (₹)',
    custom:    'Monthly Fee (₹)',
  }[form.paymentType] || 'Fee (₹)'

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div className="space-y-4">

        {/* Student */}
        <div className="relative">
          <label className="label">Student</label>
          <input
            className="input"
            placeholder="Type to search student…"
            value={studentSearch}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            onChange={e => {
              setStudentSearch(e.target.value)
              setShowDropdown(true)
              setAmountOverride(null)
              setForm(f => ({ ...f, studentId: '', student: '', baseAmount: 0 }))
            }}
          />
          {showDropdown && filteredStudents.length > 0 && (
            <div className="absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
              {filteredStudents.slice(0, 10).map(s => (
                <button
                  key={s.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-brand-50 text-sm flex items-center justify-between gap-2 transition-colors first:rounded-t-xl last:rounded-b-xl"
                  onMouseDown={() => {
                    handleStudentChange(s.id)
                    setStudentSearch(s.name)
                    setShowDropdown(false)
                  }}
                >
                  <span className="font-medium text-gray-800">{s.name}</span>
                  <span className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
                    {s.status === 'Suspended' && <span className="text-amber-600 font-semibold">Suspended</span>}
                    {s.trainingType === 'Alternate' && <span>Alt</span>}
                    {s.batch && <span>{s.batch}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {isSuspended && (
            <p className="text-xs text-amber-600 mt-1 font-semibold">
              ⚠ Suspended — payment will reactivate this student.
            </p>
          )}
          {isUpToDate && (
            <div className="mt-2 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-brand-700">
              Paid till <strong>{new Date(selectedStudent.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</strong>
              {' '}· Advance payment starting <strong>{new Date(advanceStart + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</strong>
            </div>
          )}
          {planMismatch && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-start gap-1.5">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <span>
                Student's plan is <strong>{PLAN_LABELS[studentPlan]}</strong> but you selected <strong>{PLAN_LABELS[form.paymentType]}</strong> — are you sure?
              </span>
            </div>
          )}
          {isDuplicate && (
            <div className="mt-2 bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-700 flex items-start gap-1.5">
              <span className="text-base leading-none mt-0.5">🚫</span>
              <span>
                <strong>Possible duplicate</strong> — {form.student} is already paid through <strong>{new Date(selectedStudent.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</strong>.
                Add a note below if this is intentional.
              </span>
            </div>
          )}
          {form.studentId && studentRecentPayments.length > 0 && (
            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                Last {studentRecentPayments.length} payment{studentRecentPayments.length === 1 ? '' : 's'}
              </p>
              <div className="space-y-1">
                {studentRecentPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">
                      <span className="font-mono text-[10px] text-gray-400 mr-1.5">{p.id}</span>
                      <span className="font-semibold">{p.month}</span>
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="text-gray-500">{p.date}</span>
                      {p.mode && <><span className="text-gray-400 mx-1">·</span><span className="text-gray-500">{p.mode}</span></>}
                    </span>
                    <span className="font-bold text-gray-800">₹{Number(p.amount || 0).toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Payment plan pills */}
        <div>
          <label className="label">Payment Plan</label>
          <div className="grid grid-cols-4 gap-2">
            {PLAN_OPTS.map(pt => (
              <button key={pt.key} type="button"
                onClick={() => {
                  setAmountOverride(null)
                  const planData = getFeePlanRate(form.batchId, selectedStudent?.trainingType, pt.key)
                  setForm(f => ({ ...f, paymentType: pt.key, baseAmount: planData?.rate ?? f.baseAmount }))
                }}
                className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                  form.paymentType === pt.key
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div>{pt.label}</div>
                <div className={`font-normal mt-0.5 ${form.paymentType === pt.key ? 'text-brand-200' : 'text-gray-400'}`}>{pt.sub}</div>
              </button>
            ))}
          </div>
          {form.paymentType === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">Number of months:</label>
              <input
                className="input w-24 text-center font-bold"
                type="number" min="1" max="36"
                value={customMonths}
                onChange={e => { setCustomMonths(Math.max(1, Number(e.target.value))); setAmountOverride(null) }}
              />
            </div>
          )}
        </div>

        {/* Fee plan / batch reference info */}
        {(activePlanData || typicalBatchFee > 0) && (
          <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-brand-700 flex items-center justify-between gap-2">
            {activePlanData ? (
              activePlanData.source === 'plan' ? (
                <span>
                  <span className="font-semibold">{activePlanData.plan.name}</span>
                  <span className="text-brand-400 mx-1.5">·</span>
                  {activePlanData.plan.trainingType === 'alternate' ? 'Alternate Day' : 'Daily'}
                  <span className="text-brand-400 mx-1.5">·</span>
                  M ₹{activePlanData.plan.monthlyFee?.toLocaleString('en-IN')}
                  {activePlanData.plan.quarterlyFee > 0 && <> · Q ₹{activePlanData.plan.quarterlyFee?.toLocaleString('en-IN')}</>}
                  {activePlanData.plan.yearlyFee > 0 && <> · Y ₹{activePlanData.plan.yearlyFee?.toLocaleString('en-IN')}</>}
                </span>
              ) : (
                <span>Batch default: <span className="font-semibold">₹{activePlanData.plan.monthlyFee?.toLocaleString('en-IN')}/month</span></span>
              )
            ) : (
              <span>
                Other students in this batch pay <span className="font-semibold">₹{typicalBatchFee.toLocaleString('en-IN')}/month</span>
                <span className="text-brand-400 ml-1">({batchmateFees.length} students)</span>
              </span>
            )}
            <button type="button"
              className="text-brand-600 font-bold hover:underline whitespace-nowrap"
              onClick={() => { setAmountOverride(null); setForm(f => ({ ...f, baseAmount: referenceRate })) }}>
              Use this rate
            </button>
          </div>
        )}

        {/* Fee amount + discount */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{feeLabel}</label>
            <input className={`input ${feePlanMismatch ? 'border-amber-400 focus:border-amber-400' : ''}`} type="number" min="0" value={form.baseAmount}
              onChange={e => { setAmountOverride(null); setForm(f => ({ ...f, baseAmount: Number(e.target.value) })) }} />
            {feePlanMismatch && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-amber-600">⚠ Expected ₹{referenceRate.toLocaleString('en-IN')}</p>
                <button type="button" className="text-xs text-amber-700 font-bold hover:underline"
                  onClick={() => { setAmountOverride(null); setForm(f => ({ ...f, baseAmount: referenceRate })) }}>
                  Fix
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="label">Discount (%)</label>
            <input className="input" type="number" min="0" max="100" value={form.discountPct}
              onChange={e => setForm(f => ({ ...f, discountPct: Number(e.target.value) }))} />
          </div>
        </div>

        {/* Late fee */}
        {!showLateFee ? (
          <button type="button" onClick={() => setShowLateFee(true)}
            className="text-xs text-brand-600 font-semibold hover:underline">
            + Add Late Fee
          </button>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Late Fee (₹)</label>
              <input className="input" type="number" min="0" value={lateFee}
                onChange={e => { setLateFee(Number(e.target.value)); setAmountOverride(null) }} />
            </div>
            <button type="button"
              onClick={() => { setShowLateFee(false); setLateFee(0); setAmountOverride(null) }}
              className="mb-1 p-2 text-gray-400 hover:text-red-500 transition">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Amount breakdown */}
        <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
          {form.studentId && (
            <div className="flex justify-between items-start text-xs font-semibold text-brand-600 mb-0.5">
              <span>Coverage</span>
              <div className="text-right">
                <div>{coverageLabel}</div>
                <div className="text-[10px] font-normal text-gray-400 mt-0.5">
                  {coverageBase.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' → '}
                  {coverageEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-between text-xs text-gray-500">
            {form.paymentType === 'monthly'
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × 1 month</span>
              : form.paymentType === 'custom'
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × {customMonths} months</span>
              : <span>₹{form.baseAmount.toLocaleString('en-IN')} ({form.paymentType} flat · {months} months)</span>
            }
            <span>₹{subtotal.toLocaleString('en-IN')}</span>
          </div>
          {lateFeeAmt > 0 && (
            <div className="flex justify-between text-xs text-amber-600 font-medium">
              <span>Late Fee</span>
              <span>+₹{lateFeeAmt.toLocaleString('en-IN')}</span>
            </div>
          )}
          {discountAmt > 0 && (
            <div className="flex justify-between text-xs text-emerald-600 font-medium">
              <span>Discount ({form.discountPct}%)</span>
              <span>−₹{discountAmt.toLocaleString('en-IN')}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm font-black text-gray-900 border-t border-gray-200 pt-2 mt-1">
            <span>Total <span className="text-[10px] font-normal text-gray-400">(editable)</span></span>
            <input
              type="number" min="0"
              className="w-32 text-right font-black text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-brand-400"
              value={finalAmount}
              onChange={e => setAmountOverride(Number(e.target.value))}
            />
          </div>
          {amountMismatch && (
            <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              <div className="flex items-start gap-1.5 text-xs text-amber-700 min-w-0">
                <span className="text-base leading-none mt-0.5 shrink-0">⚠</span>
                <span>{amountMismatchMsg}</span>
              </div>
              <button
                type="button"
                className="shrink-0 text-xs font-bold text-amber-800 bg-amber-200 hover:bg-amber-300 px-2.5 py-1 rounded-lg transition whitespace-nowrap"
                onClick={() => {
                  const newPlan = finalAmount === monthlyFee * 3 ? 'quarterly' : 'yearly'
                  setForm(f => ({ ...f, paymentType: newPlan, baseAmount: finalAmount }))
                  setAmountOverride(null)
                }}
              >
                {finalAmount === monthlyFee * 3 ? '→ Switch to Quarterly' : '→ Switch to Yearly'}
              </button>
            </div>
          )}
        </div>

        {/* Batch */}
        <div>
          <label className="label">Assign Batch {isSuspended ? '— last: ' + (selectedStudent?.lastBatchName || '—') : ''}</label>
          <select className="input" value={form.batchId} onChange={e => handleBatchChange(e.target.value)}>
            <option value="">— No batch —</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.code ? ` (${b.code})` : ''} · {b.capacity - b.enrolled} seats left
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" placeholder="e.g. cheque #1234, partial payment, sibling discount…"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {/* Payment Date + Mode */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Payment Date</label>
            <input className="input" type="date"
              value={paymentDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => setPaymentDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Payment Mode</label>
            <select className="input" value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
              {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

      </div>
      {(sanityMismatch || isDuplicate) && (
        <div className="mt-5 bg-red-50 border-2 border-red-300 rounded-xl p-3.5">
          <div className="flex items-start gap-2 mb-2">
            <span className="text-lg leading-none mt-0.5">⚠️</span>
            <div className="text-xs text-red-800">
              {sanityMismatch && (
                <>
                  <p className="font-bold mb-0.5">Amount looks unusual</p>
                  <p>
                    Entered <strong>₹{finalAmount.toLocaleString('en-IN')}</strong> is
                    {' '}<strong>{sanityRatio < 1 ? `${Math.round((1 - sanityRatio) * 100)}% lower` : `${Math.round((sanityRatio - 1) * 100)}% higher`}</strong>
                    {' '}than the expected <strong>₹{expectedTotal.toLocaleString('en-IN')}</strong> for this student.
                  </p>
                </>
              )}
              {isDuplicate && (
                <>
                  <p className="font-bold mb-0.5">Possible duplicate payment</p>
                  <p>
                    <strong>{form.student}</strong> is already paid through{' '}
                    <strong>{new Date(selectedStudent.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</strong>.
                    This new payment would overlap their current coverage.
                  </p>
                </>
              )}
              <p className="mt-1">Type <strong>CONFIRM</strong> below to record anyway.</p>
            </div>
          </div>
          <input
            className="input border-red-300 focus:border-red-500 font-mono uppercase tracking-wider"
            placeholder="Type CONFIRM to proceed"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
          />
        </div>
      )}
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className={isDuplicate || sanityMismatch ? 'px-5 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed' : 'btn-primary'}
          onClick={handleSave}
          disabled={loading || finalAmount <= 0 || !confirmOk}
        >
          {loading ? '…' : isDuplicate ? `Record Anyway · ₹${finalAmount.toLocaleString('en-IN')}` : `Confirm · ₹${finalAmount.toLocaleString('en-IN')}`}
        </button>
      </div>
    </Modal>
  )
}
