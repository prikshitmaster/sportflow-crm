import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Search, CheckCircle, Clock, X, Save, ClipboardList, ChevronDown, ChevronUp } from 'lucide-react'
import * as db from '../../lib/db'
import { logAudit, ACTIONS } from '../../lib/audit'
import {
  SPORT_CATEGORIES, FOOTBALL_CATEGORIES,
  getCategoryAvg, getOverallScore, getTier,
  buildMonthOpts, monthLabel, currentMonth,
  FOOTBALL_POSITIONS, POSITION_COLORS,
} from '../../lib/performance'

const MONTH_OPTS = buildMonthOpts()

export default function StaffAssess() {
  const { user, batches, students } = useApp()
  const [tab, setTab] = useState('assess')

  return (
    <div className="pb-4 min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="text-lg font-black text-gray-900 mb-3">Player Performance</h1>
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab('assess')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${tab === 'assess' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Assess Players
          </button>
          <button
            onClick={() => setTab('view')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${tab === 'view' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            View Stats
          </button>
        </div>
      </div>
      {tab === 'assess' ? <AssessTab user={user} batches={batches} students={students} /> : <ViewTab students={students} />}
    </div>
  )
}

// ── Assess Tab ────────────────────────────────────────────

function AssessTab({ user, batches, students }) {
  const [month, setMonth]         = useState(MONTH_OPTS[0].value)
  const [batchId, setBatchId]     = useState('')
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading]     = useState(false)
  const [assessing, setAssessing] = useState(null)

  const myBatches = batches.filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches.length > 0 ? myBatches : batches
  const selectedBatch  = displayBatches.find(b => String(b.id) === batchId)

  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    db.fetchAssessmentsByBatch(batchId, month)
      .then(setAssessments)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [batchId, month])

  const sport      = selectedBatch?.sports?.[0] || 'Football'
  const categories = SPORT_CATEGORIES[sport] || FOOTBALL_CATEGORIES
  const batchStudents = selectedBatch
    ? students.filter(s => s.status === 'Active' && (s.batchId == selectedBatch.id || s.batch === selectedBatch.name))
    : []
  const assessedMap = Object.fromEntries(assessments.map(a => [a.student_id, a]))

  return (
    <div className="px-4 pt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1.5">Month</label>
          <select
            value={month} onChange={e => setMonth(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:border-brand-500"
          >
            {MONTH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1.5">Batch</label>
          <select
            value={batchId} onChange={e => setBatchId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:border-brand-500"
          >
            <option value="">Select batch</option>
            {displayBatches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {!batchId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-white rounded-2xl border border-gray-100 flex items-center justify-center mb-4 shadow-sm">
            <ClipboardList size={28} className="text-gray-300" />
          </div>
          <p className="text-sm font-bold text-gray-500">Select a batch to begin</p>
        </div>
      )}

      {batchId && loading && (
        <div className="flex justify-center py-12">
          <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      )}

      {batchId && !loading && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{batchStudents.length} students</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-emerald-600">{Object.keys(assessedMap).length} done</span>
              <span className="text-xs text-gray-300">/</span>
              <span className="text-xs text-gray-500">{batchStudents.length}</span>
            </div>
          </div>

          {/* Progress bar */}
          {batchStudents.length > 0 && (
            <div className="w-full h-1.5 bg-gray-100 rounded-full">
              <div
                className="h-1.5 bg-emerald-500 rounded-full transition-all"
                style={{ width: `${Math.round((Object.keys(assessedMap).length / batchStudents.length) * 100)}%` }}
              />
            </div>
          )}

          <div className="space-y-2.5">
            {batchStudents.map(s => {
              const a     = assessedMap[s.id]
              const score = a ? getOverallScore(a.scores, categories) : null
              const tier  = score !== null ? getTier(score) : null
              return (
                <button
                  key={s.id}
                  onClick={() => setAssessing({ student: s, existing: a, sport, categories })}
                  className="w-full bg-white rounded-2xl border border-gray-100 px-4 py-3.5 flex items-center justify-between active:bg-gray-50 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${
                      a ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {s.name[0]}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.batch || sport}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a ? (
                      <>
                        <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${tier.bgClass} ${tier.textClass} ${tier.borderClass}`}>
                          {score} · {tier.label}
                        </span>
                        <CheckCircle size={16} className="text-emerald-500" />
                      </>
                    ) : (
                      <Clock size={16} className="text-gray-300" />
                    )}
                  </div>
                </button>
              )
            })}
            {batchStudents.length === 0 && (
              <p className="text-center text-gray-400 py-10 text-sm">No active students in this batch</p>
            )}
          </div>
        </>
      )}

      {assessing && (
        <AssessmentModal
          {...assessing}
          month={month}
          batchId={batchId}
          user={user}
          onClose={() => setAssessing(null)}
          onSaved={updated => {
            setAssessments(prev => {
              const idx = prev.findIndex(a => a.student_id === updated.student_id)
              if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n }
              return [...prev, updated]
            })
            setAssessing(null)
          }}
        />
      )}
    </div>
  )
}

// ── Assessment Modal ──────────────────────────────────────

function AssessmentModal({ student, existing, sport, categories, month, batchId, user, onClose, onSaved }) {
  const [mode, setMode] = useState(existing ? 'prompt' : 'form')
  const [scores, setScores] = useState(() => {
    if (existing?.scores) return { ...existing.scores }
    const init = {}
    categories.forEach(cat => cat.skills.forEach(sk => { init[sk] = 50 }))
    return init
  })
  const [notes, setNotes]       = useState(existing?.notes || '')
  const [position, setPosition] = useState(student.position || '')
  const [saving, setSaving]     = useState(false)
  const [openCat, setOpenCat]   = useState(categories[0]?.id || null)

  function startUpdate() {
    setScores(existing?.scores ? { ...existing.scores } : {})
    setMode('form')
    setOpenCat(categories[0]?.id || null)
  }

  function startOverwrite() {
    const init = {}
    categories.forEach(cat => cat.skills.forEach(sk => { init[sk] = 50 }))
    setScores(init)
    setNotes('')
    setMode('form')
    setOpenCat(categories[0]?.id || null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const result = await db.upsertAssessment({
        studentId: student.id,
        staffId:   user?.id,
        batchId,
        sport,
        month,
        scores,
        notes,
        academyId: user?.academyId,
      })
      if (position !== (student.position || '')) {
        await db.updateStudentPosition(student.id, position || null)
      }
      const isUpdate = !!existing
      logAudit({
        actor:      user,
        action:     isUpdate ? ACTIONS.ASSESSMENT_UPDATE : ACTIONS.ASSESSMENT_ADD,
        entityType: 'assessment',
        entityId:   student.id,
        entityName: student.name,
        changes:    { month, position: position || '—', batch: student.batch || '—', note: notes || '—' },
        academyId:  user?.academyId,
      })
      onSaved(result || { student_id: student.id, scores, notes, assessed_month: month, batch_id: batchId, position })
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const overall = getOverallScore(scores, categories)
  const tier    = overall > 0 ? getTier(overall) : null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl flex flex-col" style={{ maxHeight: '93vh' }}>

        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{sport} · {monthLabel(month)}</p>
              <h2 className="text-xl font-black text-gray-900 leading-none">{student.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              {tier && overall > 0 && (
                <span className={`text-sm font-black px-3 py-1 rounded-full border ${tier.bgClass} ${tier.textClass} ${tier.borderClass}`}>
                  {overall} · {tier.label}
                </span>
              )}
              <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Position picker */}
          <div className="mt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Position</p>
            <div className="flex flex-wrap gap-1.5">
              {FOOTBALL_POSITIONS.map(p => {
                const col = POSITION_COLORS[p.id]
                const active = position === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPosition(active ? '' : p.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-black border transition ${
                      active
                        ? `${col.bg} ${col.text} border-current`
                        : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {p.id} <span className="font-normal opacity-70 hidden sm:inline">· {p.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Prompt */}
        {mode === 'prompt' && (
          <div className="px-5 py-10 text-center space-y-5">
            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto">
              <ClipboardList size={28} className="text-amber-600" />
            </div>
            <div>
              <p className="font-black text-gray-900 text-lg">Assessment exists</p>
              <p className="text-sm text-gray-500 mt-2">
                {student.name} already has an assessment for {monthLabel(month)}.
              </p>
            </div>
            <div className="space-y-2.5">
              <button onClick={startUpdate}
                className="w-full bg-brand-600 text-white rounded-2xl py-3.5 font-bold text-sm">
                Update — keep existing, edit scores
              </button>
              <button onClick={startOverwrite}
                className="w-full border border-gray-200 text-gray-700 rounded-2xl py-3.5 font-bold text-sm">
                Overwrite — start fresh from 50
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        {mode === 'form' && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {categories.map(cat => {
              const avg   = getCategoryAvg(scores, cat.skills)
              const isOpen = openCat === cat.id
              return (
                <div key={cat.id} className="bg-gray-50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpenCat(isOpen ? null : cat.id)}
                    className="w-full flex items-center justify-between px-4 py-3.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm font-black text-gray-900">{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black px-2.5 py-0.5 rounded-full text-white text-xs" style={{ backgroundColor: cat.color }}>
                        {avg > 0 ? avg : '—'}
                      </span>
                      {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-5 border-t border-gray-100 pt-4">
                      {cat.skills.map(skill => {
                        const val = scores[skill] ?? 50
                        return (
                          <div key={skill}>
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-xs font-semibold text-gray-700">{skill}</label>
                              <span className="text-base font-black text-gray-900 tabular-nums w-10 text-right">{val}</span>
                            </div>
                            <div className="relative">
                              <div className="w-full h-2 bg-gray-200 rounded-full absolute top-1/2 -translate-y-1/2 pointer-events-none">
                                <div className="h-2 rounded-full" style={{ width: `${val}%`, backgroundColor: cat.color }} />
                              </div>
                              <input
                                type="range" min="0" max="100" value={val}
                                onChange={e => setScores(prev => ({ ...prev, [skill]: parseInt(e.target.value) }))}
                                className="relative w-full h-5 cursor-pointer appearance-none bg-transparent z-10"
                                style={{ accentColor: cat.color }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] text-gray-300 font-semibold mt-0.5">
                              <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Coach Notes (optional)</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                rows={3} placeholder="Observations about this player..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 resize-none focus:outline-none focus:border-brand-500 bg-white"
              />
            </div>

            <button
              onClick={handleSave} disabled={saving}
              className="w-full bg-brand-600 text-white rounded-2xl py-4 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 mb-4"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Assessment'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── View Tab (search + stats) ─────────────────────────────

function ViewTab({ students }) {
  const [query, setQuery]           = useState('')
  const [playerData, setPlayerData] = useState({})
  const [loadingId, setLoadingId]   = useState(null)
  const [expanded, setExpanded]     = useState(null)

  const activeStudents = students.filter(s => s.status === 'Active')
  const filtered = query.trim().length >= 2
    ? students.filter(s => s.name.toLowerCase().includes(query.toLowerCase().trim()))
    : activeStudents.slice(0, 20)

  async function loadPlayer(student) {
    if (expanded === student.id) { setExpanded(null); return }
    if (playerData[student.id]) { setExpanded(student.id); return }
    setLoadingId(student.id)
    try {
      const data = await db.fetchStudentAssessments(student.id)
      setPlayerData(prev => ({ ...prev, [student.id]: data }))
      setExpanded(student.id)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search player name..."
          className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-brand-500"
        />
      </div>

      {query.length === 0 && (
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Recent students · tap to see stats</p>
      )}

      <div className="space-y-2">
        {filtered.map(s => {
          const assessments = playerData[s.id]
          const latest      = assessments?.[0]
          const sport       = s.sport || 'Football'
          const categories  = SPORT_CATEGORIES[sport] || FOOTBALL_CATEGORIES
          const score       = latest ? getOverallScore(latest.scores, categories) : null
          const tier        = score !== null ? getTier(score) : null
          const isOpen      = expanded === s.id

          return (
            <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={() => loadPlayer(s)} className="w-full px-4 py-3.5 flex items-center justify-between active:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-sm font-black text-brand-700">
                    {s.name[0]}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.batch || sport}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {loadingId === s.id ? (
                    <svg className="animate-spin h-4 w-4 text-brand-600" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : score !== null ? (
                    <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${tier.bgClass} ${tier.textClass} ${tier.borderClass}`}>
                      {score} · {tier.label}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300 font-semibold">No data</span>
                  )}
                  {isOpen ? <ChevronUp size={14} className="text-gray-300" /> : <ChevronDown size={14} className="text-gray-300" />}
                </div>
              </button>

              {isOpen && latest && (
                <div className="px-4 pb-4 pt-3 border-t border-gray-50 space-y-3">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Latest: {monthLabel(latest.assessed_month)}</p>
                  {categories.map(cat => {
                    const avg = getCategoryAvg(latest.scores, cat.skills)
                    return (
                      <div key={cat.id} className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-gray-600 w-20 shrink-0">{cat.short}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full">
                          <div className="h-2 rounded-full" style={{ width: `${avg}%`, backgroundColor: cat.color }} />
                        </div>
                        <span className="text-xs font-black text-gray-900 w-7 text-right">{avg}</span>
                      </div>
                    )
                  })}
                  {latest.notes && (
                    <p className="text-xs text-gray-400 italic border-t border-gray-100 pt-2">"{latest.notes}"</p>
                  )}
                  {assessments.length > 1 && (
                    <p className="text-[10px] text-gray-400">{assessments.length} assessments on record</p>
                  )}
                </div>
              )}

              {isOpen && assessments && !latest && (
                <div className="px-4 pb-4 pt-2 border-t border-gray-50">
                  <p className="text-xs text-gray-400">No assessments yet for this player.</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
