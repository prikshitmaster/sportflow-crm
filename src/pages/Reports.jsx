import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Download, TrendingUp, Users, CreditCard, UserPlus, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, BarChart3, BookOpen, Layers,
  CalendarCheck, Clock, Search, FileText, IndianRupee, Target, Star,
  Shield, ChevronDown, ChevronUp, RefreshCw, Filter, X, Calendar, User,
  FileDown, CheckSquare, Trash2, PlusSquare, Edit3,
} from 'lucide-react'
import * as db from '../lib/db'
import { ACTION_LABELS, ACTION_CATEGORY, ENTITY_COLORS, ROLE_COLORS } from '../lib/audit'
import { isOutstanding, daysOverdue as ruleDaysOverdue, ageingBucket, ageingBucketOrder } from '../lib/studentRules'
import { SPORT_CATEGORIES, FOOTBALL_CATEGORIES, getCategoryAvg, getOverallScore, getTier, buildMonthOpts, monthLabel, FOOTBALL_POSITIONS, POSITION_COLORS } from '../lib/performance'

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
  { id: 'overview',     label: 'Overview',     icon: BarChart3    },
  { id: 'financial',    label: 'Financial',    icon: BookOpen     },
  { id: 'by_batch',     label: 'By Batch',     icon: Layers       },
  { id: 'students',     label: 'Ledger',       icon: FileText     },
  { id: 'ageing',       label: 'Ageing',       icon: Clock        },
  { id: 'attendance',   label: 'Attendance',   icon: CalendarCheck },
  { id: 'performance',  label: 'Performance',  icon: Star         },
  { id: 'audit',        label: 'Audit Log',    icon: Shield       },
]

// ── Main ──────────────────────────────────────────────────

export default function Reports() {
  const { user, students, payments, trials, batches, attendanceData, selectedSport, selectedBranch, sportBranches } = useApp()
  const [activeTab, setActiveTab] = useState('overview')

  // Header summary stats — live, not hardcoded
  const headerStats = useMemo(() => {
    const active     = students.filter(s => s.status === 'Active').length
    const currMonth  = today.toISOString().slice(0, 7)
    const collected  = payments.filter(p => p.status === 'Paid' && (p.date || '').slice(0, 7) === currMonth)
                                .reduce((s, p) => s + p.amount, 0)
    const expected   = students.filter(s => s.status === 'Active').reduce((s, st) => s + (st.fees || 0), 0)
    const rate       = expected > 0 ? Math.round((collected / expected) * 100) : 0
    return { active, collected, expected, rate }
  }, [students, payments])

  // Multi-batch enrolments — without this, students who train in a non-primary batch
  // had their payments invisible to that batch's "collected" total. (QA_AUDIT H2)
  // We fetch once on mount; if the table doesn't exist, the lookup gracefully returns []
  // so the report falls back to primary-batch-only counting.
  const [mbRows, setMbRows] = useState([])
  useEffect(() => {
    if (!user?.academyId) return
    db.fetchAllStudentBatches(user.academyId).then(setMbRows).catch(() => setMbRows([]))
  }, [user?.academyId])

  // batchId → Set<studentId> for fast "who's in this batch" lookups, including multi-batch.
  const batchToStudents = useMemo(() => {
    const map = {}
    mbRows.forEach(r => {
      if (!map[r.batch_id]) map[r.batch_id] = new Set()
      map[r.batch_id].add(r.student_id)
    })
    return map
  }, [mbRows])

  const generatedAt = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">SportFlow CRM</p>
          <h2 className="text-2xl font-black text-gray-900 leading-none">Reports & Analytics</h2>
          <p className="text-xs text-gray-400 mt-1">Generated {generatedAt}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Active Students', value: headerStats.active,                                     color: 'text-brand-700',   bg: 'bg-brand-50'   },
            { label: 'Collected This Month', value: `₹${headerStats.collected >= 100000 ? (headerStats.collected/100000).toFixed(1)+'L' : headerStats.collected >= 1000 ? (headerStats.collected/1000).toFixed(0)+'k' : headerStats.collected}`, color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Collection Rate', value: `${headerStats.rate}%`,                                 color: headerStats.rate >= 80 ? 'text-emerald-700' : headerStats.rate >= 60 ? 'text-amber-600' : 'text-red-600', bg: headerStats.rate >= 80 ? 'bg-emerald-50' : headerStats.rate >= 60 ? 'bg-amber-50' : 'bg-red-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl px-4 py-2.5 text-center`}>
              <p className={`text-lg font-black tabular-nums leading-none ${color}`}>{value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 font-semibold uppercase tracking-wide">{label}</p>
            </div>
          ))}
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
        {activeTab === 'overview'     && <OverviewTab   students={students} payments={payments} trials={trials} batches={batches} batchToStudents={batchToStudents} />}
        {activeTab === 'financial'    && <FinancialTab  payments={payments} students={students} />}
        {activeTab === 'by_batch'     && <BatchTab      batches={batches} students={students} payments={payments} attendanceData={attendanceData} batchToStudents={batchToStudents} />}
        {activeTab === 'students'     && <StudentLedgerTab students={students} payments={payments} />}
        {activeTab === 'ageing'       && <AgeingTab     key={`${selectedSport}-${selectedBranch}`} students={students} payments={payments} />}
        {activeTab === 'attendance'   && <AttendanceTab key={`${selectedSport}-${selectedBranch}`} students={students} batches={batches} attendanceData={attendanceData} />}
        {activeTab === 'performance'  && <PerformanceTab students={students} batches={batches} academyId={user?.academyId} />}
        {activeTab === 'audit'        && <AuditTab academyId={user?.academyId} selectedSport={selectedSport} selectedBranch={selectedBranch} sportBranches={sportBranches} />}
      </div>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────

function OverviewTab({ students, payments, trials, batches, batchToStudents = {} }) {
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
    .filter(s => isOutstanding(s, firstOfMonthStr))
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
  // Keep full count for KPI subtitle; only slice when rendering the list.
  const overdueAll = useMemo(() => {
    const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`
    return students
      .filter(s => isOutstanding(s, firstOfMonth))
      .sort((a, b) => (a.paidTill || '').localeCompare(b.paidTill || ''))
  }, [students])
  const overdueStudents = overdueAll.slice(0, 8)

  // Batch performance — includes multi-batch students so non-primary batches
  // don't get credit-erased for collected payments.
  const batchPerf = useMemo(() => batches.map(b => {
    const mbIds = batchToStudents[b.id] || new Set()
    const bs = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name || mbIds.has(s.id)))
    const exp = bs.reduce((s, st) => s + (st.fees || 0), 0)
    const bsIdSet = new Set(bs.map(s => s.id))
    const col = payments.filter(p => bsIdSet.has(p.studentId) && p.status === 'Paid' && monthKey(p.date) === period)
      .reduce((s, p) => s + p.amount, 0)
    return { name: b.name, count: bs.length, expected: exp, collected: col }
  }).filter(r => r.count > 0).sort((a, b) => b.expected - a.expected).slice(0, 5), [batches, students, payments, period, batchToStudents])

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
        <KpiCard label="Total Outstanding"  value={INR(outstanding)} sub={`${overdueAll.length} students overdue`} icon={CreditCard}  color="text-red-600"     bg="bg-red-50" />
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
              <Bar dataKey="pending"   stackId="a" fill="#fde68a" radius={[0,0,0,0]} name="pending" />
              <Bar dataKey="collected" stackId="a" fill="#10b981" radius={[4,4,0,0]} name="collected" />
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

      {/* ── Trial Funnel + Student Health ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Trial conversion funnel */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title="Trial Pipeline" subtitle="Lead → Conversion funnel" />
          {trials.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">No trial data yet</p>
          ) : (() => {
            const total     = trials.length
            const converted = trials.filter(t => t.converted).length
            const active    = trials.filter(t => !t.converted).length
            const followUp  = trials.filter(t => !t.converted && t.followUp && t.followUp <= todayStr).length
            const convRate  = pct(converted, total)
            const stages = [
              { label: 'Total Leads',       count: total,     pct: 100,      color: 'bg-brand-500',   text: 'text-brand-700'   },
              { label: 'Active Trials',     count: active,    pct: pct(active, total), color: 'bg-amber-400',   text: 'text-amber-700'   },
              { label: 'Follow-ups Due',    count: followUp,  pct: pct(followUp, total), color: 'bg-orange-400',  text: 'text-orange-700'  },
              { label: 'Converted',         count: converted, pct: convRate, color: 'bg-emerald-500', text: 'text-emerald-700' },
            ]
            return (
              <div className="space-y-3">
                {stages.map(s => (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold text-gray-700">{s.label}</span>
                      <span className={`font-black tabular-nums ${s.text}`}>{s.count}</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Conversion Rate</span>
                  <span className={`text-xl font-black tabular-nums ${convRate >= 30 ? 'text-emerald-600' : convRate >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{convRate}%</span>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Student health / retention */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <SectionHeader title="Student Health" subtitle="Retention & engagement snapshot" />
          {(() => {
            const active   = students.filter(s => s.status === 'Active')
            const susp     = students.filter(s => s.status === 'Suspended')
            const threeM   = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10)
            const retained = active.filter(s => s.joinDate && s.joinDate <= threeM).length
            const newStu   = active.filter(s => !s.joinDate || s.joinDate > threeM).length
            const total    = active.length || 1
            const retRate  = pct(retained, total)
            const rows = [
              { label: 'Active (3+ months)',  count: retained, pct: pct(retained, total), color: 'bg-emerald-500', text: 'text-emerald-700', desc: 'Long-term retained' },
              { label: 'Joined < 3 months',  count: newStu,   pct: pct(newStu, total),   color: 'bg-brand-400',   text: 'text-brand-700',   desc: 'Recently enrolled' },
              { label: 'Suspended',           count: susp.length, pct: pct(susp.length, students.length || 1), color: 'bg-red-400', text: 'text-red-600', desc: 'Fee overdue' },
            ]
            return (
              <div className="space-y-3">
                {rows.map(r => (
                  <div key={r.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <div>
                        <span className="font-semibold text-gray-700">{r.label}</span>
                        <span className="text-gray-400 ml-1.5">{r.desc}</span>
                      </div>
                      <span className={`font-black tabular-nums ${r.text}`}>{r.count}</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Retention Rate (3m+)</span>
                  <span className={`text-xl font-black tabular-nums ${retRate >= 70 ? 'text-emerald-600' : retRate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{retRate}%</span>
                </div>
              </div>
            )
          })()}
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
            <span className="text-xs text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-full">{overdueAll.length} students{overdueAll.length > overdueStudents.length ? ` — showing top ${overdueStudents.length}` : ''}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {overdueStudents.map(s => {
              const daysOverdue = ruleDaysOverdue(s, today)
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
  // Receivables state
  const [period,     setPeriod]    = useState(MONTH_OPTS[0].value)
  const [recStatus,  setRecStatus] = useState('All')
  const [recSearch,  setRecSearch] = useState('')
  const [showCount,  setShowCount] = useState(25)
  // Transactions state
  const [showTx,     setShowTx]    = useState(false)
  const [fromMonth,  setFromMonth] = useState(MONTH_OPTS[0].value)
  const [toMonth,    setToMonth]   = useState(MONTH_OPTS[0].value)
  const [txSearch,   setTxSearch]  = useState('')

  const studentMap = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s }); return m
  }, [students])

  const [yr, mo] = period.split('-').map(Number)
  const lastDayM   = new Date(yr, mo, 0).getDate()
  const firstDayStr = `${yr}-${String(mo).padStart(2,'0')}-01`
  const lastDayStr  = `${yr}-${String(mo).padStart(2,'0')}-${String(lastDayM).padStart(2,'0')}`

  // Build accounts-receivable rows
  const receivables = useMemo(() => {
    return students
      .filter(s => s.status === 'Active' || s.status === 'Suspended')
      .map(s => {
        const isPaid    = s.paidTill != null && s.paidTill >= lastDayStr
        const isOverdue = s.paidTill == null || s.paidTill < firstDayStr
        const noPayment = s.paidTill == null
        const status    = noPayment ? 'No Payment' : isPaid ? 'Paid' : 'Overdue'
        const monthPays = payments.filter(p => String(p.studentId) === String(s.id) && monthKey(p.date) === period)
        const collected = monthPays.reduce((sum, p) => sum + p.amount, 0)
        return { s, isPaid, isOverdue, status, outstanding: isPaid ? 0 : (s.fees || 0), collected }
      })
      .sort((a, b) => {
        const rank = { Overdue: 0, 'No Payment': 1, Paid: 2 }
        const rd = (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
        if (rd !== 0) return rd
        if (a.status === 'Overdue') {
          if (a.s.status === 'Suspended' && b.s.status !== 'Suspended') return -1
          if (b.s.status === 'Suspended' && a.s.status !== 'Suspended') return  1
        }
        return a.s.name.localeCompare(b.s.name)
      })
  }, [students, payments, period, firstDayStr, lastDayStr])

  const filteredRec = useMemo(() => receivables.filter(r => {
    const matchS = recStatus === 'All' || r.status === recStatus
    const q = recSearch.toLowerCase()
    const matchQ = !q || r.s.name.toLowerCase().includes(q) || (r.s.studentCode||'').toLowerCase().includes(q) || (r.s.batch||'').toLowerCase().includes(q)
    return matchS && matchQ
  }), [receivables, recStatus, recSearch])

  const expected     = students.filter(s => s.status === 'Active').reduce((sum, s) => sum + (s.fees || 0), 0)
  const recCollected = payments.filter(p => monthKey(p.date) === period).reduce((sum, p) => sum + p.amount, 0)
  const recOutstanding = receivables.filter(r => !r.isPaid).reduce((sum, r) => sum + (r.s.fees || 0), 0)
  const rate         = pct(recCollected, expected)

  const paidCount    = receivables.filter(r => r.status === 'Paid').length
  const overdueCount = receivables.filter(r => r.status === 'Overdue').length

  // Transactions
  const from = fromMonth < toMonth ? fromMonth : toMonth
  const to   = fromMonth < toMonth ? toMonth   : fromMonth
  const txFiltered = useMemo(() => payments
    .filter(p => { const mk = monthKey(p.date); return mk >= from && mk <= to && (!txSearch || (p.student||'').toLowerCase().includes(txSearch.toLowerCase()) || (p.id||'').toLowerCase().includes(txSearch.toLowerCase())) })
    .sort((a, b) => (b.date||'').localeCompare(a.date||''))
  , [payments, from, to, txSearch])

  const handleExportRec = () => {
    const headers = ['Student','Student Code','Batch','Sport','Expected Fee','Collected This Month','Outstanding','Status','Paid Till']
    downloadCSV(headers, filteredRec.map(({ s, collected, outstanding, status }) => [
      s.name, s.studentCode||'', s.batch||'', s.sport||'', s.fees||0, collected, outstanding, status, s.paidTill||''
    ]), `receivables-${period}.csv`)
  }

  const handleExportTx = () => {
    const headers = ['Date','Invoice','Student','Batch','Period','Mode','Amount','Notes']
    downloadCSV(headers, txFiltered.map(p => {
      const stu = studentMap[p.studentId]
      return [p.date||'', p.id||'', p.student||'', stu?.batch||'', p.month||'', p.mode||'', p.amount||0, p.notes||'']
    }), `transactions-${from}-to-${to}.csv`)
  }

  const recCols = [
    { key: 'student',     label: 'Student',       w: '2fr'   },
    { key: 'batch',       label: 'Batch',         w: '1.5fr' },
    { key: 'expected',    label: 'Expected',      w: '110px', right: true },
    { key: 'collected',   label: 'Collected',     w: '110px', right: true },
    { key: 'outstanding', label: 'Outstanding',   w: '115px', right: true },
    { key: 'paidtill',    label: 'Paid Till',     w: '110px' },
    { key: 'status',      label: 'Status',        w: '110px' },
  ]
  const txCols = [
    { key: 'date',    label: 'Date',    w: '100px' },
    { key: 'inv',     label: 'Invoice', w: '130px' },
    { key: 'student', label: 'Student', w: '1.5fr' },
    { key: 'period',  label: 'Period',  w: '1fr'   },
    { key: 'mode',    label: 'Mode',    w: '80px'  },
    { key: 'amount',  label: 'Amount',  w: '110px', right: true },
  ]

  return (
    <div className="space-y-5">

      {/* ── Receivables filters ─────────────────────── */}
      <FilterBar>
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Month</span>
        <Sel value={period} onChange={v => { setPeriod(v); setShowCount(25) }}>
          {MONTH_OPTS.slice(0, 12).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Sel>
        <Sel value={recStatus} onChange={setRecStatus} className="ml-1">
          {['All','Paid','Overdue','No Payment'].map(s => <option key={s} value={s}>{s}</option>)}
        </Sel>
        <div className="relative ml-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="text-xs bg-white border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-gray-700 focus:outline-none focus:border-brand-400 w-44"
            placeholder="Search student / batch…" value={recSearch} onChange={e => { setRecSearch(e.target.value); setShowCount(25) }} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">{filteredRec.length} students</span>
          <ExportBtn onClick={handleExportRec} />
        </div>
      </FilterBar>

      {/* ── KPI cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Expected',        value: INR(expected),       color: 'text-gray-900'    },
          { label: 'Collected',       value: INR(recCollected),   color: 'text-emerald-700' },
          { label: 'Outstanding',     value: INR(recOutstanding), color: 'text-red-600'     },
          { label: 'Collection Rate', value: `${rate}%`,          color: rate >= 80 ? 'text-emerald-700' : rate >= 60 ? 'text-amber-600' : 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{k.label}</p>
            <p className={`text-xl font-black tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Accounts Receivable table ───────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Table header bar */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-black text-gray-800 uppercase tracking-wide">
              Accounts Receivable
              <span className="ml-2 text-[11px] font-semibold text-gray-400 normal-case tracking-normal">
                {MONTH_OPTS.find(m => m.value === period)?.label}
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{receivables.length} students · {overdueCount} overdue · {paidCount} paid</p>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"/>
              {paidCount} Paid
            </span>
            <span className="flex items-center gap-1.5 text-red-500 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"/>
              {overdueCount} Overdue
            </span>
            <span className="flex items-center gap-1.5 text-gray-400 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block"/>
              {receivables.filter(r => r.status === 'No Payment').length} No Record
            </span>
          </div>
        </div>

        <TableHead cols={recCols} />

        {filteredRec.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No students match this filter</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-50">
              {filteredRec.slice(0, showCount).map(({ s, isPaid, status, outstanding, collected }) => {
                const isSusp = s.status === 'Suspended'
                const chipCls = status === 'Paid'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : status === 'No Payment'
                  ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : isSusp
                  ? 'bg-red-50 text-red-600 border-red-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
                const chipLabel = status === 'Overdue' && isSusp ? 'Suspended' : status
                return (
                  <div key={s.id}
                    className={`grid gap-3 px-4 py-3.5 items-center transition hover:bg-gray-50/50 ${!isPaid && isSusp ? 'bg-red-50/20' : ''}`}
                    style={{ gridTemplateColumns: recCols.map(c => c.w || '1fr').join(' ') }}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                      <p className="text-[11px] text-gray-400">{s.studentCode} · {s.sport || '—'}</p>
                    </div>
                    <span className="text-xs text-gray-600 truncate">{s.batch || '—'}</span>
                    <span className="text-sm font-semibold text-gray-600 text-right tabular-nums">{INR(s.fees)}</span>
                    <span className={`text-sm font-bold text-right tabular-nums ${collected > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                      {collected > 0 ? INR(collected) : '—'}
                    </span>
                    <span className={`text-sm font-black text-right tabular-nums ${outstanding > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                      {outstanding > 0 ? INR(outstanding) : '—'}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                      {s.paidTill
                        ? new Date(s.paidTill+'T00:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'})
                        : <span className="text-gray-300">—</span>}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit ${chipCls}`}>{chipLabel}</span>
                  </div>
                )
              })}
            </div>

            {/* View more / pagination */}
            {filteredRec.length > showCount && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/60">
                <span className="text-xs text-gray-400">Showing {Math.min(showCount, filteredRec.length)} of {filteredRec.length} students</span>
                <button onClick={() => setShowCount(c => c + 25)}
                  className="text-xs font-bold text-brand-600 hover:text-brand-700 bg-white border border-gray-200 hover:border-brand-300 px-4 py-1.5 rounded-lg transition">
                  View 25 more ↓
                </button>
              </div>
            )}

            {/* Totals footer */}
            <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
              style={{ gridTemplateColumns: recCols.map(c => c.w || '1fr').join(' ') }}>
              <span className="text-xs font-black uppercase tracking-wide col-span-2">
                Total — {filteredRec.length} students
              </span>
              <span className="text-sm font-black text-right tabular-nums text-gray-300">
                {INR(filteredRec.reduce((s, r) => s + (r.s.fees || 0), 0))}
              </span>
              <span className="text-sm font-black text-right tabular-nums text-emerald-400">
                {INR(filteredRec.reduce((s, r) => s + r.collected, 0))}
              </span>
              <span className="text-sm font-black text-right tabular-nums text-red-300">
                {INR(filteredRec.reduce((s, r) => s + r.outstanding, 0))}
              </span>
              <span /><span />
            </div>
          </>
        )}
      </div>

      {/* ── Payment Transactions (collapsible) ─────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50/40 transition"
          onClick={() => setShowTx(v => !v)}>
          <div className="text-left">
            <p className="text-sm font-black text-gray-800 uppercase tracking-wide">Payment Transactions</p>
            <p className="text-xs text-gray-400 mt-0.5">Raw cash-in records by date range</p>
          </div>
          <span className="text-xs font-bold text-gray-400 flex-shrink-0">{showTx ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {showTx && (
          <>
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-wrap gap-2 items-center">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">From</span>
              <Sel value={fromMonth} onChange={setFromMonth}>
                {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Sel>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">To</span>
              <Sel value={toMonth} onChange={setToMonth}>
                {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Sel>
              <div className="relative ml-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="text-xs bg-white border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-gray-700 focus:outline-none focus:border-brand-400 w-44"
                  placeholder="Search student / invoice…" value={txSearch} onChange={e => setTxSearch(e.target.value)} />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-gray-400">{txFiltered.length} records</span>
                <ExportBtn onClick={handleExportTx} />
              </div>
            </div>

            <TableHead cols={txCols} />
            {txFiltered.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No transactions in this range</div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                {txFiltered.map((p, i) => (
                  <div key={p.id || i}
                    className="grid gap-3 px-4 py-3 items-center hover:bg-brand-50/20 transition text-sm"
                    style={{ gridTemplateColumns: txCols.map(c => c.w || '1fr').join(' ') }}>
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
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 px-4 py-3 bg-gray-800 text-white"
              style={{ gridTemplateColumns: txCols.map(c => c.w || '1fr').join(' ') }}>
              <span className="text-xs font-black uppercase tracking-wide col-span-5">Total Collected</span>
              <span className="text-sm font-black text-right tabular-nums">
                {INR(txFiltered.reduce((s, p) => s + p.amount, 0))}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── By Batch ──────────────────────────────────────────────

function BatchTab({ batches, students, payments, attendanceData, batchToStudents = {} }) {
  const [period, setPeriod] = useState(MONTH_OPTS[0].value)
  const todayAtt = attendanceData[todayStr] || {}

  // Each batch's roster is primary-assigned students UNION multi-batch enrolments.
  // Without the union, multi-batch students' fees and payments were invisible to non-primary batches.
  const rows = useMemo(() => batches.map(b => {
    const mbIds = batchToStudents[b.id] || new Set()
    const bs  = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name || mbIds.has(s.id)))
    const exp = bs.reduce((s, st) => s + (st.fees || 0), 0)
    const bsIdSet = new Set(bs.map(s => s.id))
    const bPay = payments.filter(p => bsIdSet.has(p.studentId) && monthKey(p.date) === period)
    const col = bPay.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
    const pend = bPay.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
    const present = bs.filter(s => todayAtt[s.id] === 'Present').length
    return { batch: b, count: bs.length, expected: exp, collected: col, pending: pend, attPct: bs.length ? pct(present, bs.length) : 0 }
  }).filter(r => r.count > 0 || r.batch.capacity > 0)
    .sort((a, b) => b.expected - a.expected)
  , [batches, students, payments, period, todayAtt, batchToStudents])

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
                {ledgerWithBalance.map((p, i) => {
                  const isFirstPayment = student?.fromTrial && i === ledgerWithBalance.length - 1
                  const hasNote = p.notes && p.notes.includes('Trial fee')
                  return (
                    <div key={p.id || i}
                      className={`grid gap-3 px-4 py-3 items-center hover:bg-brand-50/20 transition ${isFirstPayment ? 'bg-amber-50/40' : ''}`}
                      style={{ gridTemplateColumns: cols.map(c => c.w || '1fr').join(' ') }}>
                      <span className="text-xs text-gray-500 font-mono">{p.date ? new Date(p.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}) : '—'}</span>
                      <span className="text-xs text-gray-400 font-mono truncate">{p.id || '—'}</span>
                      <div>
                        <span className="text-xs text-gray-600">{p.month || '—'}</span>
                        {isFirstPayment && (
                          <span className="ml-2 text-[9px] bg-amber-400 text-amber-900 font-black px-1.5 py-0.5 rounded-full">★ New Student</span>
                        )}
                        {hasNote && (
                          <p className="text-[10px] text-emerald-600 mt-0.5">{p.notes}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">{p.mode || '—'}</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-gray-900 tabular-nums">{INR(p.amount)}</span>
                        {isFirstPayment && student?.fees && (
                          <p className="text-[10px] text-emerald-600 tabular-nums">of ₹{student.fees.toLocaleString('en-IN')}</p>
                        )}
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${STATUS_CHIP[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
                      <span className="text-xs font-bold text-emerald-700 text-right tabular-nums">{INR(p.runningPaid)}</span>
                    </div>
                  )
                })}
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
      isOutstanding(s, firstOfMonth) &&
      (batchFilter === 'All' || s.batch === batchFilter)
    )
    return overdueStudents.map(s => {
      const days = ruleDaysOverdue(s, today)
      return { ...s, daysOverdue: days, bucket: ageingBucket(days), bucketOrder: ageingBucketOrder(days) }
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
  const [markerData,  setMarkerData]  = useState({})  // { [studentId]: { status, markedBy } }

  // Fetch the richer attendance (with marked_by) whenever date changes
  useEffect(() => {
    setMarkerData({})
    db.fetchAttendanceWithMarker(date).then(setMarkerData).catch(() => {})
  }, [date])

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
    const headers = ['Student','Student Code','Batch','Sport','Status','Marked By']
    downloadCSV(headers, filtered.map(s => [
      s.name, s.studentCode||'', s.batch||'', s.sport||'',
      attForDay[s.id]||'Unmarked', markerData[s.id]?.markedBy || '—'
    ]), `attendance-${date}.csv`)
  }

  const cols = [
    { key: 'name',     label: 'Student',    w: '2fr'   },
    { key: 'batch',    label: 'Batch',      w: '1.5fr' },
    { key: 'sport',    label: 'Sport',      w: '1fr'   },
    { key: 'status',   label: 'Status',     w: '100px' },
    { key: 'markedBy', label: 'Marked by',  w: '1.5fr' },
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
            const mb = markerData[s.id]?.markedBy || null
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
                <span className="text-xs text-gray-600 truncate">
                  {st === 'Unmarked' ? <span className="text-gray-300">—</span>
                    : mb ? mb
                    : <span className="text-gray-300 italic">legacy</span>}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Performance Tab ───────────────────────────────────────

const PERF_MONTH_OPTS = buildMonthOpts(12)

function PerformanceTab({ students, batches, academyId }) {
  const [month, setMonth]             = useState(PERF_MONTH_OPTS[0].value)
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    setLoading(true)
    db.fetchAllAssessments(academyId, month)
      .then(setAssessments)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [month, academyId])

  const studentMap  = Object.fromEntries(students.map(s => [s.id, s]))
  const leaderboard = assessments
    .map(a => {
      const student = studentMap[a.student_id]
      // Exclude deleted students AND suspended ones — suspended players shouldn't
      // sit on the leaderboard; coaches assess them but they're not currently in the program.
      if (!student || student.status !== 'Active') return null
      const cats  = SPORT_CATEGORIES[a.sport] || FOOTBALL_CATEGORIES
      const score = getOverallScore(a.scores, cats)
      return { student, score, tier: getTier(score) }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  const batchScores = {}
  leaderboard.forEach(({ student, score }) => {
    const key = student.batch || 'Unassigned'
    if (!batchScores[key]) batchScores[key] = []
    batchScores[key].push(score)
  })
  const batchAvgs = Object.entries(batchScores)
    .map(([name, scores]) => ({ name, avg: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length), count: scores.length }))
    .sort((a,b) => b.avg - a.avg)

  const assessedIds = new Set(assessments.map(a => a.student_id))
  const notAssessed = students.filter(s => s.status === 'Active' && !assessedIds.has(s.id))
  const avgScore    = leaderboard.length ? Math.round(leaderboard.reduce((a,b)=>a+b.score,0)/leaderboard.length) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-gray-900">Player Performance</h3>
        <select
          value={month} onChange={e => setMonth(e.target.value)}
          className="text-xs font-semibold border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none"
        >
          {PERF_MONTH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <svg className="animate-spin h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      )}

      {!loading && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-black text-gray-900">{leaderboard.length}</p>
              <p className="text-xs text-gray-500 mt-1">Assessed</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-black text-brand-600">{avgScore || '—'}</p>
              <p className="text-xs text-gray-500 mt-1">Avg Score</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-2xl font-black text-red-500">{notAssessed.length}</p>
              <p className="text-xs text-gray-500 mt-1">Pending</p>
            </div>
          </div>

          {leaderboard.length > 0 && (
            <div>
              <h4 className="text-sm font-black text-gray-900 mb-3">Top Players</h4>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
                {leaderboard.slice(0, 20).map(({ student, score, tier }, i) => {
                  const preset = student.position ? FOOTBALL_POSITIONS.find(p => p.id === student.position) : null
                  const posCol = preset ? POSITION_COLORS[preset.id] : null
                  return (
                    <div key={student.id} className="px-4 py-3 flex items-center gap-3">
                      <span className={`text-sm font-black w-7 flex-shrink-0 ${i < 3 ? 'text-brand-600' : 'text-gray-300'}`}>#{i+1}</span>
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-xs font-black text-gray-600 flex-shrink-0">{student.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold text-gray-900 truncate">{student.name}</p>
                          {student.position && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 ${posCol ? `${posCol.bg} ${posCol.text}` : 'bg-gray-100 text-gray-600'}`}>
                              {student.position}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{student.batch || '—'}</p>
                      </div>
                      <span className={`text-xs font-black px-2.5 py-1 rounded-full border flex-shrink-0 ${tier.bgClass} ${tier.textClass} ${tier.borderClass}`}>
                        {score} · {tier.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {batchAvgs.length > 0 && (
            <div>
              <h4 className="text-sm font-black text-gray-900 mb-3">Batch Performance</h4>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
                {batchAvgs.map(({ name, avg, count }) => {
                  const t = getTier(avg)
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-700 w-32 truncate">{name}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full">
                        <div className="h-3 rounded-full" style={{ width: `${avg}%`, backgroundColor: t.hex + 'cc' }} />
                      </div>
                      <span className="text-xs font-black text-gray-900 w-8 text-right">{avg}</span>
                      <span className="text-[10px] text-gray-400 w-14">{count} players</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {notAssessed.length > 0 && (
            <div>
              <h4 className="text-sm font-black text-gray-900 mb-3">Not Assessed This Month ({notAssessed.length})</h4>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
                {notAssessed.slice(0, 15).map(s => (
                  <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center text-xs font-black text-red-400">{s.name[0]}</div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.batch || '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {assessments.length === 0 && (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Star size={28} className="text-gray-300" />
              </div>
              <p className="text-sm font-bold text-gray-500">No assessments for {monthLabel(month)}</p>
              <p className="text-xs text-gray-400 mt-1">Coaches need to submit assessments first</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Audit Log Tab ──────────────────────────────────────────

const ENTITY_TYPES = ['All', 'student', 'payment', 'batch', 'trial', 'event', 'staff', 'announcement', 'assessment']
const ACTION_TYPES = [
  { id: 'all',    label: 'All Actions', icon: null },
  { id: 'add',    label: 'Added',       icon: PlusSquare },
  { id: 'edit',   label: 'Edited',      icon: Edit3 },
  { id: 'delete', label: 'Deleted',     icon: Trash2 },
]

const ENTITY_ICONS = {
  student:      '👤',
  payment:      '💳',
  batch:        '🏷️',
  trial:        '📋',
  event:        '📅',
  staff:        '👷',
  announcement: '📢',
  assessment:   '📊',
}

function exportAuditCSV(logs) {
  const rows = [
    ['Date', 'Time', 'Actor', 'Role', 'Action', 'Entity Type', 'Entity Name', 'Changes', 'Note'],
    ...logs.map(l => {
      const dt = l.created_at ? new Date(l.created_at) : null
      const changes = Object.entries(l.changes || {}).map(([k, v]) =>
        v && typeof v === 'object' ? `${k}: ${v.old || '—'} → ${v.new || '—'}` : `${k}: ${v}`
      ).join('; ')
      return [
        dt ? dt.toLocaleDateString('en-IN') : '',
        dt ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        l.actor_name || '',
        l.actor_role || '',
        ACTION_LABELS[l.action] || l.action,
        l.entity_type || '',
        l.entity_name || '',
        changes,
        l.note || '',
      ]
    })
  ]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60)  return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fullTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function groupByDate(logs) {
  const map = {}
  for (const log of logs) {
    const d = (log.created_at || '').slice(0, 10)
    if (!map[d]) map[d] = []
    map[d].push(log)
  }
  return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
}

function AuditEntry({ log, branchName, expanded, onToggle }) {
  const changes    = log.changes || {}
  const hasChanges = Object.keys(changes).length > 0
  const label      = ACTION_LABELS[log.action] || log.action
  const roleColor  = ROLE_COLORS[log.actor_role] || ROLE_COLORS.Staff
  const entityColor = ENTITY_COLORS[log.entity_type] || { bg: 'bg-gray-100', text: 'text-gray-600' }
  const cat        = ACTION_CATEGORY[log.action]
  const catColor   = cat === 'add' ? 'text-emerald-500' : cat === 'delete' ? 'text-red-400' : 'text-amber-500'
  const catIcon    = cat === 'add' ? <PlusSquare size={11} className={catColor}/> : cat === 'delete' ? <Trash2 size={11} className={catColor}/> : <Edit3 size={11} className={catColor}/>
  const entityEmoji = ENTITY_ICONS[log.entity_type] || '•'

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 hover:border-gray-200 transition group">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-black flex-shrink-0 uppercase">
          {(log.actor_name || '?')[0]}
        </div>

        <div className="flex-1 min-w-0">
          {/* Actor + role */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{log.actor_name}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${roleColor.bg} ${roleColor.text}`}>
              {log.actor_role}
            </span>
          </div>
          {/* Action + entity */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {catIcon}
            <p className="text-xs text-gray-600">
              {label}
              {log.entity_name ? <> — <span className="font-semibold text-gray-900">{log.entity_name}</span></> : ''}
            </p>
          </div>
          {/* Entity badge + branch + note */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {log.entity_type && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${entityColor.bg} ${entityColor.text}`}>
                <span>{entityEmoji}</span> {log.entity_type}
              </span>
            )}
            {(branchName || log.sport) && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
                {log.sport && <span>{log.sport}</span>}
                {log.sport && branchName && <span className="opacity-60">·</span>}
                {branchName && <span>{branchName}</span>}
              </span>
            )}
            {log.note && (
              <span className="text-[10px] text-gray-400 italic">"{log.note}"</span>
            )}
          </div>
        </div>

        {/* Time + diff toggle */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[11px] text-gray-400" title={fullTime(log.created_at)}>
            {relativeTime(log.created_at)}
          </span>
          <span className="text-[10px] text-gray-300">{fullTime(log.created_at).split(',')[1]?.trim()}</span>
          {hasChanges && (
            <button
              onClick={onToggle}
              className="flex items-center gap-0.5 text-[10px] text-brand-600 font-semibold hover:underline mt-1"
            >
              {expanded ? <><ChevronUp size={10}/> Hide</> : <><ChevronDown size={10}/> Details</>}
            </button>
          )}
        </div>
      </div>

      {/* Expanded diff */}
      {expanded && hasChanges && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">What Changed</p>
          <div className="space-y-1.5">
            {Object.entries(changes).map(([field, val]) => {
              const isOldNew = val && typeof val === 'object' && ('old' in val || 'new' in val)
              return (
                <div key={field} className="flex items-start gap-2 text-xs">
                  <span className="text-gray-400 font-semibold w-24 flex-shrink-0 capitalize">{field}</span>
                  {isOldNew ? (
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="line-through text-red-400 bg-red-50 px-1 rounded">{String(val.old || '—')}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-emerald-600 font-medium bg-emerald-50 px-1 rounded">{String(val.new || '—')}</span>
                    </span>
                  ) : (
                    <span className="text-gray-600">{String(val)}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function AuditTab({ academyId, selectedSport, selectedBranch, sportBranches }) {
  const branchNameById = useMemo(() => {
    const m = {}
    ;(sportBranches || []).forEach(b => { m[b.id] = b.branchName })
    return m
  }, [sportBranches])
  const [logs, setLogs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [entityFilter, setEntityFilter] = useState('All')
  const [actionFilter, setActionFilter] = useState('all')
  const [actorFilter, setActorFilter]   = useState('All')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [auditSection, setAuditSection] = useState('checkins') // 'checkins' | 'all'

  const load = () => {
    setLoading(true)
    db.fetchAuditLogs(academyId, 500, selectedSport || null, selectedBranch || null)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [academyId, selectedSport, selectedBranch])

  // Student check-ins: only attendance events — branch_id is now tagged correctly
  // from StudentScan, so strict branch filter applies and cross-branch bleed is prevented
  const checkIns = useMemo(() => logs
    .filter(l => l.action === 'attendance.qr_scan' || l.action === 'attendance.manual')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [logs])

  const checkInsByDate = useMemo(() => groupByDate(checkIns), [checkIns])

  const actors = useMemo(() => ['All', ...[...new Set(logs.map(l => l.actor_name).filter(Boolean))].sort()], [logs])

  const filtered = useMemo(() => logs.filter(l => {
    const matchEntity = entityFilter === 'All' || l.entity_type === entityFilter
    const matchAction = actionFilter === 'all' || ACTION_CATEGORY[l.action] === actionFilter
    const matchActor  = actorFilter === 'All' || l.actor_name === actorFilter
    const matchSearch = !search || l.actor_name?.toLowerCase().includes(search.toLowerCase()) || l.entity_name?.toLowerCase().includes(search.toLowerCase()) || (ACTION_LABELS[l.action] || '').toLowerCase().includes(search.toLowerCase())
    const logDate     = (l.created_at || '').slice(0, 10)
    const matchFrom   = !dateFrom || logDate >= dateFrom
    const matchTo     = !dateTo   || logDate <= dateTo
    return matchEntity && matchAction && matchActor && matchSearch && matchFrom && matchTo
  }), [logs, entityFilter, actionFilter, actorFilter, search, dateFrom, dateTo])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const hasActiveFilters = entityFilter !== 'All' || actionFilter !== 'all' || actorFilter !== 'All' || search || dateFrom || dateTo

  const clearFilters = () => {
    setEntityFilter('All'); setActionFilter('all'); setActorFilter('All')
    setSearch(''); setDateFrom(''); setDateTo('')
  }

  // Summary counts
  const counts = useMemo(() => ({
    total:   logs.length,
    adds:    logs.filter(l => ACTION_CATEGORY[l.action] === 'add').length,
    edits:   logs.filter(l => ACTION_CATEGORY[l.action] === 'edit').length,
    deletes: logs.filter(l => ACTION_CATEGORY[l.action] === 'delete').length,
  }), [logs])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
            <Shield size={16} className="text-brand-600" /> Audit Log
          </h3>
          <p className="text-xs text-gray-500">Every action — who did it, when, and what changed</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportAuditCSV(filtered)} className="btn-secondary text-xs gap-1.5" disabled={filtered.length === 0}>
            <FileDown size={12} /> Export CSV
          </button>
          <button onClick={load} className="btn-secondary text-xs gap-1.5">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Section toggle */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        <button onClick={() => setAuditSection('checkins')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition ${auditSection === 'checkins' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          Student Check-ins
        </button>
        <button onClick={() => setAuditSection('all')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition ${auditSection === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          All Activity
        </button>
      </div>

      {/* ── Check-ins section ── */}
      {auditSection === 'checkins' && (
        loading ? (
          <div className="card p-10 text-center">
            <RefreshCw size={24} className="animate-spin text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : checkIns.length === 0 ? (
          <div className="card p-10 text-center">
            <span className="text-3xl block mb-3">📱</span>
            <p className="text-sm font-bold text-gray-500">No student check-ins yet</p>
            <p className="text-xs text-gray-400 mt-1">Students marking attendance from their phone will appear here</p>
          </div>
        ) : (
          <div className="space-y-6">
            {checkInsByDate.map(([date, entries]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar size={10}/>
                    {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{entries.length} check-in{entries.length > 1 ? 's' : ''}</span>
                  </span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {entries.map((log, i) => {
                    const name = log.entity_name || log.actor_name || '?'
                    const time = new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    const isQR = log.action === 'attendance.qr_scan'
                    return (
                      <div key={log.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                        <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-sm font-black text-brand-600 flex-shrink-0">
                          {name[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
                          <p className="text-xs text-gray-400">{time}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex-shrink-0 ${isQR ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                          {isQR ? 'QR Scan' : 'Manual'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── All activity section ── */}
      {auditSection === 'all' && <>

      {/* Summary KPIs */}
      {!loading && logs.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Actions', val: counts.total,   color: 'text-gray-900' },
            { label: 'Added',         val: counts.adds,    color: 'text-emerald-600' },
            { label: 'Edited',        val: counts.edits,   color: 'text-amber-600' },
            { label: 'Deleted',       val: counts.deletes, color: 'text-red-500' },
          ].map(k => (
            <div key={k.label} className="card p-3 text-center">
              <p className={`text-xl font-black ${k.color}`}>{k.val}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter toggle bar */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-52">
          <Search size={13} className="text-gray-400 flex-shrink-0" />
          <input
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
            placeholder="Search actor, name, or action…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button onClick={() => setSearch('')}><X size={12} className="text-gray-400 hover:text-gray-600"/></button>}
        </div>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition ${showFilters || hasActiveFilters ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        >
          <Filter size={12} /> Filters {hasActiveFilters && <span className="bg-white/30 text-white rounded-full px-1">●</span>}
        </button>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-red-500 hover:underline flex items-center gap-1">
            <X size={11} /> Clear all
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto font-medium">{filtered.length} / {logs.length} entries</span>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          {/* Date range */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Calendar size={11}/> Date Range
            </p>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">From</span>
                <input type="date" className="input text-xs py-1.5 w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">To</span>
                <input type="date" className="input text-xs py-1.5 w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-red-500">
                  <X size={12}/>
                </button>
              )}
            </div>
          </div>

          {/* Actor */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <User size={11}/> Who Did It
            </p>
            <select className="input text-xs py-1.5 w-48" value={actorFilter} onChange={e => setActorFilter(e.target.value)}>
              {actors.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>

          {/* Action type */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Action Type</p>
            <div className="flex gap-1.5 flex-wrap">
              {ACTION_TYPES.map(t => (
                <button key={t.id} onClick={() => setActionFilter(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${actionFilter === t.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Entity type */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Module</p>
            <div className="flex gap-1.5 flex-wrap">
              {ENTITY_TYPES.map(t => (
                <button key={t} onClick={() => setEntityFilter(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition capitalize ${entityFilter === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t !== 'All' && ENTITY_ICONS[t] ? `${ENTITY_ICONS[t]} ` : ''}{t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="card p-10 text-center">
          <RefreshCw size={24} className="animate-spin text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading audit log…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <Shield size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-bold text-gray-500">{logs.length === 0 ? 'No audit entries yet' : 'No entries match filters'}</p>
          <p className="text-xs text-gray-400 mt-1">
            {logs.length === 0 && selectedSport
              ? `No actions recorded in "${selectedSport}" yet — do any action then click Refresh`
              : logs.length === 0 ? 'Actions will appear here as they happen'
              : 'Try adjusting your filters'}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="mt-3 text-xs text-brand-600 font-bold hover:underline">Clear Filters</button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, entries]) => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar size={10}/>
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400">{entries.length} action{entries.length > 1 ? 's' : ''}</span>
                </span>
                <div className="h-px flex-1 bg-gray-100" />
              </div>
              <div className="space-y-2">
                {entries.map(log => (
                  <AuditEntry
                    key={log.id}
                    log={log}
                    branchName={log.branch_id ? branchNameById[log.branch_id] : null}
                    expanded={expandedId === log.id}
                    onToggle={() => setExpandedId(prev => prev === log.id ? null : log.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      </>}
    </div>
  )
}

