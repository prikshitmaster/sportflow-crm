import { useApp } from '../context/AppContext'
import { useState, useMemo, useEffect } from 'react'
import {
  Users, CreditCard, TrendingUp, UserPlus, ChevronRight,
  AlertCircle, CalendarDays, CheckCircle, XCircle, UserCog,
  BarChart3, Layers,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { isOutstanding } from '../lib/studentRules'

export default function Dashboard() {
  const {
    students, payments, trials, batches, staff,
    user, role, hasPermission, dataLoading, attendanceData,
    leaveRequests, loadLeaveRequests, updateLeave,
    selectedSport,
  } = useApp()

  useEffect(() => { loadLeaveRequests?.() }, [])

  // ── All hooks must run before any early return ────────────

  const activeStudents = useMemo(() =>
    students.filter(s => s.status === 'Active')
  , [students])

  const activeStaff = useMemo(() =>
    staff.filter(s => s.status === 'Active')
  , [staff])

  // Derived values (not hooks — safe to compute after all hooks)
  const now          = new Date()
  const currentMonth = now.toISOString().slice(0, 7)
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const todayStr     = now.toISOString().split('T')[0]
  const todayAtt     = attendanceData[todayStr] || {}

  // Current month paid only
  const collectedAmt = payments
    .filter(p => p.status === 'Paid' && p.date?.slice(0, 7) === currentMonth)
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  // Virtual overdue: students whose paid_till expired with no existing payment record
  const studentsWithRecord = new Set(
    payments.filter(p => p.status === 'Overdue' || p.status === 'Pending').map(p => String(p.studentId))
  )
  const virtualOverdue = students
    .filter(s => isOutstanding(s, firstOfMonth) && !studentsWithRecord.has(String(s.id)))
    .map(s => ({
      id:        `DUE-${s.id}`,
      studentId: s.id,
      student:   s.name,
      amount:    s.fees || 0,
      month:     `Due — paid till ${new Date(s.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
      status:    'Overdue',
      isVirtual: true,
    }))

  const overdueList  = [...payments.filter(p => p.status === 'Overdue'), ...virtualOverdue]
  const pendingList  = payments.filter(p => p.status === 'Pending')
  const overdueAmt   = overdueList.reduce((s, p) => s + (p.amount ?? 0), 0)
  const expectedAmt  = activeStudents.reduce((s, st) => s + (st.fees || 0), 0)
  const collectPct   = expectedAmt > 0 ? Math.round((collectedAmt / expectedAmt) * 100) : 0

  const batchStats = (b) => {
    const bs = activeStudents.filter(s => s.batch === b.name || s.batchId === b.id)
    const present = bs.filter(s => todayAtt[s.id] === 'Present' || todayAtt[s.id] === true).length
    const marked  = Object.keys(todayAtt).length > 0
    const pct = bs.length ? Math.round((present / bs.length) * 100) : 0
    return { count: bs.length, present, pct, marked }
  }

  const pendingLeaves   = (leaveRequests || []).filter(r => r.status === 'Pending')
  const trialFollowUps  = trials.filter(t => {
    if (t.converted || !t.followUp) return false
    return t.followUp <= todayStr
  })

  const quickActions = [
    { label: '+ Add Student', to: '/students', color: 'bg-brand-600 text-white hover:bg-brand-700' },
    { label: '+ Add Staff',   to: '/coaches',  color: 'bg-purple-600 text-white hover:bg-purple-700' },
    { label: 'View Reports',  to: '/reports',  color: 'bg-gray-800 text-white hover:bg-gray-900' },
    { label: 'Collect Fee',   to: '/payments', color: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  ]

  // ── Loading state (after all hooks) ──────────────────────
  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm text-gray-500 font-medium">Loading…</p>
        </div>
      </div>
    )
  }

  // ── Permission gate — admin without dashboard.view ────────
  if (role === 'admin' && !hasPermission('dashboard.view')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <BarChart3 size={24} className="text-gray-400" />
          </div>
          <h3 className="font-bold text-gray-900 mb-1">Dashboard not accessible</h3>
          <p className="text-sm text-gray-500">You don't have permission to view the dashboard. Use the sidebar to navigate to your assigned sections.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">
            Good morning, {user?.name?.split(' ')[0]} 👋
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {user?.academy} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map(a => (
            <Link key={a.label} to={a.to}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${a.color}`}>
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Students"
          value={activeStudents.length}
          sub={`${students.length - activeStudents.length} inactive`}
          icon={Users}
          color="blue"
        />
        <KpiCard
          label="Collected This Month"
          value={`₹${fmtAmt(collectedAmt)}`}
          sub={`${collectPct}% of ₹${fmtAmt(expectedAmt)} expected`}
          icon={TrendingUp}
          color="green"
        />
        <KpiCard
          label="Overdue Fees"
          value={`₹${fmtAmt(overdueAmt)}`}
          sub={`${overdueList.length} overdue · ${pendingList.length} pending`}
          icon={CreditCard}
          color="red"
        />
        <KpiCard
          label={selectedSport === 'All' ? 'Active Staff' : `${selectedSport} Coaches`}
          value={activeStaff.length}
          sub={`of ${staff.length} total staff`}
          icon={UserCog}
          color="purple"
        />
      </div>

      {/* ── Main content row ──────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Money snapshot — left 2/3 */}
        <div className="lg:col-span-2 space-y-5">

          {/* Collection bar */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Fee Collection</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedSport === 'All' ? 'All sports' : selectedSport} · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </p>
              </div>
              <Link to="/reports" className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-1">
                Full report <ChevronRight size={12} />
              </Link>
            </div>

            {/* Tally-style collection summary */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-emerald-50 rounded-xl">
                <p className="text-lg font-black text-emerald-700">₹{fmtAmt(collectedAmt)}</p>
                <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Collected</p>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-xl">
                <p className="text-lg font-black text-amber-700">₹{fmtAmt(pendingList.reduce((s,p)=>s+p.amount,0))}</p>
                <p className="text-[10px] text-amber-600 font-semibold mt-0.5">Pending</p>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-xl">
                <p className="text-lg font-black text-red-700">₹{fmtAmt(overdueAmt)}</p>
                <p className="text-[10px] text-red-600 font-semibold mt-0.5">Overdue</p>
              </div>
            </div>

            {/* Progress bar */}
            {expectedAmt > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Collected {collectPct}%</span>
                  <span>Expected ₹{fmtAmt(expectedAmt)}</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min(collectPct, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Overdue students */}
          {overdueList.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <AlertCircle size={15} className="text-red-500" /> Overdue Fees
                </h3>
                <Link to="/payments" className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-1">
                  View all <ChevronRight size={12} />
                </Link>
              </div>
              <div className="divide-y divide-gray-50">
                {overdueList.slice(0, 6).map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">
                        {p.student?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{p.student}</p>
                        <p className="text-xs text-gray-400">{p.month}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-black text-red-600">₹{(p.amount ?? 0).toLocaleString('en-IN')}</p>
                      <span className="badge badge-red">Overdue</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Today's batches */}
          {batches.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Layers size={15} className="text-brand-600" />
                  Today's Batches
                  {selectedSport !== 'All' && <span className="text-xs text-gray-400 font-normal">· {selectedSport}</span>}
                </h3>
                <Link to="/batches" className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-1">
                  Manage <ChevronRight size={12} />
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {batches.map(b => {
                  const { count, present, pct, marked } = batchStats(b)
                  return (
                    <div key={b.id} className="card p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-gray-900 truncate">{b.name}</p>
                          <p className="text-xs text-gray-400 truncate">{b.coach || '—'}</p>
                        </div>
                        {marked ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full flex-shrink-0">✓ Marked</span>
                        ) : (
                          <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-full flex-shrink-0">Pending</span>
                        )}
                      </div>
                      <div className="flex items-end gap-3">
                        <div>
                          <p className="text-xl font-black text-gray-900">{count}</p>
                          <p className="text-[10px] text-gray-400">students</p>
                        </div>
                        {count > 0 && (
                          <div className="flex-1">
                            <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                              <span>{present} present</span>
                              <span className={`font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      {b.sports?.length > 0 && (
                        <p className="text-[10px] text-gray-400 mt-2 flex gap-1 flex-wrap">
                          {b.sports.map(sp => <span key={sp} className="bg-gray-100 px-1.5 py-0.5 rounded">{sp}</span>)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column — alerts + reports ─────────────────── */}
        <div className="space-y-4">

          {/* Pending leave requests — with inline approve/reject */}
          {pendingLeaves.length > 0 && (
            <div className="card p-4">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                <CalendarDays size={15} className="text-purple-600" />
                Leave Requests
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingLeaves.length}</span>
              </h3>
              <div className="space-y-3">
                {pendingLeaves.map(r => (
                  <LeaveCard key={r.id} request={r} onUpdate={updateLeave} />
                ))}
              </div>
              <Link to="/coaches" className="mt-3 flex items-center justify-center gap-1 text-xs text-purple-600 font-semibold hover:underline">
                All leave requests <ChevronRight size={11} />
              </Link>
            </div>
          )}

          {/* Summary alerts */}
          <div className="card p-4">
            <h3 className="font-bold text-gray-900 mb-3">Academy Alerts</h3>
            <div className="space-y-2.5">
              <AlertRow
                icon={CreditCard}
                color="text-red-600" bg="bg-red-50"
                text={overdueList.length > 0 ? `${overdueList.length} students overdue — ₹${fmtAmt(overdueAmt)}` : 'No overdue fees'}
                to="/payments"
              />
              <AlertRow
                icon={UserPlus}
                color="text-amber-600" bg="bg-amber-50"
                text={trialFollowUps.length > 0 ? `${trialFollowUps.length} trial follow-up${trialFollowUps.length > 1 ? 's' : ''} due` : 'No follow-ups due'}
                to="/trials"
              />
              <AlertRow
                icon={Users}
                color="text-brand-600" bg="bg-brand-50"
                text={`${activeStudents.length} active student${activeStudents.length !== 1 ? 's' : ''}${selectedSport !== 'All' ? ` in ${selectedSport}` : ''}`}
                to="/students"
              />
              <AlertRow
                icon={BarChart3}
                color="text-purple-600" bg="bg-purple-50"
                text="View full reports"
                to="/reports"
              />
            </div>
          </div>

          {/* Staff overview */}
          {activeStaff.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">
                  {selectedSport === 'All' ? 'Staff' : `${selectedSport} Staff`}
                </h3>
                <Link to="/coaches" className="text-xs text-brand-600 font-semibold hover:underline">Manage</Link>
              </div>
              <div className="space-y-2.5">
                {activeStaff.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-3">
                    {s.photoUrl ? (
                      <img src={s.photoUrl} alt={s.name} className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0 ${
                        s.staffType === 'office'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-brand-100 text-brand-700'
                      }`}>
                        {s.name[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                      <p className="text-xs text-gray-400 truncate">{s.role}</p>
                    </div>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  </div>
                ))}
                {activeStaff.length > 5 && (
                  <p className="text-xs text-gray-400 text-center">+{activeStaff.length - 5} more</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Leave request card with inline approve/reject ─────────────

function LeaveCard({ request: r, onUpdate }) {
  const [loading, setLoading] = useState(null)
  const handle = async (status) => {
    setLoading(status)
    try { await onUpdate(r.id, status) } finally { setLoading(null) }
  }
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-bold text-gray-900">{r.staff_name}</p>
          <p className="text-xs text-gray-500">{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</p>
          <p className="text-xs text-gray-400 mt-0.5 italic truncate">"{r.reason}"</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => handle('Approved')} disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50">
          <CheckCircle size={11} /> {loading === 'Approved' ? '…' : 'Approve'}
        </button>
        <button onClick={() => handle('Rejected')} disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-bold transition disabled:opacity-50">
          <XCircle size={11} /> Reject
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }) {
  const c = {
    blue:   { bg: 'bg-brand-50',   icon: 'text-brand-600' },
    green:  { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
    red:    { bg: 'bg-red-50',     icon: 'text-red-500' },
    purple: { bg: 'bg-purple-50',  icon: 'text-purple-600' },
  }[color]
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
        <div className={`w-9 h-9 ${c.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          <Icon size={18} className={c.icon} />
        </div>
      </div>
      <p className="text-2xl font-black text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-1 leading-tight">{sub}</p>
    </div>
  )
}

function AlertRow({ icon: Icon, color, bg, text, to }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 hover:opacity-80 transition">
      <div className={`w-7 h-7 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        <Icon size={13} className={color} />
      </div>
      <p className="text-xs text-gray-600 font-medium flex-1">{text}</p>
      <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />
    </Link>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function fmtAmt(n) {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `${(n / 1000).toFixed(0)}k`
  return n.toLocaleString('en-IN')
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
