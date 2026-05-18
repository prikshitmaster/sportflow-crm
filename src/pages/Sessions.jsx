// Owner Sessions — monthly calendar view of all session plans across batches
import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { fetchSessionPlans, fetchSessionPlan, deleteSessionPlan } from '../lib/db'
import { exportSessionPDF } from '../lib/sessionPDF'
import {
  ChevronLeft, ChevronRight, CalendarDays, Clock, Users,
  Trophy, BookOpen, Trash2, X, CheckCircle2, FileDown, Zap,
} from 'lucide-react'

// Stable set of colours assigned to batches by index
const BATCH_COLORS = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
]
function batchColor(index) { return BATCH_COLORS[index % BATCH_COLORS.length] }

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function phaseCount(plan) {
  const phases = plan.session_phases || []
  return `${phases.length} phase${phases.length !== 1 ? 's' : ''}`
}

function totalDuration(plan) {
  const phases = plan.session_phases || []
  return phases.reduce((s, p) => s + (p.duration || 0), 0)
}

function coachName(plan, staff) {
  if (!plan?.coach_id) return null
  const member = (staff || []).find(s => String(s.id) === String(plan.coach_id))
  return member?.name || null
}

// ── Session Detail Slide-in ───────────────────────────────────────────────────
function SessionDetail({ planId, batches, batchColorMap, staff, onClose, onDeleted }) {
  const [plan, setPlan]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchSessionPlan(planId)
      .then(setPlan)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [planId])

  const batch = plan ? batches.find(b => b.id === plan.batch_id) : null
  const color = batch ? batchColorMap[batch.id] : '#3B82F6'

  const handleDelete = async () => {
    if (!confirm('Delete this session plan?')) return
    setDeleting(true)
    try { await deleteSessionPlan(planId); onDeleted() }
    catch { setDeleting(false) }
  }

  const handleExportPDF = () => {
    if (!plan) return
    exportSessionPDF({
      plan,
      phases: plan.session_phases || [],
      batchName: batch?.name || '—',
      academyName: plan.academy_id ? undefined : '—',
    })
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end md:items-center justify-center"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-3 animate-pulse">
            {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-xl" />)}
          </div>
        ) : !plan ? (
          <div className="p-6 text-center text-sm text-gray-400">Session not found</div>
        ) : (
          <>
            {/* Header strip */}
            <div className="h-2 rounded-t-2xl" style={{ background: color }} />
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-gray-900">{batch?.name || '—'}</p>
                <p className="text-sm text-gray-500 mt-0.5">{fmt(plan.date)}</p>
                {coachName(plan, staff) && (
                  <p className="text-xs text-gray-500 mt-0.5">Coach: <span className="font-medium text-gray-700">{coachName(plan, staff)}</span></p>
                )}
                {plan.topic && <p className="text-sm font-medium text-gray-700 mt-1">{plan.topic}</p>}
              </div>
              <div className="flex items-center gap-2">
                {plan.status === 'draft' && (
                  <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">Created</span>
                )}
                {plan.status === 'active' && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">
                    <Zap size={11} /> Active
                  </span>
                )}
                {plan.status === 'completed' && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                    <Trophy size={11} /> Completed
                  </span>
                )}
                <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex gap-4 px-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-1.5 text-sm text-gray-600">
                <Clock size={14} className="text-gray-400" />
                {totalDuration(plan)}min
              </div>
              <div className="flex items-center gap-1.5 text-sm text-gray-600">
                <BookOpen size={14} className="text-gray-400" />
                {phaseCount(plan)}
              </div>
              {plan.num_players && (
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Users size={14} className="text-gray-400" />
                  {plan.num_players} players
                </div>
              )}
            </div>

            {/* Phases */}
            {(plan.session_phases || []).length > 0 && (
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Phases</p>
                {plan.session_phases.map((phase, i) => (
                  <div key={phase.id} className="flex items-start gap-3">
                    <span className="text-xs font-bold text-gray-400 w-5 mt-0.5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-600 capitalize">
                          {phase.phase_name?.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-gray-400">· {phase.duration}m</span>
                      </div>
                      {phase.drills && (
                        <p className="text-sm font-medium text-gray-800 mt-0.5">{phase.drills.name}</p>
                      )}
                      {phase.area && (
                        <p className="text-xs text-gray-500 mt-0.5">Area: {phase.area}</p>
                      )}
                      {(phase.coaching_points || []).length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {phase.coaching_points.slice(0, 2).map((cp, j) => (
                            <li key={j} className="text-xs text-gray-500 flex gap-1">
                              <span className="text-brand-500">•</span>{cp}
                            </li>
                          ))}
                          {phase.coaching_points.length > 2 && (
                            <li className="text-xs text-gray-400">+{phase.coaching_points.length - 2} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="px-5 pb-5 pt-2 flex items-center justify-between">
              {plan.status === 'completed' && plan.completed_at && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 size={12} />
                  Done {new Date(plan.completed_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
                </span>
              )}
              <button onClick={handleExportPDF}
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-xl hover:bg-brand-50 transition font-semibold">
                <FileDown size={13} /> Export PDF
              </button>
              <div className="flex-1" />
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-xl hover:bg-red-50 transition disabled:opacity-50">
                <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Calendar ──────────────────────────────────────────────────────────────────
export default function Sessions() {
  const { user, batches: ctxBatches, staff } = useApp()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [today]                 = useState(new Date())
  const [cursor, setCursor]     = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selectedDay, setSelectedDay] = useState(null)  // 'YYYY-MM-DD'
  const [detailId, setDetailId]       = useState(null)

  const academyId = user?.academyId
  // Use AppContext batches — already filtered by selectedSport + selectedBranch
  const batches = ctxBatches || []

  const load = () => {
    if (!academyId) return
    setLoading(true)
    fetchSessionPlans({ academyId })
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [academyId])

  // Batch → stable colour mapping
  const batchColorMap = useMemo(() => {
    const map = {}
    batches.forEach((b, i) => { map[b.id] = batchColor(i) })
    return map
  }, [batches])

  // Sessions grouped by date string — only for batches in current sport/branch scope
  const visibleBatchIds = useMemo(() => new Set(batches.map(b => b.id)), [batches])
  const visibleSessions = useMemo(() =>
    sessions.filter(s => !s.batch_id || visibleBatchIds.has(s.batch_id))
  , [sessions, visibleBatchIds])

  const byDate = useMemo(() => {
    const map = {}
    visibleSessions.forEach(s => {
      if (!map[s.date]) map[s.date] = []
      map[s.date].push(s)
    })
    return map
  }, [sessions])

  // Calendar grid for current month
  const calDays = useMemo(() => {
    const { year, month } = cursor
    const first = new Date(year, month, 1)
    // Monday start: 0=Mon … 6=Sun
    const startDow = (first.getDay() + 6) % 7
    const days = []
    for (let i = 0; i < startDow; i++) days.push(null)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      days.push(iso)
    }
    return days
  }, [cursor])

  const monthLabel = useMemo(() => {
    return new Date(cursor.year, cursor.month, 1)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }, [cursor])

  const prevMonth = () => setCursor(c => {
    const m = c.month === 0 ? 11 : c.month - 1
    const y = c.month === 0 ? c.year - 1 : c.year
    return { year: y, month: m }
  })
  const nextMonth = () => setCursor(c => {
    const m = c.month === 11 ? 0 : c.month + 1
    const y = c.month === 11 ? c.year + 1 : c.year
    return { year: y, month: m }
  })

  const todayStr = today.toISOString().split('T')[0]

  const dayPlans = selectedDay ? (byDate[selectedDay] || []) : []

  return (
    <div className="max-w-5xl mx-auto px-4 pb-10">
      {/* Page header */}
      <div className="pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Training plans across all batches</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> Completed
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500" /> Planned
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMonth} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <ChevronLeft size={18} />
              </button>
              <h2 className="font-bold text-gray-900">{monthLabel}</h2>
              <button onClick={nextMonth} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-gray-400">{d}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {loading
                ? Array.from({ length: 35 }).map((_, i) => (
                    <div key={i} className="aspect-square p-1.5">
                      <div className="h-full bg-gray-50 rounded-xl animate-pulse" />
                    </div>
                  ))
                : calDays.map((iso, i) => {
                  if (!iso) return <div key={`empty-${i}`} className="aspect-square" />
                  const plans = byDate[iso] || []
                  const isToday   = iso === todayStr
                  const isSelected = iso === selectedDay
                  return (
                    <button key={iso} onClick={() => setSelectedDay(iso === selectedDay ? null : iso)}
                      className={`aspect-square p-1 flex flex-col items-center gap-0.5 transition hover:bg-gray-50 relative
                        ${isSelected ? 'bg-brand-50 rounded-xl' : ''}
                      `}>
                      <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full
                        ${isToday ? 'bg-brand-600 text-white' : isSelected ? 'text-brand-700' : 'text-gray-700'}`}>
                        {new Date(iso + 'T00:00:00').getDate()}
                      </span>
                      {plans.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
                          {plans.slice(0, 3).map(p => (
                            <span key={p.id}
                              className="w-2 h-2 rounded-full"
                              style={{ background: p.status === 'completed' ? '#10B981' : p.status === 'active' ? '#3B82F6' : (batchColorMap[p.batch_id] || '#9CA3AF') }}
                            />
                          ))}
                          {plans.length > 3 && (
                            <span className="text-[9px] text-gray-400 leading-none">+{plans.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
            </div>
          </div>

          {/* Legend */}
          {batches.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3 px-1">
              {batches.map((b, i) => (
                <div key={b.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: batchColorMap[b.id] }} />
                  {b.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Day panel */}
        <div>
          {selectedDay ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 text-sm">{fmt(selectedDay)}</h3>
                <button onClick={() => setSelectedDay(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
              {dayPlans.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <CalendarDays size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-400">No sessions on this day</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {dayPlans.map(plan => {
                    const b = batches.find(x => x.id === plan.batch_id)
                    const col = batchColorMap[plan.batch_id] || '#3B82F6'
                    return (
                      <button key={plan.id} onClick={() => setDetailId(plan.id)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-start gap-3">
                        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: plan.status === 'completed' ? '#10B981' : plan.status === 'active' ? '#3B82F6' : col }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-900 truncate">{b?.name || '—'}</p>
                          {plan.topic && <p className="text-xs text-gray-500 truncate">{plan.topic}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">
                            {coachName(plan, staff) && <span>{coachName(plan, staff)} · </span>}
                            {(plan.session_phases || []).length} phases
                            {plan.status === 'active' && ' · ⚡ Active'}
                            {plan.status === 'completed' && ' · ✓ Done'}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-gray-300 mt-1 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl px-4 py-10 text-center">
              <CalendarDays size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">Select a day to see sessions</p>
            </div>
          )}

          {/* Month summary */}
          {!loading && (
            <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">This month</p>
              {(() => {
                const { year, month } = cursor
                const prefix = `${year}-${String(month + 1).padStart(2,'0')}`
                const monthPlans = visibleSessions.filter(s => s.date?.startsWith(prefix))
                const done = monthPlans.filter(s => s.status === 'completed').length
                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total sessions</span>
                      <span className="font-bold text-gray-900">{monthPlans.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Completed</span>
                      <span className="font-bold text-emerald-600">{done}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pending</span>
                      <span className="font-bold text-gray-900">{monthPlans.length - done}</span>
                    </div>
                    {batches.map(b => {
                      const cnt = monthPlans.filter(s => s.batch_id === b.id).length
                      if (!cnt) return null
                      return (
                        <div key={b.id} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: batchColorMap[b.id] }} />
                            <span className="text-gray-500 truncate max-w-[120px]">{b.name}</span>
                          </div>
                          <span className="font-semibold text-gray-700">{cnt}</span>
                        </div>
                      )
                    })}
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>

      {detailId && (
        <SessionDetail
          planId={detailId}
          batches={batches}
          batchColorMap={batchColorMap}
          staff={staff}
          onClose={() => setDetailId(null)}
          onDeleted={() => { setDetailId(null); load() }}
        />
      )}
    </div>
  )
}
