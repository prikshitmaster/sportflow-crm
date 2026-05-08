// Reports — professional Tally-style financial + operational reports
//
// Tabs:
//  Overview     — KPI cards + revenue bar chart
//  Financial    — Ledger-style fee collection table (Tally look)
//  By Batch     — Branch-wise revenue, headcount, attendance %
//  Students     — Per-student fee ledger with running balance
//  Attendance   — Batch + student attendance report

import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Download, TrendingUp, Users, CreditCard, UserPlus,
  ChevronDown, BarChart3, BookOpen, Layers, CalendarCheck,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────

const INR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Build month options for last 12 months
function buildMonthOptions() {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    opts.push({
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    })
  }
  return opts
}

const MONTH_OPTS = buildMonthOptions()

// ── Main component ────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: BarChart3 },
  { id: 'financial',   label: 'Financial',   icon: BookOpen },
  { id: 'by_batch',    label: 'By Batch',    icon: Layers },
  { id: 'students',    label: 'Students',    icon: Users },
  { id: 'attendance',  label: 'Attendance',  icon: CalendarCheck },
]

export default function Reports() {
  const { students, payments, trials, batches, attendanceData } = useApp()
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Reports & Analytics</h2>
          <p className="text-sm text-gray-500">Financial ledger, batch performance, attendance analysis</p>
        </div>
        <button className="btn-secondary text-xs">
          <Download size={14} /> Export
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'overview'   && <OverviewTab students={students} payments={payments} trials={trials} />}
      {activeTab === 'financial'  && <FinancialTab payments={payments} />}
      {activeTab === 'by_batch'   && <BatchTab batches={batches} students={students} payments={payments} attendanceData={attendanceData} />}
      {activeTab === 'students'   && <StudentLedgerTab students={students} payments={payments} />}
      {activeTab === 'attendance' && <AttendanceTab students={students} batches={batches} attendanceData={attendanceData} />}
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────

function OverviewTab({ students, payments, trials }) {
  const activeCount  = students.filter(s => s.status === 'Active').length
  const collected    = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const pending      = payments.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
  const convRate     = trials.length ? Math.round((trials.filter(t => t.converted).length / trials.length) * 100) : 0

  // Build monthly revenue from real payments
  const monthlyRevenue = useMemo(() => {
    const map = {}
    payments.forEach(p => {
      if (!p.date) return
      const key = p.date.slice(0, 7)  // YYYY-MM
      if (!map[key]) map[key] = { collected: 0, pending: 0 }
      if (p.status === 'Paid') map[key].collected += p.amount
      else map[key].pending += p.amount
    })
    return MONTH_OPTS.slice(0, 6).reverse().map(m => ({
      month: m.label.split(' ')[0],
      collected: map[m.value]?.collected || 0,
      pending:   map[m.value]?.pending   || 0,
    }))
  }, [payments])

  const overdueList = payments.filter(p => p.status === 'Overdue')
    .sort((a, b) => b.amount - a.amount).slice(0, 8)

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Students', value: activeCount,       icon: Users,      color: 'text-brand-600',   bg: 'bg-brand-50' },
          { label: 'Total Collected', value: INR(collected),    icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pending / Due',   value: INR(pending),      icon: CreditCard, color: 'text-amber-600',   bg: 'bg-amber-50' },
          { label: 'Trial Conv. Rate',value: `${convRate}%`,    icon: UserPlus,   color: 'text-purple-600',  bg: 'bg-purple-50' },
        ].map(k => (
          <div key={k.label} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{k.label}</p>
              <div className={`w-9 h-9 ${k.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <k.icon size={18} className={k.color} />
              </div>
            </div>
            <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-gray-900">Monthly Collection</h3>
            <p className="text-xs text-gray-500">Collected vs Pending — last 6 months</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-500 rounded-sm inline-block" />Collected</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />Pending</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyRevenue} margin={{ top: 0, right: 0, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
              tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v, n) => [INR(v), n === 'collected' ? 'Collected' : 'Pending']}
              contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            <Bar dataKey="collected" fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="pending"   fill="#fbbf24" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Overdue list */}
      {overdueList.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-4">Overdue Collections</h3>
          <div className="space-y-2.5">
            {overdueList.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{p.student}</p>
                  <p className="text-xs text-gray-400">{p.month}</p>
                </div>
                <p className="text-sm font-bold text-red-600">{INR(p.amount)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between">
            <p className="text-xs font-semibold text-gray-500">Total Overdue</p>
            <p className="text-sm font-black text-red-600">
              {INR(overdueList.reduce((s, p) => s + p.amount, 0))}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Financial Ledger (Tally-style) ───────────────────
// Columns: Date | Invoice | Student | Batch | Amount | Mode | Status
// Shows monthly subtotals, grand total at bottom — like Tally's ledger

function FinancialTab({ payments }) {
  const [monthFilter, setMonthFilter] = useState(MONTH_OPTS[0].value)
  const [statusFilter, setStatusFilter] = useState('All')

  const filtered = useMemo(() => {
    return payments.filter(p => {
      const matchMonth  = !monthFilter || (p.date || '').startsWith(monthFilter) || (p.month || '').includes(MONTH_OPTS.find(m => m.value === monthFilter)?.label.split(' ')[0] || '')
      const matchStatus = statusFilter === 'All' || p.status === statusFilter
      return matchMonth && matchStatus
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [payments, monthFilter, statusFilter])

  const totalCollected = filtered.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const totalPending   = filtered.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)

  const statusColor = {
    'Paid':    'bg-emerald-100 text-emerald-700',
    'Pending': 'bg-amber-100 text-amber-700',
    'Overdue': 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={monthFilter} onChange={setMonthFilter} label="Month">
          {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        <Select value={statusFilter} onChange={setStatusFilter} label="Status">
          {['All','Paid','Pending','Overdue'].map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <p className="text-xs text-gray-400 ml-auto">{filtered.length} entries</p>
      </div>

      {/* Summary row — Tally-style totals at top */}
      <div className="grid grid-cols-3 gap-3">
        <TallyKPI label="Total Billed"     value={INR(totalCollected + totalPending)} color="text-gray-900" />
        <TallyKPI label="Collected (Dr)"   value={INR(totalCollected)}               color="text-emerald-700" />
        <TallyKPI label="Outstanding (Cr)" value={INR(totalPending)}                 color="text-red-600" />
      </div>

      {/* Ledger table */}
      <div className="card overflow-hidden">
        {/* Table header — Tally-like */}
        <div className="bg-gray-800 text-white grid grid-cols-[1fr_1.2fr_1fr_1fr_auto] gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wide">
          <span>Date</span>
          <span>Student</span>
          <span className="hidden sm:block">Month / Desc</span>
          <span className="text-right">Amount</span>
          <span>Status</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No records for this period</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((p, i) => (
              <div key={p.id || i}
                className="grid grid-cols-[1fr_1.2fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center hover:bg-gray-50 transition">
                <span className="text-xs text-gray-500 font-mono">
                  {p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.student}</p>
                  <p className="text-xs text-gray-400">{p.id}</p>
                </div>
                <span className="text-xs text-gray-500 hidden sm:block truncate">{p.month}</span>
                <span className="text-sm font-bold text-gray-900 text-right tabular-nums">
                  {INR(p.amount)}
                </span>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Grand total footer — Tally-style bold border */}
        <div className="bg-gray-50 border-t-2 border-gray-300 grid grid-cols-[1fr_1.2fr_1fr_1fr_auto] gap-3 px-4 py-3">
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wide col-span-3">Grand Total</span>
          <span className="text-sm font-black text-gray-900 text-right tabular-nums">
            {INR(filtered.reduce((s, p) => s + p.amount, 0))}
          </span>
          <span />
        </div>
      </div>
    </div>
  )
}

// ── Tab: By Batch ─────────────────────────────────────────
// Each batch row: Batch | Students | Expected ₹ | Collected ₹ | Pending ₹ | Att%

function BatchTab({ batches, students, payments, attendanceData }) {
  const today = new Date().toISOString().split('T')[0]
  const todayAtt = attendanceData[today] || {}

  const rows = useMemo(() => {
    return batches.map(b => {
      const batchStudents = students.filter(
        s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name)
      )
      // Expected = fee_amount × number of students in batch
      const expected  = batchStudents.reduce((s, st) => s + (st.feeAmount || st.fees || 0), 0)
      // Collected = payments where student is in this batch + Paid
      const studentNames = new Set(batchStudents.map(s => s.name))
      const batchPayments = payments.filter(p => studentNames.has(p.student))
      const collected = batchPayments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
      const pending   = batchPayments.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
      // Today attendance for this batch
      const present   = batchStudents.filter(s => todayAtt[s.id] === 'Present').length
      const attPct    = batchStudents.length ? Math.round((present / batchStudents.length) * 100) : 0

      return { batch: b, count: batchStudents.length, expected, collected, pending, attPct }
    }).filter(r => r.count > 0 || r.batch.capacity > 0)
  }, [batches, students, payments, todayAtt])

  const totalExpected  = rows.reduce((s, r) => s + r.expected, 0)
  const totalCollected = rows.reduce((s, r) => s + r.collected, 0)
  const totalPending   = rows.reduce((s, r) => s + r.pending, 0)

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <TallyKPI label="Total Expected" value={INR(totalExpected)}  color="text-gray-900" />
        <TallyKPI label="Collected"      value={INR(totalCollected)} color="text-emerald-700" />
        <TallyKPI label="Outstanding"    value={INR(totalPending)}   color="text-red-600" />
      </div>

      {/* Batch table */}
      <div className="card overflow-hidden">
        <div className="bg-gray-800 text-white grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide">
          <span>Batch / Branch</span>
          <span className="text-right">Students</span>
          <span className="text-right hidden sm:block">Expected</span>
          <span className="text-right">Collected</span>
          <span className="text-right">Pending</span>
          <span className="text-right">Att% Today</span>
        </div>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No batch data yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {rows.map(({ batch, count, expected, collected, pending, attPct }) => (
              <div key={batch.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3.5 hover:bg-gray-50 transition items-center">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{batch.name}</p>
                  <p className="text-xs text-gray-400">
                    {batch.sports?.join(', ')} {batch.startTime && `· ${batch.startTime}`}
                  </p>
                </div>
                <span className="text-sm text-gray-700 text-right tabular-nums">{count}</span>
                <span className="text-sm text-gray-500 text-right tabular-nums hidden sm:block">{INR(expected)}</span>
                <span className="text-sm font-bold text-emerald-600 text-right tabular-nums">{INR(collected)}</span>
                <span className="text-sm font-bold text-red-500 text-right tabular-nums">{INR(pending)}</span>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs font-bold ${attPct >= 80 ? 'text-emerald-600' : attPct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                    {count > 0 ? `${attPct}%` : '—'}
                  </span>
                  {count > 0 && (
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${attPct >= 80 ? 'bg-emerald-500' : attPct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${attPct}%` }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total footer */}
        <div className="bg-gray-50 border-t-2 border-gray-300 grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3">
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Total</span>
          <span className="text-sm font-black text-gray-900 text-right tabular-nums">
            {rows.reduce((s, r) => s + r.count, 0)}
          </span>
          <span className="text-sm font-black text-gray-500 text-right tabular-nums hidden sm:block">{INR(totalExpected)}</span>
          <span className="text-sm font-black text-emerald-700 text-right tabular-nums">{INR(totalCollected)}</span>
          <span className="text-sm font-black text-red-600 text-right tabular-nums">{INR(totalPending)}</span>
          <span />
        </div>
      </div>
    </div>
  )
}

// ── Tab: Student Ledger ───────────────────────────────────
// Select a student → see their full fee history + running balance

function StudentLedgerTab({ students, payments }) {
  const activeStudents = students.filter(s => s.status === 'Active')
  const [selectedId, setSelectedId] = useState('')

  const selectedStudent = activeStudents.find(s => String(s.id) === selectedId)
  const ledger = useMemo(() => {
    if (!selectedStudent) return []
    return payments
      .filter(p => p.student === selectedStudent.name || p.studentId === selectedStudent.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [selectedStudent, payments])

  const totalPaid    = ledger.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const totalPending = ledger.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)

  const statusColor = {
    'Paid':    'bg-emerald-100 text-emerald-700',
    'Pending': 'bg-amber-100 text-amber-700',
    'Overdue': 'bg-red-100 text-red-700',
  }

  return (
    <div className="space-y-4">
      {/* Student picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="input appearance-none pr-8 text-sm"
          >
            <option value="">— Select a student —</option>
            {activeStudents.map(s => (
              <option key={s.id} value={String(s.id)}>{s.name} ({s.studentCode})</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        {selectedStudent && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>Batch: <strong className="text-gray-800">{selectedStudent.batch || '—'}</strong></span>
            <span>Sport: <strong className="text-gray-800">{selectedStudent.sport || '—'}</strong></span>
          </div>
        )}
      </div>

      {selectedStudent ? (
        <>
          {/* Student summary */}
          <div className="grid grid-cols-3 gap-3">
            <TallyKPI label="Total Paid"    value={INR(totalPaid)}    color="text-emerald-700" />
            <TallyKPI label="Outstanding"   value={INR(totalPending)} color="text-red-600" />
            <TallyKPI label="Monthly Fee"   value={INR(selectedStudent.feeAmount || selectedStudent.fees || 0)} color="text-gray-900" />
          </div>

          {/* Ledger */}
          <div className="card overflow-hidden">
            <div className="bg-gray-800 text-white grid grid-cols-[1fr_1.5fr_1fr_1fr_auto] gap-3 px-4 py-3 text-xs font-bold uppercase tracking-wide">
              <span>Date</span>
              <span>Invoice</span>
              <span>Period</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
            </div>

            {ledger.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">No payment records for this student</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {ledger.map((p, i) => (
                  <div key={p.id || i}
                    className="grid grid-cols-[1fr_1.5fr_1fr_1fr_auto] gap-3 px-4 py-3 hover:bg-gray-50 transition items-center">
                    <span className="text-xs text-gray-500 font-mono">
                      {p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{p.id}</span>
                    <span className="text-xs text-gray-600">{p.month}</span>
                    <span className="text-sm font-bold text-gray-900 text-right tabular-nums">{INR(p.amount)}</span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Total */}
            <div className="bg-gray-50 border-t-2 border-gray-300 grid grid-cols-[1fr_1.5fr_1fr_1fr_auto] gap-3 px-4 py-3">
              <span className="text-xs font-bold text-gray-700 col-span-3">Balance</span>
              <div className="text-right">
                <p className="text-sm font-black text-emerald-700 tabular-nums">Paid: {INR(totalPaid)}</p>
                <p className="text-xs font-bold text-red-600 tabular-nums mt-0.5">Due: {INR(totalPending)}</p>
              </div>
              <span />
            </div>
          </div>
        </>
      ) : (
        <div className="card py-16 text-center">
          <Users size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Select a student to view their fee ledger</p>
        </div>
      )}
    </div>
  )
}

// ── Tab: Attendance Report ────────────────────────────────
// Shows today's attendance summary + batch-wise breakdown

function AttendanceTab({ students, batches, attendanceData }) {
  const [batchFilter, setBatchFilter] = useState('All')
  const today = new Date().toISOString().split('T')[0]
  const todayAtt = attendanceData[today] || {}

  const activeStu = students.filter(s => s.status === 'Active')
  const filtered  = batchFilter === 'All'
    ? activeStu
    : activeStu.filter(s => s.batch === batchFilter || String(s.batchId) === batchFilter)

  const present  = filtered.filter(s => todayAtt[s.id] === 'Present').length
  const absent   = filtered.filter(s => todayAtt[s.id] === 'Absent').length
  const late     = filtered.filter(s => todayAtt[s.id] === 'Late').length
  const unmarked = filtered.length - present - absent - late
  const attPct   = filtered.length ? Math.round((present / filtered.length) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={batchFilter} onChange={setBatchFilter} label="Batch">
          <option value="All">All Batches</option>
          {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </Select>
        <p className="text-xs text-gray-400 ml-auto">
          Date: {new Date(today).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </p>
      </div>

      {/* Attendance KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: present,  color: 'text-emerald-700', bg: 'bg-emerald-50' },
          { label: 'Absent',  value: absent,   color: 'text-red-600',     bg: 'bg-red-50' },
          { label: 'Late',    value: late,      color: 'text-amber-700',   bg: 'bg-amber-50' },
          { label: 'Att %',   value: `${attPct}%`, color: 'text-brand-700', bg: 'bg-brand-50' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
            <p className="text-xs font-semibold text-gray-500 mb-1">{k.label}</p>
            <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Batch-wise attendance summary */}
      <div className="card overflow-hidden">
        <div className="bg-gray-800 text-white grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wide">
          <span>Batch</span>
          <span className="text-right">Students</span>
          <span className="text-right">Present</span>
          <span className="text-right">Absent</span>
          <span className="text-right">Late</span>
          <span className="text-right">Rate%</span>
        </div>
        <div className="divide-y divide-gray-50">
          {batches.map(b => {
            const bStu    = activeStu.filter(s => s.batch === b.name || s.batchId === b.id)
            const bPres   = bStu.filter(s => todayAtt[s.id] === 'Present').length
            const bAbs    = bStu.filter(s => todayAtt[s.id] === 'Absent').length
            const bLate   = bStu.filter(s => todayAtt[s.id] === 'Late').length
            const bPct    = bStu.length ? Math.round((bPres / bStu.length) * 100) : 0
            if (bStu.length === 0) return null
            return (
              <div key={b.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-3 hover:bg-gray-50 transition items-center">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{b.name}</p>
                  <p className="text-xs text-gray-400">{b.sports?.join(', ')}</p>
                </div>
                <span className="text-sm text-gray-700 text-right tabular-nums">{bStu.length}</span>
                <span className="text-sm font-bold text-emerald-600 text-right tabular-nums">{bPres}</span>
                <span className="text-sm font-bold text-red-500 text-right tabular-nums">{bAbs}</span>
                <span className="text-sm font-bold text-amber-600 text-right tabular-nums">{bLate}</span>
                <span className={`text-sm font-bold text-right tabular-nums ${bPct >= 80 ? 'text-emerald-600' : bPct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                  {bPct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-student list */}
      <div className="card overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Student-wise Today</p>
          <p className="text-xs text-gray-400">{filtered.length} students</p>
        </div>
        <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">No students found</div>
          ) : filtered.map(s => {
            const status = todayAtt[s.id] || 'Unmarked'
            const badge = {
              Present: 'bg-emerald-100 text-emerald-700',
              Absent:  'bg-red-100 text-red-700',
              Late:    'bg-amber-100 text-amber-700',
              Unmarked:'bg-gray-100 text-gray-500',
            }
            return (
              <div key={s.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">{s.batch} · {s.sport}</p>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${badge[status]}`}>
                  {status}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Shared mini components ────────────────────────────────

// Tally-style KPI box — small, data-dense
function TallyKPI({ label, value, color }) {
  return (
    <div className="card p-4 border border-gray-100">
      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-black tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// Compact select with label
function Select({ value, onChange, label, children }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input text-sm appearance-none pr-7 py-2 min-w-[140px]"
      >
        {children}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}
