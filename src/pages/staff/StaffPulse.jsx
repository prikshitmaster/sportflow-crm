// Session Pulse — fast tap-through coach feedback after each session.
//
// Flow:
//   Step 1 (batch): pick the batch you just finished
//   Step 2 (rate):  one student per screen — tap 3 metrics (Effort, Execution,
//                   Focus), optionally add a 4-corner Spotlight + note, hit Next
//   Step 3 (done):  summary screen
//
// Each student's pulse is saved on Next so coach can abandon mid-batch
// without losing earlier work. Returning to a batch later reloads existing
// rows and starts from the first unrated player.

import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import StudentAvatar from '../../components/StudentAvatar'
import {
  ArrowLeft, ChevronRight, ChevronLeft, Sparkles, Check, X, Users, Search, CheckCircle2,
} from 'lucide-react'

const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const pad2 = (n) => String(n).padStart(2, '0')

// Three required metrics every player gets — emoji + label keep it instant.
const PULSE_METRICS = [
  { key: 'effort',    label: 'Effort',    options: [
    { v: 1, label: 'Low',   emoji: '😴', color: 'red'     },
    { v: 2, label: 'Med',   emoji: '⚡', color: 'amber'   },
    { v: 3, label: 'High',  emoji: '🔥', color: 'emerald' },
  ]},
  { key: 'execution', label: 'Execution', options: [
    { v: 1, label: 'Below', emoji: '↓',  color: 'red'     },
    { v: 2, label: 'On',    emoji: '→',  color: 'amber'   },
    { v: 3, label: 'Above', emoji: '↑',  color: 'emerald' },
  ]},
  { key: 'focus',     label: 'Focus',     options: [
    { v: 1, label: 'Poor',  emoji: '😕', color: 'red'     },
    { v: 2, label: 'OK',    emoji: '😐', color: 'amber'   },
    { v: 3, label: 'Great', emoji: '😊', color: 'emerald' },
  ]},
]

// 4-corner model used by top European academies (optional spotlight only).
const SPOTLIGHT_METRICS = [
  { key: 'technical', label: 'Technical', color: 'blue'   },
  { key: 'tactical',  label: 'Tactical',  color: 'purple' },
  { key: 'physical',  label: 'Physical',  color: 'orange' },
  { key: 'mental',    label: 'Mental',    color: 'pink'   },
]

const COLOR_CLASS = {
  red:     'bg-red-500 text-white border-red-500',
  amber:   'bg-amber-400 text-gray-900 border-amber-400',
  emerald: 'bg-emerald-500 text-white border-emerald-500',
  blue:    'bg-blue-500 text-white border-blue-500',
  purple:  'bg-purple-500 text-white border-purple-500',
  orange:  'bg-orange-500 text-white border-orange-500',
  pink:    'bg-pink-500 text-white border-pink-500',
}

export default function StaffPulse() {
  const { user, batches, students } = useApp()
  const navigate = useNavigate()

  // LOCAL date — toISOString returns UTC and would key against yesterday in IST mornings.
  const now      = new Date()
  const today    = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const dayShort = DAYS_SHORT[now.getDay()]

  const [step, setStep]                   = useState('batch')   // 'batch' | 'rate' | 'done'
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [mbStudentIds, setMbStudentIds]   = useState(new Set()) // multi-batch enrolment ids
  const [ratings, setRatings]             = useState({})        // { studentId: { effort, execution, focus, ...spotlight, note } }
  const [currentIdx, setCurrentIdx]       = useState(0)
  const [showSpotlight, setShowSpotlight] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [loadingBatch, setLoadingBatch]   = useState(false)
  const [search, setSearch]               = useState('')        // jump-to-student in rate step

  const batchTrainsToday = (b) =>
    !b.days || b.days.length === 0 ||
    b.days.some(d => d.toLowerCase().startsWith(dayShort.toLowerCase().slice(0, 2)))

  // My batches (or all if none assigned), today's-first.
  const myBatches = useMemo(() => {
    const assigned = batches.filter(b =>
      b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
    )
    const pool = assigned.length > 0 ? assigned : batches
    return [...pool].sort((a, b) => (batchTrainsToday(b) ? 1 : 0) - (batchTrainsToday(a) ? 1 : 0))
  }, [batches, user, dayShort])

  // Active students in the selected batch (primary + multi-batch).
  const batchStudents = useMemo(() => {
    if (!selectedBatch) return []
    return students.filter(s =>
      s.status === 'Active' &&
      (s.batchId === selectedBatch.id || s.batch === selectedBatch.name || mbStudentIds.has(s.id))
    )
  }, [students, selectedBatch, mbStudentIds])

  const current        = batchStudents[currentIdx]
  const currentRating  = current ? (ratings[current.id] || {}) : {}
  const allPulseDone   = currentRating.effort && currentRating.execution && currentRating.focus
  const ratedCount     = Object.values(ratings).filter(r => r.effort && r.execution && r.focus).length
  const spotlightCount = Object.values(ratings).filter(r => r.technical || r.tactical || r.physical || r.mental || (r.note || '').trim()).length

  // Live search across the batch — empty when no query so the dropdown stays hidden.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return batchStudents
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) =>
        s.name.toLowerCase().includes(q) ||
        (s.studentCode || s.student_code || '').toLowerCase().includes(q)
      )
      .slice(0, 6)
  }, [search, batchStudents])

  const jumpToStudent = (idx) => {
    setCurrentIdx(idx)
    setSearch('')
    setShowSpotlight(false)
  }

  // ── Pick a batch → preload existing + jump to first unrated ──
  const pickBatch = async (batch) => {
    setLoadingBatch(true)
    setSelectedBatch(batch)
    setMbStudentIds(new Set())
    try {
      const [enrolments, existing] = await Promise.all([
        db.fetchBatchEnrolments(batch.id).catch(() => []),
        db.fetchSessionFeedback(today, batch.id).catch(() => []),
      ])
      const mbIds = new Set(enrolments.map(r => r.student_id))
      setMbStudentIds(mbIds)

      const preloaded = {}
      existing.forEach(r => {
        preloaded[r.student_id] = {
          effort:    r.effort    ?? null,
          execution: r.execution ?? null,
          focus:     r.focus     ?? null,
          technical: r.technical ?? null,
          tactical:  r.tactical  ?? null,
          physical:  r.physical  ?? null,
          mental:    r.mental    ?? null,
          note:      r.note      || '',
        }
      })
      setRatings(preloaded)

      const list = students.filter(s =>
        s.status === 'Active' &&
        (s.batchId === batch.id || s.batch === batch.name || mbIds.has(s.id))
      )
      const firstUnrated = list.findIndex(s => {
        const r = preloaded[s.id]
        return !r || !r.effort || !r.execution || !r.focus
      })
      setCurrentIdx(firstUnrated >= 0 ? firstUnrated : 0)
      setStep('rate')
    } finally {
      setLoadingBatch(false)
    }
  }

  const setMetric = (key, value) => {
    if (!current) return
    setRatings(prev => ({ ...prev, [current.id]: { ...prev[current.id], [key]: value } }))
  }
  const setNote = (text) => {
    if (!current) return
    setRatings(prev => ({ ...prev, [current.id]: { ...prev[current.id], note: text } }))
  }

  // ── Save current student & advance ───────────────────────
  const advance = async (skip = false) => {
    if (!current) return
    if (!skip) {
      const r = ratings[current.id]
      if (r && r.effort && r.execution && r.focus) {
        setSaving(true)
        try {
          await db.saveSessionPulse({
            date:      today,
            batchId:   selectedBatch.id,
            academyId: user?.academyId,
            staffId:   user?.id,
            records:   [{ studentId: current.id, effort: r.effort, execution: r.execution, focus: r.focus }],
          })
          const hasSpot = r.technical || r.tactical || r.physical || r.mental || (r.note || '').trim()
          if (hasSpot) {
            await db.upsertSpotlight({
              date:      today,
              batchId:   selectedBatch.id,
              academyId: user?.academyId,
              staffId:   user?.id,
              studentId: current.id,
              technical: r.technical || null,
              tactical:  r.tactical  || null,
              physical:  r.physical  || null,
              mental:    r.mental    || null,
              note:      r.note      || null,
            })
          }
        } catch (e) {
          alert(`Save failed: ${e.message}`)
          setSaving(false)
          return
        }
        setSaving(false)
      }
    }
    setShowSpotlight(false)
    if (currentIdx + 1 >= batchStudents.length) setStep('done')
    else setCurrentIdx(i => i + 1)
  }

  const goBack = () => { if (currentIdx > 0) { setCurrentIdx(i => i - 1); setShowSpotlight(false) } }

  // ── Step 1: batch picker ─────────────────────────────────
  if (step === 'batch') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/staff/home')} className="p-1 -ml-1 text-gray-500">
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-base font-black text-gray-900">Session Pulse</h1>
          </div>
          <span className="text-[10px] text-gray-400 font-semibold">~5 min</span>
        </div>

        <div className="px-4 py-5 space-y-3">
          <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4">
            <p className="text-xs text-brand-700 font-bold mb-1">Pick the batch you just finished</p>
            <p className="text-[11px] text-brand-600 leading-snug">
              One tap each for Effort, Execution, Focus. Spotlight standouts as you go — adds detailed feedback the student sees.
            </p>
          </div>

          {myBatches.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">No batches assigned to you yet.</p>
          ) : (
            myBatches.map(b => {
              const trainsToday = batchTrainsToday(b)
              const count = students.filter(s =>
                s.status === 'Active' && (s.batchId === b.id || s.batch === b.name)
              ).length
              return (
                <button
                  key={b.id}
                  onClick={() => pickBatch(b)}
                  disabled={loadingBatch}
                  className={`w-full bg-white rounded-2xl border p-4 flex items-center justify-between active:bg-gray-50 shadow-sm ${
                    trainsToday ? 'border-brand-100' : 'border-gray-100 opacity-55'
                  } ${loadingBatch ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                      trainsToday ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'
                    }`}>
                      <Users size={20} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-gray-900 flex items-center gap-2">
                        {b.name}
                        {trainsToday && (
                          <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">TODAY</span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {count} active · {b.days?.length ? b.days.join('/') : 'Daily'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-300" />
                </button>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // ── Step 2: rate ────────────────────────────────────────
  if (step === 'rate' && current) {
    const progress = batchStudents.length ? Math.round((currentIdx / batchStudents.length) * 100) : 0
    const isLast   = currentIdx + 1 === batchStudents.length

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setStep('batch')} className="text-xs text-gray-400 font-bold flex items-center gap-1">
              <X size={14} /> Exit
            </button>
            <p className="text-xs font-black text-gray-900">{currentIdx + 1} / {batchStudents.length}</p>
            <button onClick={() => setStep('done')} className="text-xs text-brand-600 font-bold">Done</button>
          </div>
          <div className="w-full h-1 bg-gray-100 rounded-full mb-2">
            <div className="h-1 bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>

          {/* Jump-to-student search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Jump to student…"
              className="w-full pl-8 pr-8 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-brand-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 active:text-gray-500"
              >
                <X size={12} />
              </button>
            )}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 overflow-hidden max-h-60 overflow-y-auto">
                {searchResults.map(({ s, idx }) => {
                  const r    = ratings[s.id]
                  const done = r?.effort && r?.execution && r?.focus
                  const onMe = idx === currentIdx
                  return (
                    <button
                      key={s.id}
                      onClick={() => jumpToStudent(idx)}
                      className={`w-full px-3 py-2 flex items-center justify-between border-b border-gray-50 last:border-0 active:bg-gray-100 ${
                        onMe ? 'bg-brand-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-left min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate">{s.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{s.studentCode || s.student_code || '—'}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {onMe && <span className="text-[9px] font-black text-brand-600">CURRENT</span>}
                        {done
                          ? <CheckCircle2 size={12} className="text-emerald-500" />
                          : <span className="text-[9px] text-gray-300 font-bold uppercase">pending</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {search.trim() && searchResults.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 px-3 py-2">
                <p className="text-xs text-gray-400 text-center">No match in this batch</p>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-4 py-5 space-y-5">
          {/* Player card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
            <StudentAvatar student={current} size={56} />
            <div className="min-w-0">
              <p className="text-lg font-black text-gray-900 leading-tight truncate">{current.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {current.studentCode || current.student_code || '—'} · {current.position || current.sport || 'Player'}
              </p>
            </div>
          </div>

          {/* Pulse metrics */}
          {PULSE_METRICS.map(m => (
            <div key={m.key}>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{m.label}</p>
              <div className="grid grid-cols-3 gap-2">
                {m.options.map(o => {
                  const selected = currentRating[m.key] === o.v
                  return (
                    <button
                      key={o.v}
                      onClick={() => setMetric(m.key, o.v)}
                      className={`py-3.5 rounded-xl border-2 transition-all active:scale-95 ${
                        selected
                          ? COLOR_CLASS[o.color] + ' shadow-md'
                          : 'bg-white border-gray-200 text-gray-500'
                      }`}
                    >
                      <div className="text-xl leading-none">{o.emoji}</div>
                      <div className="text-xs font-black mt-1.5">{o.label}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Spotlight toggle */}
          <button
            onClick={() => setShowSpotlight(s => !s)}
            className="w-full bg-amber-50 border border-amber-100 rounded-2xl p-3 flex items-center justify-between active:bg-amber-100"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              <span className="text-sm font-bold text-amber-900">
                {showSpotlight ? 'Hide' : 'Add'} detailed spotlight
              </span>
            </div>
            <ChevronRight size={16} className={`text-amber-500 transition-transform ${showSpotlight ? 'rotate-90' : ''}`} />
          </button>

          {showSpotlight && (
            <div className="space-y-3 bg-white rounded-2xl border border-amber-100 p-4">
              {SPOTLIGHT_METRICS.map(sm => {
                const v = currentRating[sm.key]
                return (
                  <div key={sm.key} className="flex items-center gap-3">
                    <p className="text-xs font-bold text-gray-600 w-20 shrink-0">{sm.label}</p>
                    <div className="flex-1 grid grid-cols-3 gap-1.5">
                      {[1, 2, 3].map(val => (
                        <button
                          key={val}
                          onClick={() => setMetric(sm.key, val)}
                          className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            v === val
                              ? COLOR_CLASS[sm.color]
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}
                        >
                          {val === 1 ? 'Low' : val === 2 ? 'Mid' : 'High'}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              <textarea
                value={currentRating.note || ''}
                onChange={e => setNote(e.target.value)}
                placeholder="One line — what stood out? (e.g., great first touch, weak foot needs work)"
                rows={2}
                maxLength={200}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-amber-400"
              />
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 flex items-center gap-2"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={goBack}
            disabled={currentIdx === 0 || saving}
            className="px-3 py-3 rounded-xl bg-gray-100 text-gray-500 disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => advance(true)}
            disabled={saving}
            className="px-4 py-3 rounded-xl bg-gray-100 text-gray-500 text-xs font-bold disabled:opacity-30"
          >
            Skip
          </button>
          <button
            onClick={() => advance(false)}
            disabled={!allPulseDone || saving}
            className={`flex-1 py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 ${
              allPulseDone
                ? 'bg-brand-600 text-white shadow-md active:scale-95'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {saving ? 'Saving…' : (<>{isLast ? 'Finish' : 'Next'}<ChevronRight size={16} /></>)}
          </button>
        </div>
      </div>
    )
  }

  // ── Step 3: done ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mb-5">
        <Check size={36} className="text-emerald-600" />
      </div>
      <h1 className="text-2xl font-black text-gray-900 mb-1">Pulse complete</h1>
      <p className="text-sm text-gray-500">{selectedBatch?.name}</p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 my-6 w-full max-w-xs space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Players rated</span>
          <span className="font-black text-gray-900">{ratedCount} / {batchStudents.length}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Spotlights left</span>
          <span className="font-black text-amber-600">{spotlightCount}</span>
        </div>
      </div>

      <div className="flex gap-2 w-full max-w-xs">
        <button
          onClick={() => { setStep('batch'); setRatings({}); setCurrentIdx(0); setSelectedBatch(null) }}
          className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-sm"
        >
          Another batch
        </button>
        <button
          onClick={() => navigate('/staff/home')}
          className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-bold text-sm"
        >
          Done
        </button>
      </div>
    </div>
  )
}
