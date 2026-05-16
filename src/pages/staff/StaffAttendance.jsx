// Staff Attendance — 3-step wizard
//  Step 1: Pick batch (cards, auto-filtered to today)
//  Step 2: Student roster + mark Present / Absent / Late (tap cycles)
//  Step 3: Save & sync to DB
// No URL routing between steps — internal state machine

import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { ArrowLeft, Check, Users, Clock, Search, ChevronRight } from 'lucide-react'
import { fetchBatchEnrolments } from '../../lib/db'
import StudentAvatar from '../../components/StudentAvatar'

// Status cycle: blank → Present → Absent → Late → blank (tap again to clear mistake)
const NEXT_STATUS = { '': 'Present', Present: 'Absent', Absent: 'Late', Late: '' }

const STATUS_STYLE = {
  Present: { bg: 'bg-emerald-500', text: 'text-white',     label: 'P' },
  Absent:  { bg: 'bg-red-500',     text: 'text-white',     label: 'A' },
  Late:    { bg: 'bg-amber-400',   text: 'text-gray-900',  label: 'L' },
  '':      { bg: 'bg-gray-100',    text: 'text-gray-400',  label: '·' },
}

export default function StaffAttendance() {
  const { user, batches, students, attendanceData, saveAttendance, refreshData, loadAttendanceForDate } = useApp()

  // LOCAL date (not UTC) — toISOString() returns UTC so it would read previous day's data in IST mornings
  const pad2      = (n) => String(n).padStart(2, '0')
  const now       = new Date()
  const today     = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
  const todayAtt  = attendanceData[today] || {}
  const dayShort  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]

  // Always (re)load today's attendance on mount — even if stale data exists in cache
  useEffect(() => { loadAttendanceForDate?.(today) }, [today])

  // Step 1: batch picker state
  const [step,          setStep]          = useState(1)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [mbStudentIds,  setMbStudentIds]  = useState(new Set())

  // Step 2: mark attendance state
  const [marks,         setMarks]         = useState({})  // { studentId: 'Present'|'Absent'|'Late'|'' }
  const [reasons,       setReasons]       = useState({})  // { studentId: 'reason text' }
  const [search,        setSearch]        = useState('')
  const [saving,        setSaving]        = useState(false)

  // Batches assigned to this coach (or all if none assigned), sorted today's-first
  const batchTrainsToday = (b) =>
    !b.days || b.days.length === 0 ||
    b.days.some(d => d.toLowerCase().startsWith(dayShort.toLowerCase().slice(0, 2)))

  const myBatches = useMemo(() => {
    const assigned = batches.filter(b =>
      b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
    )
    const pool = assigned.length > 0 ? assigned : batches
    return [...pool].sort((a, b) => (batchTrainsToday(b) ? 1 : 0) - (batchTrainsToday(a) ? 1 : 0))
  }, [batches, user, dayShort])

  // Students in the selected batch (primary + multi-batch)
  const batchStudents = useMemo(() => {
    if (!selectedBatch) return []
    return students.filter(
      s => s.status === 'Active' && (s.batchId === selectedBatch.id || s.batch === selectedBatch.name || mbStudentIds.has(s.id))
    )
  }, [students, selectedBatch, mbStudentIds])

  // Suspended students who were in this batch — shown read-only
  const suspendedInBatch = useMemo(() => {
    if (!selectedBatch) return []
    return students.filter(
      s => s.status === 'Suspended' && (s.batchId === selectedBatch.id || s.batch === selectedBatch.name)
    )
  }, [students, selectedBatch])

  // Filter students by search
  const visible = useMemo(() => {
    const q = search.toLowerCase()
    return batchStudents.filter(s =>
      !q || s.name.toLowerCase().includes(q) || (s.parent || '').toLowerCase().includes(q)
    )
  }, [batchStudents, search])

  // Count present for header badge
  const presentCount = batchStudents.filter(s => (marks[s.id] || todayAtt[s.id] || '') === 'Present').length

  // ── Select a batch → go to step 2 ────────────────────
  const pickBatch = async (batch) => {
    setSelectedBatch(batch)
    setMbStudentIds(new Set())
    // Load multi-batch enrolments
    try {
      const rows = await fetchBatchEnrolments(batch.id)
      setMbStudentIds(new Set(rows.map(r => r.student_id)))
    } catch {/* table may not exist yet */}
    // Pre-load batch-specific marks for today (not aggregate — avoids cross-batch bleed)
    let batchMarks = {}
    try { batchMarks = await db.fetchAttendanceForDate(today, batch.id) } catch {}
    const existing = {}
    students
      .filter(s => s.status === 'Active' && (s.batchId === batch.id || s.batch === batch.name))
      .forEach(s => { existing[s.id] = batchMarks[s.id] || '' })
    setMarks(existing)
    setReasons({})
    setSearch('')
    setStep(2)
  }

  // ── Tap student → cycle status ────────────────────────
  const cycleMark = (studentId) => {
    setMarks(prev => {
      const cur = prev[studentId] || ''
      return { ...prev, [studentId]: NEXT_STATUS[cur] }
    })
  }

  // ── Save attendance to DB ─────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      // Save only this batch's marks — no merging with other batches
      await saveAttendance(today, marks, selectedBatch?.id ?? null)
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  // ─────────────────────────────────────────────────────
  // Step 1: Batch picker
  // ─────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="px-4 pt-5 pb-4">
        <div className="mb-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Attendance</p>
          <h2 className="text-xl font-black text-gray-900">Pick Today's Batch</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {myBatches.length === 0 ? (
          <div className="text-center py-16">
            <Users size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No batches assigned</p>
            <p className="text-xs text-gray-400 mt-1">Ask your owner to assign you to a batch</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myBatches.map(b => {
              const activeCount    = students.filter(s => s.status === 'Active'    && (s.batchId === b.id || s.batch === b.name)).length
              const suspendedCount = students.filter(s => s.status === 'Suspended' && (s.batchId === b.id || s.batch === b.name)).length
              const count = activeCount
              const runsToday = batchTrainsToday(b)
              // Only count Alternate students who train today + all Daily students
              const alreadyMarked = runsToday ? students
                .filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
                .filter(s => s.trainingType !== 'Alternate' || (b.days || []).includes(dayShort))
                .filter(s => todayAtt[s.id]).length : 0

              return (
                <button key={b.id}
                  onClick={() => pickBatch(b)}
                  className={`w-full rounded-2xl p-4 border text-left flex items-center gap-4 transition ${
                    runsToday
                      ? 'bg-white border-gray-100 active:bg-gray-50'
                      : 'bg-gray-50 border-gray-100 opacity-55 active:opacity-70'
                  }`}>
                  {/* Sport icon placeholder */}
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${runsToday ? 'bg-brand-50' : 'bg-gray-100'}`}>
                    <span className="text-xl">{getSportEmoji(b.sports?.[0])}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className={`font-bold text-sm truncate ${runsToday ? 'text-gray-900' : 'text-gray-500'}`}>{b.name}</p>
                      {runsToday
                        ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold flex-shrink-0">Today</span>
                        : <span className="text-[10px] bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-bold flex-shrink-0">Off</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {b.startTime && <span className="flex items-center gap-1"><Clock size={10} />{b.startTime}</span>}
                      <span className="flex items-center gap-1"><Users size={10} />{count} students{suspendedCount > 0 ? ` · ${suspendedCount} suspended` : ''}</span>
                      {runsToday
                        ? alreadyMarked > 0 && <span className="text-emerald-600 font-semibold">{alreadyMarked} marked</span>
                        : b.days?.length > 0 && <span>· {b.days.join(', ')}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────
  // Step 2: Mark attendance
  // ─────────────────────────────────────────────────────
  if (step === 2) {
    const selectedRunsToday = selectedBatch ? batchTrainsToday(selectedBatch) : true
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 bg-white border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setStep(1)}
              className="p-1.5 rounded-xl bg-gray-100 text-gray-600">
              <ArrowLeft size={16} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 truncate">{selectedBatch?.name}</p>
              <p className="text-xs text-gray-400">{selectedBatch?.sports?.join(', ')} · {selectedBatch?.startTime}</p>
            </div>
            {/* Live present count badge */}
            <div className="flex-shrink-0 text-right">
              <p className="text-lg font-black text-emerald-600">{presentCount}</p>
              <p className="text-[10px] text-gray-400 leading-tight">present<br/>of {batchStudents.length}</p>
            </div>
          </div>
          {/* Off-day warning */}
          {!selectedRunsToday && (
            <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              <span>⚠</span>
              <span><strong>Off day</strong> — this batch doesn't train today{selectedBatch?.days?.length > 0 && <> (trains {selectedBatch.days.join(', ')})</>}</span>
            </div>
          )}
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-8 py-2 text-sm"
              placeholder="Search student or parent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Tap legend */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4">
          <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Tap to mark:</p>
          {[
            { label: 'Present', color: 'bg-emerald-500 text-white' },
            { label: 'Absent',  color: 'bg-red-500 text-white' },
            { label: 'Late',    color: 'bg-amber-400 text-gray-900' },
          ].map(s => (
            <span key={s.label} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.color}`}>
              {s.label}
            </span>
          ))}
        </div>

        {/* Student list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {visible.length === 0 && suspendedInBatch.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No students found</div>
          ) : visible.map(s => {
            const status = marks[s.id] || ''
            const st = STATUS_STYLE[status] || STATUS_STYLE['']
            const isLate = status === 'Late'
            return (
              <div key={s.id}>
                <button
                  onClick={() => cycleMark(s.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 text-left"
                >
                  {/* Avatar */}
                  <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={36} />
                  {/* Name + parent */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                    {s.parentPhone && (
                      <p className="text-xs text-gray-400 truncate">{s.parent} · {s.parentPhone}</p>
                    )}
                  </div>
                  {/* Status chip */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-base flex-shrink-0 ${st.bg} ${st.text}`}>
                    {st.label}
                  </div>
                </button>
                {/* Late reason input — shown inline below the row */}
                {isLate && (
                  <div className="px-4 pb-3 pt-0">
                    <input
                      className="input text-xs py-2"
                      placeholder="Reason for late (optional — e.g. traffic, drop-off)"
                      value={reasons[s.id] || ''}
                      onChange={e => setReasons(prev => ({ ...prev, [s.id]: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {/* Suspended students — read-only info */}
          {suspendedInBatch.length > 0 && (
            <>
              <div className="px-4 py-2 bg-red-50 border-y border-red-100">
                <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">Suspended ({suspendedInBatch.length})</p>
              </div>
              {suspendedInBatch.map(s => (
                <div key={`susp-${s.id}`} className="flex items-center gap-3 px-4 py-3 opacity-50">
                  <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-sm font-black text-red-400 flex-shrink-0">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-500 truncate">{s.name}</p>
                    {s.parentPhone && <p className="text-xs text-gray-400 truncate">{s.parent} · {s.parentPhone}</p>}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-500">Suspended</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Sticky save button */}
        <div className="px-4 py-4 bg-white border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full btn-primary justify-center py-3.5 text-base"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Saving…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Check size={18} /> Save & Sync
              </span>
            )}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">
            {Object.values(marks).filter(v => v).length} of {batchStudents.length} marked
          </p>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────
  // Step 3: Success
  // ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] px-6 text-center">
      <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
        <Check size={28} className="text-emerald-600" />
      </div>
      <h2 className="text-xl font-black text-gray-900 mb-1">Attendance Saved!</h2>
      <p className="text-sm text-gray-500 mb-2">
        {presentCount} present · {batchStudents.length - presentCount} absent/late
      </p>
      <p className="text-xs text-gray-400 mb-6">Synced to {selectedBatch?.name}</p>
      <button
        onClick={() => setStep(1)}
        className="btn-primary px-8 py-3"
      >
        Mark Another Batch
      </button>
    </div>
  )
}

// ── Helper — sport emoji ───────────────────────────────────
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
