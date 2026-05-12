import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Download, TrendingUp, Users, CreditCard, UserPlus, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, BarChart3, BookOpen, Layers,
  CalendarCheck, Clock, Search, FileText, IndianRupee, Target,
} from 'lucide-react'

// ── Utilities ─────────────────────────────────────────────

const INR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

function buildMonthOptions(count = 24) {
  const opts = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    opts.push({
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
    })
  }
  return opts
}
const MONTH_OPTS = buildMonthOptions()

function downloadCSV(headers, rows, filename) {
  const lines = [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
  ]
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0 }
function monthKey(date) { return (date || '').slice(0, 7) }

// ── Shared UI ─────────────────────────────────────────────

function Trend({ current, prev }) {
  if (!prev) return null
  const diff = current - prev
  const p    = Math.abs(pct(diff, prev))
  if (diff > 0)  return <span className="flex items-center gap-0.5 text-emerald-600 text-[11px] font-bold"><ArrowUpRight size={12}/>{p}%</span>
  if (diff < 0)  return <span className="flex items-center gap-0.5 text-red-500 text-[11px] font-bold"><ArrowDownRight size={12}/>{p}%</span>
  return <span className="flex items-center gap-0.5 text-gray-400 text-[11px]"><Minus size={10}/>0%</span>
}

function KpiCard({ label, value, sub, icon: Icon, color, bg, trend, prevValue }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-tight">{label}</p>
        <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon size={17} className={color} />
        </div>
      </div>
      <div>
        <p className={`text-[1.6rem] font-black leading-none tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
      {trend !== undefined && <Trend current={trend} prev={prevValue} />}
    </div>
  )
}

function RateBar({ value, max = 100 }) {
  const p = Math.min(100, pct(value, max))
  const col = p >= 80 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${col}`} style={{ width: `${p}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums w-9 text-right ${p >= 80 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{p}%</span>
    </div>
  )
}

function TableHead({ cols }) {
  return (
    <div className={`grid gap-3 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50 border-b border-gray-100`}
      style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
      {cols.map(c => <span key={c.key} className={c.right ? 'text-right' : ''}>{c.label}</span>)}
    </div>
  )
}

function SectionHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
      <div>
        <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function ExportBtn({ onClick, label = 'Export CSV' }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition">
      <Download size={12} /> {label}
    </button>
  )
}

function FilterBar({ children }) {
  return (
    <div className="flex flex-wrap gap-2 items-center bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 mb-5">
      {children}
    </div>
  )
}

function Sel({ value, onChange, children, className = '' }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`text-xs font-semibold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:border-brand-400 ${className}`}>
      {children}
    </select>
  )
}

const STATUS_CHIP = {
  Paid:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  Overdue: 'bg-red-50 text-red-600 border border-red-200',
}

// ── Tab definitions ───────────────────────────────────────

const TABS = [
  { id: 'overview',   label: 'Overview',   icon: BarChart3   },
  { id: 'financial',  label: 'Financial',  icon: BookOpen    },
  { id: 'by_batch',   label: 'By Batch',   icon: Layers      },
  { id: 'students',   label: 'Ledger',     icon: FileText    },
  { id: 'ageing',     label: 'Ageing',     icon: Clock       },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
]

// ── Main ──────────────────────────────────────────────────

export default function Reports() {
  const { students, payments, trials, batches, attendanceData } = useApp()
  const [activeTab, setActiveTab] = useState('overview')

  const generatedAt = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">SportFlow CRM</p>
          <h2 className="text-2xl font-black text-gray-900 leading-none">Reports & Analytics</h2>
          <p className="text-xs text-gray-400 mt-1">Generated {generatedAt}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 flex-shrink-0 px-4 py-3 text-xs font-bold transition border-b-2 -mb-px ${
              activeTab === id
                ? 'border-brand-600 text-brand-700 bg-brand-50/40'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div>
        {activeTab === 'overview'   && <OverviewTab   students={students} payments={payments} trials={trials} batches={batches} />}
        {activeTab === 'financial'  && <FinancialTab  payments={payments} students={students} />}
        {activeTab === 'by_batch'   && <BatchTab      batches={batches} students={students} payments={payments} attendanceData={attendanceData} />}
        {activeTab === 'students'   && <StudentLedgerTab students={students} payments={payments} />}
        {activeTab === 'ageing'     && <AgeingTab     students={students} payments={payments} />}
        {activeTab === 'attendance' && <AttendanceTab students={students} batches={batches} attendanceData={attendanceData} />}
      </div>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────

function OverviewTab({ students, payments, trials, batches }) {
  const [period, setPeriod] = useState(MONTH_OPTS[0].value)

  const prevPeriod = MONTH_OPTS[1]?.value

  const periodPay  = payments.filter(p => monthKey(p.date) === period)
  const prevPay    = payments.filter(p => monthKey(p.date) === prevPeriod)

  const activeCount   = students.filter(s => s.status === 'Active').length
  const suspCount     = students.filter(s => s.status === 'Suspended').length
  const collected     = periodPay.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const prevCollected = prevPay.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const firstOfMonthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`
  const outstanding   = students
    .filter(s => (s.status === 'Active' || s.status === 'Suspended') && s.paidTill && s.paidTill < firstOfMonthStr)
    .reduce((sum, s) => sum + (s.fees || 0), 0)
  const convRate      = trials.length ? pct(trials.filter(t => t.converted).length, trials.length) : 0
  const forecast      = students.filter(s => s.status === 'Active').reduce((s, st) => s + (st.fees || 0), 0)
  const collRate      = pct(collected, forecast)

  // 6-month revenue trend
  const chartData = useMemo(() => {
    return MONTH_OPTS.slice(0, 6).reverse().map(m => {
      const mp = payments.filter(p => monthKey(p.date) === m.value)
      return {
        month:     m.label.split(' ')[0],
        collected: mp.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0),
        pending:   mp.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0),
      }
    })
  }, [payments])

  // Top overdue (Active = grace period, Suspended = already auto-suspended for non-payment)
  const overdueStudents = useMemo(() => {
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`
    return students
      .filter(s => (s.status === 'Active' || s.status === 'Suspended') && s.paidTill && s.paidTill < firstOfMonth)
      .sort((a, b) => (a.paidTill || '').localeCompare(b.paidTill || ''))
      .slice(0, 8)
  }, [students])

  // Batch performance
  const batchPerf = useMemo(() => batches.map(b => {
    const bs = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
    const exp = bs.reduce((s, st) => s + (st.fees || 0), 0)
    const col = payments.filter(p => bs.some(s => s.id === p.studentId) && p.status === 'Paid' && monthKey(p.date) === period)
      .reduce((s, p) => s + p.amount, 0)
    return { name: b.name, count: bs.length, expected: exp, collected: col }
  }).filter(r => r.count > 0).sort((a, b) => b.expected - a.expected).slice(0, 5), [batches, students, payments, period])

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Period</span>
        <Sel value={period} onChange={setPeriod}>
          {MONTH_OPTS.slice(0, 12).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Sel>
        <span className="text-xs text-gray-400 ml-2">vs {MONTH_OPTS[1]?.label}</span>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500"/> Collected
          <div className="w-2 h-2 rounded-full bg-amber-400 ml-2"/> Pending
        </div>
      </FilterBar>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Active Students"    value={activeCount}      sub={`${suspCount} suspended`}  icon={Users}       color="text-brand-700"    bg="bg-brand-50" />
        <KpiCard label={`Collected — ${MONTH_OPTS.find(m=>m.value===period)?.label}`} value={INR(collected)} sub={`${collRate}% of forecast`} icon={TrendingUp}  color="text-emerald-700" bg="bg-emerald-50" trend={collected} prevValue={prevCollected} />
        <KpiCard label="Total Outstanding"  value={INR(outstanding)} sub={`${overdueStudents.length} students overdue`} icon={CreditCard}  color="text-red-600"     bg="bg-red-50" />
        <KpiCard label="Monthly Forecast"   value={INR(forecast)}    sub="active students × fee"    icon={Target}      color="text-purple-700"  bg="bg-purple-50" />
      </div>

      {/* Chart + batch performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue trend */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title="Revenue Trend" subtitle="Collected vs Pending — last 6 months" />
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v, n) => [INR(v), n === 'collected' ? 'Collected' : 'Pending']}
                contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
              />
              <Bar dataKey="pending"   fill="#fde68a" radius={[4,4,0,0]} name="pending" />
              <Bar dataKey="collected" fill="#10b981" radius={[4,4,0,0]} name="collected" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Batch performance */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title="Batch Performance" subtitle={MONTH_OPTS.find(m=>m.value===period)?.label} />
          <div className="space-y-3">
            {batchPerf.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No data for this period</p>}
            {batchPerf.map(b => (
              <div key={b.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-700 truncate max-w-[120px]">{b.name}</span>
                  <span className="text-gray-400 tabular-nums">{INR(b.collected)} / {INR(b.expected)}</span>
                </div>
                <RateBar value={b.collected} max={b.expected || 1} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue students */}
      {overdueStudents.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-500" />
              <p className="text-sm font-black text-gray-800 uppercase tracking-wide">Overdue Students</p>
            </div>
            <span className="text-xs text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">{overdueStudents.length} students</span>
          </div>
          <div className="divide-y divide-gray-50">
            {overdueStudents.map(s => {
              const daysOverdue = s.paidTill ? Math.floor((today - new Date(s.paidTill + 'T00:00:00')) / 86400000) : null
              return (
                <div key={s.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-5 py-3 hover:bg-gray-50/50 items-center">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                      {s.name}
                      {s.status === 'Suspended' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Suspended</span>}
                    </p>
                    <p className="text-xs text-gray-400">{s.batch || '—'} · {s.studentCode}</p>
                  </div>
                  <span className="text-xs text-gray-500">Paid till <strong>{s.paidTill ? new Date(s.paidTill+'T00:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'}) : '—'}</strong></span>
                  {daysOverdue !== null && (
                    <span className={`text-xs font-bold ${daysOverdue > 60 ? 'text-red-600' : daysOverdue > 30 ? 'text-amber-600' : 'text-gray-600'}`}>
                      {daysOverdue}d overdue
                    </span>
                  )}
                  <span className="text-sm font-bold text-red-600 text-right tabular-nums">{INR(s.fees)}/mo</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Financial Ledger ──────────────────────────────────────

function FinancialTab({ payments, students }) {
  const [fromMonth,   setFromMonth]   = useState(MONTH_OPTS[0].value)
  const [toMonth,     setToMonth]     = useState(MONTH_OPTS[0].value)
  const [statusFilter, setStatusFilter] = useState('All')
  const [search,      setSearch]      = useState('')

  const studentMap = useMemo(() => {
    const m = {}
    students.forEach(s => { m[s.id] = s })
    return m
  }, [students])

  const from = fromMonth < toMonth ? fromMonth : toMonth
  const to   = fromMonth < toMonth ? toMonth   : fromMonth

  const filtered = useMemo(() => payments
    .filter(p => {
      const mk = monthKey(p.date)
      const inRange = mk >= from && mk <= to
      const matchS  = statusFilter === 'All' || p.status === statusFilter
      const matchQ  = !search || (p.student||'').toLowerCase().includes(search.toLowerCase()) || (p.id||'').toLowerCase().includes(search.toLowerCase())
      return inRange && matchS && matchQ
    })
    .sort((a, b) => (b.date||'').localeCompare(a.date||''))
  , [payments, from, to, statusFilter, search])

  const billed    = filtered.reduce((s, p) => s + p.amount, 0)
  const collected = filtered.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const outstanding = filtered.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
  const rate = pct(collected, billed)

  // Group by month for monthly subtotals
  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(p => {
      const mk = monthKey(p.date)
      if (!map[mk]) map[mk] = []
      map[mk].push(p)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const handleExport = () => {
    const headers = ['Date','Invoice','Student','Batch','Period','Mode','Amount','Status','Notes']
    const rows = filtered.map(p => {
      const stu = studentMap[p.studentId]
      return [
        p.date || '', p.id || '', p.student || '', stu?.batch || '',
        p.month || '', p.mode || '', p.amount || 0, p.status || '', p.notes || '',
      ]
    })
    downloadCSV(headers, rows, `financial-${from}-to-${to}.csv`)
  }

  const cols = [
    { key: 'date',    label: 'Date',        w: '100px' },
    { key: 'inv',     label: 'Invoice',     w: '130px' },
    { key: 'student', label: 'Student',     w: '1.5fr' },
    { key: 'period',  label: 'Period',      w: '1fr'   },
    { key: 'mode',    label: 'Mode',        w: '80px'  },
    { key: 'amount',  label: 'Amount',      w: '110px', right: true },
    { key: 'status',  label: 'Status',      w: '90px'  },
  ]

  return (
    <div className="space-y-5">
      {/* Filters */}
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">From</span>
        <Sel value={fromMonth} onChange={setFromMonth}>
          {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Sel>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">To</span>
        <Sel value={toMonth} onChange={setToMonth}>
          {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Sel>
        <Sel value={statusFilter} onChange={setStatusFilter} className="ml-2">
          {['All','Paid'].map(s => <option key={s} value={s}>{s}</option>)}
        </Sel>
        <div className="relative ml-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="text-xs bg-white border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-gray-700 focus:outline-none focus:border-brand-400 w-44"
            placeholder="Search student / invoice…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">{filtered.length} entries</span>
          <ExportBtn onClick={handleExport} />
        </div>
      </FilterBar>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Billed',    value: INR(billed),      color: 'text-gray-900'    },
          { label: 'Collected',       value: INR(collected),   color: 'text-emerald-700' },
          { label: 'Outstanding',     value: INR(outstanding), color: 'text-red-600'     },
          { label: 'Collection Rate', value: `${rate}%`,       color: rate >= 80 ? 'text-emerald-700' : rate >= 60 ? 'text-amber-600' : 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{k.label}</p>
            <p className={`text-xl font-black tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Ledger */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <TableHead cols={cols} />

        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No records for this period</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {grouped.map(([mk, rows]) => {
              const mLabel = (() => { const [y,m] = mk.split('-'); return `${MONTHS[Number(m)-1]} ${y}` })()
              const mTotal = rows.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
              return (
                <div key={mk}>
                  {/* Month group header */}
                  <div className="grid gap-3 px-4 py-2 bg-gray-50/80 border-y border-gray-100 text-[11px] font-bold text-gray-600 uppercase tracking-wide"
                    style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                    <span className="col-span-5">{mLabel} — {rows.length} entries</span>
                    <span className="text-right text-emerald-700 tabular-nums">{INR(mTotal)}</span>
                    <span />
                  </div>
                  {rows.map((p, i) => (
                    <div key={p.id || i}
                      className="grid gap-3 px-4 py-3 items-center hover:bg-brand-50/30 transition text-sm"
                      style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                      <span className="text-xs text-gray-500 font-mono">
                        {p.date ? new Date(p.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '—'}
                      </span>
                      <span className="text-xs text-gray-400 font-mono truncate">{p.id || '—'}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{p.student}</p>
                        {p.notes && <p className="text-[11px] text-gray-400 truncate">{p.notes}</p>}
                      </div>
                      <span className="text-xs text-gray-500 truncate">{p.month || '—'}</span>
                      <span className="text-xs text-gray-500">{p.mode || '—'}</span>
                      <span className="font-bold text-gray-900 text-right tabular-nums">{INR(p.amount)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center justify-center w-fit ${STATUS_CHIP[p.status] || 'bg-gray-100 text-gray-500'}`}>
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* Grand total */}
        <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
          style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
          <span className="text-xs font-black uppercase tracking-wide col-span-5">Grand Total</span>
          <span className="text-sm font-black text-right tabular-nums">{INR(billed)}</span>
          <span />
        </div>
      </div>
    </div>
  )
}

// ── By Batch ──────────────────────────────────────────────

function BatchTab({ batches, students, payments, attendanceData }) {
  const [period, setPeriod] = useState(MONTH_OPTS[0].value)
  const todayAtt = attendanceData[todayStr] || {}

  const rows = useMemo(() => batches.map(b => {
    const bs  = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
    const exp = bs.reduce((s, st) => s + (st.fees || 0), 0)
    const bPay = payments.filter(p => bs.some(s => s.id === p.studentId) && monthKey(p.date) === period)
    const col = bPay.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
    const pend = bPay.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
    const present = bs.filter(s => todayAtt[s.id] === 'Present').length
    return { batch: b, count: bs.length, expected: exp, collected: col, pending: pend, attPct: bs.length ? pct(present, bs.length) : 0 }
  }).filter(r => r.count > 0 || r.batch.capacity > 0)
    .sort((a, b) => b.expected - a.expected)
  , [batches, students, payments, period, todayAtt])

  const totExp = rows.reduce((s, r) => s + r.expected, 0)
  const totCol = rows.reduce((s, r) => s + r.collected, 0)
  const totPend = rows.reduce((s, r) => s + r.pending, 0)
  const totCount = rows.reduce((s, r) => s + r.count, 0)

  const handleExport = () => {
    const headers = ['Batch','Students','Expected (Monthly)','Collected','Outstanding','Collection Rate%','Attendance% Today']
    downloadCSV(headers, rows.map(r => [
      r.batch.name, r.count, r.expected, r.collected, r.pending,
      pct(r.collected, r.expected || 1), r.attPct,
    ]), `batch-report-${period}.csv`)
  }

  const cols = [
    { key: 'batch',    label: 'Batch',         w: '2fr'   },
    { key: 'count',    label: 'Students',       w: '80px',  right: true },
    { key: 'expected', label: 'Expected / mo',  w: '130px', right: true },
    { key: 'collected',label: 'Collected',      w: '120px', right: true },
    { key: 'pending',  label: 'Outstanding',    w: '120px', right: true },
    { key: 'rate',     label: 'Collection %',   w: '150px' },
    { key: 'att',      label: 'Att% Today',     w: '100px', right: true },
  ]

  return (
    <div className="space-y-5">
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Month</span>
        <Sel value={period} onChange={setPeriod}>
          {MONTH_OPTS.slice(0,12).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Sel>
        <div className="ml-auto"><ExportBtn onClick={handleExport} /></div>
      </FilterBar>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Batches',  value: rows.length,        color: 'text-gray-900'    },
          { label: 'Total Students', value: totCount,           color: 'text-brand-700'   },
          { label: 'Collected',      value: INR(totCol),        color: 'text-emerald-700' },
          { label: 'Collection Rate',value: `${pct(totCol, totExp || 1)}%`, color: pct(totCol,totExp||1) >= 80 ? 'text-emerald-700' : 'text-amber-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{k.label}</p>
            <p className={`text-xl font-black tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <TableHead cols={cols} />
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">No batch data</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {rows.map(({ batch, count, expected, collected, pending, attPct }) => (
              <div key={batch.id}
                className="grid gap-3 px-4 py-4 hover:bg-brand-50/20 transition items-center"
                style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{batch.name}</p>
                  <p className="text-xs text-gray-400">{batch.sports?.join(', ')} {batch.startTime && `· ${batch.startTime}`}</p>
                </div>
                <span className="text-sm text-gray-700 text-right tabular-nums font-semibold">{count}</span>
                <span className="text-sm text-gray-500 text-right tabular-nums">{INR(expected)}</span>
                <span className="text-sm font-bold text-emerald-600 text-right tabular-nums">{INR(collected)}</span>
                <span className="text-sm font-bold text-red-500 text-right tabular-nums">{INR(pending)}</span>
                <RateBar value={collected} max={expected || 1} />
                <span className={`text-sm font-bold text-right tabular-nums ${attPct >= 80 ? 'text-emerald-600' : attPct >= 60 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {count > 0 ? `${attPct}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
          style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
          <span className="text-xs font-black uppercase tracking-wide">Total</span>
          <span className="text-sm font-black text-right tabular-nums">{totCount}</span>
          <span className="text-sm font-black text-right tabular-nums text-gray-300">{INR(totExp)}</span>
          <span className="text-sm font-black text-right tabular-nums text-emerald-400">{INR(totCol)}</span>
          <span className="text-sm font-black text-right tabular-nums text-red-300">{INR(totPend)}</span>
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}

// ── Student Ledger ────────────────────────────────────────

function StudentLedgerTab({ students, payments }) {
  const [search,     setSearch]     = useState('')
  const [showDrop,   setShowDrop]   = useState(false)
  const [selectedId, setSelectedId] = useState('')

  const allStudents = students.filter(s => s.status !== 'deleted')
  const matchList   = search
    ? allStudents.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || (s.studentCode||'').toLowerCase().includes(search.toLowerCase()))
    : []

  const student = allStudents.find(s => String(s.id) === selectedId)

  const ledger = useMemo(() => {
    if (!student) return []
    return payments
      .filter(p => String(p.studentId) === String(student.id) || p.student === student.name)
      .sort((a, b) => (a.date||'').localeCompare(b.date||''))
  }, [student, payments])

  // Running balance
  const ledgerWithBalance = useMemo(() => {
    let bal = 0
    return ledger.map(p => {
      if (p.status === 'Paid') bal += p.amount
      return { ...p, runningPaid: bal }
    }).reverse()
  }, [ledger])

  const totalPaid    = ledger.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const totalPending = ledger.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)

  const handleExport = () => {
    if (!student) return
    const headers = ['Date','Invoice','Period','Mode','Amount','Status','Running Paid','Notes']
    downloadCSV(headers, ledgerWithBalance.map(p => [
      p.date||'', p.id||'', p.month||'', p.mode||'', p.amount||0, p.status||'', p.runningPaid, p.notes||''
    ]), `ledger-${student.name.replace(/\s+/g,'-')}.csv`)
  }

  const cols = [
    { key: 'date',    label: 'Date',          w: '100px' },
    { key: 'inv',     label: 'Invoice',       w: '130px' },
    { key: 'period',  label: 'Period',        w: '1fr'   },
    { key: 'mode',    label: 'Mode',          w: '80px'  },
    { key: 'amount',  label: 'Amount',        w: '110px', right: true },
    { key: 'status',  label: 'Status',        w: '90px'  },
    { key: 'balance', label: 'Running Paid',  w: '120px', right: true },
  ]

  return (
    <div className="space-y-5">
      {/* Student search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-brand-400 shadow-sm"
          placeholder="Search student by name or ID…"
          value={search}
          onFocus={() => setShowDrop(true)}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
          onChange={e => { setSearch(e.target.value); setShowDrop(true); setSelectedId('') }}
        />
        {showDrop && matchList.length > 0 && (
          <div className="absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-56 overflow-y-auto">
            {matchList.slice(0, 10).map(s => (
              <button key={s.id} type="button"
                className="w-full text-left px-4 py-2.5 hover:bg-brand-50 text-sm flex items-center justify-between"
                onMouseDown={() => { setSelectedId(String(s.id)); setSearch(s.name); setShowDrop(false) }}>
                <span className="font-semibold text-gray-900">{s.name}</span>
                <span className="text-xs text-gray-400">{s.studentCode} · {s.batch || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!student ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">Search and select a student to view their ledger</p>
        </div>
      ) : (
        <>
          {/* Student profile card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-black text-lg">
                  {student.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-lg font-black text-gray-900">{student.name}</p>
                  <p className="text-xs text-gray-400">{student.studentCode} · {student.batch || '—'} · {student.sport || '—'}</p>
                </div>
              </div>
              <div className="flex gap-6 text-center">
                <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Monthly Fee</p><p className="text-sm font-black text-gray-800">{INR(student.fees)}</p></div>
                <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Total Paid</p><p className="text-sm font-black text-emerald-700">{INR(totalPaid)}</p></div>
                <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Outstanding</p><p className="text-sm font-black text-red-600">{INR(totalPending)}</p></div>
                <div><p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Paid Till</p><p className="text-sm font-black text-gray-700">{student.paidTill ? new Date(student.paidTill+'T00:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'}) : '—'}</p></div>
              </div>
              <ExportBtn onClick={handleExport} label="Export Ledger" />
            </div>
          </div>

          {/* Ledger table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <TableHead cols={cols} />
            {ledgerWithBalance.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No payment records found</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {ledgerWithBalance.map((p, i) => (
                  <div key={p.id || i}
                    className="grid gap-3 px-4 py-3 items-center hover:bg-brand-50/20 transition"
                    style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                    <span className="text-xs text-gray-500 font-mono">{p.date ? new Date(p.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '—'}</span>
                    <span className="text-xs text-gray-400 font-mono truncate">{p.id || '—'}</span>
                    <span className="text-xs text-gray-600">{p.month || '—'}</span>
                    <span className="text-xs text-gray-500">{p.mode || '—'}</span>
                    <span className="text-sm font-bold text-gray-900 text-right tabular-nums">{INR(p.amount)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${STATUS_CHIP[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
                    <span className="text-xs font-bold text-emerald-700 text-right tabular-nums">{INR(p.runningPaid)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
              style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
              <span className="text-xs font-black uppercase tracking-wide col-span-4">Balance</span>
              <span className="text-sm font-black text-right tabular-nums text-emerald-400">{INR(totalPaid)}</span>
              <span />
              <span className="text-xs font-bold text-right text-red-300 tabular-nums">Due: {INR(totalPending)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Ageing Report ─────────────────────────────────────────

function AgeingTab({ students, payments }) {
  const [batchFilter, setBatchFilter] = useState('All')

  const batches = [...new Set(students.map(s => s.batch).filter(Boolean))].sort()

  const ageing = useMemo(() => {
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`
    const overdueStudents = students.filter(s =>
      (s.status === 'Active' || s.status === 'Suspended') && s.paidTill && s.paidTill < firstOfMonth &&
      (batchFilter === 'All' || s.batch === batchFilter)
    )
    return overdueStudents.map(s => {
      const days = Math.floor((today - new Date(s.paidTill+'T00:00:00')) / 86400000)
      const bucket = days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '90+ days'
      const bucketOrder = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3
      return { ...s, daysOverdue: days, bucket, bucketOrder }
    }).sort((a, b) => b.daysOverdue - a.daysOverdue)
  }, [students, batchFilter])

  const buckets = ['1–30 days','31–60 days','61–90 days','90+ days']
  const bucketColors = ['text-amber-600','text-orange-600','text-red-500','text-red-700']
  const bucketBg     = ['bg-amber-50','bg-orange-50','bg-red-50','bg-red-100']

  const handleExport = () => {
    const headers = ['Student','Student Code','Batch','Sport','Paid Till','Days Overdue','Bucket','Status','Monthly Fee']
    downloadCSV(headers, ageing.map(s => [
      s.name, s.studentCode||'', s.batch||'', s.sport||'', s.paidTill||'', s.daysOverdue, s.bucket, s.status||'', s.fees||0
    ]), `ageing-report-${todayStr}.csv`)
  }

  const cols = [
    { key: 'student', label: 'Student',      w: '2fr'   },
    { key: 'batch',   label: 'Batch',        w: '1.5fr' },
    { key: 'since',   label: 'Paid Till',    w: '110px' },
    { key: 'days',    label: 'Days Overdue', w: '110px', right: true },
    { key: 'bucket',  label: 'Bucket',       w: '110px' },
    { key: 'status',  label: 'Status',       w: '100px' },
    { key: 'fee',     label: 'Monthly Fee',  w: '110px', right: true },
  ]

  return (
    <div className="space-y-5">
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Batch</span>
        <Sel value={batchFilter} onChange={setBatchFilter}>
          <option value="All">All Batches</option>
          {batches.map(b => <option key={b}>{b}</option>)}
        </Sel>
        <span className="text-xs text-gray-400 ml-2">As of {today.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>
        <div className="ml-auto"><ExportBtn onClick={handleExport} /></div>
      </FilterBar>

      {/* Bucket KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {buckets.map((b, i) => {
          const items = ageing.filter(s => s.bucket === b)
          const amt   = items.reduce((s, x) => s + (x.fees || 0), 0)
          return (
            <div key={b} className={`${bucketBg[i]} rounded-xl border border-gray-100 p-4`}>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{b}</p>
              <p className={`text-xl font-black tabular-nums ${bucketColors[i]}`}>{items.length} students</p>
              <p className="text-xs text-gray-500 mt-0.5 tabular-nums">{INR(amt)}/month at risk</p>
            </div>
          )
        })}
      </div>

      {/* Ageing table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <TableHead cols={cols} />
        {ageing.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <TrendingUp size={20} className="text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-gray-400">No overdue students — all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {ageing.map(s => (
              <div key={s.id}
                className="grid gap-3 px-4 py-3.5 items-center hover:bg-gray-50/50 transition"
                style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                  <p className="text-[11px] text-gray-400">{s.studentCode}</p>
                </div>
                <span className="text-xs text-gray-600">{s.batch || '—'}</span>
                <span className="text-xs text-gray-500 font-mono">{s.paidTill ? new Date(s.paidTill+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '—'}</span>
                <span className={`text-sm font-black text-right tabular-nums ${bucketColors[s.bucketOrder]}`}>{s.daysOverdue}d</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${bucketBg[s.bucketOrder]} ${bucketColors[s.bucketOrder]}`}>{s.bucket}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${s.status === 'Suspended' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{s.status === 'Suspended' ? 'Suspended' : 'Active'}</span>
                <span className="text-sm font-bold text-gray-800 text-right tabular-nums">{INR(s.fees)}</span>
              </div>
            ))}
          </div>
        )}
        {ageing.length > 0 && (
          <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
            style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
            <span className="text-xs font-black uppercase tracking-wide col-span-4">{ageing.length} overdue</span>
            <span />
            <span className="text-sm font-black text-right tabular-nums text-red-300">{INR(ageing.reduce((s,x)=>s+(x.fees||0),0))}/mo</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Attendance ────────────────────────────────────────────

function AttendanceTab({ students, batches, attendanceData }) {
  const [date,        setDate]        = useState(todayStr)
  const [batchFilter, setBatchFilter] = useState('All')

  const attForDay = attendanceData[date] || {}
  const activeStu = students.filter(s => s.status === 'Active')
  const filtered  = batchFilter === 'All'
    ? activeStu
    : activeStu.filter(s => s.batch === batchFilter || String(s.batchId) === batchFilter)

  const present  = filtered.filter(s => attForDay[s.id] === 'Present').length
  const absent   = filtered.filter(s => attForDay[s.id] === 'Absent').length
  const late     = filtered.filter(s => attForDay[s.id] === 'Late').length
  const unmarked = filtered.length - present - absent - late
  const attPct   = filtered.length ? pct(present, filtered.length) : 0

  const handleExport = () => {
    const headers = ['Student','Student Code','Batch','Sport','Status']
    downloadCSV(headers, filtered.map(s => [
      s.name, s.studentCode||'', s.batch||'', s.sport||'', attForDay[s.id]||'Unmarked'
    ]), `attendance-${date}.csv`)
  }

  const cols = [
    { key: 'name',   label: 'Student',  w: '2fr'  },
    { key: 'batch',  label: 'Batch',    w: '1.5fr' },
    { key: 'sport',  label: 'Sport',    w: '1fr'  },
    { key: 'status', label: 'Status',   w: '100px' },
  ]

  return (
    <div className="space-y-5">
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Date</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} max={todayStr}
          className="text-xs font-semibold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:border-brand-400" />
        <Sel value={batchFilter} onChange={setBatchFilter} className="ml-2">
          <option value="All">All Batches</option>
          {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </Sel>
        <div className="ml-auto"><ExportBtn onClick={handleExport} /></div>
      </FilterBar>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Present',  value: present,       color: 'text-emerald-700', bg: 'bg-emerald-50'  },
          { label: 'Absent',   value: absent,        color: 'text-red-600',     bg: 'bg-red-50'      },
          { label: 'Late',     value: late,          color: 'text-amber-700',   bg: 'bg-amber-50'    },
          { label: 'Unmarked', value: unmarked,      color: 'text-gray-500',    bg: 'bg-gray-50'     },
          { label: 'Rate',     value: `${attPct}%`,  color: attPct >= 80 ? 'text-emerald-700' : attPct >= 60 ? 'text-amber-600' : 'text-red-600', bg: 'bg-white' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl border border-gray-100 p-4`}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{k.label}</p>
            <p className={`text-2xl font-black tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Batch breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Batch Breakdown</p>
        </div>
        <div className="divide-y divide-gray-50">
          {batches.map(b => {
            const bs   = activeStu.filter(s => s.batch === b.name || s.batchId === b.id)
            if (bs.length === 0) return null
            const pres = bs.filter(s => attForDay[s.id] === 'Present').length
            const abs  = bs.filter(s => attForDay[s.id] === 'Absent').length
            const late = bs.filter(s => attForDay[s.id] === 'Late').length
            const p    = pct(pres, bs.length)
            return (
              <div key={b.id} className="grid grid-cols-[2fr_repeat(4,_80px)_150px] gap-3 px-4 py-3 items-center hover:bg-gray-50/50 text-sm">
                <div>
                  <p className="font-semibold text-gray-900">{b.name}</p>
                  <p className="text-xs text-gray-400">{bs.length} students</p>
                </div>
                <span className="text-emerald-600 font-bold text-right">{pres}</span>
                <span className="text-red-500 font-bold text-right">{abs}</span>
                <span className="text-amber-600 font-bold text-right">{late}</span>
                <span className="text-gray-400 text-right">{bs.length - pres - abs - late}</span>
                <RateBar value={pres} max={bs.length} />
              </div>
            )
          })}
        </div>
        <div className="grid grid-cols-[2fr_repeat(4,_80px)_150px] gap-3 px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
          <span>Batch</span><span className="text-right">Present</span><span className="text-right">Absent</span><span className="text-right">Late</span><span className="text-right">Unmarked</span><span>Rate</span>
        </div>
      </div>

      {/* Student list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Student-wise</p>
          <span className="text-xs text-gray-400">{filtered.length} students</span>
        </div>
        <TableHead cols={cols} />
        <div className="divide-y divide-gray-50 max-h-[480px] overflow-y-auto">
          {filtered.map(s => {
            const st = attForDay[s.id] || 'Unmarked'
            const chip = { Present: 'bg-emerald-50 text-emerald-700 border-emerald-200', Absent: 'bg-red-50 text-red-600 border-red-200', Late: 'bg-amber-50 text-amber-700 border-amber-200', Unmarked: 'bg-gray-50 text-gray-400 border-gray-200' }
            return (
              <div key={s.id}
                className="grid gap-3 px-4 py-3 items-center hover:bg-gray-50/50 transition"
                style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">{s.studentCode}</p>
                </div>
                <span className="text-xs text-gray-600">{s.batch || '—'}</span>
                <span className="text-xs text-gray-500">{s.sport || '—'}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit ${chip[st]}`}>{st}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
