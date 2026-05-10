import { useState, useMemo, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { CreditCard, Plus, Search, Download, CheckCircle, Clock, AlertCircle, X, Pencil } from 'lucide-react'
import { Modal } from './Students'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const STATUS_MAP = {
  Paid:    { cls: 'badge-green',  icon: CheckCircle, iconCls: 'text-emerald-500' },
  Pending: { cls: 'badge-yellow', icon: Clock,       iconCls: 'text-amber-500' },
  Overdue: { cls: 'badge-red',    icon: AlertCircle, iconCls: 'text-red-500' },
}

export default function Payments() {
  const { payments, students, batches, addPayment, markPaymentPaid, updatePaymentDate } = useApp()
  const [editingDate, setEditingDate] = useState(null) // paymentId being edited

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('All')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
  const [monthFilter,     setMonthFilter]     = useState(new Date().toISOString().slice(0, 7))
  const [showModal,       setShowModal]       = useState(false)
  const [payForStudent,   setPayForStudent]   = useState(null)

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
      .filter(s =>
        (s.status === 'Active' || s.status === 'Suspended') &&
        s.paidTill &&
        s.paidTill < firstOfMonth &&
        !studentsWithPendingRecord.has(s.id)
      )
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

  const filtered = allRecords.filter(p => {
    const q       = search.toLowerCase()
    const matchQ  = !q || (p.student || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q)
    const matchS  = statusFilter === 'All' || p.status === statusFilter
    const stu     = studentMap[p.studentId]
    const matchSport = sportFilter === 'All' || stu?.sport === sportFilter
    const matchBatch = batchFilter === 'All' || stu?.batch === batchFilter
    const matchMonth = !monthFilter || p.isVirtual || (p.date && p.date.slice(0, 7) === monthFilter)
    return matchQ && matchS && matchSport && matchBatch && matchMonth
  })

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
          <select className="input w-auto" value={sportFilter}
            onChange={e => { setSportFilter(e.target.value); setBatchFilter('All') }}>
            <option value="All">All Sports</option>
            {sportOptions.map(s => <option key={s}>{s}</option>)}
          </select>
          <select className="input w-auto" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="All">All Batches</option>
            {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          {(sportFilter !== 'All' || batchFilter !== 'All') && (
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
              {filtered.map(p => {
                const sm = STATUS_MAP[p.status] || STATUS_MAP.Overdue
                return (
                  <tr key={p.id} className={`hover:bg-gray-50/60 transition ${p.isVirtual ? 'bg-red-50/30' : ''}`}>
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
                    <td className="px-4 py-3">
                      {p.isVirtual ? (
                        <button
                          className="text-xs text-red-600 font-semibold hover:underline"
                          onClick={() => setPayForStudent(studentMap[p.studentId])}
                        >
                          Record Payment
                        </button>
                      ) : p.status !== 'Paid' ? (
                        <button
                          className="text-xs text-brand-600 font-semibold hover:underline"
                          onClick={() => markPaymentPaid(p.id, 'UPI')}
                        >
                          Mark Paid
                        </button>
                      ) : (
                        <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                          <Download size={12} /> Receipt
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <RecordPaymentModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addPayment(data); setShowModal(false) }}
          students={students}
          batches={batches}
        />
      )}
      {payForStudent && (
        <RecordPaymentModal
          onClose={() => setPayForStudent(null)}
          onSave={async (data) => { await addPayment(data); setPayForStudent(null) }}
          students={students}
          batches={batches}
          initialStudentId={payForStudent.id}
        />
      )}
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

export function RecordPaymentModal({ onClose, onSave, students, batches = [], initialStudentId }) {
  const initStudent = students.find(s => s.id === initialStudentId) || students[0] || {}
  const [form, setForm] = useState({
    studentId:   initStudent.id       || '',
    student:     initStudent.name     || '',
    baseAmount:  initStudent.fees     || 0,
    paymentType: initStudent.feePlan  || 'monthly',
    discountPct: 0,
    batchId:     String(initStudent.batchId || initStudent.lastBatchId || ''),
    batchName:   initStudent.batch || initStudent.lastBatchName || '',
    mode:        'UPI',
  })
  const [loading,        setLoading]       = useState(false)
  const [studentSearch,  setStudentSearch] = useState('')
  const [amountOverride, setAmountOverride] = useState(null)
  const [paymentDate,    setPaymentDate]   = useState(new Date().toISOString().split('T')[0])

  const months      = form.paymentType === 'quarterly' ? 3 : form.paymentType === 'yearly' ? 12 : 1
  // For quarterly/yearly the entered amount IS the flat total — no multiplication
  const subtotal    = form.paymentType === 'monthly' ? form.baseAmount : form.baseAmount
  const discountAmt = Math.round(form.baseAmount * form.discountPct / 100)
  const calcAmount  = form.baseAmount - discountAmt
  const finalAmount = amountOverride !== null ? amountOverride : calcAmount

  const filteredStudents = studentSearch
    ? students.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
    : students

  const handleStudentChange = (id) => {
    const s = students.find(x => String(x.id) === String(id))
    if (!s) return
    setAmountOverride(null)
    setForm(f => ({
      ...f,
      studentId:   s.id,
      student:     s.name,
      baseAmount:  s.fees || 0,
      paymentType: s.feePlan || 'monthly',
      batchId:     String(s.batchId || s.lastBatchId || ''),
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
      await onSave({ ...form, amount: finalAmount, paymentDate })
    } finally {
      setLoading(false)
    }
  }

  const selectedStudent = students.find(s => String(s.id) === String(form.studentId))
  const isSuspended = selectedStudent?.status === 'Suspended'

  const PLAN_OPTS = [
    { key: 'monthly',   label: 'Monthly',   sub: '1 month'   },
    { key: 'quarterly', label: 'Quarterly', sub: '3 months'  },
    { key: 'yearly',    label: 'Yearly',    sub: '12 months' },
  ]

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div className="space-y-4">

        {/* Student */}
        <div>
          <label className="label">Student</label>
          <input
            className="input mb-1.5"
            placeholder="Search by name…"
            value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)}
          />
          <select className="input" value={form.studentId} onChange={e => handleStudentChange(e.target.value)}>
            <option value="">— Select student —</option>
            {filteredStudents.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status === 'Suspended' ? ' (Suspended)' : ''}{s.trainingType === 'Alternate' ? ' · Alt' : ''}
              </option>
            ))}
          </select>
          {isSuspended && (
            <p className="text-xs text-amber-600 mt-1 font-semibold">
              ⚠ Suspended — payment will reactivate this student.
            </p>
          )}
        </div>

        {/* Payment plan pills */}
        <div>
          <label className="label">Payment Plan</label>
          <div className="grid grid-cols-3 gap-2">
            {PLAN_OPTS.map(pt => (
              <button key={pt.key} type="button"
                onClick={() => { setAmountOverride(null); setForm(f => ({ ...f, paymentType: pt.key })) }}
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
        </div>

        {/* Fee amount + discount */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{{ monthly: 'Monthly Fee (₹)', quarterly: 'Quarterly Fee (₹)', yearly: 'Yearly Fee (₹)' }[form.paymentType] || 'Fee (₹)'}</label>
            <input className="input" type="number" min="0" value={form.baseAmount}
              onChange={e => { setAmountOverride(null); setForm(f => ({ ...f, baseAmount: Number(e.target.value) })) }} />
          </div>
          <div>
            <label className="label">Discount (%)</label>
            <input className="input" type="number" min="0" max="100" value={form.discountPct}
              onChange={e => setForm(f => ({ ...f, discountPct: Number(e.target.value) }))} />
          </div>
        </div>

        {/* Amount breakdown */}
        <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
          <div className="flex justify-between text-xs text-gray-500">
            {form.paymentType === 'monthly'
              ? <span>₹{form.baseAmount.toLocaleString('en-IN')} × 1 month</span>
              : <span>₹{form.baseAmount.toLocaleString('en-IN')} ({form.paymentType} flat rate · {months} months)</span>
            }
            <span>₹{form.baseAmount.toLocaleString('en-IN')}</span>
          </div>
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
        </div>

        {/* Batch */}
        <div>
          <label className="label">Assign Batch {isSuspended ? '— last: ' + (selectedStudent?.lastBatchName || '—') : ''}</label>
          <select className="input" value={form.batchId} onChange={e => handleBatchChange(e.target.value)}>
            <option value="">— No batch —</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.capacity - b.enrolled} seats left
              </option>
            ))}
          </select>
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
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading || finalAmount <= 0}>
          {loading ? '…' : `Confirm · ₹${finalAmount.toLocaleString('en-IN')}`}
        </button>
      </div>
    </Modal>
  )
}
