import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { CreditCard, Plus, Search, Download, CheckCircle, Clock, AlertCircle, X } from 'lucide-react'
import { Modal } from './Students'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { revenueData } from '../data/mockData'

const STATUS_MAP = {
  Paid:    { cls: 'badge-green',  icon: CheckCircle, iconCls: 'text-emerald-500' },
  Pending: { cls: 'badge-yellow', icon: Clock,       iconCls: 'text-amber-500' },
  Overdue: { cls: 'badge-red',    icon: AlertCircle, iconCls: 'text-red-500' },
}

export default function Payments() {
  const { payments, students, batches, addPayment, markPaymentPaid } = useApp()

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('All')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
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

  // Virtual overdue rows: active students with an expired paid_till and no pending payment already recorded
  const overdueRows = useMemo(() => {
    const studentsWithPendingRecord = new Set(
      payments.filter(p => p.status === 'Overdue' || p.status === 'Pending').map(p => p.studentId)
    )
    return students
      .filter(s =>
        s.status === 'Active' &&
        s.paidTill &&
        s.paidTill < firstOfMonth &&
        !studentsWithPendingRecord.has(s.id)
      )
      .map(s => ({
        id:        `DUE-${s.id}`,
        studentId: s.id,
        student:   s.name,
        amount:    s.fees || 0,
        month:     `Due — paid till ${new Date(s.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
        date:      null,
        status:    'Overdue',
        mode:      null,
        isVirtual: true,
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
    return matchQ && matchS && matchSport && matchBatch
  })

  const paid          = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + (p.amount ?? 0), 0)
  const pending       = payments.filter(p => p.status === 'Pending').reduce((s, p) => s + (p.amount ?? 0), 0)
  const overdueAmt    = [...payments.filter(p => p.status === 'Overdue'), ...overdueRows].reduce((s, p) => s + (p.amount ?? 0), 0)
  const overdueCount  = payments.filter(p => p.status === 'Overdue').length + overdueRows.length

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
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Collected" value={`₹${paid.toLocaleString('en-IN')}`} count={payments.filter(p=>p.status==='Paid').length} color="emerald" />
        <SummaryCard label="Pending" value={`₹${pending.toLocaleString('en-IN')}`} count={payments.filter(p=>p.status==='Pending').length} color="amber" />
        <SummaryCard label="Overdue" value={`₹${overdueAmt.toLocaleString('en-IN')}`} count={overdueCount} color="red" />
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
            <Bar dataKey="target" fill="#e5e7eb" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Row 1: search + status pills */}
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
                    <td className="px-4 py-3 font-semibold text-gray-900">{p.student}</td>
                    <td className="px-4 py-3 text-gray-600">{p.month}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">₹{(p.amount ?? 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.mode || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.date || '—'}</td>
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

function SummaryCard({ label, value, count, color }) {
  const c = { emerald: 'text-emerald-600 bg-emerald-50', amber: 'text-amber-600 bg-amber-50', red: 'text-red-600 bg-red-50' }[color]
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-black ${c.split(' ')[0]}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{count} {count === 1 ? 'payment' : 'payments'}</p>
    </div>
  )
}

export function RecordPaymentModal({ onClose, onSave, students, batches = [], initialStudentId }) {
  const initStudent = students.find(s => s.id === initialStudentId) || students[0] || {}
  const [form, setForm] = useState({
    studentId:   initStudent.id    || '',
    student:     initStudent.name  || '',
    baseAmount:  initStudent.fees  || 0,
    paymentType: 'monthly',
    discountPct: 0,
    batchId:     String(initStudent.batchId || initStudent.lastBatchId || ''),
    batchName:   initStudent.batch || initStudent.lastBatchName || '',
    mode:        'UPI',
  })
  const [loading, setLoading] = useState(false)

  const months     = form.paymentType === 'quarterly' ? 3 : form.paymentType === 'yearly' ? 12 : 1
  const subtotal   = form.baseAmount * months
  const discountAmt = Math.round(subtotal * form.discountPct / 100)
  const finalAmount = subtotal - discountAmt

  const handleStudentChange = (id) => {
    const s = students.find(x => String(x.id) === String(id))
    if (!s) return
    setForm(f => ({
      ...f,
      studentId:  s.id,
      student:    s.name,
      baseAmount: s.fees || 0,
      batchId:    String(s.batchId || s.lastBatchId || ''),
      batchName:  s.batch || s.lastBatchName || '',
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
      await onSave({ ...form, amount: finalAmount })
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
          <select className="input" value={form.studentId} onChange={e => handleStudentChange(e.target.value)}>
            <option value="">— Select student —</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status === 'Suspended' ? ' (Suspended)' : ''}
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
                onClick={() => setForm(f => ({ ...f, paymentType: pt.key }))}
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

        {/* Monthly rate + discount */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Monthly Fee (₹)</label>
            <input className="input" type="number" min="0" value={form.baseAmount}
              onChange={e => setForm(f => ({ ...f, baseAmount: Number(e.target.value) }))} />
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
            <span>₹{form.baseAmount.toLocaleString('en-IN')} × {months} month{months > 1 ? 's' : ''}</span>
            <span>₹{subtotal.toLocaleString('en-IN')}</span>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-xs text-emerald-600 font-medium">
              <span>Discount ({form.discountPct}%)</span>
              <span>−₹{discountAmt.toLocaleString('en-IN')}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-2 mt-1">
            <span>Total</span>
            <span>₹{finalAmount.toLocaleString('en-IN')}</span>
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

        {/* Mode */}
        <div>
          <label className="label">Payment Mode</label>
          <select className="input" value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
            {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card'].map(m => <option key={m}>{m}</option>)}
          </select>
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
