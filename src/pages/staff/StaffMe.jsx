// StaffMe — "Staff" tab: Apply Leave + My Schedule + Payroll Slip
// Maps to the diagram's "Staff" column: Apply Leave, Payroll Slip, My Schedule
// My Performance and Drills Library are excluded per owner decision

import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import {
  CalendarDays, IndianRupee, LayoutGrid, ChevronDown,
  Clock, CheckCircle, XCircle, Hourglass,
} from 'lucide-react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const SECTION_TABS = [
  { id: 'leave',    label: 'Apply Leave', icon: CalendarDays },
  { id: 'schedule', label: 'My Schedule', icon: LayoutGrid },
  { id: 'payroll',  label: 'Payroll Slip', icon: IndianRupee },
]

export default function StaffMe() {
  const { user, staff, batches, leaveRequests, submitLeave, loadLeaveRequests } = useApp()
  const [tab, setTab] = useState('leave')

  useEffect(() => { loadLeaveRequests() }, [])

  return (
    <div className="px-4 pt-5 pb-4">
      {/* Section tab switcher */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {SECTION_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition ${
              tab === id
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'leave'    && <LeaveSection leaveRequests={leaveRequests} submitLeave={submitLeave} userId={user?.id} userName={user?.name} />}
      {tab === 'schedule' && <ScheduleSection batches={batches} user={user} />}
      {tab === 'payroll'  && <PayrollSection staff={staff} user={user} />}
    </div>
  )
}

// ── Apply Leave ───────────────────────────────────────────

function LeaveSection({ leaveRequests, submitLeave, userId, userName }) {
  const today = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [reason,    setReason]    = useState('')
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!startDate || !endDate || !reason.trim()) return
    setLoading(true)
    try {
      await submitLeave(startDate, endDate, reason.trim())
      setStartDate(''); setEndDate(''); setReason(''); setDone(true)
      setTimeout(() => setDone(false), 3000)
    } finally {
      setLoading(false)
    }
  }

  // Days between dates
  const dayCount = useMemo(() => {
    if (!startDate || !endDate) return 0
    const diff = (new Date(endDate) - new Date(startDate)) / 86400000
    return diff >= 0 ? diff + 1 : 0
  }, [startDate, endDate])

  const statusIcon = {
    Pending:  <Hourglass  size={14} className="text-amber-500" />,
    Approved: <CheckCircle size={14} className="text-emerald-500" />,
    Rejected: <XCircle   size={14} className="text-red-500" />,
  }
  const statusStyle = {
    Pending:  'bg-amber-50 text-amber-700 border-amber-100',
    Approved: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    Rejected: 'bg-red-50 text-red-700 border-red-100',
  }

  return (
    <div className="space-y-5">
      {/* Apply form */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h3 className="font-bold text-gray-900 mb-4">Apply for Leave</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">From</label>
              <input className="input text-sm" type="date" min={today}
                value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input className="input text-sm" type="date" min={startDate || today}
                value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>
          {dayCount > 0 && (
            <p className="text-xs text-brand-600 font-semibold">{dayCount} day{dayCount > 1 ? 's' : ''} selected</p>
          )}
          <div>
            <label className="label text-xs">Reason</label>
            <textarea
              className="input text-sm resize-none"
              rows={3}
              placeholder="Enter reason for leave (e.g. family function, medical, travel)…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading || !startDate || !endDate || !reason.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition">
            {loading ? 'Submitting…' : done ? '✓ Submitted!' : 'Submit Leave Request'}
          </button>
          {done && <p className="text-xs text-emerald-600 text-center font-semibold">Sent to owner for approval</p>}
        </form>
      </div>

      {/* My leave history */}
      {leaveRequests.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">My Leave History</p>
          <div className="space-y-2">
            {leaveRequests.map(r => (
              <div key={r.id} className={`rounded-2xl border p-3.5 ${statusStyle[r.status] || 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{r.reason}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {statusIcon[r.status]}
                    <span className="text-xs font-bold">{r.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── My Schedule (weekly grid) ─────────────────────────────

function ScheduleSection({ batches, user }) {
  // Find coach's batches
  const myBatches = useMemo(() => {
    const assigned = batches.filter(b =>
      b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
    )
    return assigned.length > 0 ? assigned : batches
  }, [batches, user])

  // Build a day → batches map
  const schedule = useMemo(() => {
    const map = {}
    DAYS.forEach(d => { map[d] = [] })
    myBatches.forEach(b => {
      if (!b.days || b.days.length === 0) {
        // No days set — show under every day
        DAYS.forEach(d => map[d].push(b))
      } else {
        b.days.forEach(day => {
          const key = DAYS.find(d => d.toLowerCase() === day.toLowerCase().slice(0, 3))
          if (key) map[key].push(b)
        })
      }
    })
    return map
  }, [myBatches])

  const todayDay = new Date().toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 3)

  return (
    <div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Weekly Schedule</p>
      <div className="space-y-2">
        {DAYS.map(day => {
          const dayBatches = schedule[day] || []
          const isToday = day.toLowerCase() === todayDay.toLowerCase()
          return (
            <div key={day}
              className={`rounded-2xl border p-3 ${isToday ? 'border-brand-200 bg-brand-50' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <p className={`text-xs font-black uppercase tracking-wide w-8 ${isToday ? 'text-brand-600' : 'text-gray-400'}`}>
                  {day}
                </p>
                {isToday && <span className="text-[9px] bg-brand-600 text-white px-1.5 py-0.5 rounded font-bold">TODAY</span>}
              </div>
              {dayBatches.length === 0 ? (
                <p className="text-xs text-gray-300 italic pl-10">Rest day</p>
              ) : (
                <div className="space-y-1.5 pl-10">
                  {dayBatches.map(b => (
                    <div key={b.id} className="flex items-center gap-2">
                      <span className="text-base">{getSportEmoji(b.sports?.[0])}</span>
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{b.name}</p>
                        {b.startTime && (
                          <p className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Clock size={9} /> {b.startTime}{b.endTime ? ` – ${b.endTime}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Payroll Slip ──────────────────────────────────────────

function PayrollSection({ staff, user }) {
  // Find staff record by matching name
  const myRecord = useMemo(() =>
    staff.find(s => s.name.toLowerCase() === user?.name?.toLowerCase()),
  [staff, user])

  const month = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  if (!myRecord) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
        <IndianRupee size={28} className="text-gray-200 mx-auto mb-3" />
        <p className="text-sm text-gray-500 font-semibold">Payroll not set up yet</p>
        <p className="text-xs text-gray-400 mt-1">Ask your owner to add your salary details in Staff Management.</p>
      </div>
    )
  }

  const gross    = myRecord.salary || 0
  const tds      = Math.round(gross * 0.1)   // 10% TDS (simplified)
  const pf       = Math.round(gross * 0.12)  // 12% PF (simplified)
  const net      = gross - tds - pf

  return (
    <div>
      {/* Slip header */}
      <div className="bg-gray-900 rounded-2xl p-5 text-white mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Payroll Slip</p>
        <h3 className="text-lg font-black">{user?.name}</h3>
        <p className="text-sm text-gray-300">{myRecord.role} · {user?.academy}</p>
        <p className="text-xs text-gray-500 mt-2">{month}</p>
      </div>

      {/* Earnings / deductions — Tally style */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-2 bg-gray-50 px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-100">
          <span>Earnings</span>
          <span className="text-right">Amount</span>
        </div>
        <Row label="Basic Salary" value={gross} />
        <div className="grid grid-cols-2 bg-gray-50 px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide border-t border-b border-gray-100 mt-0">
          <span>Deductions</span>
          <span className="text-right">Amount</span>
        </div>
        <Row label="TDS (10%)" value={tds} negative />
        <Row label="PF (12%)" value={pf} negative />
        {/* Net */}
        <div className="grid grid-cols-2 px-4 py-3 bg-brand-50 border-t-2 border-brand-200">
          <span className="text-sm font-black text-brand-800">Net Pay</span>
          <span className="text-sm font-black text-brand-800 text-right">
            ₹{net.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center mt-3">
        Contact your owner for official salary slip / receipt
      </p>
    </div>
  )
}

function Row({ label, value, negative }) {
  return (
    <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-sm font-semibold text-right tabular-nums ${negative ? 'text-red-500' : 'text-gray-900'}`}>
        {negative ? '–' : ''}₹{value.toLocaleString('en-IN')}
      </span>
    </div>
  )
}

// ── Profile / Me tab (simple) ─────────────────────────────

export function StaffProfile() {
  const { user, logoutStaff } = useApp()
  const navigate = useNavigate?.() // optional

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      {/* Avatar + name */}
      <div className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 p-4">
        <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center text-xl font-black text-brand-700">
          {user?.name?.[0] || 'S'}
        </div>
        <div>
          <p className="font-bold text-gray-900">{user?.name}</p>
          <p className="text-xs text-gray-500">{user?.email}</p>
          <p className="text-xs text-gray-400 mt-0.5">{user?.academy}</p>
        </div>
      </div>
      {/* Logout */}
      <button
        onClick={async () => { await logoutStaff?.(); window.location.href = '/login' }}
        className="w-full bg-red-50 text-red-600 font-bold py-3 rounded-2xl text-sm border border-red-100 active:bg-red-100 transition">
        Sign Out
      </button>
    </div>
  )
}

// Helpers
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function getSportEmoji(sport) {
  if (!sport) return '🏃'
  const s = sport.toLowerCase()
  if (s.includes('cricket'))    return '🏏'
  if (s.includes('football'))   return '⚽'
  if (s.includes('tennis'))     return '🎾'
  if (s.includes('badminton'))  return '🏸'
  if (s.includes('basketball')) return '🏀'
  if (s.includes('swimming'))   return '🏊'
  if (s.includes('dance'))      return '💃'
  if (s.includes('martial') || s.includes('karate')) return '🥋'
  return '🏃'
}
