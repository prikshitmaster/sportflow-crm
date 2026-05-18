// Staff Session Planner — coaches build and manage training sessions
import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import {
  fetchSessionPlans, fetchSessionPlan, createSessionPlan, updateSessionPlan,
  deleteSessionPlan as dbDeleteSessionPlan, completeSessionPlan, duplicateSessionPlan,
  createSessionPhase, updateSessionPhase, deleteSessionPhase,
  reorderSessionPhases, fetchDrills,
} from '../../lib/db'
import { exportSessionPDF } from '../../lib/sessionPDF'
import {
  Plus, ChevronLeft, ChevronRight, Edit2, Trash2, Check, Copy,
  Clock, Users, BookOpen, ChevronDown, ChevronUp, X, Save,
  CalendarDays, Trophy, ArrowUp, ArrowDown, FileDown, AlertCircle,
} from 'lucide-react'

const PHASE_CATEGORIES = [
  { key: 'warm_up',    label: 'Warm Up',      color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'technical',  label: 'Technical',    color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'passing',    label: 'Passing',      color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'shooting',   label: 'Shooting',     color: 'bg-red-100 text-red-700 border-red-200' },
  { key: 'defending',  label: 'Defending',    color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { key: 'ssg',        label: 'Small-Sided',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'cool_down',  label: 'Cool Down',    color: 'bg-gray-100 text-gray-600 border-gray-200' },
]

function catStyle(key) {
  return PHASE_CATEGORIES.find(c => c.key === key)?.color || 'bg-gray-100 text-gray-600 border-gray-200'
}
function catLabel(key) {
  return PHASE_CATEGORIES.find(c => c.key === key)?.label || key
}

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
}

// ── Drill Picker Modal ────────────────────────────────────────────────────────
function DrillPicker({ category, academyId, sportName, onSelect, onClose }) {
  const [drills, setDrills] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    fetchDrills(academyId, sportName).then(setDrills).catch(() => {})
  }, [academyId, sportName])

  const filtered = drills.filter(d => {
    const matchCat = !category || d.category === category
    const matchQ   = !q || d.name.toLowerCase().includes(q.toLowerCase())
    return matchCat && matchQ
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
      <div className="bg-white rounded-t-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Pick a Drill</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-4 py-2 border-b border-gray-100">
          <input
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"
            placeholder="Search drills…"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
          {filtered.map(d => (
            <button key={d.id} onClick={() => onSelect(d)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-start gap-3">
              <span className={`mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${catStyle(d.category)}`}>
                {catLabel(d.category)}
              </span>
              <div>
                <p className="font-semibold text-sm text-gray-900">{d.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{d.duration}m · {d.age_group} · {d.difficulty}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No drills found</p>
          )}
        </div>
        <div className="px-4 pb-5 pt-2 border-t border-gray-100">
          <button onClick={() => onSelect(null)}
            className="w-full py-2.5 text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50">
            + Add phase without drill
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phase Card ────────────────────────────────────────────────────────────────
function PhaseCard({ phase, index, total, onChange, onDelete, onMoveUp, onMoveDown }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dur, setDur] = useState(phase.duration || 15)
  const [notes, setNotes] = useState(phase.coaching_points?.join('\n') || '')

  const save = async () => {
    await onChange(phase.id, {
      duration: dur,
      coaching_points: notes ? notes.split('\n').filter(Boolean) : [],
    })
    setEditing(false)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="text-xs font-bold text-gray-400 w-5 text-center">{index + 1}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${catStyle(phase.phase_name)}`}>
          {catLabel(phase.phase_name)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 truncate">
            {phase.drills?.name || phase.area || 'Custom phase'}
          </p>
          <p className="text-xs text-gray-400">{phase.duration}m</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp}   disabled={index === 0}     className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={13} /></button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={13} /></button>
          <button onClick={() => { setEditing(e => !e); setExpanded(true) }} className="p-1 text-gray-400 hover:text-brand-600"><Edit2 size={13} /></button>
          <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
          <button onClick={() => setExpanded(e => !e)} className="p-1 text-gray-400">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-3">
          {editing ? (
            <>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 w-16">Duration</label>
                <input type="number" value={dur} min={1} max={90}
                  onChange={e => setDur(Number(e.target.value))}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-400"
                />
                <span className="text-xs text-gray-400">min</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Coaching notes (one per line)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder="Key coaching points for this phase…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="flex-1 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1">
                  <Save size={13} /> Save
                </button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Cancel</button>
              </div>
            </>
          ) : (
            <>
              {phase.drills && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-700">Drill: {phase.drills.name}</p>
                  {phase.drills.area && <p className="text-xs text-gray-500">Area: {phase.drills.area}</p>}
                  {phase.drills.context_ct && <p className="text-xs text-blue-600">CT — {phase.drills.context_ct}</p>}
                  {phase.drills.context_mt && <p className="text-xs text-red-600">MT — {phase.drills.context_mt}</p>}
                </div>
              )}
              {phase.coaching_points?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Coaching Notes</p>
                  <ul className="space-y-1">
                    {phase.coaching_points.map((cp, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-2">
                        <span className="text-brand-500">•</span>{cp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Session Editor ────────────────────────────────────────────────────────────
function SessionEditor({ plan: initPlan, batches, academyId, sportName, onBack, onSaved }) {
  const [plan, setPlan] = useState(initPlan)
  const [phases, setPhases] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState(null)    // category for picker
  const [completing, setCompleting] = useState(false)
  const [duplicateModal, setDuplicateModal] = useState(false)
  const [dupDate, setDupDate] = useState('')
  const [dupBatch, setDupBatch] = useState(plan.batch_id || '')

  const totalDur = phases.reduce((s, p) => s + (p.duration || 0), 0)

  useEffect(() => {
    if (initPlan.id) {
      fetchSessionPlan(initPlan.id)
        .then(full => { setPlan(full); setPhases(full.session_phases || []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [initPlan.id])

  const addPhase = async (category, drill) => {
    const position = phases.length
    const newPhase = await createSessionPhase({
      session_id: plan.id,
      phase_name: category,
      drill_id: drill?.id || null,
      duration: drill?.duration || 15,
      area: drill?.area || null,
      context_ct: drill?.context_ct || null,
      context_mt: drill?.context_mt || null,
      coaching_points: drill?.coaching_points || [],
      position,
    })
    setPhases(prev => [...prev, newPhase])
    setPicker(null)
  }

  const changePhase = async (id, updates) => {
    const updated = await updateSessionPhase(id, updates)
    setPhases(prev => prev.map(p => p.id === id ? updated : p))
  }

  const removePhase = async (id) => {
    await deleteSessionPhase(id)
    setPhases(prev => {
      const next = prev.filter(p => p.id !== id)
      reorderSessionPhases(next.map((p, i) => ({ id: p.id, position: i })))
      return next.map((p, i) => ({ ...p, position: i }))
    })
  }

  const movePhase = async (index, dir) => {
    const next = [...phases]
    const swap = index + dir
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setPhases(next)
    await reorderSessionPhases(next.map((p, i) => ({ id: p.id, position: i })))
  }

  const saveHeader = async (field, value) => {
    const updated = await updateSessionPlan(plan.id, { [field]: value })
    setPlan(prev => ({ ...prev, ...updated }))
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      await completeSessionPlan(plan.id)
      onSaved()
    } finally {
      setCompleting(false)
    }
  }

  const handleDuplicate = async () => {
    if (!dupDate) return
    setSaving(true)
    try {
      await duplicateSessionPlan(plan.id, dupDate, dupBatch)
      setDuplicateModal(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-gray-400">Loading session…</div>

  const batch = batches.find(b => b.id === plan.batch_id)

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{batch?.name || 'Session'}</p>
          <p className="text-xs text-gray-400">{fmt(plan.date)} · {totalDur}m total</p>
        </div>
        <button
          onClick={() => exportSessionPDF({ plan, phases, batchName: batch?.name || '—' })}
          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition"
          title="Export PDF">
          <FileDown size={17} />
        </button>
        {plan.status !== 'completed' && (
          <button onClick={handleComplete} disabled={completing || phases.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
            <Check size={13} /> {completing ? 'Saving…' : 'Complete'}
          </button>
        )}
        {plan.status === 'completed' && (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
            <Trophy size={12} /> Done
          </span>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Session meta */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Topic</label>
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Session topic / theme…"
              defaultValue={plan.topic || ''}
              onBlur={e => saveHeader('topic', e.target.value)}
              disabled={plan.status === 'completed'}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Objective</label>
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Main objective…"
              defaultValue={plan.objective || ''}
              onBlur={e => saveHeader('objective', e.target.value)}
              disabled={plan.status === 'completed'}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Players</label>
            <input type="number"
              className="w-20 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="0"
              defaultValue={plan.num_players || ''}
              onBlur={e => saveHeader('num_players', parseInt(e.target.value) || null)}
              disabled={plan.status === 'completed'}
            />
          </div>
        </div>

        {/* Phases */}
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1">
          Phases · {phases.length} · {totalDur}min
        </p>

        {phases.map((phase, i) => (
          <PhaseCard key={phase.id} phase={phase} index={i} total={phases.length}
            onChange={changePhase}
            onDelete={() => removePhase(phase.id)}
            onMoveUp={() => movePhase(i, -1)}
            onMoveDown={() => movePhase(i, 1)}
          />
        ))}

        {plan.status !== 'completed' && (
          <>
            <p className="text-xs font-semibold text-gray-500 px-1">Add phase</p>
            <div className="grid grid-cols-4 gap-2">
              {PHASE_CATEGORIES.map(cat => (
                <button key={cat.key}
                  onClick={() => setPicker(cat.key)}
                  className={`rounded-xl border py-2 text-[11px] font-semibold ${cat.color} hover:opacity-80 transition`}>
                  {cat.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Duplicate button */}
        <button onClick={() => setDuplicateModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 hover:bg-gray-50 transition mt-2">
          <Copy size={14} /> Use as template for another day
        </button>
      </div>

      {/* Drill picker sheet */}
      {picker && (
        <DrillPicker
          category={picker}
          academyId={academyId}
          sportName={sportName}
          onSelect={drill => addPhase(picker, drill)}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Duplicate modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-gray-900">Duplicate to another day</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">New date</label>
                <input type="date" value={dupDate} onChange={e => setDupDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Batch</label>
                <select value={dupBatch} onChange={e => setDupBatch(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 bg-white">
                  {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleDuplicate} disabled={!dupDate || saving}
                className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                {saving ? 'Duplicating…' : 'Duplicate'}
              </button>
              <button onClick={() => setDuplicateModal(false)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_SHORT = { Sunday:'Sun', Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' }

function nextValidDate(fromDate, days) {
  if (!days?.length) return fromDate
  const d = new Date(fromDate + 'T00:00:00')
  for (let i = 0; i < 7; i++) {
    if (days.includes(DAY_NAMES[d.getDay()])) return d.toISOString().split('T')[0]
    d.setDate(d.getDate() + 1)
  }
  return fromDate
}

// ── New Session Modal ─────────────────────────────────────────────────────────
function NewSessionModal({ batches, academyId, coachId, onCreated, onClose }) {
  const [batchId, setBatchId] = useState(batches[0]?.id || '')
  const [date, setDate]       = useState(() => {
    const today = new Date().toISOString().split('T')[0]
    const first = batches[0]
    return first?.days?.length ? nextValidDate(today, first.days) : today
  })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const batch     = batches.find(b => b.id === batchId)
  const batchDays = batch?.days || []
  const selDay    = date ? DAY_NAMES[new Date(date + 'T00:00:00').getDay()] : null
  const dayBlocked = batchDays.length > 0 && selDay && !batchDays.includes(selDay)

  const handleBatchChange = (newBatchId) => {
    setBatchId(newBatchId)
    const newBatch = batches.find(b => b.id === newBatchId)
    if (newBatch?.days?.length) setDate(nextValidDate(date, newBatch.days))
  }

  const handleDateChange = (newDate) => {
    setDate(newDate)
  }

  const create = async () => {
    if (!batchId || !date) return
    setSaving(true)
    setErr('')
    try {
      const payload = {
        academy_id: academyId || undefined,
        batch_id:   batchId   || undefined,
        coach_id:   coachId   || undefined,
        date,
        status: 'draft',
      }
      console.log('Session payload:', payload)
      const plan = await createSessionPlan(payload)
      onCreated(plan)
    } catch (e) {
      console.error('createSessionPlan error:', e)
      console.error('Payload:', { academy_id: academyId, batch_id: batchId, coach_id: coachId, date })
      if (e.code === '23505')  setErr('A session already exists for this batch on that date.')
      else if (e.code === '42P01') setErr('Session tables not found — please run migrations 0021–0024 in Supabase.')
      else if (e.code === '23502') setErr('Missing required field. Check academy / batch setup.')
      else setErr(`Error ${e.code || '?'}: ${e.message || 'unknown'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
        <h3 className="font-bold text-gray-900">New Session Plan</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Batch</label>
            <select value={batchId} onChange={e => handleBatchChange(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 bg-white">
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {batchDays.length > 0 && (
              <p className="text-[11px] mt-1 text-gray-400">
                Training days: {batchDays.map(d => DAY_SHORT[d] || d).join(' · ')}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Date</label>
            <input type="date" value={date} onChange={e => handleDateChange(e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 ${dayBlocked ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
            {dayBlocked && (
              <div className="flex items-start gap-1.5 mt-1.5">
                <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-red-600 font-medium">{selDay} is not a training day.</p>
                  <button type="button" onClick={() => setDate(nextValidDate(date, batchDays))}
                    className="text-[11px] text-brand-600 font-semibold underline mt-0.5">
                    Jump to next training day →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {err && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={create} disabled={!batchId || !date || saving || dayBlocked}
            className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main SessionPlanner ───────────────────────────────────────────────────────
export default function SessionPlanner() {
  const { user, batches: ctxBatches, selectedSport, sportBranches } = useApp()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null)
  const [newModal, setNewModal] = useState(false)
  const [tab, setTab]           = useState('upcoming')
  const [deletingId, setDeletingId] = useState(null)

  const academyId = user?.academyId
  const coachId   = user?.staffId || user?.id

  const myBatches = (ctxBatches || []).filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const batches = myBatches.length > 0 ? myBatches : (ctxBatches || [])
  const sportName = (sportBranches || []).find(sb => sb.id === selectedSport)?.sportName || null

  const load = useCallback(() => {
    if (!academyId) return
    setLoading(true)
    fetchSessionPlans({ academyId, coachId })
      .then(plans => setSessions(plans))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [academyId, coachId])

  useEffect(() => { load() }, [load])

  if (editing) {
    return (
      <SessionEditor
        plan={editing}
        batches={batches}
        academyId={academyId}
        sportName={sportName}
        onBack={() => { setEditing(null); load() }}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  const handleDelete = async (e, planId) => {
    e.stopPropagation()
    if (!confirm('Delete this session plan?')) return
    setDeletingId(planId)
    try { await dbDeleteSessionPlan(planId); load() }
    catch { setDeletingId(null) }
  }

  const upcoming  = sessions.filter(s => s.status !== 'completed').sort((a, b) => a.date < b.date ? -1 : 1)
  const completed = sessions.filter(s => s.status === 'completed').sort((a, b) => a.date > b.date ? -1 : 1)
  const list      = tab === 'upcoming' ? upcoming : completed

  const batchName = id => batches.find(b => b.id === id)?.name || '—'

  const phaseSummary = plan => {
    const phases = plan.session_phases || []
    return phases.length ? `${phases.length} phase${phases.length > 1 ? 's' : ''} · ${plan.total_duration || phases.reduce((s, p) => s + (p.duration || 0), 0)}m` : 'No phases yet'
  }

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Sessions</h1>
          <p className="text-xs text-gray-400 mt-0.5">Build and manage training plans</p>
        </div>
        <button onClick={() => setNewModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold shadow-sm">
          <Plus size={15} /> New
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
          {[
            { key: 'upcoming',  label: `Upcoming (${upcoming.length})` },
            { key: 'completed', label: `History (${completed.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="px-4 space-y-3">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)
        ) : list.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-semibold text-gray-500">
              {tab === 'upcoming' ? 'No upcoming sessions' : 'No completed sessions yet'}
            </p>
            {tab === 'upcoming' && (
              <button onClick={() => setNewModal(true)}
                className="mt-3 text-sm text-brand-600 font-semibold">
                Create your first session →
              </button>
            )}
          </div>
        ) : (
          list.map(plan => (
            <div key={plan.id} className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-2"
                onClick={() => setEditing(plan)} style={{ cursor: 'pointer' }}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 text-sm">{batchName(plan.batch_id)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmt(plan.date)}</p>
                  {plan.topic && <p className="text-xs text-gray-600 mt-1 truncate">{plan.topic}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {plan.status === 'completed' && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <Trophy size={10} /> Done
                    </span>
                  )}
                  {plan.status === 'draft' && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Draft</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock size={11} /> {phaseSummary(plan)}
                </span>
                <button onClick={e => handleDelete(e, plan.id)} disabled={deletingId === plan.id}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition disabled:opacity-40">
                  <Trash2 size={12} /> {deletingId === plan.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {newModal && (
        <NewSessionModal
          batches={batches}
          academyId={academyId}
          coachId={coachId}
          onCreated={plan => { setNewModal(false); load(); setEditing(plan) }}
          onClose={() => setNewModal(false)}
        />
      )}
    </div>
  )
}
