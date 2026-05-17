// /ops/live — PIN-gated ops monitoring dashboard (dev-only, no nav links)
// Change OPS_PIN below to your preferred 4-digit code.

import { useState, useEffect, useCallback } from 'react'
import * as db from '../lib/db'
import { ACTION_LABELS } from '../lib/audit'
import {
  Shield, RefreshCw, Wifi, WifiOff, Activity,
  ClipboardList, BarChart3, Search,
} from 'lucide-react'

const OPS_PIN = '1111' // ← change this

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
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

const TYPE = {
  student: { bg: 'bg-blue-900',    text: 'text-blue-300',    dot: 'bg-blue-400'    },
  staff:   { bg: 'bg-emerald-900', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  owner:   { bg: 'bg-violet-900',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
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

        {/* PIN dots */}
        <div className="flex justify-center gap-4 mb-10">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
              error
                ? 'bg-red-500 border-red-500'
                : i < digits.length
                ? 'bg-brand-500 border-brand-500 scale-125'
                : 'bg-transparent border-gray-600'
            }`} />
          ))}
        </div>

        {/* Numpad */}
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

// ── Live Tab ──────────────────────────────────────────────────

function LiveTab({ sessions }) {
  const now     = Date.now()
  const ONLINE  = 5 * 60 * 1000
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const online     = sessions.filter(s => now - new Date(s.last_active_at).getTime() < ONLINE)
  const todayCount = sessions.filter(s => new Date(s.started_at) >= todayStart).length
  const weekTotal  = sessions.length

  const byType = type => sessions.filter(s => s.user_type === type).length

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Online Now</p>
          </div>
          <p className="text-5xl font-black text-white">{online.length}</p>
          <p className="text-gray-600 text-xs mt-1">active in last 5 min</p>
        </div>
        <div className="bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={11} className="text-gray-400" />
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest">Today</p>
          </div>
          <p className="text-5xl font-black text-white">{todayCount}</p>
          <p className="text-gray-600 text-xs mt-1">sessions started</p>
        </div>
      </div>

      {/* 7-day breakdown */}
      <div className="grid grid-cols-3 gap-2">
        {['student', 'staff', 'owner'].map(t => {
          const st = TYPE[t]
          return (
            <div key={t} className="bg-gray-800 rounded-2xl p-3 text-center">
              <p className="text-2xl font-black text-white">{byType(t)}</p>
              <p className={`text-[10px] font-black uppercase mt-1 ${st.text}`}>{t}s</p>
              <p className="text-[9px] text-gray-700 mt-0.5">7-day</p>
            </div>
          )
        })}
      </div>

      {/* Currently active */}
      {online.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Currently Active</p>
          <div className="space-y-2">
            {online.map(s => {
              const st  = TYPE[s.user_type] || TYPE.staff
              const dur = fmtDuration(Math.round((now - new Date(s.started_at).getTime()) / 1000))
              return (
                <div key={s.id} className="bg-gray-800 rounded-2xl px-4 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center text-sm font-black text-gray-300">
                        {s.user_name[0]?.toUpperCase()}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-800" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{s.user_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.academy_name || s.device || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                      {s.user_type}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">{dur}</p>
                  </div>
                </div>
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

      {/* Today's activity timeline */}
      {todayCount > 0 && (
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Today's Activity</p>
          <div className="space-y-1.5">
            {sessions
              .filter(s => new Date(s.started_at) >= todayStart)
              .map(s => {
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
                      {s.duration_seconds && (
                        <p className="text-[10px] text-gray-600">{fmtDuration(s.duration_seconds)}</p>
                      )}
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
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by name..."
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              filter === f.id ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-500'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(s => {
          const st  = TYPE[s.user_type] || TYPE.staff
          const dur = s.duration_seconds
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
                    {isActive && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-gray-800" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white truncate">{s.user_name}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                        {s.user_type}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{s.academy_name || '—'} · {s.device || '—'}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-black text-gray-300">{dur}</p>
                  {isActive
                    ? <p className="text-[10px] text-emerald-500 font-bold mt-0.5">● Active</p>
                    : <p className="text-[10px] text-gray-600 mt-0.5">{timeAgo(s.ended_at || s.last_active_at)}</p>
                  }
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-gray-700 flex items-center justify-between">
                <p className="text-[10px] text-gray-600">Started {fmtDateTime(s.started_at)}</p>
                {s.ended_at && <p className="text-[10px] text-gray-600">Ended {timeAgo(s.ended_at)}</p>}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-center text-gray-600 py-12 text-sm">No sessions found</p>
        )}
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
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or entity..."
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {AUDIT_CATS.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              cat === c.id ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-500'
            }`}>
            {c.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">{filtered.length} entries</p>

      <div className="space-y-2">
        {filtered.slice(0, 300).map(l => {
          const et = ENTITY_TAG[l.entity_type] || ENTITY_TAG.auth
          const isAuth = l.action?.startsWith('auth')
          return (
            <div key={l.id} className="bg-gray-800 rounded-2xl px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-white">{l.actor_name}</p>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400 uppercase tracking-wide`}>
                      {l.actor_role}
                    </span>
                    {isAuth && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">auth</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{ACTION_LABELS[l.action] || l.action}</p>
                  {l.entity_name && (
                    <p className="text-[11px] text-gray-600 mt-0.5 truncate">↳ {l.entity_name}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-gray-600">{timeAgo(l.created_at)}</p>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block ${et.bg} ${et.text}`}>
                    {l.entity_type}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-center text-gray-600 py-12 text-sm">No entries found</p>
        )}
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
      userMap[key] = {
        userName:    s.user_name,
        userType:    s.user_type,
        academyName: s.academy_name,
        loginCount:  0,
        totalSec:    0,
        lastSeen:    s.last_active_at,
        devices:     new Set(),
      }
    }
    userMap[key].loginCount++
    userMap[key].totalSec += s.duration_seconds || 0
    if (s.last_active_at > userMap[key].lastSeen) userMap[key].lastSeen = s.last_active_at
    if (s.device) userMap[key].devices.add(s.device)
  })

  const users = Object.values(userMap).sort((a, b) =>
    new Date(b.lastSeen) - new Date(a.lastSeen)
  )

  const totalSec   = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
  const withDur    = sessions.filter(s => s.duration_seconds).length
  const avgSec     = withDur > 0 ? Math.round(totalSec / withDur) : 0

  return (
    <div className="px-4 pt-4 pb-10 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-white">{users.length}</p>
          <p className="text-[10px] text-gray-500 mt-1">Unique Users</p>
        </div>
        <div className="bg-gray-800 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-white">{sessions.length}</p>
          <p className="text-[10px] text-gray-500 mt-1">Sessions</p>
        </div>
        <div className="bg-gray-800 rounded-2xl p-3 text-center">
          <p className="text-2xl font-black text-white">{fmtDuration(avgSec)}</p>
          <p className="text-[10px] text-gray-500 mt-1">Avg Session</p>
        </div>
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
                    {isOnline && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-800" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white truncate">{u.userName}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                        {u.userType}
                      </span>
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
                {u.devices.size > 0 && (
                  <p className="text-[10px] text-gray-600">{[...u.devices].join(' · ')}</p>
                )}
              </div>
            </div>
          )
        })}
        {users.length === 0 && (
          <p className="text-center text-gray-600 py-12 text-sm">No session data yet — run migration 0009 first</p>
        )}
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────

const TABS = [
  { id: 'live',     label: 'Live',     Icon: Wifi         },
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

  // Auto-refresh on Live tab
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
              {lastUpdated && (
                <p className="text-[9px] text-gray-600 leading-tight">Updated {timeAgo(lastUpdated)}</p>
              )}
            </div>
          </div>
          <button onClick={load}
            className="p-2 rounded-xl bg-gray-800 text-gray-500 active:bg-gray-700 transition">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex bg-gray-800 rounded-t-xl p-1 gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-bold transition ${
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
            {tab === 'live'     && <LiveTab     sessions={sessions} />}
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
