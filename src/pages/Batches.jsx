import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Layers, Plus, Users, Clock, UserCog, AlertCircle, X, ChevronRight, Pencil, Trash2, UserPlus, Search, UserMinus } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'
import { fetchBatchEnrolments, assignStudentToBatch, unassignStudentFromBatch, updateBatchEnrolled } from '../lib/db'
import { logAudit, ACTIONS } from '../lib/audit'
import StudentAvatar from '../components/StudentAvatar'
import { FOOTBALL_POSITIONS, POSITION_COLORS } from '../lib/performance'
import { updateStudentPosition } from '../lib/db'

const COLOR_HEX      = ['#4f46e5', '#059669', '#7c3aed', '#d97706', '#e11d48']
const COLOR_HEX_DARK = ['#3730a3', '#047857', '#6d28d9', '#b45309', '#be123c']

export default function Batches() {
  const { batches, addBatch, updateBatch, deleteBatch, staff, students, updateBatchCoach, branches } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [editingBatch, setEditingBatch] = useState(null)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [activeBranch, setActiveBranch] = useState('All')
  const [enrolledAdj, setEnrolledAdj] = useState({}) // { [batchId]: cumulative delta }

  const adjustEnrolled = (batchId, delta) => {
    updateBatchEnrolled(batchId, delta).catch(() => {})
    setEnrolledAdj(prev => ({ ...prev, [batchId]: (prev[batchId] || 0) + delta }))
  }

  // Return the single "home" sport for a batch: the longest entry in its sports array.
  // Handles both array and string (in case DB returns text instead of text[]).
  const getBatchSection = (b) => {
    const sports = Array.isArray(b.sports) ? b.sports : (b.sports ? [String(b.sports)] : [])
    return sports.slice().sort((a, z) => z.length - a.length)[0] ?? null
  }

  // Build the branch tab list from primary sports only — no ghost tabs for secondary sports.
  const branchList = useMemo(() => {
    const set = new Set()
    batches.forEach(b => { const s = getBatchSection(b); if (s) set.add(s) })
    return [...set].sort()
  }, [batches])

  // Grouped sections — each batch in exactly one section
  const grouped = useMemo(() => {
    if (branchList.length === 0) return null
    return branchList.map(br => ({
      branch: br,
      batches: batches.filter(b => getBatchSection(b) === br),
    }))
  }, [branchList, batches])

  // Active branch filter — also exclusive
  const visibleBatches = activeBranch === 'All'
    ? batches
    : batches.filter(b => getBatchSection(b) === activeBranch)

  const handleAdd = async (b) => {
    await addBatch(b)
    setShowModal(false)
  }

  const handleEdit = async (b) => {
    const updated = await updateBatch(editingBatch.id, b)
    if (updated) {
      setSelectedBatch(prev => prev && prev.id === editingBatch.id
        ? { ...prev, ...updated, sports: updated.sports || [], days: updated.days || [],
            startTime: updated.start_time, endTime: updated.end_time,
            ageMin: updated.age_min, ageMax: updated.age_max, ground: updated.ground || null }
        : prev)
    }
    setEditingBatch(null)
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Batches</h2>
          <p className="text-xs text-gray-500">Tap a batch to view details &amp; manage students</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setShowModal(true)}>
          <Plus size={15} /> <span className="hidden sm:inline">Create Batch</span><span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Branch jump pills */}
      {branchList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setActiveBranch('All')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-bold border transition ${activeBranch === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
          >
            All <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === 'All' ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.length}</span>
          </button>
          {branchList.map(br => (
            <button key={br} onClick={() => setActiveBranch(br)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-bold border transition ${activeBranch === br ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {br} <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === br ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.filter(b => getBatchSection(b) === br).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { val: visibleBatches.length, label: 'Batches', color: 'text-gray-900' },
          { val: visibleBatches.reduce((s,b) => s + (b.enrolled || 0), 0), label: 'Enrolled', color: 'text-brand-600' },
          { val: visibleBatches.reduce((s,b) => s + (b.waitlist || 0), 0), label: 'Waitlist', color: 'text-amber-600' },
          { val: visibleBatches.reduce((s,b) => s + Math.max(0, b.capacity - (b.enrolled || 0)), 0), label: 'Seats Free', color: 'text-gray-400' },
        ].map(({ val, label, color }) => (
          <div key={label} className="card p-3 text-center">
            <p className={`text-2xl font-black ${color}`}>{val}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Grouped branch sections (when branches configured) ── */}
      {grouped && activeBranch === 'All' ? (
        <div className="space-y-8">
          {grouped.map(({ branch, batches: branchBatches }) => (
            <div key={branch}>
              {/* Branch heading */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2 h-6 bg-brand-600 rounded-full" />
                <h3 className="text-base font-black text-gray-900">{branch}</h3>
                <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                  {branchBatches.length} batch{branchBatches.length !== 1 ? 'es' : ''} · {branchBatches.reduce((s,b) => s+b.enrolled, 0)} enrolled
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {branchBatches.map((b, idx) => (
                  <BatchCard key={b.id} b={b} idx={idx} enrolledAdj={enrolledAdj} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : visibleBatches.length === 0 ? (
        <div className="card p-10 text-center">
          <Layers size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">No batches in {activeBranch}</p>
        </div>
      ) : (
        /* Single branch selected — flat grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleBatches.map((b, idx) => (
            <BatchCard key={b.id} b={b} idx={idx} enrolledAdj={enrolledAdj} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} />
          ))}
        </div>
      )}

      {/* Fallback flat grid when no branches configured */}
      {!grouped && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {batches.map((b, idx) => <BatchCard key={b.id} b={b} idx={idx} enrolledAdj={enrolledAdj} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} />)}
        </div>
      )}

      {showModal && <AddBatchModal onClose={() => setShowModal(false)} onSave={handleAdd} staff={staff} />}

      {editingBatch && (
        <AddBatchModal
          onClose={() => setEditingBatch(null)}
          onSave={handleEdit}
          staff={staff}
          initialData={editingBatch}
        />
      )}

      {selectedBatch && (
        <BatchDetailPanel
          batch={{ ...selectedBatch, enrolled: (selectedBatch.enrolled || 0) + (enrolledAdj[selectedBatch.id] || 0) }}
          students={students}
          staff={staff}
          onClose={() => setSelectedBatch(null)}
          onEdit={() => { setEditingBatch(selectedBatch); setSelectedBatch(null) }}
          onDelete={async () => { await deleteBatch(selectedBatch.id); setSelectedBatch(null) }}
          onAssignCoach={async (id, name) => {
            await updateBatchCoach(id, name)
            setSelectedBatch(prev => ({ ...prev, coach: name }))
          }}
          onEnrolledChange={adjustEnrolled}
        />
      )}
    </div>
  )
}

function BatchCard({ b, idx, enrolledAdj = {}, staff = [], onSelect, onEdit }) {
  const enrolled = (b.enrolled || 0) + (enrolledAdj[b.id] || 0)
  const pct      = Math.min(Math.round((enrolled / b.capacity) * 100), 100)
  const isFull   = enrolled >= b.capacity
  const hex      = COLOR_HEX[idx % COLOR_HEX.length]
  const hexDark  = COLOR_HEX_DARK[idx % COLOR_HEX_DARK.length]
  const barColor = isFull ? '#ef4444' : pct > 80 ? '#f59e0b' : hex

  const coachStaff = b.coach ? staff.find(s => s.name === b.coach) : null

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md active:scale-[0.98] transition-all border border-gray-100/80">
      {/* Gradient header — click opens detail panel */}
      <div
        className="px-4 pt-4 pb-5 relative cursor-pointer"
        style={{ background: `linear-gradient(135deg, ${hex} 0%, ${hexDark} 100%)` }}
        onClick={() => onSelect(b)}
      >
        {/* Edit button top-right */}
        <button
          onClick={e => { e.stopPropagation(); onEdit(b) }}
          className="absolute top-3 right-3 p-1.5 rounded-lg bg-white/20 hover:bg-white/35 active:bg-white/40 transition"
          title="Edit batch"
        >
          <Pencil size={12} className="text-white" />
        </button>

        {/* Sport badge */}
        {b.sports?.length > 0 && (
          <span className="inline-block text-[10px] font-bold text-white/90 bg-white/20 px-2 py-0.5 rounded-full mb-2">
            {b.sports[0]}
          </span>
        )}

        {/* Batch name */}
        <h3 className="font-black text-white text-base leading-snug pr-8">{b.name}</h3>
        {b.code && <p className="font-mono text-[10px] text-white/50 mt-0.5">{b.code}</p>}

        {/* Schedule */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5">
          {b.time && (
            <span className="flex items-center gap-1 text-white/80 text-xs">
              <Clock size={10} className="flex-shrink-0" />{b.time}
            </span>
          )}
          {b.days?.map(d => (
            <span key={d} className="text-[10px] bg-white/25 text-white px-1.5 py-0.5 rounded font-bold">{d}</span>
          ))}
        </div>
        {b.ground && <p className="text-white/50 text-[10px] mt-1 truncate">{b.ground}</p>}
      </div>

      {/* Card body */}
      <div className="px-4 py-3 cursor-pointer" onClick={() => onSelect(b)}>
        {/* Capacity bar */}
        <div className="mb-2.5">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">{enrolled} / {b.capacity} students</span>
            <span className="font-bold" style={{ color: barColor }}>{pct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </div>

        {/* Status badges + age */}
        <div className="flex items-center gap-2 mb-3">
          {isFull && <span className="badge badge-red text-[10px]">Full</span>}
          {!isFull && b.waitlist > 0 && <span className="badge badge-yellow text-[10px]">{b.waitlist} waitlist</span>}
          {(b.ageMin > 0 || b.ageMax < 99) && (
            <span className="text-[11px] text-gray-400">Ages {b.ageMin}–{b.ageMax} yrs</span>
          )}
        </div>

        {/* Coach footer */}
        <div className="flex items-center justify-between pt-2.5 border-t border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {coachStaff?.photoUrl ? (
              <img src={coachStaff.photoUrl} alt={b.coach}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0 border-2 border-white shadow-sm" />
            ) : (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white flex-shrink-0 shadow-sm"
                style={{ background: hex }}>
                {(b.coach || 'U')[0]}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-700 truncate">{b.coach || 'Unassigned'}</p>
              <p className="text-[10px] text-gray-400">Coach</p>
            </div>
          </div>
          <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
        </div>
      </div>
    </div>
  )
}

const ALL_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function AddBatchModal({ onClose, onSave, staff, initialData }) {
  const { selectedSport } = useApp()
  const isEdit = !!initialData
  const defaultSports = initialData?.sports ?? (selectedSport && selectedSport !== 'All' ? [selectedSport] : [])
  const [form, setForm] = useState({
    name:        initialData?.name        || '',
    code:        initialData?.code        || '',
    startTime:   initialData?.startTime   || '',
    endTime:     initialData?.endTime     || '',
    sports:      defaultSports,
    coach:       initialData?.coach       || staff[0]?.name || '',
    capacity:    initialData?.capacity    || 20,
    days:        initialData?.days        || [],
    ageMin:      initialData?.ageMin      ?? 0,
    ageMax:      initialData?.ageMax      ?? 99,
    ground:      initialData?.ground      || '',
    defaultFee:  initialData?.defaultFee  || 0,
    defaultPlan: initialData?.defaultPlan || 'monthly',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleSport = (sport) => setForm(f => ({
    ...f,
    sports: f.sports.includes(sport) ? f.sports.filter(s => s !== sport) : [...f.sports, sport],
  }))

  const toggleDay = (day) => setForm(f => ({
    ...f,
    days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
  }))

  return (
    <Modal title={isEdit ? `Edit Batch — ${initialData.name}` : 'Create New Batch'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Batch Name *</label>
            <input className="input" placeholder="e.g. Morning Cricket U20" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Batch Code <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input font-mono" placeholder="e.g. u20-eve" value={form.code}
              onChange={e => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start Time</label>
            <input className="input" type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
          </div>
          <div>
            <label className="label">End Time</label>
            <input className="input" type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Ground / Venue <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" placeholder="e.g. Ground A, Court 1, Indoor Hall"
            value={form.ground} onChange={e => set('ground', e.target.value)} />
        </div>
        <div>
          <label className="label">Batch Days</label>
          <div className="flex flex-wrap gap-2">
            {ALL_DAYS.map(d => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  form.days.includes(d) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Sports</label>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map(s => (
              <button key={s} type="button" onClick={() => toggleSport(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  form.sports.includes(s) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>{s}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Age Min</label>
            <input className="input" type="number" min={0} value={form.ageMin} onChange={e => set('ageMin', e.target.value)} />
          </div>
          <div>
            <label className="label">Age Max</label>
            <input className="input" type="number" min={0} value={form.ageMax} onChange={e => set('ageMax', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Assigned Coach</label>
          <select className="input" value={form.coach} onChange={e => set('coach', e.target.value)}>
            {staff.filter(s => s.role !== 'Admin').map(s => <option key={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Maximum Capacity</label>
          <input className="input" type="number" min={1} value={form.capacity} onChange={e => set('capacity', Number(e.target.value))} />
        </div>

      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>
          {isEdit ? 'Save Changes' : 'Create Batch'}
        </button>
      </div>
    </Modal>
  )
}

function BatchDetailPanel({ batch: b, students, staff, onClose, onEdit, onDelete, onAssignCoach, onEnrolledChange }) {
  const { user } = useApp()
  const [mbEnrolments, setMbEnrolments] = useState([])
  const [assignSearch, setAssignSearch] = useState('')
  const [assigning, setAssigning] = useState(null)
  const [unassigning, setUnassigning] = useState(null)
  const [editCoach, setEditCoach] = useState(false)
  const [newCoach, setNewCoach] = useState(b.coach || '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [posEditId, setPosEditId]   = useState(null)  // student id being position-edited
  const [posInput,  setPosInput]    = useState('')
  const [posSaving, setPosSaving]   = useState(false)
  // local position overrides: { [studentId]: positionString }
  const [localPositions, setLocalPositions] = useState({})

  const openPosEdit = (s) => { setPosEditId(s.id); setPosInput(localPositions[s.id] ?? s.position ?? '') }
  const closePosEdit = () => { setPosEditId(null); setPosInput('') }
  const savePosition = async (studentId) => {
    setPosSaving(true)
    try {
      await updateStudentPosition(studentId, posInput || null)
      setLocalPositions(prev => ({ ...prev, [studentId]: posInput || null }))
      closePosEdit()
    } catch {}
    setPosSaving(false)
  }
  const coaches = staff.filter(s => s.role !== 'Admin')
  const pct = Math.round((b.enrolled / b.capacity) * 100)

  useEffect(() => {
    fetchBatchEnrolments(b.id).then(rows => setMbEnrolments(rows)).catch(() => {})
  }, [b.id])

  const primaryEnrolled = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
  const primaryIds = useMemo(() => new Set(primaryEnrolled.map(s => s.id)), [primaryEnrolled])
  const mbStudentIds = useMemo(() => new Set(mbEnrolments.map(e => e.student_id)), [mbEnrolments])
  const mbOnly = students.filter(s => mbStudentIds.has(s.id) && !primaryIds.has(s.id) && s.status === 'Active')
  const allEnrolled = [...primaryEnrolled, ...mbOnly]
  const enrolledIds = useMemo(() => new Set(allEnrolled.map(s => s.id)), [allEnrolled])

  const nameMatch = (s) => s.name.toLowerCase().includes(assignSearch.toLowerCase())
  const isAlternateBlocked = (s) => s.trainingType === 'Alternate' && !!s.batchId

  const searchResults = assignSearch.trim().length >= 2
    ? students
        .filter(s => s.status === 'Active' && !enrolledIds.has(s.id) && nameMatch(s))
        .slice(0, 8)
    : []

  const handleAssign = async (student) => {
    if (isAlternateBlocked(student)) return
    setAssigning(student.id)
    try {
      await assignStudentToBatch(student.id, b.id, b.name, user?.academyId)
      setMbEnrolments(prev => [...prev, { student_id: student.id, batch_id: b.id }])
      onEnrolledChange?.(b.id, 1)
      logAudit({ actor: user, action: ACTIONS.BATCH_ASSIGN, entityType: 'batch', entityId: b.id, entityName: b.name, changes: { student: student.name }, academyId: user?.academyId })
      setAssignSearch('')
    } finally {
      setAssigning(null)
    }
  }

  const handleUnassign = async (studentId) => {
    setUnassigning(studentId)
    try {
      await unassignStudentFromBatch(studentId, b.id)
      setMbEnrolments(prev => prev.filter(e => e.student_id !== studentId))
      onEnrolledChange?.(b.id, -1)
      const removedS = students.find(s => s.id === studentId)
      logAudit({ actor: user, action: ACTIONS.BATCH_UNASSIGN, entityType: 'batch', entityId: b.id, entityName: b.name, changes: { student: removedS?.name || String(studentId) }, academyId: user?.academyId })
    } finally {
      setUnassigning(null)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try { await onDelete() } finally { setDeleting(false) }
  }

  const handleSaveCoach = async () => {
    setSaving(true)
    await onAssignCoach(b.id, newCoach)
    setSaving(false)
    setEditCoach(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-lg shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-5 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-8">
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-xs font-semibold">
                <Pencil size={12} /> Edit
              </button>
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 transition text-white text-xs font-semibold">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-white">{b.name}</h2>
            {b.code && <span className="font-mono text-xs text-brand-300 bg-white/10 px-2 py-0.5 rounded">{b.code}</span>}
          </div>
          <p className="text-brand-200 text-sm">{b.time}</p>
          {b.ground && (
            <p className="text-brand-300 text-xs mt-0.5 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              {b.ground}
            </p>
          )}
          {b.days?.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {b.days.map(d => <span key={d} className="text-[10px] bg-white/15 text-white px-2 py-0.5 rounded-full font-semibold">{d}</span>)}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{allEnrolled.length}</p>
              <p className="text-[10px] text-brand-200">Enrolled</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{b.capacity - b.enrolled}</p>
              <p className="text-[10px] text-brand-200">Seats Left</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{pct}%</p>
              <p className="text-[10px] text-brand-200">Filled</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sports */}
          {b.sports?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {b.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
            </div>
          )}

          {/* Coach */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assigned Coach</p>
              <button onClick={() => setEditCoach(e => !e)} className="text-xs text-brand-600 font-semibold hover:underline">
                {editCoach ? 'Cancel' : 'Change'}
              </button>
            </div>
            {editCoach ? (
              <div className="flex gap-2">
                <select className="input flex-1 text-xs" value={newCoach} onChange={e => setNewCoach(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {coaches.map(c => <option key={c.id} value={c.name}>{c.name} ({c.role})</option>)}
                </select>
                <button onClick={handleSaveCoach} disabled={saving} className="btn-primary text-xs px-3 py-2">
                  {saving ? '…' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-bold text-gray-600">
                  {(b.coach || 'U')[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{b.coach || 'Unassigned'}</p>
                  <p className="text-xs text-gray-400">Head Coach</p>
                </div>
              </div>
            )}
          </div>

          {/* Assign Student */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus size={14} className="text-brand-600" />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assign Student</p>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8 text-sm"
                placeholder="Type name to search…"
                value={assignSearch}
                onChange={e => setAssignSearch(e.target.value)}
              />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map(s => {
                  const blocked = isAlternateBlocked(s)
                  return (
                    <div key={s.id} className={`flex items-center gap-3 px-2 py-1.5 rounded-xl transition ${blocked ? 'opacity-50' : 'hover:bg-gray-50'}`}>
                      <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400">{s.sport} · {s.batch || 'No primary batch'}</p>
                      </div>
                      {blocked ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg flex-shrink-0 whitespace-nowrap">
                          Alternate — 1 batch only
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAssign(s)}
                          disabled={assigning === s.id}
                          className="text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                        >
                          {assigning === s.id ? '…' : 'Assign'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {assignSearch.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">No students found</p>
            )}
          </div>

          {/* Student list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Enrolled Students ({allEnrolled.length})
            </p>
            {allEnrolled.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No active students in this batch</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {allEnrolled.map((s, i) => {
                  const canUnassign = mbStudentIds.has(s.id)
                  const pos = localPositions[s.id] !== undefined ? localPositions[s.id] : s.position
                  const preset = pos ? FOOTBALL_POSITIONS.find(p => p.id === pos) : null
                  const posCol = preset ? POSITION_COLORS[preset.id] : null
                  return (
                    <div key={s.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      {/* Main row */}
                      <div className="flex items-center gap-3 px-2 py-2">
                        <span className="text-xs text-gray-400 w-5 flex-shrink-0">{i + 1}</span>
                        <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={32} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                            {!primaryIds.has(s.id) && (
                              <span className="text-[9px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full flex-shrink-0">Multi</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">{s.sport} · {s.age} yrs</p>
                        </div>
                        {/* Position chip / button */}
                        <button
                          onClick={() => posEditId === s.id ? closePosEdit() : openPosEdit(s)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition flex-shrink-0 ${
                            pos
                              ? posCol
                                ? `${posCol.bg} ${posCol.text} border-current`
                                : 'bg-gray-100 text-gray-600 border-gray-200'
                              : 'bg-gray-50 text-gray-400 border-dashed border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {pos || '+ Pos'}
                        </button>
                        {canUnassign ? (
                          <button
                            onClick={() => handleUnassign(s.id)}
                            disabled={unassigning === s.id}
                            className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition disabled:opacity-40 flex-shrink-0"
                          >
                            {unassigning === s.id ? '…' : 'Remove'}
                          </button>
                        ) : (
                          <span className="badge badge-green text-[10px] flex-shrink-0">Primary</span>
                        )}
                      </div>
                      {/* Inline position editor */}
                      {posEditId === s.id && (
                        <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
                          <input
                            className="input text-xs py-1.5 mb-2"
                            placeholder="Type position or pick below…"
                            value={posInput}
                            onChange={e => setPosInput(e.target.value)}
                            maxLength={40}
                            autoFocus
                          />
                          <div className="flex flex-wrap gap-1 mb-2">
                            {FOOTBALL_POSITIONS.map(p => {
                              const c = POSITION_COLORS[p.id]
                              const active = posInput === p.id
                              return (
                                <button key={p.id} type="button"
                                  onClick={() => setPosInput(active ? '' : p.id)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition ${
                                    active ? `${c.bg} ${c.text} border-current` : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-100'
                                  }`}>
                                  {p.id}
                                </button>
                              )
                            })}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => savePosition(s.id)}
                              disabled={posSaving}
                              className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"
                            >
                              {posSaving ? '…' : 'Save'}
                            </button>
                            <button onClick={closePosEdit} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Delete trigger button — always visible at bottom of panel */}
          {!confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-red-200 text-red-600 text-sm font-bold hover:bg-red-50 active:bg-red-100 transition"
            >
              <Trash2 size={15} /> Delete Batch
            </button>
          )}

          {/* Delete confirmation */}
          {confirmDelete && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={16} className="text-red-600" />
                <p className="text-sm font-bold text-red-800">Delete "{b.name}"?</p>
              </div>
              {allEnrolled.length > 0 && (
                <p className="text-xs text-red-600 mb-3">
                  ⚠ This batch has {allEnrolled.length} active student{allEnrolled.length > 1 ? 's' : ''}. Move them to another batch first, or they will lose their batch assignment.
                </p>
              )}
              <p className="text-xs text-red-600 mb-4">This cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Yes, Delete Batch'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
