import { useState, useMemo, useRef, useEffect } from 'react'
import Paginator, { PAGE_SIZE } from '../components/Paginator'
import { useApp } from '../context/AppContext'
import { CreditCard, Plus, Search, CheckCircle, Clock, AlertCircle, X, Pencil, Trash2, Printer, Link as LinkIcon, MessageCircle, FileSpreadsheet, Download, ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal, Wallet } from 'lucide-react'
import { Modal } from './Students'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { isOutstanding, normTrainingType, trainingTypeLabel } from '../lib/studentRules'
import DevFillButton from '../components/DevFillButton'
import { fillPayment } from '../lib/devFill'
import SendPayLinkModal from '../components/SendPayLinkModal'
import WhatsAppBulkModal from '../components/WhatsAppBulkModal'
import { openWhatsAppLink, buildFeesReminderMessage, daysOverdue } from '../lib/whatsapp'
import { todayStr, toLocalDateStr, toLocalMonthStr } from '../lib/dates'
import { buildReceiptHTML } from '../lib/paymentReceipt'
import { resolveBranchTax } from '../lib/tax'
import { fetchAttendanceForStudents } from '../lib/db'

// Casing differs either side of the students ↔ fee_plans join — see
// normTrainingType in lib/studentRules.js for the full story.
const normTraining  = normTrainingType
const trainingLabel = trainingTypeLabel

// Defangs the classic CSV/Excel formula-injection pattern: a cell value
// that starts with =, +, -, or @ can be interpreted as a formula by some
// spreadsheet apps when the exported file is opened. A leading apostrophe
// is the standard "force text" convention Excel/Sheets both already
// recognize, so this never changes what a legitimate value displays as.
const excelSafe = (v) => (typeof v === 'string' && /^[=+\-@]/.test(v)) ? `'${v}` : v

function printReceipt(p, student, academyName, logoUrl) {
  const html = buildReceiptHTML(p, student, academyName, logoUrl)
  const w = window.open('', '_blank', 'width=600,height=850')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}

// Exact rupee amount, Indian comma grouping — no k/L abbreviation (see
// Dashboard.jsx's fmtAmt for why: it hides real amounts at this scale).
function fmtMoney(n) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

const STATUS_MAP = {
  Paid:    { cls: 'badge-green',  icon: CheckCircle, iconCls: 'text-emerald-500' },
  Pending: { cls: 'badge-yellow', icon: Clock,       iconCls: 'text-amber-500' },
  Overdue: { cls: 'badge-red',    icon: AlertCircle, iconCls: 'text-red-500' },
}

export default function Payments() {
  const { payments, students, batches, feePlans, sportBranches, addPayment, markPaymentPaid, removePayment, updatePaymentDate, selectedSport, selectedBranch, user, hasPermission, showToast, isFeatureOn, visibleSports, showSportFilter } = useApp()
  const canManage = hasPermission('payments.manage')
  const [editingDate,            setEditingDate]            = useState(null)
  const [markingPaid,            setMarkingPaid]            = useState(null)
  const [markPaidTarget,         setMarkPaidTarget]         = useState(null)
  const [deleteTarget,           setDeleteTarget]           = useState(null)
  const [deleteNote,             setDeleteNote]             = useState('')
  const [deleting,               setDeleting]               = useState(false)
  const [selectedStudentHistory, setSelectedStudentHistory] = useState(null)
  const [exportingAll,           setExportingAll]           = useState(false)

  const handleMarkPaid = (id) => {
    const payment = allRecords.find(p => p.id === id)
    if (payment) setMarkPaidTarget(payment)
  }

  const executeMarkPaid = async (id, mode, clearedDate) => {
    setMarkingPaid(id)
    try { await markPaymentPaid(id, mode, clearedDate) }
    finally { setMarkingPaid(null); setMarkPaidTarget(null) }
  }

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('All')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
  // toISOString() is UTC — in IST (UTC+5:30) it still reads as the previous
  // month until 05:30 on the 1st, so the page would open filtered to last
  // month and today's collections would look missing. See lib/dates.js.
  const [monthFilter,     setMonthFilter]     = useState(toLocalMonthStr())
  const [modeFilter,      setModeFilter]      = useState('All')
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')
  const [newRenewalFilter,setNewRenewalFilter]= useState('All')
  const [exportingCollection, setExportingCollection] = useState(false)
  const [showActions,     setShowActions]     = useState(false)
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const actionsRef = useRef(null)
  const [showModal,       setShowModal]       = useState(false)
  const [showPayLink,     setShowPayLink]     = useState(false)
  const [showBulkWA,      setShowBulkWA]      = useState(false)
  const [payForStudent,   setPayForStudent]   = useState(null)
  const [detailPayment,   setDetailPayment]   = useState(null)
  const [page,            setPage]            = useState(1)

  useEffect(() => {
    if (!showActions) return
    const h = e => { if (!actionsRef.current?.contains(e.target)) setShowActions(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [showActions])

  const now          = new Date()
  const firstOfMonth = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1))

  // Build studentId → student lookup for filter joins
  const studentMap = useMemo(() => {
    const m = {}
    students.forEach(s => { m[s.id] = s })
    return m
  }, [students])

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
  useEffect(() => setPage(1), [statusFilter, sportFilter, batchFilter, monthFilter, modeFilter, dateFrom, dateTo, newRenewalFilter])

  // studentId → id of that student's earliest regular (non-trial) payment —
  // "New admission" for the collection sheet means THIS is that payment,
  // everything after it for the same student is a renewal. Trial-fee rows
  // are excluded since they're a different revenue stream, not a fees renewal.
  const firstRegularPaymentIdByStudent = useMemo(() => {
    const earliest = {}
    // status === 'Paid' only — a linked Due-balance row (partial-payment
    // shortfall, see addPayment) shares the same date as the real payment
    // it's linked to and would otherwise win the earliest-date tie, making
    // a student's actual first collection get mislabeled "Renewal" while
    // the not-yet-collected Due row gets called "New" instead.
    payments.filter(p => p.paymentType !== 'trial' && p.status === 'Paid').forEach(p => {
      const cur = earliest[p.studentId]
      if (!cur || (p.date || '') < (cur.date || '')) earliest[p.studentId] = p
    })
    const map = {}
    Object.entries(earliest).forEach(([sid, p]) => { map[sid] = p.id })
    return map
  }, [payments])

  // Clear batch/sport filters when the owner switches sport or branch so stale
  // filter values don't hide all payments in the new scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setBatchFilter('All'); setSportFilter('All') }, [selectedSport, selectedBranch])

  const filtered = allRecords.filter(p => {
    const q       = search.toLowerCase()
    const matchQ  = !q || (p.student || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q)
    const matchS  = statusFilter === 'All' || p.status === statusFilter
    const stu     = studentMap[p.studentId]
    // Trial-fee rows have no student until conversion and carry their own
    // sport, so fall back to it or they vanish whenever a sport is picked.
    const matchSport = sportFilter === 'All' || (stu?.sport || p.sport) === sportFilter
    // Batch is intentionally not falling back: a trial has no batch, so a
    // batch filter correctly excludes these rows.
    const matchBatch = batchFilter === 'All' || stu?.batch === batchFilter || String(stu?.batchId) === batchFilter
    // Match by date (Paid/Overdue with a paid date) OR by billing month (Pending where date is NULL)
    // Virtual overdue rows have no date/month string — re-derive "was this student
    // overdue as of the selected month" instead of the real current month.
    const matchMonth = !monthFilter ||
      (p.isVirtual && isOutstanding(stu, monthFilter + '-01')) ||
      (!p.isVirtual && p.date && p.date.slice(0, 7) === monthFilter) ||
      (!p.isVirtual && !p.date && p.month === monthFilter)
    const matchMode = modeFilter === 'All' || p.mode === modeFilter
    const matchDateRange = (!dateFrom || (p.date && p.date >= dateFrom)) && (!dateTo || (p.date && p.date <= dateTo))
    const isNewPayment = firstRegularPaymentIdByStudent[p.studentId] === p.id
    const matchNewRenewal = newRenewalFilter === 'All' || (newRenewalFilter === 'New' ? isNewPayment : !isNewPayment)
    return matchQ && matchS && matchSport && matchBatch && matchMonth && matchMode && matchDateRange && matchNewRenewal
  })
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Summary cards — filter by selected month when active
  const paidBase    = monthFilter
    ? payments.filter(p => p.status === 'Paid'    && p.date?.slice(0,7) === monthFilter)
    : payments.filter(p => p.status === 'Paid')
  const pendingBase = monthFilter
    ? payments.filter(p => p.status === 'Pending' && (p.date?.slice(0,7) === monthFilter || (!p.date && p.month === monthFilter)))
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

  // Sport is no longer one of these — it lives in the primary filter row now.
  const advancedFilterCount = [
    batchFilter !== 'All', modeFilter !== 'All',
    !!dateFrom || !!dateTo, newRenewalFilter !== 'All',
  ].filter(Boolean).length

  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Payments</h2>
          <p className="text-sm text-gray-500">Track fees, generate receipts, manage collections</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && overdueCount > 0 && (
            <button
              onClick={() => setShowBulkWA(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition shadow-sm">
              <MessageCircle size={14} />
              Remind ({overdueCount})
            </button>
          )}
          <div className="relative" ref={actionsRef}>
            <button onClick={() => setShowActions(v => !v)} className="btn-secondary text-xs">
              Actions <ChevronDown size={13} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
            </button>
            {showActions && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 z-20">
                {isFeatureOn('family_login') && (
                  <button onClick={() => { setShowPayLink(true); setShowActions(false) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition text-left">
                    <LinkIcon size={14} className="text-gray-400" /> Send Pay Link
                  </button>
                )}
                <button
                  onClick={async () => {
                    setShowActions(false)
                    setExportingAll(true)
                    try { await exportPaymentsToExcel({ records: filtered, studentMap, title: `PAYMENT REPORT${monthLabel ? ' — ' + monthLabel : ''}`, showToast }) }
                    finally { setExportingAll(false) }
                  }}
                  disabled={exportingAll || filtered.length === 0}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition text-left disabled:opacity-40">
                  <FileSpreadsheet size={14} className="text-gray-400" /> {exportingAll ? 'Exporting…' : 'Export Excel'}
                </button>
                <button
                  onClick={async () => {
                    setShowActions(false)
                    setExportingCollection(true)
                    try {
                      await exportCollectionSheetToExcel({
                        // status === 'Paid' only — a "collection" sheet is money actually in
                        // hand. A linked Due-balance row (partial-payment shortfall) or an
                        // uncleared cheque is still Pending and would otherwise inflate the
                        // totals-by-mode figures with cash that hasn't been collected yet.
                        records: filtered.filter(p => !p.isVirtual && p.paymentType !== 'trial' && p.status === 'Paid'),
                        studentMap, sportBranches, firstRegularPaymentIdByStudent,
                        title: `COLLECTION DATA${monthLabel ? ' — ' + monthLabel : ''}`,
                        showToast,
                      })
                    } finally { setExportingCollection(false) }
                  }}
                  disabled={exportingCollection || filtered.length === 0}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition text-left disabled:opacity-40">
                  <Download size={14} className="text-gray-400" /> {exportingCollection ? 'Exporting…' : 'Collection Sheet'}
                </button>
              </div>
            )}
          </div>
          {canManage && (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Record Payment
            </button>
          )}
        </div>
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
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Collected" value={fmtMoney(paid)} count={paidBase.length} color="emerald" icon={CheckCircle} />
        <SummaryCard label="Pending"   value={fmtMoney(pending)} count={pendingBase.length} color="amber" icon={Clock} />
        <SummaryCard label="Overdue"   value={fmtMoney(overdueAmt)} count={overdueCount} color="red" icon={AlertCircle} />
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
            <Bar dataKey="revenue" radius={[4,4,0,0]}>
              {revenueData.map((d, i) => <Cell key={i} fill={d.key === thisMonthKey ? '#1d4ed8' : '#bfdbfe'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Row 1: search + month picker + status pills — the 90% case, always visible */}
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
          {/* Sport sits in the PRIMARY row, not behind "More filters": whoever
              runs a whole branch is looking at every sport at once, so this is
              the filter they reach for most. Hidden when there's only one. */}
          {showSportFilter && (
            <select className={`input w-auto text-xs font-semibold ${sportFilter !== 'All' ? 'border-brand-400 text-brand-700' : ''}`}
              value={sportFilter}
              onChange={e => { setSportFilter(e.target.value); setBatchFilter('All') }}>
              <option value="All">All Sports</option>
              {visibleSports.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
          <button onClick={() => setShowMoreFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition ml-auto ${showMoreFilters ? 'bg-brand-50 text-brand-600 border-brand-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            <SlidersHorizontal size={13} /> More filters
            {advancedFilterCount > 0 && (
              <span className="w-4 h-4 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold">{advancedFilterCount}</span>
            )}
          </button>
        </div>
        {/* Row 2 (collapsed by default): Sport, Batch, Mode, date range, New/Renewal — the occasional-use filters */}
        {showMoreFilters && (
        <>
        <div className="flex flex-wrap gap-3 items-center pt-3 border-t border-gray-100">
          <select className="input w-auto" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="All">All Batches</option>
            {batches.map(b => <option key={b.id} value={String(b.id)}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
          </select>
          {(batchFilter !== 'All' || sportFilter !== 'All') && (
            <button onClick={() => { setSportFilter('All'); setBatchFilter('All') }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition font-medium">
              <X size={12} /> Clear filters
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
        </div>
        {/* Mode + Date range + New/Renewal — the less-common collection-sheet filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <select className="input w-auto" value={modeFilter} onChange={e => setModeFilter(e.target.value)}>
            <option value="All">All Modes</option>
            {['UPI','Cash','Bank Transfer','Cheque','Card'].map(m => <option key={m}>{m}</option>)}
          </select>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>From</span>
            <input type="date" className="input w-auto text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span>To</span>
            <input type="date" className="input w-auto text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 transition">
                <X size={12} />
              </button>
            )}
          </div>
          {['All','New','Renewal'].map(s => (
            <button key={s} onClick={() => setNewRenewalFilter(s)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition ${newRenewalFilter===s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {s}
            </button>
          ))}
        </div>
        </>
        )}
      </div>

      {/* Mobile card list */}
      <div className="sm:hidden card overflow-hidden divide-y divide-gray-50">
        {paged.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <CreditCard size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No payments found</p>
          </div>
        ) : paged.map(p => {
          const sm = STATUS_MAP[p.status] || STATUS_MAP.Overdue
          return (
            <div key={p.id}
              className={`p-4 ${p.isVirtual ? 'bg-red-50/40' : ''}`}
              onClick={() => !p.isVirtual && setDetailPayment({ payment: p, student: studentMap[p.studentId] })}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="font-semibold text-gray-900 text-sm hover:text-brand-600 transition" onClick={e => { e.stopPropagation(); const s = studentMap[p.studentId]; if (s) setSelectedStudentHistory(s) }}>{p.student}</button>
                    {p.isSuspended && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Suspended</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{p.month}{p.mode ? ` · ${p.mode}` : ''}{p.date ? ` · ${p.date}` : ''}{p.mode==='Cheque'&&p.notes?.startsWith('Cheque #') ? ` · ${p.notes.split('\n')[0]}` : ''}</p>
                  {!p.isVirtual && <p className="text-[10px] font-mono text-gray-300 mt-0.5">{p.id}</p>}
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="font-black text-gray-900">₹{(p.amount ?? 0).toLocaleString('en-IN')}</p>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${sm.iconCls}`}>
                    <sm.icon size={11} /> {p.status}
                  </span>
                  {p.dueAmount > 0 && (
                    <div className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-semibold whitespace-nowrap">
                      ₹{p.dueAmount.toLocaleString('en-IN')} due
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2.5" onClick={e => e.stopPropagation()}>
                {p.isVirtual ? (
                  canManage ? (<>
                    <button className="text-xs text-red-600 font-semibold" onClick={() => setPayForStudent(studentMap[p.studentId])}>Record</button>
                    <button className="text-xs text-emerald-600 font-semibold flex items-center gap-1" onClick={() => { const stu = studentMap[p.studentId]; if (stu) openWhatsAppLink(stu.parentPhone || stu.phone, buildFeesReminderMessage({ student: stu, academy: user?.academy })) }}>
                      <MessageCircle size={11} /> Remind
                    </button>
                  </>) : null
                ) : p.status !== 'Paid' ? (
                  canManage ? (
                    <button className="text-xs text-brand-600 font-semibold disabled:opacity-50" onClick={() => handleMarkPaid(p.id)} disabled={markingPaid === p.id}>
                      {markingPaid === p.id ? 'Marking…' : 'Mark Paid'}
                    </button>
                  ) : null
                ) : (<>
                  <button className="text-xs text-gray-400 flex items-center gap-1" onClick={() => printReceipt(p, studentMap[p.studentId], user?.academy, user?.academyLogo)}>
                    <Printer size={11} /> Receipt
                  </button>
                  {canManage && p.paymentType !== 'trial' && <button className="text-xs text-gray-300 hover:text-red-500" onClick={() => { setDeleteTarget(p); setDeleteNote('') }}><Trash2 size={13} /></button>}
                </>)}
              </div>
            </div>
          )
        })}
        {filtered.length > PAGE_SIZE && (
          <div className="px-4 py-2 border-t border-gray-100">
            <Paginator page={page} total={filtered.length} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Table — desktop only */}
      <div className="hidden sm:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Invoice', 'Student', 'Month', 'Amount', 'Due', 'Mode', 'Date', 'Status', 'Action'].map(h => (
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
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.isVirtual ? <span className="text-gray-300">—</span> : p.id}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900" onClick={e => { e.stopPropagation(); const s = studentMap[p.studentId]; if (s) setSelectedStudentHistory(s) }}>
                      <span className="hover:text-brand-600 cursor-pointer transition">{p.student}</span>
                      {p.isSuspended && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Suspended</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.month}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">₹{(p.amount ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">
                      {p.dueAmount > 0
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold whitespace-nowrap">₹{p.dueAmount.toLocaleString('en-IN')} due</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      <div>{p.mode || <span className="text-gray-300">—</span>}</div>
                      {p.mode==='Cheque'&&p.notes?.startsWith('Cheque #') && <div className="text-[10px] text-gray-400 font-mono mt-0.5">{p.notes.split('\n')[0]}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {!p.isVirtual && editingDate === p.id ? (
                        <input
                          type="date"
                          className="input py-0.5 px-1.5 text-xs w-36"
                          defaultValue={p.date || ''}
                          max={toLocalDateStr()}
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
                          {p.date || <span className="text-gray-300">—</span>}
                          {!p.isVirtual && canManage && (
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
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${sm.iconCls}`}>
                        <sm.icon size={13} /> {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      {p.isVirtual ? (
                        canManage ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            className="px-2.5 py-1 rounded-lg border border-red-200 bg-white text-red-600 text-xs font-semibold hover:bg-red-50 transition"
                            onClick={() => setPayForStudent(studentMap[p.studentId])}
                          >
                            Record
                          </button>
                          <button
                            className="px-2.5 py-1 rounded-lg border border-emerald-200 bg-white text-emerald-600 text-xs font-semibold hover:bg-emerald-50 transition inline-flex items-center gap-1"
                            title="Send WhatsApp reminder"
                            onClick={() => {
                              const stu = studentMap[p.studentId]
                              if (!stu) return
                              openWhatsAppLink(
                                stu.parentPhone || stu.phone,
                                buildFeesReminderMessage({ student: stu, academy: user?.academy })
                              )
                            }}
                          >
                            <MessageCircle size={11} /> Remind
                          </button>
                        </div>
                        ) : <span className="text-xs text-gray-300">—</span>
                      ) : p.status !== 'Paid' ? (
                        canManage ? (
                        <button
                          className="px-2.5 py-1 rounded-lg border border-brand-200 bg-white text-brand-600 text-xs font-semibold hover:bg-brand-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleMarkPaid(p.id)}
                          disabled={markingPaid === p.id}
                        >
                          {markingPaid === p.id ? 'Marking…' : 'Mark Paid'}
                        </button>
                        ) : <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => printReceipt(p, studentMap[p.studentId], user?.academy, user?.academyLogo)}
                            className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs font-semibold hover:bg-gray-50 transition inline-flex items-center gap-1">
                            <Printer size={12} /> Receipt
                          </button>
                          {/* Trial receipts are owned by the Trial record —
                              deleting one here would leave trials.trial_fee_paid
                              claiming money that is no longer booked. */}
                          {canManage && p.paymentType !== 'trial' && (
                          <button
                            onClick={() => { setDeleteTarget(p); setDeleteNote('') }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition"
                            title="Delete payment"
                          >
                            <Trash2 size={13} />
                          </button>
                          )}
                          {canManage && p.paymentType === 'trial' && (
                            <span className="text-[10px] text-gray-300" title="Remove the fee from the Trial record instead">Trial fee</span>
                          )}
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

      {showPayLink && (
        <SendPayLinkModal
          students={students}
          onClose={() => setShowPayLink(false)}
        />
      )}

      {markPaidTarget && (
        <ConfirmMarkPaidModal
          payment={markPaidTarget}
          studentMap={studentMap}
          isLoading={!!markingPaid}
          onConfirm={executeMarkPaid}
          onClose={() => setMarkPaidTarget(null)}
        />
      )}

      {selectedStudentHistory && (
        <StudentPaymentPanel
          student={selectedStudentHistory}
          payments={allRecords}
          studentMap={studentMap}
          onClose={() => setSelectedStudentHistory(null)}
          showToast={showToast}
          user={user}
        />
      )}

      {showBulkWA && (
        <WhatsAppBulkModal
          overdueStudents={overdueBase.map(p => studentMap[p.studentId]).filter(Boolean)}
          academy={user?.academy}
          onClose={() => setShowBulkWA(false)}
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
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reason for deletion <span className="font-normal text-red-500">(required)</span></label>
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
                disabled={deleting || !deleteNote.trim()}
                title={!deleteNote.trim() ? 'Enter a reason before deleting' : ''}
                onClick={async () => {
                  setDeleting(true)
                  // The reason was collected here already but never reached the
                  // audit trail — removePayment took one argument and dropped it.
                  try { await removePayment(deleteTarget, deleteNote.trim()) }
                  finally { setDeleting(false); setDeleteTarget(null); setDeleteNote('') }
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <span>Trial Fee <span className="text-[11px] text-red-400">(paid at trial — separate receipt)</span></span>
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
                  <span>{p.paymentType === 'trial'
                    ? 'Trial Fee'
                    : `${planLabel[student?.feePlan] || 'Monthly'} Fee`}
                    {(p.paymentType !== 'trial' && p.monthsCovered > 1) && <span className="text-xs font-normal text-gray-400 ml-1">× {p.monthsCovered} months</span>}
                  </span>
                  <span className="text-emerald-700">₹{(p.amount ?? 0).toLocaleString('en-IN')}</span>
                </div>
              )}
            </div>
          </div>

          {/* A trial receipt has no student until the lead converts. */}
          {p.paymentType === 'trial' && !student && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">Trial lead</span> — not yet enrolled as a student
                {p.sport ? ` · ${p.sport}` : ''}
              </p>
            </div>
          )}

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

// ── Professional Excel export for payments ────────────────────
async function exportPaymentsToExcel({ records, studentMap, title, showToast }) {
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Khelit'
    wb.created = new Date()

    const BRAND = '2563eb', DARK = '1e3a5f'
    const hFont  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    const subFont = { bold: true, color: { argb: 'FF374151' }, size: 9, name: 'Calibri' }
    const dFont  = { size: 9, name: 'Calibri' }
    const thin   = { style: 'thin', color: { argb: 'FFe5e7eb' } }
    const STATUS_FILLS = {
      Paid:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdcfce7' } },
      Pending: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } },
      Overdue: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfee2e2' } },
    }

    // ── Sheet 1: Payment Records ──────────────────────────────
    const ws = wb.addWorksheet('Payment Records', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] })

    const cols = [
      { key: 'num',     header: '#',         width: 5 },
      { key: 'invoice', header: 'Invoice',    width: 18 },
      { key: 'student', header: 'Student',    width: 22 },
      { key: 'sport',   header: 'Sport',      width: 14 },
      { key: 'batch',   header: 'Batch',      width: 18 },
      { key: 'month',   header: 'Period',     width: 20 },
      { key: 'amount',  header: 'Amount (₹)', width: 14 },
      { key: 'mode',    header: 'Mode',       width: 10 },
      { key: 'date',    header: 'Date',       width: 14 },
      { key: 'status',  header: 'Status',     width: 10 },
    ]
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

    // Row 1: title
    ws.mergeCells(1, 1, 1, cols.length)
    const t = ws.getCell(1, 1)
    t.value = title || 'PAYMENT REPORT'
    t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${DARK}` } }
    t.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 22

    // Row 2: meta
    ws.mergeCells(2, 1, 2, 4)
    ws.getCell(2, 1).value = `Exported: ${new Date().toLocaleDateString('en-IN')}`
    ws.mergeCells(2, 5, 2, cols.length)
    ws.getCell(2, 5).value = `Total Records: ${records.length}   Total Collected: ₹${records.filter(r=>r.status==='Paid').reduce((s,r)=>s+(r.amount||0),0).toLocaleString('en-IN')}`
    ;[ws.getCell(2,1), ws.getCell(2,5)].forEach(c => {
      c.font = { italic: true, size: 9, color: { argb: 'FF6b7280' }, name: 'Calibri' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } }
    })
    ws.getRow(2).height = 15

    // Row 3: headers
    cols.forEach((c, i) => {
      const cell = ws.getCell(3, i + 1)
      cell.value = c.header
      cell.font = hFont
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND}` } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF1d4ed8' } } }
    })
    ws.getRow(3).height = 18

    // Data rows
    records.forEach((p, idx) => {
      const stu = studentMap[p.studentId]
      const row = ws.getRow(idx + 4)
      const isEven = idx % 2 === 1
      const fill = STATUS_FILLS[p.status] || { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFf9fafb' : 'FFffffff' } }

      // Trial-fee rows have no student row to read sport from; they carry it.
      const vals = [idx+1, p.isVirtual ? '—' : (p.id||'—'), p.student||'—', stu?.sport||p.sport||'—', stu?.batch||(p.paymentType==='trial'?'Trial':'—'), p.month||'—', p.amount||0, p.mode||'—', p.date||'—', p.status||'—']
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1)
        cell.value = excelSafe(v)
        cell.font = i === 9 ? { ...dFont, bold: true, color: { argb: p.status==='Paid'?'FF166534':p.status==='Pending'?'FF92400e':'FFb91c1c' } } : dFont
        cell.fill = i === 9 ? (STATUS_FILLS[p.status] || fill) : (isEven ? { type:'pattern',pattern:'solid',fgColor:{argb:'FFf9fafb'} } : { type:'pattern',pattern:'solid',fgColor:{argb:'FFffffff'} })
        if (i === 6) { cell.numFmt = '₹#,##0'; cell.alignment = { horizontal: 'right' } }
        cell.border = { bottom: thin }
      })
      row.height = 16
    })

    // ── Sheet 2: Student Summary ──────────────────────────────
    const ws2 = wb.addWorksheet('Student Summary')
    const cols2 = ['#','Student','Sport','Batch','Total Paid (₹)','Pending (₹)','Overdue (₹)','Transactions','Last Payment']
    const widths2 = [5,22,14,18,16,14,14,14,16]
    cols2.forEach((h,i) => {
      ws2.getColumn(i+1).width = widths2[i]
      const cell = ws2.getCell(1, i+1)
      cell.value = h
      cell.font = hFont
      cell.fill = { type:'pattern',pattern:'solid',fgColor:{argb:`FF${BRAND}`} }
      cell.alignment = { horizontal:'center',vertical:'middle' }
    })
    ws2.getRow(1).height = 18

    const byStudent = {}
    records.forEach(p => {
      if (p.isVirtual) return
      const sid = p.studentId
      if (!byStudent[sid]) byStudent[sid] = { paid:0, pending:0, overdue:0, count:0, lastDate:'' }
      const b = byStudent[sid]
      b.count++
      if (p.status==='Paid')    { b.paid    += p.amount||0; if ((p.date||'') > b.lastDate) b.lastDate = p.date||'' }
      if (p.status==='Pending') b.pending += p.amount||0
      if (p.status==='Overdue') b.overdue += p.amount||0
    })

    let r2 = 2
    const uniqueStudents = [...new Set(records.filter(p=>!p.isVirtual).map(p=>p.studentId))]
      .sort((a,b)=>(records.find(r=>r.studentId===a)?.student||'').localeCompare(records.find(r=>r.studentId===b)?.student||''))
    uniqueStudents.forEach((sid, idx) => {
      const b = byStudent[sid]
      const stu = studentMap[sid]
      const p = records.find(r => r.studentId === sid)
      const isEven = idx%2===1
      const rowFill = { type:'pattern',pattern:'solid',fgColor:{argb:isEven?'FFf9fafb':'FFffffff'} }
      const vals = [idx+1, p?.student||'—', stu?.sport||'—', stu?.batch||'—', b.paid, b.pending, b.overdue, b.count, b.lastDate||'—']
      vals.forEach((v,i) => {
        const cell = ws2.getCell(r2, i+1)
        cell.value = excelSafe(v)
        cell.font = dFont
        cell.fill = rowFill
        if (i===4||i===5||i===6) { cell.numFmt='₹#,##0'; cell.alignment={horizontal:'right'} }
        if (i===4&&b.paid>0) cell.font = {...dFont, color:{argb:'FF166534'}, bold:true}
        if (i===6&&b.overdue>0) cell.font = {...dFont, color:{argb:'FFb91c1c'}, bold:true}
        cell.border = { bottom: thin }
      })
      ws2.getRow(r2).height = 16
      r2++
    })

    // Totals row
    const totRow = ws2.getRow(r2)
    totRow.getCell(1).value = ''
    totRow.getCell(2).value = 'TOTAL'
    totRow.getCell(2).font = {...subFont, color:{argb:'FF111827'}}
    totRow.getCell(5).value = uniqueStudents.reduce((s,sid)=>s+(byStudent[sid]?.paid||0),0)
    totRow.getCell(5).numFmt = '₹#,##0'
    totRow.getCell(5).font = {bold:true,size:10,color:{argb:'FF166534'},name:'Calibri'}
    totRow.getCell(6).value = uniqueStudents.reduce((s,sid)=>s+(byStudent[sid]?.pending||0),0)
    totRow.getCell(6).numFmt = '₹#,##0'
    ;[1,2,3,4,5,6,7,8,9].forEach(i => {
      totRow.getCell(i).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFf0f9ff'}}
      totRow.getCell(i).border = {top:{style:'medium',color:{argb:'FF2563eb'}}}
    })
    totRow.height = 18

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title||'payments').replace(/[^a-z0-9]/gi,'_')}_${todayStr()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Excel exported successfully')
  } catch (err) {
    console.error(err)
    showToast('Export failed: ' + (err?.message || 'unknown'), 'error')
  }
}

// ── Regular-fees Collection Sheet export ───────────────────────
// Separate from exportPaymentsToExcel above — a different shape (COURSE
// FEE/GST split, NEW vs renewal, day of week) for a different audience
// (daily cash-collection reconciliation, matching the academy's existing
// hand-built sheet), not a replacement for the accounting-style export.
async function exportCollectionSheetToExcel({ records, studentMap, sportBranches, firstRegularPaymentIdByStudent, title, showToast }) {
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Khelit'
    wb.created = new Date()

    const BRAND = '2563eb', DARK = '1e3a5f'
    const hFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    const dFont = { size: 9, name: 'Calibri' }
    const thin  = { style: 'thin', color: { argb: 'FFe5e7eb' } }

    const branchById = {}
    ;(sportBranches || []).forEach(b => { branchById[b.id] = b })

    const ws = wb.addWorksheet('Collection Sheet', { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] })

    const cols = [
      { key: 'num',     header: 'NO',         width: 5 },
      { key: 'name',    header: 'NAME',       width: 22 },
      { key: 'sport',   header: 'SPORT',      width: 14 },
      { key: 'batch',   header: 'BATCH',      width: 16 },
      { key: 'start',   header: 'START DATE', width: 13 },
      { key: 'end',     header: 'END DATE',   width: 13 },
      { key: 'fee',     header: 'COURSE FEE', width: 13 },
      { key: 'gst',     header: 'GST',        width: 10 },
      { key: 'total',   header: 'TOTAL',      width: 13 },
      { key: 'mode',    header: 'MODE',       width: 12 },
      { key: 'new',     header: 'NEW',        width: 10 },
      { key: 'day',     header: 'DAY',        width: 12 },
      { key: 'remarks', header: 'REMARKS',    width: 22 },
    ]
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

    ws.mergeCells(1, 1, 1, cols.length)
    const t = ws.getCell(1, 1)
    t.value = title || 'COLLECTION DATA'
    t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${DARK}` } }
    t.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 22

    const totalCollected = records.reduce((s, p) => s + (p.amount || 0), 0)
    ws.mergeCells(2, 1, 2, 4)
    ws.getCell(2, 1).value = `Exported: ${new Date().toLocaleDateString('en-IN')}`
    ws.mergeCells(2, 5, 2, cols.length)
    ws.getCell(2, 5).value = `Total Records: ${records.length}   Total Collected: ₹${totalCollected.toLocaleString('en-IN')}`
    ;[ws.getCell(2, 1), ws.getCell(2, 5)].forEach(c => {
      c.font = { italic: true, size: 9, color: { argb: 'FF6b7280' }, name: 'Calibri' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } }
    })
    ws.getRow(2).height = 15

    cols.forEach((c, i) => {
      const cell = ws.getCell(3, i + 1)
      cell.value = c.header
      cell.font = hFont
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND}` } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF1d4ed8' } } }
    })
    ws.getRow(3).height = 18

    const modeTotals = {}
    records.forEach((p, idx) => {
      const stu    = studentMap[p.studentId]
      const branch = stu?.branchId ? branchById[stu.branchId] : null
      const pct    = resolveBranchTax(branch, 'fees')
      const total  = p.amount || 0
      // amount is stored GROSS (lib/tax.js invariant) — split it back out
      // rather than adding tax on top of it again.
      const base   = pct > 0 ? Math.round(total / (1 + pct / 100)) : total
      const gst    = total - base
      const isNew  = firstRegularPaymentIdByStudent[p.studentId] === p.id
      const day    = p.date ? new Date(p.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' }) : '—'

      modeTotals[p.mode || 'Other'] = (modeTotals[p.mode || 'Other'] || 0) + total

      const row = ws.getRow(idx + 4)
      const isEven = idx % 2 === 1
      const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFf9fafb' : 'FFffffff' } }
      const vals = [idx + 1, p.student || '—', stu?.sport || p.sport || '—', stu?.batch || '—', p.coverageStart || p.date || '—', p.coverageEnd || '—', base, gst, total, p.mode || '—', isNew ? 'New' : 'Renewal', day, p.notes || '']
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1)
        cell.value = excelSafe(v)
        cell.font = i === 10 ? { ...dFont, bold: true, color: { argb: isNew ? 'FF166534' : 'FF6b7280' } } : dFont
        cell.fill = fill
        if (i === 6 || i === 7 || i === 8) { cell.numFmt = '₹#,##0'; cell.alignment = { horizontal: 'right' } }
        cell.border = { bottom: thin }
      })
      row.height = 16
    })

    // Totals-by-mode footer, then a grand total — same numbers the physical
    // sheet's CASH/TOTAL row shows, generalized to every mode present.
    let r = records.length + 5
    ws.getCell(r, 1).value = 'TOTALS BY MODE'
    ws.getCell(r, 1).font = { bold: true, size: 9, color: { argb: 'FF374151' }, name: 'Calibri' }
    r++
    Object.entries(modeTotals).forEach(([mode, amt]) => {
      ws.getCell(r, 10).value = mode
      ws.getCell(r, 10).font = { bold: true, size: 9, name: 'Calibri' }
      ws.getCell(r, 9).value = amt
      ws.getCell(r, 9).numFmt = '₹#,##0'
      ws.getCell(r, 9).font = { bold: true, size: 9, color: { argb: 'FF166534' }, name: 'Calibri' }
      ws.getCell(r, 9).alignment = { horizontal: 'right' }
      r++
    })
    ws.getCell(r, 8).value = 'GRAND TOTAL'
    ws.getCell(r, 9).value = totalCollected
    ws.getCell(r, 9).numFmt = '₹#,##0'
    ;[8, 9].forEach(i => {
      ws.getCell(r, i).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
      ws.getCell(r, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${DARK}` } }
    })
    ws.getCell(r, 9).alignment = { horizontal: 'right' }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || 'collection_sheet').replace(/[^a-z0-9]/gi, '_')}_${todayStr()}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Collection sheet exported successfully')
  } catch (err) {
    console.error(err)
    showToast('Export failed: ' + (err?.message || 'unknown'), 'error')
  }
}

// ── Student Payment History Panel ─────────────────────────────
function StudentPaymentPanel({ student, payments, studentMap, onClose, showToast, user }) {
  const [exporting, setExporting] = useState(false)
  const studentPayments = useMemo(() =>
    payments.filter(p => p.studentId === student.id && !p.isVirtual)
      .sort((a,b) => (b.date||b.month||'') > (a.date||a.month||'') ? 1 : -1)
  , [payments, student.id])

  const totals = useMemo(() => {
    let paid=0, pending=0, overdue=0
    studentPayments.forEach(p => {
      if (p.status==='Paid')    paid    += p.amount||0
      if (p.status==='Pending') pending += p.amount||0
      if (p.status==='Overdue') overdue += p.amount||0
    })
    return { paid, pending, overdue }
  }, [studentPayments])

  const STATUS_CFG = {
    Paid:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    Pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-400' },
    Overdue: { cls: 'bg-red-50 text-red-700 border-red-200',             dot: 'bg-red-500' },
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportPaymentsToExcel({
        records: studentPayments, studentMap,
        title: `PAYMENT HISTORY — ${student.name}`, showToast,
      })
    } finally { setExporting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-sm shadow-2xl flex flex-col animate-slide-up">
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/20 rounded-full flex items-center justify-center text-lg font-black text-white border-2 border-white/30 flex-shrink-0">
                {student.name[0]}
              </div>
              <div>
                <h2 className="text-base font-black text-white leading-tight">{student.name}</h2>
                <p className="text-brand-200 text-xs mt-0.5">{student.sport} · {student.batch || 'No batch'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition">
              <X size={15} className="text-white" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: 'Collected', value: fmtMoney(totals.paid),    color: 'bg-emerald-500/80' },
              { label: 'Pending',   value: fmtMoney(totals.pending), color: 'bg-amber-400/80' },
              { label: 'Overdue',   value: fmtMoney(totals.overdue), color: 'bg-red-500/80' },
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-xl p-2 text-center`}>
                <p className="text-sm font-black text-white">{s.value}</p>
                <p className="text-[9px] text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <span className="text-xs font-semibold text-gray-500">{studentPayments.length} transactions</span>
          <button onClick={handleExport} disabled={exporting || studentPayments.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50">
            <FileSpreadsheet size={12} /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>

        {/* Payment list */}
        <div className="flex-1 overflow-y-auto">
          {studentPayments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-300">
              <CreditCard size={32} />
              <p className="text-sm text-gray-400">No payments recorded</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {studentPayments.map(p => {
                const cfg = STATUS_CFG[p.status] || STATUS_CFG.Pending
                return (
                  <div key={p.id} className="px-4 py-3.5 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${cfg.dot} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{p.month}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.mode || 'Cash'}{p.date ? ` · ${p.date}` : ''}</p>
                      <p className="text-[10px] font-mono text-gray-300">{p.id}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-black text-gray-900">₹{(p.amount||0).toLocaleString('en-IN')}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.cls}`}>{p.status}</span>
                    </div>
                    <button onClick={() => printReceipt(p, student, user?.academy, user?.academyLogo)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition flex-shrink-0">
                      <Printer size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Double-confirmation Mark Paid modal ───────────────────────
function ConfirmMarkPaidModal({ payment, studentMap, onConfirm, onClose, isLoading }) {
  const [step,        setStep]        = useState(1)
  const [mode,        setMode]        = useState(payment?.mode === 'Cheque' ? 'Cheque' : (payment?.mode || 'UPI'))
  const [clearedDate, setClearedDate] = useState(toLocalDateStr())
  const [confirmText, setConfirmText] = useState('')
  const student = studentMap[payment?.studentId]

  const isChq  = payment?.mode === 'Cheque'
  const chqMatch = isChq ? (payment?.notes || '').match(/^Cheque #([^·]+)·\s*(.+)/) : null
  const chqNo  = chqMatch?.[1]?.trim()
  const chqBank = chqMatch?.[2]?.split('\n')[0]?.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={!isLoading ? onClose : undefined} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up overflow-hidden">

        {/* Header */}
        <div className={`px-5 pt-5 pb-4 ${step === 2 ? 'bg-amber-50 border-b border-amber-100' : 'border-b border-gray-100'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${step === 2 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                <CheckCircle size={18} className={step === 2 ? 'text-amber-600' : 'text-emerald-600'} />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-sm">{step === 1 ? 'Mark Payment as Paid' : 'Confirm Action'}</h3>
                <p className="text-xs text-gray-400">{step === 1 ? 'Review details before confirming' : 'Step 2 of 2 — type CONFIRM to proceed'}</p>
              </div>
            </div>
            <button onClick={onClose} disabled={isLoading} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={15} /></button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Payment summary */}
          <div className="bg-gray-50 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-gray-400">Student</span><span className="font-bold text-gray-900">{payment?.student}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Amount</span><span className="font-black text-emerald-700 text-sm">₹{(payment?.amount||0).toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Period</span><span className="font-semibold text-gray-700">{payment?.month}</span></div>
            {isChq && chqNo && (
              <div className="flex justify-between"><span className="text-gray-400">Cheque</span><span className="font-semibold text-gray-700">#{chqNo}{chqBank ? ` · ${chqBank}` : ''}</span></div>
            )}
          </div>

          {step === 1 && (
            <>
              {isChq && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 text-xs text-blue-700">
                  <span className="text-base leading-none mt-0.5">🏦</span>
                  <span>Confirm cheque <strong>#{chqNo || '—'}</strong>{chqBank ? ` from ${chqBank}` : ''} has successfully cleared.</span>
                </div>
              )}
              {/* Mode + date override */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">Payment Mode</label>
                  <select className="input text-xs py-2" value={mode} onChange={e => setMode(e.target.value)}>
                    {['UPI','Cash','Bank Transfer','Cheque','Card'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">Cleared Date</label>
                  <input type="date" className="input text-xs py-2" value={clearedDate} max={toLocalDateStr()} onChange={e => setClearedDate(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <div>
              <p className="text-xs text-gray-600 mb-2">Type <strong className="text-gray-900">CONFIRM</strong> to mark this payment as paid. This cannot be undone.</p>
              <input
                className="input font-mono tracking-widest text-center"
                placeholder="Type CONFIRM"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button onClick={step === 1 ? onClose : () => setStep(1)} disabled={isLoading}
            className="btn-secondary flex-1 justify-center text-sm">
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step === 1 ? (
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition">
              Continue →
            </button>
          ) : (
            <button
              onClick={() => onConfirm(payment.id, mode, clearedDate)}
              disabled={confirmText !== 'CONFIRM' || isLoading}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold transition">
              {isLoading ? 'Processing…' : 'Mark as Paid'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, count, color, icon: Icon }) {
  const theme = {
    emerald: { text: 'text-emerald-600', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600' },
    amber:   { text: 'text-amber-600',   bar: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-600' },
    red:     { text: 'text-red-600',     bar: 'bg-red-500',     chip: 'bg-red-50 text-red-600' },
  }[color]
  return (
    <div className="relative card p-3 sm:p-5 overflow-hidden pl-4 sm:pl-6">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${theme.bar}`} />
      <div className="flex items-start justify-between">
        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
        {Icon && <span className={`hidden sm:flex w-7 h-7 rounded-lg items-center justify-center ${theme.chip}`}><Icon size={14} /></span>}
      </div>
      <p className={`text-lg sm:text-2xl font-black tracking-tight ${theme.text}`}>{value}</p>
      <p className="text-[10px] sm:text-xs text-gray-400 mt-1">{count} {count === 1 ? 'record' : 'records'}</p>
    </div>
  )
}

export function RecordPaymentModal({ onClose, onSave, students, batches = [], feePlans = [], payments = [], initialStudentId }) {
  const { sportBranches } = useApp()
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
  // Locked to the fee-plan total (Total field read-only) until explicitly
  // ticked — turns editing the Total from an implicit side effect into a
  // deliberate action, and is what actually enables shortfall/Due tracking.
  const [isPartialPayment, setIsPartialPayment] = useState(false)
  const [paymentDate,    setPaymentDate]   = useState(toLocalDateStr())
  const [customMonths,   setCustomMonths]  = useState(2)
  // Backdating Payment Date changes fee coverage for a Suspended student (it becomes
  // the coverage start, not just the collection date) — collapsed by default so staff
  // don't stumble into billing for skipped months by accident. Hidden entirely for
  // non-suspended students since backdating there doesn't affect coverage anyway.
  const [showBackdate,   setShowBackdate]  = useState(false)
  const [lateFee,        setLateFee]       = useState(0)
  const [showLateFee,    setShowLateFee]   = useState(false)
  const [chequeNo,       setChequeNo]      = useState('')
  const [bankName,       setBankName]      = useState('')
  // Required when amount is >30% off the expected total — staff must type CONFIRM
  const [confirmText,    setConfirmText]   = useState('')
  // Month keys (YYYY-MM) the student was inactive for — no fee charged, and no
  // invoice is created for them since no money changes hands.
  const [inactiveMonths, setInactiveMonths] = useState([])
  // Manual override for a non-month-aligned billing period (e.g. a student
  // who joined mid-month) — bypasses the whole due-months/plan system below.
  const [customDates,    setCustomDates]   = useState(false)
  const [customStart,    setCustomStart]   = useState('')
  const [customEnd,      setCustomEnd]     = useState('')

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const selectedStudent = students.find(s => String(s.id) === String(form.studentId))
  const isSuspended = selectedStudent?.status === 'Suspended'

  // Branch setting (0187): moved up here (was only computed lower down for
  // proration) so monthPickerOn can also read it — off means no auto
  // month-picker, no "Custom coverage dates" toggle, plain manual dates only.
  const branchForProration    = sportBranches.find(b => String(b.id) === String(selectedStudent?.branchId))
  const autoCalcEnabled       = branchForProration?.autoCalcDates !== false

  // ── Pending months ────────────────────────────────────────────────────
  // Every month the student still owes: the month after their paidTill through
  // the current month. Empty when they are already paid up — that is the
  // advance-payment path, which has its own coverage handling below.
  const dueMonths = (() => {
    if (!selectedStudent) return []
    const now = new Date()
    const curY = now.getFullYear(), curM = now.getMonth()
    let y, m
    if (selectedStudent.paidTill) {
      const [py, pm] = selectedStudent.paidTill.split('-').map(Number)
      // pm is 1-based, so using it directly as a 0-based index already means
      // "the month after paidTill" (paid till June → pm 6 → index 6 = July).
      y = py; m = pm
      if (m > 11) { m = 0; y += 1 }
    } else {
      const j = selectedStudent.joinDate ? new Date(selectedStudent.joinDate + 'T00:00:00') : now
      y = j.getFullYear(); m = j.getMonth()
    }
    const out = []
    while ((y < curY || (y === curY && m <= curM)) && out.length < 24) {
      out.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MO[m]} ${y}` })
      m += 1
      if (m > 11) { m = 0; y += 1 }
    }
    return out
  })()

  // The picker drives coverage itself, so it stands down when staff explicitly
  // backdate the collection date (that path already sets coverage by hand), and
  // when a custom date range is in play — otherwise `months`/`subtotal` below
  // keep computing from a picker the staff can no longer see, pre-filling the
  // total with a month-count that has nothing to do with the custom period.
  const monthPickerOn = autoCalcEnabled
    && !customDates
    && form.paymentType === 'monthly'
    && dueMonths.length > 0
    && paymentDate === toLocalDateStr()

  // Default: charge EVERY pending month. Unticking a month still covers it
  // without charging (the student wasn't training) — but that is a write-off,
  // so it has to be a deliberate act, never the default.
  //
  // This previously defaulted to `dueMonths.slice(0, -1)` — i.e. every month
  // except the newest was auto-marked inactive. Since coverage still advanced
  // across all of them, opening this modal on a student who owed 5 months and
  // clicking Confirm collected 1 month and silently forgave the other 4.
  const dueKey = dueMonths.map(d => d.key).join(',')
  useEffect(() => {
    setInactiveMonths([])
  }, [dueKey])

  // Session count per due month, for the "barely attended" hint below — same
  // threshold/intent as studentRules.js's isLowAttendanceUnpaid, just checked
  // per pending month here instead of only the live current month.
  const [lowAttendance, setLowAttendance] = useState({})
  useEffect(() => {
    if (!selectedStudent || dueMonths.length === 0) { setLowAttendance({}); return }
    let cancelled = false
    Promise.all(dueMonths.map(async d => {
      const [y, m] = d.key.split('-').map(Number)
      const byStudent = await fetchAttendanceForStudents(y, m - 1, [selectedStudent.id])
      const days = byStudent[selectedStudent.id] || {}
      const count = Object.values(days).filter(st => st === 'Present' || st === 'Late').length
      return [d.key, count]
    })).then(entries => { if (!cancelled) setLowAttendance(Object.fromEntries(entries)) }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedStudent?.id, dueKey])

  const billedMonths   = dueMonths.filter(d => !inactiveMonths.includes(d.key))
  const inactiveList   = dueMonths.filter(d =>  inactiveMonths.includes(d.key))
  // Nothing is being charged — mark the months inactive and write no invoice.
  const isAllInactive  = monthPickerOn && billedMonths.length === 0

  // Months actually charged for. Inactive months cost nothing but are still
  // covered, so the student stops showing as pending for them.
  const months = monthPickerOn ? billedMonths.length
               : form.paymentType === 'quarterly' ? 3
               : form.paymentType === 'yearly'    ? 12
               : form.paymentType === 'custom'    ? customMonths
               : 1
  // How far paidTill moves — charged + inactive.
  const coverageMonths = monthPickerOn ? dueMonths.length : months

  const getFeePlanRate = (batchId, trainingType, paymentType) => {
    // 1. Named fee plan for batch + training type.
    //
    // fee_plans.training_type is stored lower-case ('daily'/'alternate') while
    // students.training_type is capitalised ('Daily'/'Alternate') — verified in
    // production: 4 'alternate' + 2 'daily' plans vs 80 'Alternate' + 467
    // 'Daily' students. A strict === could therefore NEVER match, so the plan
    // lookup always fell through: batches with one plan silently offered it even
    // when it was for the other training type (wrong rate), and batches with two
    // plans offered nothing at all. Compare case-insensitively.
    const batchPlans = feePlans.filter(p => String(p.batchId) === String(batchId))
    const want  = normTraining(trainingType)
    const exact = batchPlans.find(p => normTraining(p.trainingType) === want)
    // A plan with no training type set is generic — safe for anyone.
    const generic = batchPlans.find(p => !normTraining(p.trainingType))
    const plan = exact || generic || (batchPlans.length === 1 ? batchPlans[0] : null)
    if (plan) {
      const rate = paymentType === 'quarterly' ? plan.quarterlyFee
                 : paymentType === 'yearly'    ? plan.yearlyFee
                 : plan.monthlyFee
      return {
        plan, rate: rate || 0, source: 'plan',
        // True when we fell back to a plan meant for the OTHER training type —
        // the rate is probably wrong, so the UI says so instead of pretending.
        mismatch: !exact && !generic && !!want && normTraining(plan.trainingType) !== want,
      }
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

  // Custom coverage starting mid-month: deduct the days BEFORE the start date
  // (not covered) from whatever total the plan already charges, priced off
  // the MONTHLY rate — the only rate with a meaningful per-day price —
  // rather than computing a separate partial-month charge on top of a full
  // quarter/year. Basis (calendar days vs fixed 30-day month) is set per
  // branch in Settings > Branch Fees & Tax.
  //
  // Deliberately asks getFeePlanRate for 'monthly' specifically, regardless
  // of form.paymentType — form.baseAmount holds whatever rate matches the
  // SELECTED payment type (e.g. the quarterly total), and using that as a
  // monthly-rate fallback would deduct ~3x too much for a quarterly plan.
  // If no monthly rate can be found at all (no fee_plans row AND no batch
  // default), skip the deduction entirely rather than guess — a missing
  // discount is a support ticket, a wrong one is a trust problem.
  const prorationBasisSetting = branchForProration?.prorationBasis || 'calendar'
  const monthlyRateForProration = getFeePlanRate(form.batchId, selectedStudent?.trainingType, 'monthly')?.rate || 0
  // monthly & custom: fee × months; quarterly/yearly: entered amount is the flat total
  const preProrationAmount = (form.paymentType === 'monthly' || form.paymentType === 'custom')
    ? form.baseAmount * months
    : form.baseAmount
  // Deliberately NOT gated on customEnd >= customStart — the reversed-dates
  // error message and the disabled Confirm button both key off that check.
  const hasCustomRange = customDates && customStart && customEnd

  // A complete custom range is priced BY THE DAY instead of being left for
  // staff to type: every calendar month the range touches contributes
  // (days covered ÷ days in that month) of one month's fee. A student who
  // joins on the 14th of a 31-day month pays 18/31 of the month; a range that
  // happens to be a whole month still costs exactly one month.
  //
  // The per-month rate comes from the plan total (preProrationAmount ÷ months)
  // rather than the monthly fee plan, so a quarterly/yearly range keeps its
  // bulk discount instead of silently re-pricing at the monthly rate.
  const customRangeInfo = (() => {
    if (!hasCustomRange || customEnd < customStart) return null
    const perMonthRate = preProrationAmount / Math.max(1, months)
    if (perMonthRate <= 0) return null
    const start = new Date(customStart + 'T00:00:00')
    const end   = new Date(customEnd   + 'T00:00:00')
    const segments = []
    let cur = new Date(start.getFullYear(), start.getMonth(), 1)
    // Hard stop so a fat-fingered year can't spin the loop. Anything past 36
    // months is rejected below rather than priced.
    while (cur <= end && segments.length < 600) {
      const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
      const monthEnd    = new Date(cur.getFullYear(), cur.getMonth(), daysInMonth)
      const from = start > cur      ? start : cur
      const to   = end   < monthEnd ? end   : monthEnd
      const days = Math.round((to - from) / 86400000) + 1
      const basisDays = prorationBasisSetting === '30day' ? 30 : daysInMonth
      segments.push({
        label: `${MO[cur.getMonth()]} ${cur.getFullYear()}`,
        days, daysInMonth,
        // A whole calendar month always costs exactly one month, whatever the
        // basis — on the 30-day basis, February would otherwise bill 28/30 and
        // a 31-day month 31/30.
        fraction: days >= daysInMonth ? 1 : Math.min(days / basisDays, 1),
        full: days >= daysInMonth,
        amount: 0,
      })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    // Refuse rather than silently under-charge. Capping the loop at 36 months
    // priced a mistyped 5-year range as 36 months while still handing over the
    // full 60 months of coverage — two free years, no warning anywhere.
    if (segments.length > 36) return { tooLong: true, monthsSpan: segments.length }
    const fractionalMonths = segments.reduce((s, x) => s + x.fraction, 0)
    const amount = Math.max(0, Math.round(perMonthRate * fractionalMonths))
    // Per-month rupees are for display only, so the last one absorbs the
    // rounding — otherwise a range covering exactly one quarter shows three
    // ₹4,333 lines against a ₹13,000 total and looks like a bug.
    let acc = 0
    segments.forEach((s, i) => {
      s.amount = i === segments.length - 1 ? amount - acc : Math.round(perMonthRate * s.fraction)
      acc += s.amount
    })
    const firstBasis = prorationBasisSetting === '30day' ? 30 : (segments[0]?.daysInMonth || 30)
    return {
      segments, fractionalMonths, amount,
      totalDays:  segments.reduce((s, x) => s + x.days, 0),
      perDayRate: Math.round(perMonthRate / firstBasis),
    }
  })()

  const rangeTooLong = !!customRangeInfo?.tooLong
  // Everything downstream prices off this — a rejected range prices off nothing.
  const rangePricing = rangeTooLong ? null : customRangeInfo

  const prorationInfo = (() => {
    // A complete range is day-priced above; this is the older leading-days
    // deduction, still used while only "Covers from" has been filled in.
    if (customRangeInfo) return null
    if (!customDates || !customStart || monthlyRateForProration <= 0) return null
    const d = new Date(customStart + 'T00:00:00')
    const missingDays = d.getDate() - 1
    if (missingDays <= 0) return null   // starts on the 1st — nothing to deduct
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    const basisDays   = prorationBasisSetting === '30day' ? 30 : daysInMonth
    // Clamped to the plan's own total — an unusually low quarterly/yearly
    // rate (a heavy promo) could otherwise deduct more than is being
    // charged, producing a negative total instead of just "nothing due".
    const deduction   = Math.min(Math.round(monthlyRateForProration * missingDays / basisDays), preProrationAmount)
    return { missingDays, deduction, monthLabel: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
  })()
  const prorationDeduction = prorationInfo?.deduction || 0
  const subtotal = rangePricing ? rangePricing.amount : preProrationAmount - prorationDeduction
  const discountAmt = Math.round(subtotal * form.discountPct / 100)
  const lateFeeAmt  = Number(lateFee) || 0
  const calcAmount  = subtotal - discountAmt + lateFeeAmt
  const finalAmount = amountOverride !== null ? amountOverride : calcAmount
  // Only counts as a shortfall when the "This is a partial payment" checkbox
  // is explicitly on — otherwise the Total field is locked to calcAmount
  // (the fee-plan amount) and can't silently drift below it.
  const dueAmount = isPartialPayment ? Math.max(0, calcAmount - finalAmount) : 0
  const noteRequired = dueAmount > 0 && !form.notes.trim()

  const filteredStudents = studentSearch
    ? students.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
    : students

  const handleStudentChange = (id) => {
    const s = students.find(x => String(x.id) === String(id))
    if (!s) return
    setAmountOverride(null)
    setIsPartialPayment(false)
    setShowBackdate(false)
    setPaymentDate(toLocalDateStr())
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
    // Marking months inactive is a valid ₹0 action — nothing is collected, so
    // no invoice is written — hence zero is only blocked when money was expected.
    if (!form.studentId) return
    if (finalAmount <= 0 && !isAllInactive) return
    if (customDates && !hasCustomRange) return
    if (hasCustomRange && customEnd < customStart) return
    if (rangeTooLong) return
    if (noteRequired) return
    setLoading(true)
    try {
      const isCheque = form.mode === 'Cheque'
      const chequePrefix = isCheque && chequeNo ? `Cheque #${chequeNo} · ${bankName || 'Unknown Bank'}\n` : ''
      const inactivePrefix = inactiveList.length
        ? `Inactive (no fee) for ${inactiveList.map(m => m.label).join(', ')}\n`
        : ''
      const notes = chequePrefix + inactivePrefix + (form.notes || '')
      await onSave({
        ...form, notes,
        amount: finalAmount,
        dueAmount,                   // shortfall vs the locked fee-plan amount — becomes a linked Pending row
        monthsCovered: months,       // months actually charged for
        coverageMonths,              // months paidTill advances by (charged + inactive)
        inactiveCount: inactiveList.length,
        // Nothing collected → AppContext skips the invoice insert entirely.
        noChargeOnly: isAllInactive,
        lateFee: lateFeeAmt, paymentDate,
        advanceStart: coverageStart,
        // Manual custom coverage period — see AppContext.addPayment, this
        // exact end date wins over the month-count math above when present.
        customPaidTill: hasCustomRange ? customEnd : undefined,
        coverageEnd:    hasCustomRange ? customEnd : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

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
  //
  // Nets out prorationDeduction too, same as calcAmount does — otherwise a
  // legitimate mid-month join (Custom coverage dates) compares its correctly
  // prorated total against a NON-prorated expectation and looks like a data
  // -entry error, forcing CONFIRM on a perfectly normal payment. Most likely
  // to bite a Monthly plan, where the deduction is a large share of the one
  // month being charged.
  const expectedFullSubtotal = (form.paymentType === 'monthly' || form.paymentType === 'custom')
    ? referenceRate * months
    : referenceRate
  // A day-priced custom range has to be compared against a day-priced
  // expectation, or every legitimate mid-month join trips the 30% typo gate.
  const expectedSubtotal = rangePricing
    ? Math.round((expectedFullSubtotal / Math.max(1, months)) * rangePricing.fractionalMonths)
    : expectedFullSubtotal
  const expectedTotal = expectedSubtotal - Math.round(expectedSubtotal * form.discountPct / 100) + lateFeeAmt - prorationDeduction
  const sanityMismatch = !!(
    form.studentId &&
    referenceRate > 0 &&
    expectedTotal > 0 &&
    form.paymentType !== 'custom' &&
    Math.abs(finalAmount - expectedTotal) / expectedTotal > 0.30
  )
  const sanityRatio = sanityMismatch ? (finalAmount / expectedTotal) : 1

  // With the month picker on, coverage starts at the first pending month so the
  // payment clears arrears instead of pushing the student forward from today.
  const coverageStart = hasCustomRange ? customStart
    : monthPickerOn ? `${dueMonths[0].key}-01` : advanceStart
  // No explicit start → fall back to the 1st of the collection month, never the
  // collection day. Coverage always ends on a month boundary, so a mid-month
  // start bills for days that already elapsed (see addPayment for the full note).
  // Mirrors what addPayment actually writes, so this preview can't disagree.
  const coverageBase = coverageStart
    ? new Date(coverageStart + 'T00:00:00')
    : (() => {
        const d = new Date(paymentDate + 'T00:00:00')
        return new Date(d.getFullYear(), d.getMonth(), 1)
      })()

  // Duplicate guard: paidTill already covers the start of the new coverage period
  const coverageStartStr = hasCustomRange
    ? customStart
    : `${coverageBase.getFullYear()}-${String(coverageBase.getMonth() + 1).padStart(2, '0')}-01`
  const isDuplicate = !!(form.studentId && selectedStudent?.paidTill && selectedStudent.paidTill >= coverageStartStr)
  // CONFIRM gate covers BOTH soft duplicate (paidTill already covers this period) and sanity mismatch.
  // Without this, the duplicate warning was visual-only — server-side 60s dedupe only catches rapid double-clicks.
  const confirmTyped = confirmText.trim().toUpperCase() === 'CONFIRM'
  const confirmOk = (!sanityMismatch && !isDuplicate) || confirmTyped
  const coverageEnd  = hasCustomRange
    ? new Date(customEnd + 'T00:00:00')
    : new Date(coverageBase.getFullYear(), coverageBase.getMonth() + coverageMonths, 0)
  const fmtCoverageDate = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const coverageLabel = hasCustomRange
    ? `${fmtCoverageDate(coverageBase)} – ${fmtCoverageDate(coverageEnd)}`
    : coverageMonths === 1
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

  const handleDevFill = () => {
    const { student, mode, paymentType, discountPct } = fillPayment({ students })
    if (student) {
      setStudentSearch(student.name)
      handleStudentChange(String(student.id))
    }
    setForm(f => ({ ...f, mode, paymentType, discountPct }))
  }

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-end -mt-1 mb-1">
          <DevFillButton onFill={handleDevFill} />
        </div>

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
        {!customDates && (
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
        )}

        {/* Custom coverage date range — for a non-month-aligned billing
            period (e.g. a student who joined mid-month). Manual override:
            bypasses the plan pills and due-months picker entirely. */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={customDates}
              onChange={e => { setCustomDates(e.target.checked); setAmountOverride(null) }}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-xs font-semibold text-gray-700">Custom coverage dates</span>
          </label>
          {customDates && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-gray-500">Covers from</label>
                <input type="date" className="input w-full" value={customStart}
                  onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500">Covers until</label>
                <input type="date" className="input w-full" value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)} />
              </div>
              {hasCustomRange && customEnd < customStart && (
                <p className="col-span-2 text-xs text-red-600">"Covers until" must be on or after "Covers from".</p>
              )}
              <p className="col-span-2 text-[11px] text-gray-400">
                {rangeTooLong
                  ? <span className="text-red-600 font-semibold">That range covers {customRangeInfo.monthsSpan} months. Split it into periods of 36 months or less.</span>
                  : !rangePricing
                  ? 'Pick both dates — the fee is worked out by the day for exactly this period.'
                  : rangePricing.segments.length === 1
                  ? <>Charged by the day: {rangePricing.totalDays} day{rangePricing.totalDays === 1 ? '' : 's'} × ₹{rangePricing.perDayRate.toLocaleString('en-IN')}/day
                      {' '}({prorationBasisSetting === '30day' ? '30-day month' : 'calendar month'} basis).
                      {' '}Change the fee above to change the day rate.</>
                  : <>Whole months at the full rate, part-months by the day
                      {' '}({prorationBasisSetting === '30day' ? '30-day month' : 'calendar month'} basis) — see the month-by-month split below.</>}
              </p>
            </div>
          )}
        </div>

        {/* Fee plan / batch reference info */}
        {(activePlanData || typicalBatchFee > 0) && (
          <div className={`border rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 ${
            activePlanData?.mismatch
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-brand-50 border-brand-100 text-brand-700'
          }`}>
            {activePlanData ? (
              activePlanData.source === 'plan' ? (
                <span>
                  <span className="font-semibold">{activePlanData.plan.name}</span>
                  {trainingLabel(activePlanData.plan.trainingType) && (
                    <>
                      <span className="opacity-50 mx-1.5">·</span>
                      {trainingLabel(activePlanData.plan.trainingType)}
                    </>
                  )}
                  <span className="opacity-50 mx-1.5">·</span>
                  M ₹{activePlanData.plan.monthlyFee?.toLocaleString('en-IN')}
                  {activePlanData.plan.quarterlyFee > 0 && <> · Q ₹{activePlanData.plan.quarterlyFee?.toLocaleString('en-IN')}</>}
                  {activePlanData.plan.yearlyFee > 0 && <> · Y ₹{activePlanData.plan.yearlyFee?.toLocaleString('en-IN')}</>}
                  {activePlanData.mismatch && (
                    <span className="block mt-0.5 font-semibold">
                      ⚠ No {trainingLabel(selectedStudent?.trainingType) || 'matching'} plan for this batch — showing the{' '}
                      {trainingLabel(activePlanData.plan.trainingType)} rate. Check before charging.
                    </span>
                  )}
                </span>
              ) : (
                <span>Batch default: <span className="font-semibold">₹{activePlanData.plan.monthlyFee?.toLocaleString('en-IN')}/month</span></span>
              )
            ) : (
              <span>
                Other students in this batch pay <span className="font-semibold">₹{typicalBatchFee.toLocaleString('en-IN')}/month</span>
                <span className="opacity-60 ml-1">({batchmateFees.length} students)</span>
              </span>
            )}
            <button type="button"
              className="font-bold hover:underline whitespace-nowrap"
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

        {/* Pending months — tick to charge, untick if the student was inactive */}
        {monthPickerOn && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 border-b border-gray-200">
              <div>
                <p className="text-xs font-semibold text-gray-800">
                  {dueMonths.length} month{dueMonths.length !== 1 ? 's' : ''} pending
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Untick a month the student was inactive — no fee, no invoice, and it stops showing as due
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setInactiveMonths([])}
                  className="text-[11px] font-medium text-gray-600 hover:text-gray-900 border border-gray-200 bg-white px-2 py-1 rounded-lg transition-colors"
                >Charge all</button>
                <button
                  type="button"
                  onClick={() => setInactiveMonths(dueMonths.map(d => d.key))}
                  className="text-[11px] font-medium text-gray-600 hover:text-gray-900 border border-gray-200 bg-white px-2 py-1 rounded-lg transition-colors"
                >All inactive</button>
              </div>
            </div>

            <div className="divide-y divide-gray-100 max-h-52 overflow-y-auto">
              {dueMonths.map(d => {
                const inactive = inactiveMonths.includes(d.key)
                return (
                  <label
                    key={d.key}
                    className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={!inactive}
                      onChange={() => setInactiveMonths(prev =>
                        prev.includes(d.key) ? prev.filter(k => k !== d.key) : [...prev, d.key]
                      )}
                      className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 shrink-0"
                    />
                    <span className={`text-sm flex-1 flex items-center gap-1.5 ${inactive ? 'text-gray-400' : 'text-gray-800'}`}>
                      {d.label}
                      {!inactive && lowAttendance[d.key] != null && lowAttendance[d.key] < 4 && (
                        <span
                          className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                          title="Fewer than 4 sessions attended this month — consider marking inactive instead of charging"
                        >
                          ⚠ {lowAttendance[d.key]} session{lowAttendance[d.key] === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    {inactive ? (
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                        Inactive
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600 tabular-nums">
                        ₹{form.baseAmount.toLocaleString('en-IN')}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            <div className="flex items-center justify-between px-3.5 py-2 bg-gray-50 border-t border-gray-200 text-xs">
              <span className="text-gray-500">
                Charging <strong className="text-gray-800 tabular-nums">{billedMonths.length}</strong> of{' '}
                <span className="tabular-nums">{dueMonths.length}</span>
                {inactiveList.length > 0 && (
                  <span> · {inactiveList.length} inactive</span>
                )}
              </span>
              <span className="text-gray-500">
                Covered through <strong className="text-gray-800">{dueMonths[dueMonths.length - 1].label}</strong>
              </span>
            </div>

            {/* Unticking still advances coverage — that is a write-off, so state
                the rupee value plainly instead of leaving it to be inferred. */}
            {inactiveList.length > 0 && !isAllInactive && (
              <div className="px-3.5 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
                <strong>Writing off ₹{(form.baseAmount * inactiveList.length).toLocaleString('en-IN')}</strong>
                {' '}— {inactiveList.map(m => m.label).join(', ')} will be marked covered but never charged.
              </div>
            )}
          </div>
        )}

        {isAllInactive && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-700 space-y-1">
            <p>
              <strong className="text-gray-900">
                All {dueMonths.length} month{dueMonths.length !== 1 ? 's' : ''} marked inactive.
              </strong>{' '}
              Nothing is collected, so <strong>no invoice is created</strong> and revenue
              is untouched. {form.student || 'The student'} stops being due through{' '}
              {dueMonths[dueMonths.length - 1].label}.
            </p>
            <p className="text-gray-500">
              Status stays <strong>{selectedStudent?.status || '—'}</strong>
              {isSuspended && ' — reactivate from the Students page when they return'}.
            </p>
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
            {hasCustomRange
              ? <span>{rangePricing
                  // The day rate is only quoted for a range inside ONE month.
                  // Across months each month has its own day rate (a month's
                  // fee ÷ its own length) and whole months are charged whole,
                  // so "77 days × ₹144" would not multiply out to the total.
                  ? rangePricing.segments.length === 1
                    ? `Custom period · ${rangePricing.totalDays} day${rangePricing.totalDays === 1 ? '' : 's'} @ ₹${rangePricing.perDayRate.toLocaleString('en-IN')}/day`
                    : `Custom period · ${rangePricing.totalDays} days · ${rangePricing.fractionalMonths.toFixed(2)} months`
                  : 'Custom period · amount set below'}</span>
              : monthPickerOn
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × {months} month{months !== 1 ? 's' : ''} charged</span>
              : form.paymentType === 'monthly'
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × 1 month</span>
              : form.paymentType === 'custom'
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × {customMonths} months</span>
              : <span>₹{form.baseAmount.toLocaleString('en-IN')} ({form.paymentType} flat · {months} months)</span>
            }
            <span>₹{subtotal.toLocaleString('en-IN')}</span>
          </div>
          {rangePricing && (
            <div className="space-y-0.5 pl-2 border-l-2 border-gray-200">
              {rangePricing.segments.map(s => (
                <div key={s.label} className="flex justify-between text-[11px] text-gray-400">
                  <span>{s.label} · {s.full ? 'full month' : `${s.days} of ${s.daysInMonth} days`}</span>
                  <span>₹{s.amount.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
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
          {prorationInfo && (
            <div className="flex justify-between text-xs text-emerald-600 font-medium">
              <span>Partial month — {prorationInfo.missingDays} day{prorationInfo.missingDays === 1 ? '' : 's'} before join ({prorationInfo.monthLabel})</span>
              <span>−₹{prorationInfo.deduction.toLocaleString('en-IN')}</span>
            </div>
          )}
          {form.baseAmount <= 0 && lateFeeAmt > 0 && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-1">
              <span className="text-sm leading-none mt-0.5">⚠</span>
              <span>Late fee only — no months are being charged, so this does not extend coverage. {form.student || 'The student'} stays due for the same period.</span>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-gray-600 pt-2 mt-1 border-t border-gray-200 cursor-pointer">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 rounded accent-amber-600"
              checked={isPartialPayment}
              onChange={e => { setIsPartialPayment(e.target.checked); if (!e.target.checked) setAmountOverride(null) }}
            />
            This is a partial payment — parent is paying less than the full amount
          </label>
          <div className="flex justify-between items-center text-sm font-black text-gray-900 pt-1">
            <span>Total <span className="text-[10px] font-normal text-gray-400">{isPartialPayment ? '(editable)' : '(locked to fee plan)'}</span></span>
            <input
              type="number" min="0"
              disabled={!isPartialPayment}
              className={`w-32 text-right font-black rounded-lg px-2 py-1 text-sm focus:outline-none ${
                isPartialPayment
                  ? 'text-gray-900 bg-white border border-gray-200 focus:border-brand-400'
                  : 'text-gray-500 bg-gray-100 border border-gray-200 cursor-not-allowed'
              }`}
              value={finalAmount}
              onChange={e => setAmountOverride(Number(e.target.value))}
            />
          </div>
          {isPartialPayment && finalAmount > calcAmount && (
            <p className="text-[11px] text-gray-500 mt-1">
              That is ₹{(finalAmount - calcAmount).toLocaleString('en-IN')} more than the fee — recorded as an overpayment, with no balance due.
            </p>
          )}
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
          {dueAmount > 0 && (
            <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 text-xs text-amber-700">
              <span className="text-base leading-none mt-0.5 shrink-0">⚠</span>
              <span>
                Full fee is <strong>₹{calcAmount.toLocaleString('en-IN')}</strong> — the remaining{' '}
                <strong>₹{dueAmount.toLocaleString('en-IN')}</strong> will be recorded as a separate <strong>Due</strong> balance
                for this student. Add a note below explaining why.
              </span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="label">
            Notes {dueAmount > 0
              ? <span className="text-amber-600 font-semibold">(required — explain the partial payment)</span>
              : <span className="text-gray-400 font-normal">(optional)</span>}
          </label>
          <input className={`input ${noteRequired ? 'border-amber-300 focus:border-amber-500' : ''}`}
            placeholder="e.g. cheque #1234, partial payment, sibling discount…"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {/* Payment Date + Mode */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {isSuspended && !showBackdate ? (
              <>
                <label className="label">Payment Date</label>
                <button type="button"
                  className="input text-left text-xs text-brand-600 font-semibold hover:bg-brand-50"
                  onClick={() => setShowBackdate(true)}>
                  Today — bill for skipped months?
                </button>
              </>
            ) : (
              <>
                <label className="label">
                  Payment Date
                  {isSuspended && <span className="text-gray-400 font-normal"> — backdating bills the skipped months too</span>}
                </label>
                <input className="input" type="date"
                  value={paymentDate}
                  max={toLocalDateStr()}
                  onChange={e => setPaymentDate(e.target.value)} />
              </>
            )}
          </div>
          <div>
            <label className="label">Payment Mode</label>
            <select className="input" value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
              {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Cheque details */}
        {form.mode === 'Cheque' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
              <span className="text-base leading-none mt-0.5">🏦</span>
              <span>Cheque payments are saved as <strong>Pending</strong> until you mark them Paid once the cheque clears.</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cheque Number</label>
                <input className="input font-mono" placeholder="e.g. 001234" value={chequeNo} onChange={e => setChequeNo(e.target.value)} />
              </div>
              <div>
                <label className="label">Bank Name</label>
                <input className="input" placeholder="e.g. SBI, HDFC…" value={bankName} onChange={e => setBankName(e.target.value)} />
              </div>
            </div>
          </div>
        )}

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
          disabled={loading || (finalAmount <= 0 && !isAllInactive) || !confirmOk || noteRequired
            || rangeTooLong
            || (customDates && (!hasCustomRange || customEnd < customStart))}
        >
          {loading ? '…'
            : isAllInactive ? `Mark ${dueMonths.length} month${dueMonths.length !== 1 ? 's' : ''} inactive`
            : isDuplicate ? `Record Anyway · ₹${finalAmount.toLocaleString('en-IN')}`
            : dueAmount > 0 ? `Confirm · ₹${finalAmount.toLocaleString('en-IN')} (₹${dueAmount.toLocaleString('en-IN')} due)`
            : `Confirm · ₹${finalAmount.toLocaleString('en-IN')}`}
        </button>
      </div>
    </Modal>
  )
}
