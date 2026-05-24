import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Search, CheckCircle, Clock, X, Save, ClipboardList, ChevronDown, ChevronUp, Target, Sparkles, FileText } from 'lucide-react'
import * as db from '../../lib/db'
import { logAudit, ACTIONS } from '../../lib/audit'
import DevFillButton from '../../components/DevFillButton'
import { fillAssessment } from '../../lib/devFill'
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
            Assess
          </button>
          <button
            onClick={() => setTab('goals')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${tab === 'goals' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Goals
          </button>
          <button
            onClick={() => setTab('view')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${tab === 'view' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            View
          </button>
        </div>
      </div>
      {tab === 'assess' && <AssessTab user={user} batches={batches} students={students} />}
      {tab === 'goals'  && <GoalsTab  user={user} batches={batches} students={students} />}
      {tab === 'view'   && <ViewTab   students={students} user={user} />}
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
  const [query, setQuery]         = useState('')

  const myBatches = batches.filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches
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
  const visibleStudents = query.trim().length >= 1
    ? batchStudents.filter(s => s.name.toLowerCase().includes(query.toLowerCase().trim()))
    : batchStudents

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

          {/* Search */}
          {batchStudents.length > 5 && (
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search player..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
          )}

          <div className="space-y-2.5">
            {query.trim().length >= 1 && visibleStudents.length === 0 && (
              <p className="text-center text-gray-400 py-6 text-sm">No player found for "{query}"</p>
            )}
            {visibleStudents.map(s => {
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

// ── Position Picker ───────────────────────────────────────
function PositionPicker({ position, setPosition }) {
  const [open, setOpen] = useState(false)
  const preset = FOOTBALL_POSITIONS.find(p => p.id === position)
  const col    = preset ? POSITION_COLORS[preset.id] : null

  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Position</p>
      {/* Collapsed trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        {position ? (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-black border ${col ? `${col.bg} ${col.text} border-current` : 'bg-gray-100 text-gray-700 border-gray-200'}`}>
            {position}
            {preset && <span className="font-normal opacity-60 text-xs">· {preset.label}</span>}
          </span>
        ) : (
          <span className="px-3 py-1.5 rounded-xl text-sm text-gray-400 border border-dashed border-gray-300 bg-gray-50">
            Select position…
          </span>
        )}
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded chip grid */}
      {open && (
        <div className="mt-2 p-3 bg-gray-50 rounded-2xl border border-gray-100">
          <div className="flex flex-wrap gap-1.5">
            {FOOTBALL_POSITIONS.map(p => {
              const c      = POSITION_COLORS[p.id]
              const active = position === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPosition(active ? '' : p.id); setOpen(false) }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black border transition ${
                    active ? `${c.bg} ${c.text} border-current` : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {p.id} <span className="font-normal opacity-60">· {p.label}</span>
                </button>
              )
            })}
          </div>
        </div>
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
  const [categoryNotes, setCategoryNotes] = useState(() => existing?.category_notes || {})
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
        categoryNotes,
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
              <DevFillButton onFill={() => {
                const d = fillAssessment({ categories })
                setScores(d.scores)
                setNotes(d.notes)
                if (!student.position) setPosition(d.position)
              }} />
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
          <PositionPicker position={position} setPosition={setPosition} />
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
              <button
                onClick={() => window.open(`/report/student/${student.id}`, '_blank')}
                className="w-full flex items-center justify-center gap-2 border border-indigo-200 text-indigo-700 bg-indigo-50 rounded-2xl py-3 font-bold text-sm">
                <FileText size={14} /> View / Download Assessment PDF
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

                      {/* Per-category comment — shown on the assessment PDF */}
                      <div className="pt-2 border-t border-gray-200">
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">
                          {cat.short} — comment for report
                        </label>
                        <textarea
                          value={categoryNotes[cat.id] || ''}
                          onChange={e => setCategoryNotes(prev => ({ ...prev, [cat.id]: e.target.value }))}
                          rows={2}
                          placeholder={`What does the player need to improve in ${cat.short.toLowerCase()}?`}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-800 resize-none focus:outline-none focus:border-brand-500 bg-white"
                        />
                      </div>
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
              className="w-full bg-brand-600 text-white rounded-2xl py-4 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Assessment'}
            </button>
            <button
              onClick={() => window.open(`/report/student/${student.id}`, '_blank')}
              className="w-full flex items-center justify-center gap-2 text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-2xl py-3 font-bold text-sm mb-4"
            >
              <FileText size={14} /> View Assessment PDF
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── View Tab (search + stats) ─────────────────────────────

function ViewTab({ students, user }) {
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
      const data = await db.fetchStudentAssessmentsForCoach(student.id, user?.academyId)
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

// ── Goals Tab ─────────────────────────────────────────────
//
// Coach sets one focus goal per student per month. Goal shows on the
// student's portal all month and orients their training.

const GOAL_PRESETS = [
  'Improve weak foot',
  'Better positioning',
  'First touch under pressure',
  'Pass accuracy',
  'Defensive awareness',
  'Communication on field',
  'Fitness & stamina',
  'Decision making',
  'Shooting power',
  'Aerial duels',
]

function GoalsTab({ user, batches, students }) {
  const [month, setMonth]     = useState(MONTH_OPTS[0].value)
  const [batchId, setBatchId] = useState('')
  const [goals, setGoals]     = useState({})       // { studentId: goal_text }
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)     // { student, currentText }

  const myBatches = batches.filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const displayBatches = myBatches
  const selectedBatch  = displayBatches.find(b => String(b.id) === batchId)
  const batchStudents  = selectedBatch
    ? students.filter(s => s.status === 'Active' && (s.batchId == selectedBatch.id || s.batch === selectedBatch.name))
    : []

  useEffect(() => {
    if (!batchId || batchStudents.length === 0) { setGoals({}); return }
    setLoading(true)
    db.fetchBatchGoals(batchStudents.map(s => s.id), month)
      .then(rows => {
        const map = {}
        rows.forEach(g => { map[g.student_id] = g.goal_text })
        setGoals(map)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [batchId, month])

  async function saveGoal(student, text) {
    try {
      await db.upsertPlayerGoal({
        studentId: student.id,
        month,
        goalText:  text,
        academyId: user?.academyId,
        staffId:   user?.id,
      })
      setGoals(prev => {
        const next = { ...prev }
        if ((text || '').trim()) next[student.id] = text.trim()
        else delete next[student.id]
        return next
      })
      setEditing(null)
    } catch (e) {
      alert(`Save failed: ${e.message}`)
    }
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1.5">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:border-brand-500">
            {MONTH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1.5">Batch</label>
          <select value={batchId} onChange={e => setBatchId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold bg-white focus:outline-none focus:border-brand-500">
            <option value="">Select batch</option>
            {displayBatches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      {!batchId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-white rounded-2xl border border-gray-100 flex items-center justify-center mb-4 shadow-sm">
            <Target size={28} className="text-gray-300" />
          </div>
          <p className="text-sm font-bold text-gray-500">Pick a batch to set monthly goals</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">Each player sees their focus on the student app all month.</p>
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
            <span className="text-xs font-bold text-emerald-600">{Object.keys(goals).length} set</span>
          </div>

          <div className="space-y-2.5">
            {batchStudents.map(s => {
              const g = goals[s.id]
              return (
                <button
                  key={s.id}
                  onClick={() => setEditing({ student: s, currentText: g || '' })}
                  className="w-full bg-white rounded-2xl border border-gray-100 px-4 py-3.5 flex items-start justify-between active:bg-gray-50 shadow-sm text-left"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0 ${
                      g ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {s.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 truncate">{s.name}</p>
                      {g ? (
                        <p className="text-xs text-amber-700 mt-1 line-clamp-2 leading-snug">
                          <Target size={11} className="inline -mt-0.5 mr-1" />{g}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1 italic">No goal set</p>
                      )}
                    </div>
                  </div>
                  <ChevronDown size={14} className="text-gray-300 mt-1" />
                </button>
              )
            })}
            {batchStudents.length === 0 && (
              <p className="text-center text-gray-400 py-10 text-sm">No active students in this batch</p>
            )}
          </div>
        </>
      )}

      {editing && (
        <GoalEditor
          student={editing.student}
          currentText={editing.currentText}
          month={month}
          onClose={() => setEditing(null)}
          onSave={(text) => saveGoal(editing.student, text)}
        />
      )}
    </div>
  )
}

function GoalEditor({ student, currentText, month, onClose, onSave }) {
  const [text, setText]   = useState(currentText)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(text)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end">
      <div className="bg-white rounded-t-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex-shrink-0 px-5 pt-5 pb-3 border-b border-gray-100 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{monthLabel(month)} Focus</p>
            <h2 className="text-xl font-black text-gray-900 leading-none">{student.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Quick picks</p>
            <div className="flex flex-wrap gap-1.5">
              {GOAL_PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setText(p)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                    text === p
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Or write your own</p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              maxLength={140}
              placeholder="e.g., Sharpen first touch with weaker foot in pressure drills"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 resize-none focus:outline-none focus:border-amber-400 bg-white"
            />
            <p className="text-[10px] text-gray-400 mt-1 text-right">{text.length}/140</p>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
            <Sparkles size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-snug">
              Student sees this on their portal all month. Keep it actionable — one specific thing to work on.
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 flex gap-2"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          {currentText && (
            <button
              onClick={() => onSave('')}
              disabled={saving}
              className="px-4 py-3 rounded-xl bg-red-50 text-red-600 font-bold text-sm"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="flex-1 bg-amber-500 text-white rounded-xl py-3 font-black text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Goal'}
          </button>
        </div>
      </div>
    </div>
  )
}
