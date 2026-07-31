import { useApp } from '../context/AppContext'
import { useState, useMemo, useEffect } from 'react'
import {
  Users, CreditCard, TrendingUp, UserPlus, ChevronRight,
  AlertCircle, CalendarDays, CheckCircle, XCircle, UserCog,
  BarChart3, Layers, ArrowRight, Clock, FileText,
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
      // A never-paid student now counts as outstanding (studentRules.paidUpTo
      // ages them from their join date) — they have no paidTill to print.
      month: s.paidTill
        ? `Paid till ${new Date(s.paidTill + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : 'Never paid',
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
        <Skeleton className="h-24 w-full rounded-xl" />
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="lg:col-span-2 h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (role === 'admin' && !hasPermission('dashboard.view')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <BarChart3 size={20} className="text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Dashboard not accessible</h3>
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
      icon: CalendarDays, color: 'slate',
      label: `${pendingLeaves.length} leave request${pendingLeaves.length > 1 ? 's' : ''} pending`,
      amount: null,
      cta: 'Approve', to: '/coaches',
    },
  ].filter(Boolean)

  return (
    <div className="space-y-5 max-w-[1400px]">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{dateLabel}</p>
            <h2 className="text-lg font-semibold text-gray-900 tracking-tight mt-1">{greeting}, {firstName}</h2>
            <p className="text-[13px] text-gray-500 mt-1">
              {user?.academy}
              {selectedSport && selectedSport !== 'All' && <span> · {selectedSport}</span>}
              {collectPct > 0 && (
                <span className="text-gray-400"> · <span className="text-gray-600 font-medium tabular-nums">{collectPct}%</span> collected this month</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Link to="/students" className="btn-ghost">
              <UserPlus size={14} className="text-gray-400" /> Add Student
            </Link>
            <Link to="/coaches" className="btn-ghost hidden sm:inline-flex">
              <UserCog size={14} className="text-gray-400" /> Add Staff
            </Link>
            <Link to="/reports" className="btn-ghost hidden sm:inline-flex">
              <FileText size={14} className="text-gray-400" /> Reports
            </Link>
            <Link to="/payments"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors">
              Collect Fee
            </Link>

            {/* Clock-in — staff only */}
            {role === 'admin' && (
              todayCheckin ? (
                <div className="flex items-center gap-2 sm:pl-2 sm:ml-1 sm:border-l sm:border-gray-200">
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-600 tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {fmtClockTime(todayCheckin.clock_in)}
                    {todayCheckin.clock_out && ` → ${fmtClockTime(todayCheckin.clock_out)}`}
                  </span>
                  {!todayCheckin.clock_out && (
                    <button
                      onClick={handleClockOut}
                      disabled={clockLoading}
                      className="btn-ghost disabled:opacity-50"
                    >
                      Clock Out
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleClockIn}
                  disabled={clockLoading}
                  className="btn-ghost disabled:opacity-50 sm:ml-1"
                >
                  <Clock size={14} className="text-gray-400" />
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
          icon={Users}
        />
        <KpiCard
          label="Collected This Month"
          value={`₹${fmtAmt(collectedAmt)}`}
          sub={advanceCollected > 0
            ? `₹${fmtAmt(thisMonthCollected)} for ${now.toLocaleDateString('en-IN',{month:'short'})} · ₹${fmtAmt(advanceCollected)} advance`
            : `${thisMoPct}% of ₹${fmtAmt(expectedAmt)} target`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Overdue"
          value={`₹${fmtAmt(overdueAmt)}`}
          sub={overdueList.length > 0 ? `${overdueList.length} students · ${pendingList.length} pending` : 'All clear'}
          icon={CreditCard}
          tone={overdueList.length > 0 ? 'negative' : 'muted'}
        />
        <KpiCard
          label={selectedSport === 'All' ? 'Active Staff' : `${selectedSport} Staff`}
          value={activeStaff.length}
          sub={`of ${staff.length} total`}
          icon={UserCog}
        />
      </div>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-5">

          {/* Fee collection — 3 clear columns */}
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Fee Collection</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedSport === 'All' ? 'All sports' : selectedSport} · {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </p>
              </div>
              <Link to="/reports" className="text-xs text-gray-500 font-medium hover:text-gray-900 flex items-center gap-0.5 transition-colors">
                Full report <ChevronRight size={13} />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 sm:divide-x divide-y sm:divide-y-0 divide-gray-200">
              {/* This month */}
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">This Month</p>
                <p className="text-2xl font-semibold text-gray-900 tracking-tight tabular-nums mt-2">₹{fmtAmt(thisMonthCollected)}</p>
                {expectedAmt > 0 ? (
                  <>
                    <p className="text-xs text-gray-500 mt-1.5 tabular-nums">{thisMoPct}% of ₹{fmtAmt(expectedAmt)} target</p>
                    <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(thisMoPct, 100)}%`, background: thisMoPct >= 80 ? '#059669' : thisMoPct >= 50 ? '#d97706' : '#dc2626' }} />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">No target set</p>
                )}
              </div>

              {/* Advance paid */}
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Advance Paid</p>
                <p className="text-2xl font-semibold text-gray-900 tracking-tight tabular-nums mt-2">₹{fmtAmt(advanceCollected)}</p>
                <p className="text-xs text-gray-500 mt-1.5">
                  {advanceCollected > 0 ? 'Collected for future months' : 'None this month'}
                </p>
              </div>

              {/* Outstanding */}
              <div className="px-5 py-4">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Outstanding</p>
                <p className={`text-2xl font-semibold tracking-tight tabular-nums mt-2 ${overdueAmt + pendingAmt > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                  ₹{fmtAmt(overdueAmt + pendingAmt)}
                </p>
                <p className="text-xs text-gray-500 mt-1.5">
                  {overdueAmt + pendingAmt > 0
                    ? `${overdueList.length + pendingList.length} student${(overdueList.length + pendingList.length) !== 1 ? 's' : ''} unpaid`
                    : 'All clear'}
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
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Layers size={14} className="text-gray-400" />
                    Today's Batches
                    {selectedSport !== 'All' && <span className="text-xs text-gray-400 font-normal">· {selectedSport}</span>}
                    {todayBatches.length > 0 && (
                      <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded tabular-nums">{todayBatches.length} scheduled</span>
                    )}
                  </h3>
                  <Link to="/attendance" className="text-xs text-gray-500 font-medium hover:text-gray-900 flex items-center gap-0.5 transition-colors">
                    Mark attendance <ChevronRight size={13} />
                  </Link>
                </div>

                {/* Active today */}
                {todayBatches.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center">
                    <p className="text-sm text-gray-400">No batches scheduled for today ({todayDayShort})</p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {todayBatches.map(({ b, stats: { count, activeCount, present, pct, marked } }) => (
                      <div key={b.id} className="bg-white border border-gray-200 rounded-xl p-4 transition-colors hover:border-gray-300">
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate text-gray-900">{b.name}</p>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{b.coach || 'No coach assigned'}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium flex-shrink-0 ml-2 ${
                            marked ? 'text-gray-500' : 'text-amber-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${marked ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            {marked ? 'Marked' : 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-end gap-3">
                          <div>
                            <p className="text-xl font-semibold leading-none text-gray-900 tabular-nums">{count}</p>
                            <p className="text-[11px] text-gray-400 mt-1">{activeCount < count ? `${activeCount} active` : 'students'}</p>
                          </div>
                          {activeCount > 0 && (
                            <div className="flex-1 pb-0.5">
                              <div className="flex justify-between text-[11px] mb-1.5">
                                <span className="text-gray-400">{marked ? `${present} present` : 'Not marked yet'}</span>
                                <span className={`font-medium tabular-nums ${!marked ? 'text-gray-300' : pct >= 80 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-700' : 'text-red-600'}`}>{marked ? `${pct}%` : '—'}</span>
                              </div>
                              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${!marked ? 'bg-gray-200' : pct >= 80 ? 'bg-emerald-600' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: marked ? `${pct}%` : '30%' }} />
                              </div>
                            </div>
                          )}
                        </div>
                        {b.sports?.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap mt-3">
                            {b.sports.map(sp => (
                              <span key={sp} className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">{sp}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Other batches — not today */}
                {otherBatches.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Not scheduled today</p>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {otherBatches.map(({ b, stats: { count } }) => (
                        <div key={b.id} className="bg-gray-50/60 border border-gray-200 rounded-xl p-4 pointer-events-none">
                          <div className="flex items-start justify-between mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate text-gray-500">{b.name}</p>
                              <p className="text-xs text-gray-400 truncate mt-0.5">{b.coach || '—'}</p>
                            </div>
                            <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2">
                              {b.days?.join('/') || 'Daily'}
                            </span>
                          </div>
                          <p className="text-lg font-semibold text-gray-400 leading-none tabular-nums">{count}</p>
                          <p className="text-[11px] text-gray-400 mt-1">students</p>
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
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                <AlertCircle size={13} className="text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900">Needs Attention</h3>
              </div>
              <div className="divide-y divide-gray-200">
                {attentionItems.map((item, i) => {
                  const dot = {
                    red:   'bg-red-500',
                    amber: 'bg-amber-500',
                    slate: 'bg-gray-400',
                  }[item.color]
                  const Icon = item.icon
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-7 h-7 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center flex-shrink-0 relative">
                        <Icon size={13} className="text-gray-500" />
                        <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white ${dot}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-800 leading-tight">{item.label}</p>
                        {item.amount && <p className="text-xs text-gray-400 mt-0.5 tabular-nums">{item.amount}</p>}
                      </div>
                      <Link to={item.to}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors flex-shrink-0">
                        {item.cta} <ArrowRight size={11} />
                      </Link>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Leave requests — inline approve/reject */}
          {pendingLeaves.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <CalendarDays size={14} className="text-gray-400" />
                Leave Requests
                <span className="bg-gray-100 text-gray-600 text-[11px] font-medium px-1.5 py-0.5 rounded ml-auto tabular-nums">{pendingLeaves.length}</span>
              </h3>
              <div className="space-y-2.5">
                {pendingLeaves.slice(0, 3).map(r => (
                  <LeaveCard key={r.id} request={r} onUpdate={updateLeave} />
                ))}
              </div>
              {pendingLeaves.length > 3 && (
                <Link to="/coaches" className="mt-3 flex items-center justify-center gap-1 text-xs text-gray-500 font-medium hover:text-gray-900 transition-colors">
                  +{pendingLeaves.length - 3} more <ChevronRight size={12} />
                </Link>
              )}
            </div>
          )}

          {/* Staff on duty */}
          {activeStaff.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  {selectedSport === 'All' ? 'Staff' : `${selectedSport} Staff`}
                </h3>
                <Link to="/coaches" className="text-xs text-gray-500 font-medium hover:text-gray-900 transition-colors">Manage</Link>
              </div>
              <div className="space-y-3">
                {activeStaff.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-3">
                    {s.photoUrl ? (
                      <img src={s.photoUrl} alt={s.name} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {s.name[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{s.name}</p>
                      <p className="text-xs text-gray-400 truncate">{s.role}</p>
                    </div>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  </div>
                ))}
                {activeStaff.length > 5 && (
                  <p className="text-xs text-gray-400 pt-1">+{activeStaff.length - 5} more staff</p>
                )}
              </div>
            </div>
          )}

          {/* Trials pipeline */}
          {trials.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Trial Pipeline</h3>
                <Link to="/trials" className="text-xs text-gray-500 font-medium hover:text-gray-900 transition-colors">View all</Link>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'Active', count: trials.filter(t => !t.converted).length, color: 'bg-gray-400' },
                  { label: 'Follow-ups due', count: trialFollowUps.length, color: 'bg-amber-500' },
                  { label: 'Converted', count: trials.filter(t => t.converted).length, color: 'bg-emerald-500' },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />
                    <p className="text-[13px] text-gray-600 flex-1">{label}</p>
                    <p className="text-[13px] font-medium text-gray-900 tabular-nums">{count}</p>
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
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="mb-2.5">
        <p className="text-[13px] font-medium text-gray-900">{r.staff_name}</p>
        <p className="text-xs text-gray-500 mt-0.5">{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</p>
        {r.reason && <p className="text-xs text-gray-400 mt-0.5 truncate">{r.reason}</p>}
      </div>
      <div className="flex gap-2">
        <button onClick={() => handle('Approved')} disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium transition-colors disabled:opacity-50">
          <CheckCircle size={12} /> {loading === 'Approved' ? '…' : 'Approve'}
        </button>
        <button onClick={() => handle('Rejected')} disabled={!!loading}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 text-xs font-medium transition-colors disabled:opacity-50">
          <XCircle size={12} /> {loading === 'Rejected' ? '…' : 'Reject'}
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, tone = 'default' }) {
  const valueColor = {
    default:  'text-gray-900',
    negative: 'text-red-600',
    muted:    'text-gray-300',
  }[tone]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider leading-tight">{label}</p>
        <Icon size={15} className="text-gray-300 flex-shrink-0" />
      </div>
      <p className={`text-2xl font-semibold tracking-tight tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1.5 leading-tight">{sub}</p>
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
