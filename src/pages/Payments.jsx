import { useState } from 'react'
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
  const { payments, students, addPayment, markPaymentPaid } = useApp()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showModal, setShowModal] = useState(false)

  const filtered = payments.filter(p => {
    const q = search.toLowerCase()
    const matchQ = !q || p.student.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    const matchS = statusFilter === 'All' || p.status === statusFilter
    return matchQ && matchS
  })

  const paid     = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const pending  = payments.filter(p => p.status === 'Pending').reduce((s, p) => s + p.amount, 0)
  const overdue  = payments.filter(p => p.status === 'Overdue').reduce((s, p) => s + p.amount, 0)

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
        <SummaryCard label="Overdue" value={`₹${overdue.toLocaleString('en-IN')}`} count={payments.filter(p=>p.status==='Overdue').length} color="red" />
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
      <div className="card p-4 flex flex-wrap gap-3 items-center">
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
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold border transition ${statusFilter===s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {s}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} records</span>
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
                const sm = STATUS_MAP[p.status]
                return (
                  <tr key={p.id} className="hover:bg-gray-50/60 transition">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.id}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{p.student}</td>
                    <td className="px-4 py-3 text-gray-600">{p.month}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">₹{p.amount.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.mode || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.date || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${sm.cls}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      {p.status !== 'Paid' ? (
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

      {showModal && <RecordPaymentModal onClose={() => setShowModal(false)} onSave={addPayment} students={students} />}
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

function RecordPaymentModal({ onClose, onSave, students }) {
  const [form, setForm] = useState({
    studentId: students[0]?.id || '',
    student: students[0]?.name || '',
    amount: students[0]?.fees || 2000,
    month: 'May 2026',
    mode: 'UPI',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleStudentChange = (id) => {
    const s = students.find(x => x.id === Number(id))
    if (s) setForm(f => ({ ...f, studentId: s.id, student: s.name, amount: s.fees }))
  }

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Student</label>
          <select className="input" value={form.studentId} onChange={e => handleStudentChange(e.target.value)}>
            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fee Month</label>
          <input className="input" value={form.month} onChange={e => set('month', e.target.value)} placeholder="e.g. May 2026" />
        </div>
        <div>
          <label className="label">Amount (₹)</label>
          <input className="input" type="number" value={form.amount} onChange={e => set('amount', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Payment Mode</label>
          <select className="input" value={form.mode} onChange={e => set('mode', e.target.value)}>
            {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card'].map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { onSave(form); onClose() }}>Record Payment</button>
      </div>
    </Modal>
  )
}
