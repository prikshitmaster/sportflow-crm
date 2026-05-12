import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { Layers, Plus, Users, Clock, UserCog, AlertCircle, X, ChevronRight, Pencil } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'

const COLORS = ['bg-brand-600', 'bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-rose-600']

export default function Batches() {
  const { batches, addBatch, updateBatch, staff, students, updateBatchCoach, branches } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [editingBatch, setEditingBatch] = useState(null)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [activeBranch, setActiveBranch] = useState('All')

  // Derive branch list from batch sports (sorted), regardless of DB branches
  const branchList = useMemo(() => {
    const set = new Set()
    batches.forEach(b => b.sports?.forEach(s => set.add(s)))
    return [...set].sort()
  }, [batches])

  // Grouped sections — always available when batches have sports
  const grouped = useMemo(() => {
    if (branchList.length === 0) return null
    return branchList.map(br => ({
      branch: br,
      batches: batches.filter(b => b.sports?.includes(br)),
    }))
  }, [branchList, batches])

  // Active branch filter (used only when clicking a pill to scroll/jump is not needed — kept for stats)
  const visibleBatches = activeBranch === 'All'
    ? batches
    : batches.filter(b => b.sports?.includes(activeBranch))

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
    <div className="space-y-5 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Batch Management</h2>
          <p className="text-sm text-gray-500">Manage morning, evening and weekend batches</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Create Batch
        </button>
      </div>

      {/* Branch jump pills */}
      {branchList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setActiveBranch('All')}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition ${activeBranch === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            All <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === 'All' ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.length}</span>
          </button>
          {branchList.map(br => (
            <button
              key={br}
              onClick={() => setActiveBranch(br)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition ${activeBranch === br ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {br} <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === br ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.filter(b => b.sports?.includes(br)).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Summary row — scoped to active branch */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{visibleBatches.length}</p>
          <p className="text-xs text-gray-500 mt-1">Active Batches</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">{visibleBatches.reduce((s,b) => s+b.enrolled, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Enrolled</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-amber-600">{visibleBatches.reduce((s,b) => s+b.waitlist, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">On Waitlist</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-400">{visibleBatches.reduce((s,b) => s+(b.capacity-b.enrolled), 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Available Seats</p>
        </div>
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
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {branchBatches.map((b, idx) => (
                  <BatchCard key={b.id} b={b} idx={idx} onSelect={setSelectedBatch} />
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleBatches.map((b, idx) => (
            <BatchCard key={b.id} b={b} idx={idx} onSelect={setSelectedBatch} />
          ))}
        </div>
      )}

      {/* Fallback flat grid when no branches configured */}
      {!grouped && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {batches.map((b, idx) => <BatchCard key={b.id} b={b} idx={idx} onSelect={setSelectedBatch} />)}
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
          batch={selectedBatch}
          students={students}
          staff={staff}
          onClose={() => setSelectedBatch(null)}
          onEdit={() => { setEditingBatch(selectedBatch); setSelectedBatch(null) }}
          onAssignCoach={async (id, name) => {
            await updateBatchCoach(id, name)
            setSelectedBatch(prev => ({ ...prev, coach: name }))
          }}
        />
      )}
    </div>
  )
}

function BatchCard({ b, idx, onSelect }) {
  const pct = Math.round((b.enrolled / b.capacity) * 100)
  const isFull = b.enrolled >= b.capacity
  return (
    <div className="card p-5 hover:shadow-md transition">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className={`inline-flex items-center gap-1.5 text-xs font-bold text-white px-2.5 py-1 rounded-full mb-2 ${COLORS[idx % COLORS.length]}`}>
            <Layers size={11} /> {b.name}
          </div>
          {b.code && (
            <div className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded mb-1 inline-block">{b.code}</div>
          )}
          <div className="flex items-center gap-1.5 text-gray-500 text-xs">
            <Clock size={12} /> {b.time}
          </div>
          {b.ground && (
            <div className="flex items-center gap-1.5 text-gray-400 text-xs mt-0.5">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              {b.ground}
            </div>
          )}
          {b.days?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {b.days.map(d => <span key={d} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-semibold">{d}</span>)}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {isFull && <span className="badge badge-red">Full</span>}
          {b.waitlist > 0 && !isFull && <span className="badge badge-yellow">{b.waitlist} waiting</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {b.sports.map(s => <span key={s} className="badge badge-blue">{s}</span>)}
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Capacity</span>
          <span className="font-bold text-gray-700">{b.enrolled} / {b.capacity}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div className={`h-2 rounded-full transition-all ${isFull ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-1">{pct}% full · {b.capacity - b.enrolled} seats left</p>
      </div>

      {(b.ageMin > 0 || b.ageMax < 99) && (
        <p className="text-xs text-gray-400 mb-3">Ages {b.ageMin}–{b.ageMax} yrs</p>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
        <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
          {(b.coach || 'C')[0]}
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-gray-700">{b.coach || 'Unassigned'}</p>
          <p className="text-xs text-gray-400">Assigned Coach</p>
        </div>
      </div>

      <button onClick={() => onSelect(b)} className="w-full mt-4 btn-secondary text-xs justify-center py-2 gap-2">
        View Details <ChevronRight size={12} />
      </button>
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

        {/* Default Fee Plan */}
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Default Fee Plan</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Default Fee (₹/month)</label>
              <input className="input" type="number" min={0} placeholder="e.g. 2500"
                value={form.defaultFee}
                onChange={e => set('defaultFee', Number(e.target.value))} />
              <p className="text-[11px] text-gray-400 mt-1">Auto-fills when adding a student</p>
            </div>
            <div>
              <label className="label">Training Type</label>
              <select className="input" value={form.defaultPlan} onChange={e => set('defaultPlan', e.target.value)}>
                <option value="daily">Daily</option>
                <option value="alternate">Alternate Day</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
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

function BatchDetailPanel({ batch: b, students, staff, onClose, onEdit, onAssignCoach }) {
  const enrolled = students.filter(s => s.status === 'Active' && s.batch === b.name)
  const [editCoach, setEditCoach] = useState(false)
  const [newCoach, setNewCoach] = useState(b.coach || '')
  const [saving, setSaving] = useState(false)
  const coaches = staff.filter(s => s.role !== 'Admin')
  const pct = Math.round((b.enrolled / b.capacity) * 100)

  const handleSaveCoach = async () => {
    setSaving(true)
    await onAssignCoach(b.id, newCoach)
    setSaving(false)
    setEditCoach(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-6 pt-6 pb-8">
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-xs font-semibold">
              <Pencil size={12} /> Edit Batch
            </button>
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
              <p className="text-lg font-black text-white">{enrolled.length}</p>
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

          {/* Student list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Enrolled Students ({enrolled.length})
            </p>
            {enrolled.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No active students in this batch</p>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto">
                {enrolled.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                    <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-xs font-bold text-brand-700">
                      {s.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.sport} · {s.age} yrs</p>
                    </div>
                    <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'} text-[10px]`}>{s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
