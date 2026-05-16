// Staff Dashboard — coach home screen
// Matches the mobile mockup exactly:
//   date + batch context → "X sessions · Y students" → Mark Attendance CTA → Staff & Leave CTA

import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, Users, ChevronRight, QrCode, CreditCard, UserPlus, Layers, BarChart2, Megaphone, Trophy, UserCog, Settings, Search, ClipboardList, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import * as db from '../../lib/db'
import { SPORT_CATEGORIES, FOOTBALL_CATEGORIES, getOverallScore, getTier, currentMonth } from '../../lib/performance'

const WORK_TILES = [
  { perm: 'students.view',     Icon: Users,           label: 'Students',    bg: 'bg-blue-600',    route: '/staff/students'   },
  { perm: 'attendance.manage', Icon: CalendarCheck,   label: 'Attendance',  bg: 'bg-emerald-600', route: '/staff/attendance' },
  { perm: 'payments.view',     Icon: CreditCard,      label: 'Payments',    bg: 'bg-purple-600',  route: '/staff/payments'   },
  { perm: 'trials.manage',     Icon: UserPlus,        label: 'Trials',      bg: 'bg-orange-500',  route: '/staff/trials'     },
  { perm: 'batches.view',      Icon: Layers,          label: 'Batches',     bg: 'bg-teal-600',    route: '/staff/batches'    },
  { perm: 'reports.view',      Icon: BarChart2,       label: 'Reports',     bg: 'bg-rose-600',    route: '/staff/reports'    },
  { perm: 'community.manage',  Icon: Megaphone,       label: 'Community',   bg: 'bg-amber-500',   route: '/staff/community'  },
  { perm: 'events.manage',     Icon: Trophy,          label: 'Events',      bg: 'bg-indigo-600',  route: '/staff/events'     },
  { perm: 'staff.manage',      Icon: UserCog,         label: 'Staff',       bg: 'bg-gray-700',    route: '/staff/coaches'    },
  { perm: 'settings.manage',   Icon: Settings,        label: 'Settings',    bg: 'bg-gray-600',    route: '/staff/settings'   },
]

export default function StaffDashboard() {
  const { user, batches, students, attendanceData, leaveRequests, loadLeaveRequests, dataLoading, announcements, hasPermission } = useApp()
  const navigate = useNavigate()

  const [gateQRToken,   setGateQRToken]   = useState(null)
  const [gateQROpen,    setGateQROpen]    = useState(false)
  const [gateQRLoading, setGateQRLoading] = useState(false)

  const openGateQR = async () => {
    setGateQROpen(true)
    if (gateQRToken) return
    setGateQRLoading(true)
    try {
      const qr = await db.getOrCreateGateQR(user?.academy || 'Academy Gate')
      setGateQRToken(qr.token)
    } finally {
      setGateQRLoading(false)
    }
  }

  const isCoach = !user?.accessRole || ['coach', 'staff'].includes(user?.accessRole)

  useEffect(() => { if (!leaveRequests.length) loadLeaveRequests() }, [])

  const today    = new Date().toISOString().split('T')[0]
  const todayAtt = attendanceData[today] || {}
  const dayName  = new Date().toLocaleDateString('en-IN', { weekday: 'long' })
  const dateStr  = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

  const myBatches = batches.filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches.length > 0 ? myBatches : batches

  const myStudentIds = new Set(
    students
      .filter(s => s.status === 'Active' && displayBatches.some(b => b.id === s.batchId || b.name === s.batch))
      .map(s => s.id)
  )
  const totalStudents = myStudentIds.size

  const todayShort = new Date().toLocaleDateString('en-IN', { weekday: 'short' })
  const batchTrainsToday = (b) =>
    !b.days || b.days.length === 0 ||
    b.days.some(d => d.toLowerCase().startsWith(todayShort.toLowerCase().slice(0, 2)))
  const todayBatches = displayBatches.filter(batchTrainsToday)
  // All batches with today's first, non-training-today batches greyed
  const sortedBatches = [...displayBatches].sort((a, b) =>
    (batchTrainsToday(b) ? 1 : 0) - (batchTrainsToday(a) ? 1 : 0)
  )

  const presentCount  = [...myStudentIds].filter(id => todayAtt[id] === 'Present').length
  const pendingLeaves = leaveRequests.filter(r => r.status === 'Pending').length
  const firstBatch    = todayBatches[0]
  const batchLabel    = firstBatch ? `${firstBatch.startTime || firstBatch.time || 'Morning'} batch` : dateStr

  // Tiles the current user can see — always permission-based regardless of role
  const myTiles = WORK_TILES.filter(t => hasPermission(t.perm))

  return (
    <div className="px-4 pt-5 pb-4 space-y-5">

      {/* Greeting */}
      <div>
        <p className="text-xs text-gray-400 font-medium">{dayName} · {batchLabel}</p>
        <h1 className="text-2xl font-black text-gray-900 mt-1">
          {isCoach ? `Coach ${user?.name?.split(' ')[0]}` : `Hello, ${user?.name?.split(' ')[0]}`} 👋
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">{user?.academy} · {user?.accessRole}</p>
      </div>

      {/* Session summary — coaches only */}
      {isCoach && (
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
          <div className="flex items-center gap-2">
            {pendingLeaves > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-bold">
                {pendingLeaves} leave
              </span>
            )}
            <button
              onClick={openGateQR}
              className="p-2 rounded-xl bg-white border border-gray-200 text-gray-500 active:bg-gray-50 transition"
              title="Show Gate QR"
            >
              <QrCode size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Permission-based work tiles — shown for ALL staff */}
      {myTiles.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Work</p>
          <div className="grid grid-cols-2 gap-3">
            {myTiles.map(({ perm, Icon, label, bg, route }) => (
              <button key={perm} onClick={() => navigate(route)}
                className={`${bg} text-white rounded-2xl p-4 text-left active:opacity-80 transition`}>
                <Icon size={20} className="mb-2 opacity-80" />
                <p className="font-bold text-sm">{label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* My batch cards — coaches only. Today's first, others greyed. */}
      {isCoach && sortedBatches.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">My Sessions</p>
          <div className="space-y-2">
            {sortedBatches.map(b => {
              const trains   = batchTrainsToday(b)
              const bStu     = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
              const bPresent = bStu.filter(s => todayAtt[s.id] === 'Present').length
              return (
                <button key={b.id} onClick={() => navigate('/staff/attendance')}
                  className={`w-full rounded-2xl p-4 border text-left flex items-center justify-between transition ${
                    trains
                      ? 'bg-white border-gray-100 active:bg-gray-50'
                      : 'bg-gray-50 border-gray-100 opacity-55 active:opacity-70'
                  }`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`font-bold text-sm truncate ${trains ? 'text-gray-900' : 'text-gray-500'}`}>{b.name}</p>
                      {trains
                        ? <span className="text-[9px] font-black px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 leading-none">Today</span>
                        : <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-200 text-gray-500 leading-none">Off</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {b.startTime || b.time || '—'} · {b.sports?.join(', ')}
                      {!trains && b.days?.length > 0 && <> · {b.days.join(', ')}</>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className={`text-sm font-black ${trains ? 'text-gray-900' : 'text-gray-400'}`}>{bPresent}/{bStu.length}</p>
                    <p className="text-[10px] text-gray-400">marked</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent notices — non-coaches */}
      {!isCoach && (announcements || []).length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Recent Notices</p>
            <button onClick={() => navigate('/staff/notices')} className="text-xs text-brand-600 font-semibold">See all</button>
          </div>
          <div className="space-y-2">
            {(announcements || []).slice(0, 2).map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-3.5">
                <p className="text-sm font-bold text-gray-900 truncate">{a.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player Stats — coaches only, deferred until data is loaded */}
      {isCoach && batches.length > 0 && <PlayerStatsSection user={user} batches={batches} students={students} navigate={navigate} />}

      {/* Clock In — always */}
      <button onClick={() => navigate('/staff/scan-in')}
        className="w-full bg-emerald-600 active:bg-emerald-700 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
        <div className="text-left">
          <p className="font-bold text-base flex items-center gap-2"><QrCode size={18} /> Clock In Today</p>
          <p className="text-emerald-200 text-xs mt-0.5">Scan the QR code at the entrance</p>
        </div>
        <ChevronRight size={20} className="text-emerald-300" />
      </button>

      {/* Profile & Leave — always */}
      <button onClick={() => navigate('/staff/me')}
        className="w-full bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center justify-between active:bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
            <Users size={18} className="text-gray-500" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-gray-900">My Profile & Leave</p>
            <p className="text-xs text-gray-400">Apply leave · view schedule</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-300" />
      </button>

      {/* Gate QR fullscreen overlay */}
      {gateQROpen && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-8">
          <button
            onClick={() => setGateQROpen(false)}
            className="absolute top-5 right-5 w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
          >
            <X size={20} className="text-gray-600" />
          </button>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-8">Gate Entry</p>
          {gateQRLoading ? (
            <div className="w-64 h-64 bg-gray-100 rounded-2xl animate-pulse flex items-center justify-center">
              <QrCode size={40} className="text-gray-300" />
            </div>
          ) : gateQRToken ? (
            <div className="p-5 bg-white rounded-2xl border-4 border-gray-900 shadow-xl">
              <QRCodeSVG
                value={gateQRToken}
                size={240}
                bgColor="#ffffff"
                fgColor="#111827"
                level="H"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="w-64 h-64 bg-gray-50 rounded-2xl flex items-center justify-center">
              <p className="text-gray-400 text-sm">QR unavailable</p>
            </div>
          )}
          <p className="text-xl font-black text-gray-900 mt-8">{user?.academy}</p>
          <p className="text-sm text-gray-400 mt-1">Scan to mark attendance</p>
        </div>
      )}

    </div>
  )
}

// ── Player Stats section ──────────────────────────────────

function PlayerStatsSection({ user, batches, students, navigate }) {
  const [query, setQuery]         = useState('')
  const [topPlayers, setTopPlayers] = useState([])
  const [loadingTop, setLoadingTop] = useState(false)
  const [playerData, setPlayerData] = useState({})
  const [loadingId, setLoadingId]   = useState(null)

  const myBatches = batches.filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches.length > 0 ? myBatches : batches
  const myBatchIds     = displayBatches.map(b => b.id)

  useEffect(() => {
    if (!myBatchIds.length) return
    setLoadingTop(true)
    db.fetchAssessmentsByBatches(myBatchIds, currentMonth())
      .then(data => {
        const studentMap = Object.fromEntries(students.map(s => [s.id, s]))
        const ranked = data
          .map(a => {
            const student = studentMap[a.student_id]
            if (!student) return null
            const cats  = SPORT_CATEGORIES[a.sport] || FOOTBALL_CATEGORIES
            const score = getOverallScore(a.scores, cats)
            return { student, score, tier: getTier(score) }
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
        setTopPlayers(ranked)
      })
      .catch(console.error)
      .finally(() => setLoadingTop(false))
  }, [])

  const myStudents   = students.filter(s => s.status === 'Active' && displayBatches.some(b => b.id === s.batchId || b.name === s.batch))
  const searchResults = query.trim().length >= 2
    ? students.filter(s => s.name.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 6)
    : []

  async function loadStats(student) {
    if (playerData[student.id]) return
    setLoadingId(student.id)
    try {
      const data = await db.fetchStudentAssessments(student.id)
      const latest = data?.[0]
      if (latest) {
        const cats  = SPORT_CATEGORIES[latest.sport] || FOOTBALL_CATEGORIES
        const score = getOverallScore(latest.scores, cats)
        setPlayerData(prev => ({ ...prev, [student.id]: { score, tier: getTier(score), month: latest.assessed_month } }))
      } else {
        setPlayerData(prev => ({ ...prev, [student.id]: null }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingId(null)
    }
  }

  useEffect(() => {
    searchResults.forEach(s => { if (playerData[s.id] === undefined) loadStats(s) })
  }, [query])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Player Stats</p>
        <button onClick={() => navigate('/staff/assess')} className="text-xs text-brand-600 font-bold">
          Assess all →
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search any player..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Search results */}
      {query.trim().length >= 2 && (
        <div className="space-y-2 mb-2">
          {searchResults.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">No players found</p>
          )}
          {searchResults.map(s => {
            const pd = playerData[s.id]
            return (
              <button
                key={s.id}
                onClick={() => navigate('/staff/assess')}
                className="w-full bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between active:bg-gray-50 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center text-xs font-black text-brand-700">{s.name[0]}</div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.batch || '—'}</p>
                  </div>
                </div>
                {loadingId === s.id ? (
                  <svg className="animate-spin h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : pd ? (
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${pd.tier.bgClass} ${pd.tier.textClass} ${pd.tier.borderClass}`}>
                    {pd.score} · {pd.tier.label}
                  </span>
                ) : pd === null ? (
                  <span className="text-xs text-gray-300">No data</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {/* Top performers (shown when not searching) */}
      {query.trim().length < 2 && (
        <>
          {loadingTop ? (
            <div className="flex justify-center py-6">
              <svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            </div>
          ) : topPlayers.length > 0 ? (
            <div className="space-y-2">
              {topPlayers.map(({ student, score, tier }, i) => (
                <button
                  key={student.id}
                  onClick={() => navigate('/staff/assess')}
                  className="w-full bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3 active:bg-gray-50 shadow-sm"
                >
                  <span className={`text-sm font-black w-5 ${i === 0 ? 'text-yellow-500' : 'text-gray-300'}`}>#{i+1}</span>
                  <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-xs font-black text-gray-600">{student.name[0]}</div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-bold text-gray-900">{student.name}</p>
                    <p className="text-xs text-gray-400">{student.batch || '—'}</p>
                  </div>
                  <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${tier.bgClass} ${tier.textClass} ${tier.borderClass}`}>
                    {score}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => navigate('/staff/assess')}
              className="w-full bg-white rounded-2xl border border-dashed border-gray-200 px-4 py-5 flex items-center justify-center gap-2 text-gray-400 active:bg-gray-50"
            >
              <ClipboardList size={16} />
              <span className="text-xs font-semibold">No assessments this month — tap to assess</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
