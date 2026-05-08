// Staff Dashboard — coach home screen
// Matches the mobile mockup exactly:
//   date + batch context → "X sessions · Y students" → Mark Attendance CTA → Staff & Leave CTA

import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, Users, ChevronRight, Bell, QrCode, IndianRupee } from 'lucide-react'
import { useEffect } from 'react'

export default function StaffDashboard() {
  const { user, batches, students, attendanceData, leaveRequests, loadLeaveRequests, dataLoading, announcements, staff } = useApp()
  const navigate = useNavigate()

  const isOffice = user?.accessRole && !['coach', 'staff'].includes(user?.accessRole)

  // Load this coach's leave requests when dashboard mounts
  useEffect(() => { loadLeaveRequests() }, [])

  const today    = new Date().toISOString().split('T')[0]
  const todayAtt = attendanceData[today] || {}
  const dayName  = new Date().toLocaleDateString('en-IN', { weekday: 'long' })
  const dateStr  = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

  // Batches assigned to this coach
  const myBatches = batches.filter(b =>
    b.coach && user?.name &&
    b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches.length > 0 ? myBatches : batches

  // Students in coach's batches
  const myStudentIds = new Set(
    students
      .filter(s => s.status === 'Active' && displayBatches.some(b => b.id === s.batchId || b.name === s.batch))
      .map(s => s.id)
  )
  const totalStudents = myStudentIds.size

  // Count batches running today (check day name against batch.days array)
  const todayShort  = new Date().toLocaleDateString('en-IN', { weekday: 'short' }) // "Mon", "Tue" …
  const todayBatches = displayBatches.filter(b =>
    !b.days || b.days.length === 0 ||
    b.days.some(d => d.toLowerCase().startsWith(todayShort.toLowerCase().slice(0, 2)))
  )

  // Count present students today
  const presentCount = [...myStudentIds].filter(id => todayAtt[id] === 'Present').length

  // Pending leave requests for this staff
  const pendingLeaves = leaveRequests.filter(r => r.status === 'Pending').length

  // Get first batch time label
  const firstBatch = todayBatches[0]
  const batchLabel = firstBatch
    ? `${firstBatch.startTime || firstBatch.time || 'Morning'} batch`
    : 'Today'

  // ── Office staff home ─────────────────────────────────────
  if (isOffice) {
    const myRecord = staff.find(s => s.name?.toLowerCase() === user?.name?.toLowerCase())
    const recentNotices = (announcements || []).slice(0, 3)
    return (
      <div className="px-4 pt-5 pb-4 space-y-5">
        <div>
          <p className="text-xs text-gray-400 font-medium">{dayName} · {dateStr}</p>
          <h1 className="text-2xl font-black text-gray-900 mt-1">Hello, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-xs text-gray-400 mt-0.5">{user?.academy} · {user?.accessRole}</p>
        </div>

        {/* Clock in CTA */}
        <button onClick={() => navigate('/staff/scan-in')}
          className="w-full bg-brand-600 active:bg-brand-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
          <div className="text-left">
            <p className="font-bold text-base flex items-center gap-2"><QrCode size={18} /> Clock In Today</p>
            <p className="text-brand-200 text-xs mt-0.5">Scan the QR at the entrance</p>
          </div>
          <ChevronRight size={20} className="text-brand-300" />
        </button>

        {/* Salary quick view */}
        {myRecord && (
          <button onClick={() => navigate('/staff/me')}
            className="w-full bg-purple-600 active:bg-purple-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="text-left">
              <p className="font-bold text-base flex items-center gap-2"><IndianRupee size={18} /> My Payroll</p>
              <p className="text-purple-200 text-xs mt-0.5">₹{myRecord.salary?.toLocaleString('en-IN')} / month · view slip</p>
            </div>
            <ChevronRight size={20} className="text-purple-300" />
          </button>
        )}

        {/* Recent notices */}
        {recentNotices.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Recent Notices</p>
              <button onClick={() => navigate('/staff/notices')} className="text-xs text-brand-600 font-semibold">See all</button>
            </div>
            <div className="space-y-2">
              {recentNotices.map(a => (
                <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-3.5">
                  <p className="text-sm font-bold text-gray-900 truncate">{a.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.message}</p>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leave & me */}
        <button onClick={() => navigate('/staff/me')}
          className="w-full bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center justify-between active:bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
              <Users size={18} className="text-gray-500" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-gray-900">My Profile & Leave</p>
              <p className="text-xs text-gray-400">Schedule · Payroll · Apply leave</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300" />
        </button>
      </div>
    )
  }

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-60">
        <svg className="animate-spin h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
      </div>
    )
  }

  return (
    <div className="px-4 pt-5 pb-4 space-y-5">

      {/* Greeting — matches mockup */}
      <div>
        <p className="text-xs text-gray-400 font-medium">
          {dayName} · {batchLabel}
        </p>
        <h1 className="text-2xl font-black text-gray-900 mt-1">
          Coach {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">{user?.academy} · {dateStr}</p>
      </div>

      {/* Session summary — "3 sessions · 24 students" */}
      <div className="bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-xl font-black text-gray-900">{todayBatches.length}</p>
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">sessions</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-xl font-black text-gray-900">{totalStudents}</p>
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">students</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-xl font-black text-emerald-600">{presentCount}</p>
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">present</p>
          </div>
        </div>
        {pendingLeaves > 0 && (
          <span className="text-[10px] bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-bold">
            {pendingLeaves} leave req
          </span>
        )}
      </div>

      {/* Mark Attendance CTA — green */}
      <button
        onClick={() => navigate('/staff/attendance')}
        className="w-full bg-brand-600 active:bg-brand-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm"
      >
        <div className="text-left">
          <p className="font-bold text-base flex items-center gap-2">
            <CalendarCheck size={18} /> Mark Attendance
          </p>
          <p className="text-brand-200 text-xs mt-0.5">Pick batch → tap students → save</p>
        </div>
        <ChevronRight size={20} className="text-brand-300" />
      </button>

      {/* QR clock-in CTA */}
      <button
        onClick={() => navigate('/staff/scan-in')}
        className="w-full bg-emerald-600 active:bg-emerald-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm"
      >
        <div className="text-left">
          <p className="font-bold text-base flex items-center gap-2">
            <QrCode size={18} /> Clock In Today
          </p>
          <p className="text-emerald-200 text-xs mt-0.5">Scan the QR code at the entrance</p>
        </div>
        <ChevronRight size={20} className="text-emerald-300" />
      </button>

      {/* Staff & Leave CTA — purple */}
      <button
        onClick={() => navigate('/staff/me')}
        className="w-full bg-purple-600 active:bg-purple-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm"
      >
        <div className="text-left">
          <p className="font-bold text-base flex items-center gap-2">
            <Users size={18} /> Staff & Leave
          </p>
          <p className="text-purple-200 text-xs mt-0.5">Apply leave · schedule · payroll</p>
        </div>
        <ChevronRight size={20} className="text-purple-300" />
      </button>

      {/* Today's batch cards */}
      {todayBatches.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Today's Sessions</p>
          <div className="space-y-2">
            {todayBatches.map(b => {
              const bStu = students.filter(s =>
                s.status === 'Active' && (s.batchId === b.id || s.batch === b.name)
              )
              const bPresent = bStu.filter(s => todayAtt[s.id] === 'Present').length
              return (
                <button key={b.id}
                  onClick={() => navigate('/staff/attendance')}
                  className="w-full bg-white rounded-2xl p-4 border border-gray-100 active:bg-gray-50 text-left flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{b.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {b.startTime || b.time || '—'} · {b.sports?.join(', ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-gray-900">{bPresent}/{bStu.length}</p>
                    <p className="text-[10px] text-gray-400">marked</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
