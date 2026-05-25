// /ops/live — PIN-gated ops monitoring dashboard

import { useState, useEffect, useCallback, useMemo } from 'react'
import * as db from '../lib/db'
import { ACTION_LABELS } from '../lib/audit'
import {
  Shield, RefreshCw, Wifi, WifiOff, Activity,
  ClipboardList, BarChart3, Search, Users, TrendingUp,
} from 'lucide-react'

const OPS_PIN = '1111'

// ── Helpers ───────────────────────────────────────────────────

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '< 1m'
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return 'Just now'
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

const TYPE = {
  student: { bg: 'bg-blue-900',    text: 'text-blue-300',    dot: 'bg-blue-400'    },
  staff:   { bg: 'bg-emerald-900', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  owner:   { bg: 'bg-violet-900',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
}

const FEATURE_MAP = {
  attendance:   { label: 'Attendance',    color: 'bg-cyan-500'     },
  student:      { label: 'Students',      color: 'bg-blue-500'     },
  payment:      { label: 'Payments',      color: 'bg-green-500'    },
  batch:        { label: 'Batches',       color: 'bg-purple-500'   },
  trial:        { label: 'Trials',        color: 'bg-orange-500'   },
  auth:         { label: 'Login / Auth',  color: 'bg-gray-500'     },
  assessment:   { label: 'Assessments',   color: 'bg-teal-500'     },
  event:        { label: 'Events',        color: 'bg-pink-500'     },
  staff:        { label: 'Staff Mgmt',    color: 'bg-indigo-500'   },
  announcement: { label: 'Announcements', color: 'bg-yellow-500'   },
}

// ── PIN Gate ──────────────────────────────────────────────────

function PinGate({ onUnlock }) {
  const [digits, setDigits] = useState([])
  const [error,  setError]  = useState(false)

  function press(d) {
    if (digits.length >= 4) return
    const next = [...digits, d]
    setDigits(next)
    if (next.length === 4) {
      if (next.join('') === OPS_PIN) {
        onUnlock()
      } else {
        setError(true)
        setTimeout(() => { setDigits([]); setError(false) }, 700)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <Shield size={26} className="text-white" />
          </div>
          <p className="text-white font-black text-xl">Ops Monitor</p>
          <p className="text-gray-500 text-xs mt-1">Enter PIN to continue</p>
        </div>
        <div className="flex justify-center gap-4 mb-10">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              error ? 'bg-red-500 border-red-500'
              : i < digits.length ? 'bg-brand-500 border-brand-500 scale-125'
              : 'bg-transparent border-gray-600'
            }`} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => press(String(n))}
              className="h-16 rounded-2xl bg-gray-800 hover:bg-gray-700 active:scale-95 text-white text-2xl font-bold transition-all flex items-center justify-center">
              {n}
            </button>
          ))}
          <div />
          <button onClick={() => press('0')}
            className="h-16 rounded-2xl bg-gray-800 hover:bg-gray-700 active:scale-95 text-white text-2xl font-bold transition-all flex items-center justify-center">
            0
          </button>
          <button onClick={() => setDigits(d => d.slice(0, -1))}
            className="h-16 rounded-2xl bg-gray-800 hover:bg-gray-700 active:scale-95 text-gray-400 text-xl transition-all flex items-center justify-center">
            ⌫
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white', pulse }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        {pulse && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />}
        <p className="text-gray-500 text-[9px] font-black uppercase tracking-widest">{label}</p>
      </div>
      <p className={`text-3xl font-black ${color}`}>{value}</p>
      {sub && <p className="text-gray-600 text-[10px] mt-0.5">{sub}</p>}
    </div>
  )
}

function UserRow({ name, type, device, lastAction, duration, isOnline }) {
  const st = TYPE[type] || TYPE.staff
  return (
    <div className="bg-gray-800 rounded-2xl px-4 py-3.5 flex items-center gap-3">
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300">
          {name?.[0]?.toUpperCase() || '?'}
        </div>
        {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-800" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-white truncate">{name}</p>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{type}</span>
        </div>
        {lastAction
          ? <p className="text-[10px] text-gray-500 mt-0.5 truncate">↳ {lastAction}</p>
          : device && <p className="text-[10px] text-gray-600 mt-0.5 truncate">{device}</p>
        }
      </div>
      {duration && <p className="text-xs font-bold text-gray-500 flex-shrink-0">{duration}</p>}
    </div>
  )
}

// ── A: Live Tab (redesigned) ──────────────────────────────────

function LiveTab({ sessions, auditLogs }) {
  const now      = Date.now()
  const ONLINE   = 5 * 60 * 1000
  const todayStr = new Date().toISOString().slice(0, 10)

  const online         = sessions.filter(s => now - new Date(s.last_active_at).getTime() < ONLINE)
  const studentsOnline = online.filter(s => s.user_type === 'student')
  const staffOnline    = online.filter(s => s.user_type !== 'student')
  const todaySessions  = sessions.filter(s => s.started_at?.slice(0, 10) === todayStr)
  const todayCheckIns  = auditLogs.filter(l =>
    (l.action === 'attendance.qr_scan' || l.action === 'attendance.manual') &&
    l.created_at?.slice(0, 10) === todayStr
  )

  // Most recent audit action per person
  const lastActionMap = {}
  for (const l of auditLogs) {
    if (!lastActionMap[l.actor_name]) lastActionMap[l.actor_name] = l
  }

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Online Now" value={online.length} sub="active in last 5 min" pulse />
        <StatCard label="Today" value={todaySessions.length} sub="sessions started" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Students" value={studentsOnline.length} sub="online" color="text-blue-400" />
        <StatCard label="Staff" value={staffOnline.length} sub="online" color="text-emerald-400" />
        <StatCard label="Check-ins" value={todayCheckIns.length} sub="today" color="text-cyan-400" />
      </div>

      {/* Students Online */}
      {studentsOnline.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Students Online</p>
          <div className="space-y-2">
            {studentsOnline.map(s => {
              const last = lastActionMap[s.user_name]
              return (
                <UserRow key={s.id} name={s.user_name} type="student" device={s.device}
                  lastAction={last ? (ACTION_LABELS[last.action] || last.action) : null}
                  duration={fmtDuration(Math.round((now - new Date(s.started_at).getTime()) / 1000))}
                  isOnline
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Staff / Owners Online */}
      {staffOnline.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-3">Staff / Owners Online</p>
          <div className="space-y-2">
            {staffOnline.map(s => {
              const last = lastActionMap[s.user_name]
              return (
                <UserRow key={s.id} name={s.user_name} type={s.user_type} device={s.device}
                  lastAction={last ? (ACTION_LABELS[last.action] || last.action) : null}
                  duration={fmtDuration(Math.round((now - new Date(s.started_at).getTime()) / 1000))}
                  isOnline
                />
              )
            })}
          </div>
        </div>
      )}

      {online.length === 0 && (
        <div className="flex flex-col items-center py-14 text-center">
          <WifiOff size={32} className="text-gray-700 mb-3" />
          <p className="text-gray-600 text-sm font-bold">No one online right now</p>
          <p className="text-gray-700 text-xs mt-1">Auto-refreshes every 30s</p>
        </div>
      )}

      {/* Today's check-ins feed */}
      {todayCheckIns.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-3">Today's Check-ins</p>
          <div className="bg-gray-800 rounded-2xl overflow-hidden">
            {todayCheckIns.slice(0, 10).map((l, i) => (
              <div key={l.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-gray-700' : ''}`}>
                <span className="w-7 h-7 rounded-xl bg-gray-700 flex items-center justify-center text-xs font-black text-gray-300 flex-shrink-0">
                  {(l.entity_name || l.actor_name || '?')[0].toUpperCase()}
                </span>
                <p className="text-sm font-semibold text-white truncate flex-1">{l.entity_name || l.actor_name}</p>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-gray-500">{fmtTime(l.created_at)}</p>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${l.action === 'attendance.qr_scan' ? 'bg-cyan-900 text-cyan-300' : 'bg-blue-900 text-blue-300'}`}>
                    {l.action === 'attendance.qr_scan' ? 'QR' : 'Manual'}
                  </span>
                </div>
              </div>
            ))}
            {todayCheckIns.length > 10 && (
              <p className="px-4 py-2 border-t border-gray-700 text-[10px] text-gray-600">+{todayCheckIns.length - 10} more check-ins today</p>
            )}
          </div>
        </div>
      )}

      {/* Today's session timeline */}
      {todaySessions.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Today's Sessions</p>
          <div className="space-y-1.5">
            {todaySessions.map(s => {
              const st = TYPE[s.user_type] || TYPE.staff
              return (
                <div key={s.id} className="bg-gray-800 rounded-xl px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full ${st.dot} flex-shrink-0`} />
                    <p className="text-sm font-semibold text-gray-200">{s.user_name}</p>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{s.user_type}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{fmtDateTime(s.started_at)}</p>
                    {s.duration_seconds > 0 && <p className="text-[10px] text-gray-600">{fmtDuration(s.duration_seconds)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── B: Students Tab (new) ─────────────────────────────────────

function StudentsTab({ sessions, auditLogs }) {
  const now      = Date.now()
  const ONLINE   = 5 * 60 * 1000
  const todayStr = new Date().toISOString().slice(0, 10)

  const studentSessions = sessions.filter(s => s.user_type === 'student')
  const onlineStudents  = studentSessions.filter(s => now - new Date(s.last_active_at).getTime() < ONLINE)
  const todaySessions   = studentSessions.filter(s => s.started_at?.slice(0, 10) === todayStr)

  const allCheckIns   = auditLogs.filter(l => l.action === 'attendance.qr_scan' || l.action === 'attendance.manual')
  const todayCheckIns = allCheckIns.filter(l => l.created_at?.slice(0, 10) === todayStr)

  // Last audit action per student
  const lastActionMap = {}
  for (const l of auditLogs) {
    if (l.actor_role === 'Student' && !lastActionMap[l.actor_name]) lastActionMap[l.actor_name] = l
  }

  // 7-day per-student aggregate
  const studentMap = {}
  for (const s of studentSessions) {
    const key = s.user_id || s.user_name
    if (!studentMap[key]) {
      studentMap[key] = { name: s.user_name, device: s.device, sessions: 0, totalSec: 0, lastSeen: s.last_active_at, isOnline: false }
    }
    studentMap[key].sessions++
    studentMap[key].totalSec += s.duration_seconds || 0
    if ((s.last_active_at || '') > studentMap[key].lastSeen) studentMap[key].lastSeen = s.last_active_at
    if (now - new Date(s.last_active_at).getTime() < ONLINE) studentMap[key].isOnline = true
  }
  const topStudents = Object.values(studentMap).sort((a, b) => b.sessions - a.sessions).slice(0, 10)

  const withDur = studentSessions.filter(s => s.duration_seconds > 0)
  const avgSec  = withDur.length ? Math.round(withDur.reduce((t, s) => t + s.duration_seconds, 0) / withDur.length) : 0

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Online Now" value={onlineStudents.length} sub="students" color="text-blue-400" pulse />
        <StatCard label="Today" value={todaySessions.length} sub="student sessions" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Check-ins Today" value={todayCheckIns.length} sub="QR + manual" color="text-cyan-400" />
        <StatCard label="Avg Session" value={fmtDuration(avgSec)} sub="7-day" />
      </div>

      {/* Online students */}
      {onlineStudents.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Online Now</p>
          <div className="space-y-2">
            {onlineStudents.map(s => {
              const last = lastActionMap[s.user_name]
              return (
                <UserRow key={s.id} name={s.user_name} type="student" device={s.device}
                  lastAction={last ? (ACTION_LABELS[last.action] || last.action) : 'Browsing'}
                  duration={fmtDuration(Math.round((now - new Date(s.started_at).getTime()) / 1000))}
                  isOnline
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Today's check-ins */}
      {todayCheckIns.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest mb-3">
            Today's Check-ins ({todayCheckIns.length})
          </p>
          <div className="bg-gray-800 rounded-2xl overflow-hidden">
            {todayCheckIns.map((l, i) => (
              <div key={l.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-700' : ''}`}>
                <span className="w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-xs font-black text-gray-300 flex-shrink-0">
                  {(l.entity_name || l.actor_name || '?')[0].toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{l.entity_name || l.actor_name}</p>
                  <p className="text-[10px] text-gray-500">{fmtTime(l.created_at)}</p>
                </div>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${l.action === 'attendance.qr_scan' ? 'bg-cyan-900 text-cyan-300' : 'bg-blue-900 text-blue-300'}`}>
                  {l.action === 'attendance.qr_scan' ? 'QR Scan' : 'Manual'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Most active students 7-day */}
      <div>
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Most Active — 7 Days</p>
        {topStudents.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-10">No student sessions yet</p>
        ) : (
          <div className="space-y-2">
            {topStudents.map((u, i) => (
              <div key={u.name} className="bg-gray-800 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <span className="text-sm font-black text-gray-700 w-5 flex-shrink-0">#{i + 1}</span>
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300">
                    {u.name?.[0]?.toUpperCase()}
                  </div>
                  {u.isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-gray-800" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{u.name}</p>
                  <p className="text-[10px] text-gray-600 truncate">{u.device || '—'} · {timeAgo(u.lastSeen)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-white">{u.sessions}×</p>
                  <p className="text-[10px] text-gray-500">{fmtDuration(u.totalSec)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Student check-in history (all time, beyond today) */}
      {allCheckIns.filter(l => l.created_at?.slice(0, 10) !== todayStr).length > 0 && (
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Previous Check-ins</p>
          <div className="bg-gray-800 rounded-2xl overflow-hidden">
            {allCheckIns.filter(l => l.created_at?.slice(0, 10) !== todayStr).slice(0, 20).map((l, i) => (
              <div key={l.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-gray-700' : ''}`}>
                <span className="w-7 h-7 rounded-xl bg-gray-700 flex items-center justify-center text-xs font-black text-gray-300 flex-shrink-0">
                  {(l.entity_name || l.actor_name || '?')[0].toUpperCase()}
                </span>
                <p className="text-sm font-semibold text-white truncate flex-1">{l.entity_name || l.actor_name}</p>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-gray-500">{fmtDateTime(l.created_at)}</p>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${l.action === 'attendance.qr_scan' ? 'bg-cyan-900 text-cyan-300' : 'bg-blue-900 text-blue-300'}`}>
                    {l.action === 'attendance.qr_scan' ? 'QR' : 'Manual'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── C: Features Tab (new) ─────────────────────────────────────

function FeaturesTab({ auditLogs }) {
  const [view, setView] = useState('overall')

  const filtered = useMemo(() => {
    if (view === 'student') return auditLogs.filter(l => l.actor_role === 'Student')
    if (view === 'staff')   return auditLogs.filter(l => l.actor_role !== 'Student')
    return auditLogs
  }, [auditLogs, view])

  const featureCounts = useMemo(() => {
    const counts = {}
    for (const l of filtered) {
      const prefix = l.action?.split('.')?.[0] || 'other'
      counts[prefix] = (counts[prefix] || 0) + 1
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([key, count]) => ({
        key, count,
        label: FEATURE_MAP[key]?.label || key,
        color: FEATURE_MAP[key]?.color || 'bg-gray-500',
      }))
  }, [filtered])

  const maxCount = featureCounts[0]?.count || 1

  const actionCounts = useMemo(() => {
    const counts = {}
    for (const l of filtered) {
      if (!l.action) continue
      counts[l.action] = (counts[l.action] || 0) + 1
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([action, count]) => ({ action, count, label: ACTION_LABELS[action] || action }))
  }, [filtered])

  const actorCounts = useMemo(() => {
    const counts = {}
    for (const l of filtered) {
      if (!l.actor_name) continue
      if (!counts[l.actor_name]) counts[l.actor_name] = { name: l.actor_name, role: l.actor_role, count: 0 }
      counts[l.actor_name].count++
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [filtered])

  const VIEWS = [
    { id: 'overall', label: 'Overall' },
    { id: 'student', label: 'Students' },
    { id: 'staff',   label: 'Staff / Owners' },
  ]

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">

      {/* View toggle */}
      <div className="flex gap-2 flex-wrap">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              view === v.id ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-500'
            }`}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest -mt-2">{filtered.length} actions</p>

      {/* Feature usage bars */}
      <div>
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Feature Usage</p>
        <div className="space-y-3">
          {featureCounts.map(({ key, count, label, color }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-gray-300">{label}</p>
                <p className="text-xs font-black text-gray-400">{count}</p>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
              </div>
            </div>
          ))}
          {featureCounts.length === 0 && <p className="text-gray-600 text-sm text-center py-6">No actions recorded</p>}
        </div>
      </div>

      {/* Top specific actions */}
      <div>
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Top Actions</p>
        <div className="bg-gray-800 rounded-2xl overflow-hidden">
          {actionCounts.map(({ action, count, label }, i) => {
            const prefix   = action?.split('.')?.[0]
            const dotColor = FEATURE_MAP[prefix]?.color?.replace('bg-', 'bg-') || 'bg-gray-600'
            return (
              <div key={action} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-gray-700' : ''}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                <p className="text-sm text-gray-300 flex-1 truncate">{label}</p>
                <span className="text-sm font-black text-white">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Most active users */}
      <div>
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Most Active Users</p>
        <div className="space-y-2">
          {actorCounts.map((u, i) => {
            const roleKey = u.role?.toLowerCase()
            const st = TYPE[roleKey] || TYPE.staff
            return (
              <div key={u.name} className="bg-gray-800 rounded-2xl px-4 py-3 flex items-center gap-3">
                <span className="text-sm font-black text-gray-700 w-5 flex-shrink-0">#{i + 1}</span>
                <div className="w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300 flex-shrink-0">
                  {u.name?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white truncate">{u.name}</p>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{u.role}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-white">{u.count}</p>
                  <p className="text-[10px] text-gray-600">actions</p>
                </div>
              </div>
            )
          })}
          {actorCounts.length === 0 && <p className="text-gray-600 text-sm text-center py-6">No data</p>}
        </div>
      </div>
    </div>
  )
}

// ── Sessions Tab ──────────────────────────────────────────────

function SessionsTab({ sessions }) {
  const [filter, setFilter] = useState('all')
  const [query,  setQuery]  = useState('')

  const filtered = sessions
    .filter(s => filter === 'all' || s.user_type === filter)
    .filter(s => !query.trim() || s.user_name.toLowerCase().includes(query.toLowerCase().trim()))

  const FILTERS = [
    { id: 'all',     label: `All (${sessions.length})` },
    { id: 'student', label: `Students (${sessions.filter(s => s.user_type === 'student').length})` },
    { id: 'staff',   label: `Staff (${sessions.filter(s => s.user_type === 'staff').length})` },
    { id: 'owner',   label: `Owner (${sessions.filter(s => s.user_type === 'owner').length})` },
  ]

  return (
    <div className="px-4 pt-4 pb-10 space-y-4">
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name…"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
      </div>
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${filter === f.id ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map(s => {
          const st      = TYPE[s.user_type] || TYPE.staff
          const dur     = s.duration_seconds
            ? fmtDuration(s.duration_seconds)
            : fmtDuration(Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000)) + ' ●'
          const isActive = !s.ended_at && (Date.now() - new Date(s.last_active_at).getTime()) < 5 * 60 * 1000
          return (
            <div key={s.id} className="bg-gray-800 rounded-2xl px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300">
                      {s.user_name[0]?.toUpperCase()}
                    </div>
                    {isActive && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-gray-800" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white truncate">{s.user_name}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{s.user_type}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{s.academy_name || '—'} · {s.device || '—'}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-black text-gray-300">{dur}</p>
                  {isActive
                    ? <p className="text-[10px] text-emerald-500 font-bold mt-0.5">● Active</p>
                    : <p className="text-[10px] text-gray-600 mt-0.5">{timeAgo(s.ended_at || s.last_active_at)}</p>}
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-gray-700 flex items-center justify-between">
                <p className="text-[10px] text-gray-600">Started {fmtDateTime(s.started_at)}</p>
                {s.ended_at && <p className="text-[10px] text-gray-600">Ended {timeAgo(s.ended_at)}</p>}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <p className="text-center text-gray-600 py-12 text-sm">No sessions found</p>}
      </div>
    </div>
  )
}

// ── Audit Tab ─────────────────────────────────────────────────

const AUDIT_CATS = [
  { id: 'all',        label: 'All'      },
  { id: 'auth',       label: 'Auth'     },
  { id: 'student',    label: 'Students' },
  { id: 'payment',    label: 'Payments' },
  { id: 'staff',      label: 'Staff'    },
  { id: 'batch',      label: 'Batches'  },
  { id: 'trial',      label: 'Trials'   },
  { id: 'attendance', label: 'Attend'   },
  { id: 'assessment', label: 'Assess'   },
]

const ENTITY_TAG = {
  student:      { bg: 'bg-blue-900',    text: 'text-blue-300'    },
  payment:      { bg: 'bg-green-900',   text: 'text-green-300'   },
  batch:        { bg: 'bg-purple-900',  text: 'text-purple-300'  },
  trial:        { bg: 'bg-orange-900',  text: 'text-orange-300'  },
  event:        { bg: 'bg-pink-900',    text: 'text-pink-300'    },
  staff:        { bg: 'bg-indigo-900',  text: 'text-indigo-300'  },
  announcement: { bg: 'bg-yellow-900',  text: 'text-yellow-300'  },
  assessment:   { bg: 'bg-teal-900',    text: 'text-teal-300'    },
  auth:         { bg: 'bg-gray-700',    text: 'text-gray-300'    },
  attendance:   { bg: 'bg-cyan-900',    text: 'text-cyan-300'    },
}

function AuditTab({ logs }) {
  const [query, setQuery] = useState('')
  const [cat,   setCat]   = useState('all')

  const filtered = logs.filter(l => {
    if (query.trim() && (
      !l.actor_name?.toLowerCase().includes(query.toLowerCase().trim()) &&
      !l.entity_name?.toLowerCase().includes(query.toLowerCase().trim())
    )) return false
    if (cat !== 'all' && !l.action?.startsWith(cat)) return false
    return true
  })

  return (
    <div className="px-4 pt-4 pb-10 space-y-4">
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or entity…"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {AUDIT_CATS.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${cat === c.id ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">{filtered.length} entries</p>
      <div className="space-y-2">
        {filtered.slice(0, 300).map(l => {
          const et     = ENTITY_TAG[l.entity_type] || ENTITY_TAG.auth
          const isAuth = l.action?.startsWith('auth')
          return (
            <div key={l.id} className="bg-gray-800 rounded-2xl px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-white">{l.actor_name}</p>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400 uppercase tracking-wide">{l.actor_role}</span>
                    {isAuth && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">auth</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{ACTION_LABELS[l.action] || l.action}</p>
                  {l.entity_name && <p className="text-[11px] text-gray-600 mt-0.5 truncate">↳ {l.entity_name}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-gray-600">{timeAgo(l.created_at)}</p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block ${et.bg} ${et.text}`}>{l.entity_type}</span>
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && <p className="text-center text-gray-600 py-12 text-sm">No entries found</p>}
      </div>
    </div>
  )
}

// ── Stats Tab ─────────────────────────────────────────────────

function StatsTab({ sessions }) {
  const userMap = {}
  sessions.forEach(s => {
    const key = `${s.user_type}:${s.user_id || s.user_name}`
    if (!userMap[key]) {
      userMap[key] = { userName: s.user_name, userType: s.user_type, academyName: s.academy_name, loginCount: 0, totalSec: 0, lastSeen: s.last_active_at, devices: new Set() }
    }
    userMap[key].loginCount++
    userMap[key].totalSec += s.duration_seconds || 0
    if (s.last_active_at > userMap[key].lastSeen) userMap[key].lastSeen = s.last_active_at
    if (s.device) userMap[key].devices.add(s.device)
  })
  const users     = Object.values(userMap).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
  const totalSec  = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
  const withDur   = sessions.filter(s => s.duration_seconds).length
  const avgSec    = withDur > 0 ? Math.round(totalSec / withDur) : 0

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Unique Users" value={users.length} />
        <StatCard label="Sessions"     value={sessions.length} />
        <StatCard label="Avg Session"  value={fmtDuration(avgSec)} />
      </div>
      <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Per User — Last 7 Days</p>
      <div className="space-y-2">
        {users.map((u, i) => {
          const st      = TYPE[u.userType] || TYPE.staff
          const isOnline = (Date.now() - new Date(u.lastSeen).getTime()) < 5 * 60 * 1000
          return (
            <div key={i} className="bg-gray-800 rounded-2xl px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300">
                      {u.userName[0]?.toUpperCase()}
                    </div>
                    {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-800" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white truncate">{u.userName}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>{u.userType}</span>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-0.5 truncate">{u.academyName || '—'}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black text-white">{u.loginCount}×</p>
                  <p className="text-[10px] text-gray-500">{fmtDuration(u.totalSec)}</p>
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-gray-700 flex items-center justify-between">
                <p className="text-[10px] text-gray-600">Last: {timeAgo(u.lastSeen)}</p>
                {u.devices.size > 0 && <p className="text-[10px] text-gray-600">{[...u.devices].join(' · ')}</p>}
              </div>
            </div>
          )
        })}
        {users.length === 0 && <p className="text-center text-gray-600 py-12 text-sm">No session data yet</p>}
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────

const TABS = [
  { id: 'live',     label: 'Live',     Icon: Wifi         },
  { id: 'students', label: 'Students', Icon: Users        },
  { id: 'features', label: 'Features', Icon: TrendingUp   },
  { id: 'sessions', label: 'Sessions', Icon: Activity     },
  { id: 'audit',    label: 'Audit',    Icon: ClipboardList },
  { id: 'stats',    label: 'Stats',    Icon: BarChart3    },
]

function OpsDashboard() {
  const [tab,         setTab]         = useState('live')
  const [sessions,    setSessions]    = useState([])
  const [auditLogs,   setAuditLogs]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    try {
      const [sess, logs] = await Promise.all([
        db.fetchActivitySessions(7),
        db.fetchAllAuditLogs(500),
      ])
      setSessions(sess)
      setAuditLogs(logs)
      setLastUpdated(new Date())
    } catch (e) {
      console.error('Ops load:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab !== 'live') return
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [tab, load])

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 pt-3 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-600 rounded-xl flex items-center justify-center">
              <Shield size={15} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-white leading-tight">Ops Monitor</p>
              {lastUpdated && <p className="text-[9px] text-gray-600 leading-tight">Updated {timeAgo(lastUpdated)}</p>}
            </div>
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-800 text-gray-500 active:bg-gray-700 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tab bar — scrollable to fit 6 tabs */}
        <div className="flex overflow-x-auto no-scrollbar bg-gray-800 rounded-t-xl p-1 gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-shrink-0 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                tab === id ? 'bg-gray-700 text-white' : 'text-gray-600'
              }`}>
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          </div>
        ) : (
          <>
            {tab === 'live'     && <LiveTab     sessions={sessions} auditLogs={auditLogs} />}
            {tab === 'students' && <StudentsTab sessions={sessions} auditLogs={auditLogs} />}
            {tab === 'features' && <FeaturesTab auditLogs={auditLogs} />}
            {tab === 'sessions' && <SessionsTab sessions={sessions} />}
            {tab === 'audit'    && <AuditTab    logs={auditLogs} />}
            {tab === 'stats'    && <StatsTab    sessions={sessions} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── Entry point ───────────────────────────────────────────────

export default function OpsActivity() {
  const [unlocked, setUnlocked] = useState(false)
  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />
  return <OpsDashboard />
}
