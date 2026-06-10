import { useApp } from '../context/AppContext'
import { useState, useMemo, useEffect } from 'react'
import {
  Users, CreditCard, TrendingUp, UserPlus, ChevronRight,
  AlertCircle, CalendarDays, CheckCircle, XCircle, UserCog,
  BarChart3, Layers, Zap, ArrowRight, Clock,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { isOutstanding } from '../lib/studentRules'
import { Skeleton, SkeletonCards } from '../components/Skeleton'
import { fetchAllBatchEnrolments, getTodayCheckin, clockIn, clockOut } from '../lib/db'
import { toLocalDateStr, toLocalMonthStr } from '../lib/dates'

export default function Dashboard() {
  const {
    students, payments, trials, batches, staff,
    user, role, hasPermission, dataLoading, attendanceData,
    leaveRequests, loadLeaveRequests, updateLeave,
    selectedSport,
  } = useApp()

  // Multi-batch enrolments — same source as Attendance page so counts match
  const [allEnrolments, setAllEnrolments] = useState({})
  useEffect(() => {
    fetchAllBatchEnrolments()
      .then(rows => {
        const map = {}
        rows.forEach(r => {
          if (!map[r.batch_id]) map[r.batch_id] = new Set()
          map[r.batch_id].add(r.student_id)
        })
        setAllEnrolments(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadLeaveRequests?.() }, [])

  // ── Clock-in (staff only) ──────────────────────────────────────
  const [todayCheckin,  setTodayCheckin]  = useState(null)
  const [clockLoading,  setClockLoading]  = useState(false)

  useEffect(() => {
    if (role !== 'admin') return
    getTodayCheckin().then(d => setTodayCheckin(d)).catch(() => {})
  }, [role])

  const fmtClockTime = (ts) =>
    new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

  const handleClockIn = async () => {
    setClockLoading(true)
    try { setTodayCheckin(await clockIn()) } catch (e) { console.error(e) } finally { setClockLoading(false) }
  }

  const handleClockOut = async () => {
    if (!todayCheckin) return
    setClockLoading(true)
    try { setTodayCheckin(await clockOut(todayCheckin.id)) } catch (e) { console.error(e) } finally { setClockLoading(false) }
  }

  const activeStudents = useMemo(() =>
    students.filter(s => s.status === 'Active')
  , [students])

  const activeStaff = useMemo(() =>
    staff.filter(s => s.status === 'Active')
  , [staff])

  const now          = new Date()
  const currentMonth = toLocalMonthStr(now)
  const firstOfMonth = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
  const todayStr     = toLocalDateStr(now)
  const todayAtt     = attendanceData[todayStr] || {}

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const collectedAmt = payments
    .filter(p => p.status === 'Paid' && p.date?.slice(0, 7) === currentMonth)
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  // Split collected into "for this month" vs "advance (future months)"
  const MONTH_MAP = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }
  const paidForCurrentMonth = (p) => {
    const m = p.month
    if (!m) return true
    if (/^\d{4}-\d{2}/.test(m)) return m.slice(0, 7) === currentMonth
    const nameM = m.match(/^([A-Za-z]+)/), yearM = m.match(/(\d{4})/)
    if (nameM && yearM && MONTH_MAP[nameM[1]])
      return `${yearM[1]}-${String(MONTH_MAP[nameM[1]]).padStart(2,'0')}` === currentMonth
    return true
  }
  const thisMonthCollected = payments
    .filter(p => p.status === 'Paid' && p.date?.slice(0, 7) === currentMonth && paidForCurrentMonth(p))
    .reduce((s, p) => s + (p.amount ?? 0), 0)
  const advanceCollected = payments
    .filter(p => p.status === 'Paid' && p.date?.slice(0, 7) === currentMonth && !paidForCurrentMonth(p))
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  const studentsWithRecord = new Set(
    payments.filter(p => p.status === 'Overdue' || p.status === 'Pending').map(p => String(p.studentId))
  )
  const virtualOverdue = students
    .filter(s => isOutstanding(s, firstOfMonth) && !studentsWithRecord.has(String(s.id)))
    .map(s => ({
      id: `DUE-${s.id}`, studentId: s.id, student: s.name,
      amount: s.fees || 0,
      month: `Paid till ${new Date(s.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
      status: 'Overdue', isVirtual: true,
    }))

  const overdueList  = [...payments.filter(p => p.status === 'Overdue'), ...virtualOverdue]
  const pendingList  = payments.filter(p => p.status === 'Pending')
  const overdueAmt   = overdueList.reduce((s, p) => s + (p.amount ?? 0), 0)
  const pendingAmt   = pendingList.reduce((s, p) => s + (p.amount ?? 0), 0)
  const expectedAmt  = activeStudents.reduce((s, st) => s + (st.fees || 0), 0)
  const collectPct   = expectedAmt > 0 ? Math.round((collectedAmt / expectedAmt) * 100) : 0
  const thisMoPct    = expectedAmt > 0 ? Math.round((thisMonthCollected / expectedAmt) * 100) : 0

  const todayDayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]

  const batchStats = (b) => {
    const mbIds   = allEnrolments[b.id] || new Set()
    // All students (active + suspended) — matches Attendance page badge count
    const allBs   = students.filter(s => s.batchId === b.id || s.batch === b.name || mbIds.has(s.id))
    // Active only — used for attendance % denominator (same as Attendance page)
    const activeBs = allBs.filter(s => s.status === 'Active')
    const present = activeBs.filter(s => todayAtt[s.id] === 'Present' || todayAtt[s.id] === true).length
    const marked  = Object.keys(todayAtt).length > 0
    const pct = activeBs.length ? Math.round((present / activeBs.length) * 100) : 0
    // A batch trains today if it has no day schedule (trains every day) or today is in its days list
    const trainsToday = b.days?.length > 0 ? b.days.includes(todayDayShort) : true
    return { count: allBs.length, activeCount: activeBs.length, present, pct, marked, trainsToday }
  }

  const pendingLeaves   = (leaveRequests || []).filter(r => r.status === 'Pending')
  const trialFollowUps  = trials.filter(t => {
    if (t.converted || !t.followUp) return false
    return t.followUp <= todayStr
  })

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="lg:col-span-2 h-64 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (role === 'admin' && !hasPermission('dashboard.view')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <BarChart3 size={24} className="text-gray-400" />
          </div>
          <h3 className="font-bold text-gray-900 mb-1">Dashboard not accessible</h3>
          <p className="text-sm text-gray-500">You don't have permission to view the dashboard.</p>
        </div>
      </div>
    )
  }

  const firstName = user?.name?.split(' ')[0]
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  // Attention items — counts only, no lists
  const attentionItems = [
    overdueList.length > 0 && {
      icon: CreditCard, color: 'red',
      label: `${overdueList.length} student${overdueList.length > 1 ? 's' : ''} overdue`,
      amount: `₹${fmtAmt(overdueAmt)}`,
      cta: 'Collect', to: '/payments',
    },
    trialFollowUps.length > 0 && {
      icon: UserPlus, color: 'amber',
      label: `${trialFollowUps.length} trial follow-up${trialFollowUps.length > 1 ? 's' : ''} due`,
      amount: null,
      cta: 'Review', to: '/trials',
    },
    pendingLeaves.length > 0 && {
      icon: CalendarDays, color: 'purple',
      label: `${pendingLeaves.length} leave request${pendingLeaves.length > 1 ? 's' : ''} pending`,
      amount: null,
      cta: 'Approve', to: '/coaches',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-5 max-w-[1400px]">

      {/* ── Hero header ──────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 px-6 py-5">
        {/* Dot grid texture */}
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)', backgroundSize: '28px 28px' }} />
        {/* Glow accents */}
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-brand-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-8 left-20 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">{dateLabel}</p>
            <h2 className="text-xl font-black text-white">{greeting}, {firstName}</h2>
            <p className="text-sm text-white/50 mt-0.5">
              {user?.academy}
              {selectedSport && selectedSport !== 'All' && <span> · {selectedSport}</span>}
              {collectPct > 0 && (
                <span className="ml-2 text-emerald-400 font-semibold">{collectPct}% collected this month</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Link to="/students"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-500 hover:bg-brand-400 text-white transition shadow-lg shadow-brand-900/40">
              + Add Student
            </Link>
            <Link to="/coaches"
              className="hidden sm:flex px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 transition">
              + Add Staff
            </Link>
            <Link to="/reports"
              className="hidden sm:flex px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 transition">
              Reports
            </Link>
            <Link to="/payments"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white transition shadow-lg shadow-emerald-900/30">
              Collect Fee
            </Link>

            {/* Clock-in — staff only */}
            {role === 'admin' && (
              todayCheckin ? (
                <div className="flex items-center gap-1.5">
                  <span className="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 flex items-center gap-1.5">
                    <Clock size={11} />
                    {fmtClockTime(todayCheckin.clock_in)}
                    {todayCheckin.clock_out && ` → ${fmtClockTime(todayCheckin.clock_out)}`}
                  </span>
                  {!todayCheckin.clock_out && (
                    <button
                      onClick={handleClockOut}
                      disabled={clockLoading}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-red-500/30 text-white border border-white/10 transition disabled:opacity-50"
                    >
                      Clock Out
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleClockIn}
                  disabled={clockLoading}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Clock size={12} />
                  {clockLoading ? 'Clocking in…' : 'Clock In'}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── KPI row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Students"
          value={activeStudents.length}
          sub={students.length - activeStudents.length > 0 ? `${students.length - activeStudents.length} inactive` : 'All active'}
          accentColor="border-brand-500"
          valueColor="text-gray-900"
          icon={Users}
          iconColor="text-brand-500"
          iconBg="bg-brand-50"
        />
        <KpiCard
          label="Collected This Month"
          value={`₹${fmtAmt(collectedAmt)}`}
          sub={advanceCollected > 0
            ? `₹${fmtAmt(thisMonthCollected)} for ${now.toLocaleDateString('en-IN',{month:'short'})} · ₹${fmtAmt(advanceCollected)} advance`
            : `${thisMoPct}% of ₹${fmtAmt(expectedAmt)} target`}
          accentColor="border-emerald-500"
          valueColor="text-emerald-700"
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />
        <KpiCard
          label="Overdue"
          value={`₹${fmtAmt(overdueAmt)}`}
          sub={overdueList.length > 0 ? `${overdueList.length} students · ${pendingList.length} pending` : 'All clear'}
          accentColor={overdueList.length > 0 ? 'border-red-500' : 'border-gray-200'}
          valueColor={overdueList.length > 0 ? 'text-red-600' : 'text-gray-400'}
          icon={CreditCard}
          iconColor={overdueList.length > 0 ? 'text-red-500' : 'text-gray-400'}
          iconBg={overdueList.length > 0 ? 'bg-red-50' : 'bg-gray-50'}
        />
        <KpiCard
          label={selectedSport === 'All' ? 'Active Staff' : `${selectedSport} Staff`}
          value={activeStaff.length}
          sub={`of ${staff.length} total`}
          accentColor="border-purple-500"
          valueColor="text-gray-900"
          icon={UserCog}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
        />
      </div>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-5">

          {/* Fee collection — 3 clear boxes */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-gray-900">Fee Collection</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedSport === 'All' ? 'All sports' : selectedSport} · {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </p>
              </div>
              <Link to="/reports" className="text-xs text-brand-600 font-semibold hover:text-brand-700 flex items-center gap-1 transition">
                Full report <ChevronRight size={12} />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* This month */}
              <div className="bg-emerald-50 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">This Month</span>
                </div>
                <p className="text-2xl font-black text-gray-900">₹{fmtAmt(thisMonthCollected)}</p>
                {expectedAmt > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mt-1">{thisMoPct}% of ₹{fmtAmt(expectedAmt)} target</p>
                    <div className="mt-2.5 h-1.5 bg-emerald-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(thisMoPct, 100)}%`, background: thisMoPct >= 80 ? '#10b981' : thisMoPct >= 50 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">no target set</p>
                )}
              </div>

              {/* Advance paid */}
              <div className="bg-blue-50 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">Advance Paid</span>
                </div>
                <p className="text-2xl font-black text-gray-900">₹{fmtAmt(advanceCollected)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {advanceCollected > 0 ? 'collected for future months' : 'none this month'}
                </p>
              </div>

              {/* Outstanding */}
              <div className={`${overdueAmt + pendingAmt > 0 ? 'bg-red-50' : 'bg-gray-50'} rounded-2xl p-4`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2 h-2 rounded-full ${overdueAmt + pendingAmt > 0 ? 'bg-red-400' : 'bg-gray-300'}`} />
                  <span className={`text-xs font-bold uppercase tracking-wide ${overdueAmt + pendingAmt > 0 ? 'text-red-700' : 'text-gray-500'}`}>Outstanding</span>
                </div>
                <p className={`text-2xl font-black ${overdueAmt + pendingAmt > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                  ₹{fmtAmt(overdueAmt + pendingAmt)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {overdueAmt + pendingAmt > 0
                    ? `${overdueList.length + pendingList.length} student${(overdueList.length + pendingList.length) !== 1 ? 's' : ''} unpaid`
                    : 'all clear ✓'}
                </p>
              </div>
            </div>
          </div>

          {/* Today's batches */}
          {batches.length > 0 && (() => {
            const withStats = batches.map(b => ({ b, stats: batchStats(b) }))
            const todayBatches = withStats.filter(({ stats }) => stats.trainsToday)
            const otherBatches = withStats.filter(({ stats }) => !stats.trainsToday)
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Layers size={15} className="text-brand-500" />
                    Today's Batches
                    {selectedSport !== 'All' && <span className="text-xs text-gray-400 font-normal">· {selectedSport}</span>}
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Attendance</span>
                    {todayBatches.length > 0 && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{todayBatches.length} active today</span>
                    )}
                  </h3>
                  <Link to="/attendance" className="text-xs text-brand-600 font-semibold hover:text-brand-700 flex items-center gap-1 transition">
                    Mark <ChevronRight size={12} />
                  </Link>
                </div>

                {/* Active today */}
                {todayBatches.length === 0 ? (
                  <div className="card p-5 text-center">
                    <p className="text-sm text-gray-400">No batches scheduled for today ({todayDayShort})</p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {todayBatches.map(({ b, stats: { count, activeCount, present, pct, marked } }) => (
                      <div key={b.id} className={`card p-4 transition hover:shadow-md ${!marked ? 'ring-1 ring-amber-200' : 'ring-1 ring-emerald-200'}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold truncate text-gray-900">{b.name}</p>
                            <p className="text-[11px] text-gray-400 truncate mt-0.5">{b.coach || 'No coach assigned'}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${
                            marked ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-600 border border-amber-200'
                          }`}>
                            {marked ? '✓ Marked' : 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-end gap-3">
                          <div>
                            <p className="text-2xl font-black leading-none text-gray-900">{count}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{activeCount < count ? `${activeCount} active` : 'students'}</p>
                          </div>
                          {activeCount > 0 && (
                            <div className="flex-1 pb-0.5">
                              <div className="flex justify-between text-[10px] mb-1">
                                <span className="text-gray-400">{marked ? `${present} present` : 'not marked yet'}</span>
                                <span className={`font-bold ${!marked ? 'text-amber-500' : pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{marked ? `${pct}%` : '—'}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${!marked ? 'bg-amber-200' : pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                  style={{ width: marked ? `${pct}%` : '30%' }} />
                              </div>
                            </div>
                          )}
                        </div>
                        {b.sports?.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-2.5">
                            {b.sports.map(sp => (
                              <span key={sp} className="text-[10px] bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded font-medium">{sp}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Other batches — not today, clearly dimmed */}
                {otherBatches.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Not scheduled today</p>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {otherBatches.map(({ b, stats: { count } }) => (
                        <div key={b.id} className="card p-4 opacity-40 bg-gray-50 pointer-events-none">
                          <div className="flex items-start justify-between mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold truncate text-gray-500">{b.name}</p>
                              <p className="text-[11px] text-gray-400 truncate mt-0.5">{b.coach || '—'}</p>
                            </div>
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0 ml-2 font-medium">
                              {b.days?.join('/') || 'Daily'}
                            </span>
                          </div>
                          <p className="text-xl font-black text-gray-400 leading-none">{count}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">students</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Right sidebar ─────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Needs Attention — counts only, actionable */}
          {attentionItems.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                <Zap size={13} className="text-amber-500" />
                <h3 className="font-bold text-gray-900 text-sm">Needs Attention</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {attentionItems.map((item, i) => {
                  const colors = {
                    red:    { bg: 'bg-red-50',    icon: 'text-red-500',    btn: 'bg-red-600 hover:bg-red-700' },
                    amber:  { bg: 'bg-amber-50',  icon: 'text-amber-500',  btn: 'bg-amber-500 hover:bg-amber-600' },
                    purple: { bg: 'bg-purple-50', icon: 'text-purple-500', btn: 'bg-purple-600 hover:bg-purple-700' },
                  }[item.color]
                  const Icon = item.icon
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 ${colors.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <Icon size={14} className={colors.icon} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 leading-tight">{item.label}</p>
                        {item.amount && <p className="text-[11px] text-gray-400 mt-0.5 font-medium">{item.amount}</p>}
                      </div>
                      <Link to={item.to}
                        className={`text-[11px] font-bold text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition flex-shrink-0 ${colors.btn}`}>
                        {item.cta} <ArrowRight size={10} />
                      </Link>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Leave requests — inline approve/reject */}
          {pendingLeaves.length > 0 && (
            <div className="card p-4">
              <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2 text-sm">
                <CalendarDays size={14} className="text-purple-500" />
                Leave Requests
                <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto">{pendingLeaves.length}</span>
              </h3>
              <div className="space-y-3">
                {pendingLeaves.slice(0, 3).map(r => (
                  <LeaveCard key={r.id} request={r} onUpdate={updateLeave} />
                ))}
              </div>
              {pendingLeaves.length > 3 && (
                <Link to="/coaches" className="mt-3 flex items-center justify-center gap-1 text-xs text-purple-600 font-semibold hover:text-purple-700 transition">
                  +{pendingLeaves.length - 3} more <ChevronRight size={11} />
                </Link>
              )}
            </div>
          )}

          {/* Staff on duty */}
          {activeStaff.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 text-sm">
                  {selectedSport === 'All' ? 'Staff' : `${selectedSport} Staff`}
                </h3>
                <Link to="/coaches" className="text-xs text-brand-600 font-semibold hover:text-brand-700 transition">Manage</Link>
              </div>
              <div className="space-y-2.5">
                {activeStaff.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-3">
                    {s.photoUrl ? (
                      <img src={s.photoUrl} alt={s.name} className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0 ${
                        s.staffType === 'office' ? 'bg-purple-100 text-purple-700' : 'bg-brand-100 text-brand-700'
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
                  <p className="text-xs text-gray-400 text-center pt-1">+{activeStaff.length - 5} more staff</p>
                )}
              </div>
            </div>
          )}

          {/* Trials pipeline */}
          {trials.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 text-sm">Trial Pipeline</h3>
                <Link to="/trials" className="text-xs text-brand-600 font-semibold hover:text-brand-700 transition">View all</Link>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Active', count: trials.filter(t => !t.converted).length, color: 'bg-brand-500' },
                  { label: 'Follow-ups due', count: trialFollowUps.length, color: 'bg-amber-400' },
                  { label: 'Converted', count: trials.filter(t => t.converted).length, color: 'bg-emerald-500' },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />
                    <p className="text-xs text-gray-600 flex-1">{label}</p>
                    <p className="text-xs font-bold text-gray-900">{count}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Leave request card ────────────────────────────────────────

function LeaveCard({ request: r, onUpdate }) {
  const [loading, setLoading] = useState(null)
  const handle = async (status) => {
    setLoading(status)
    try { await onUpdate(r.id, status) } finally { setLoading(null) }
  }
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
      <div className="mb-2">
        <p className="text-sm font-bold text-gray-900">{r.staff_name}</p>
        <p className="text-xs text-gray-500">{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</p>
        {r.reason && <p className="text-xs text-gray-400 mt-0.5 italic truncate">"{r.reason}"</p>}
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

function KpiCard({ label, value, sub, accentColor, valueColor, icon: Icon, iconColor, iconBg }) {
  return (
    <div className={`card p-5 border-l-4 ${accentColor}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider leading-tight">{label}</p>
        <div className={`w-8 h-8 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <Icon size={15} className={iconColor} />
        </div>
      </div>
      <p className={`text-2xl font-black ${valueColor}`}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-1 leading-tight">{sub}</p>
    </div>
  )
}

function MetricBox({ label, value, accent }) {
  const c = {
    emerald: { bg: 'bg-emerald-50', value: 'text-emerald-700', label: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   value: 'text-amber-700',   label: 'text-amber-600'   },
    red:     { bg: 'bg-red-50',     value: 'text-red-700',     label: 'text-red-600'     },
  }[accent]
  return (
    <div className={`text-center p-3 ${c.bg} rounded-xl`}>
      <p className={`text-base font-black ${c.value}`}>{value}</p>
      <p className={`text-[10px] font-semibold mt-0.5 ${c.label}`}>{label}</p>
    </div>
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
