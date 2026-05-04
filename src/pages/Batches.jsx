import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Layers, Plus, Users, Clock, UserCog, AlertCircle } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'

const COLORS = ['bg-brand-600', 'bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-rose-600']

export default function Batches() {
  const { batches, addBatch, staff } = useApp()
  const [showModal, setShowModal] = useState(false)

  const handleAdd = async (b) => {
    await addBatch(b)
    setShowModal(false)
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

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{batches.length}</p>
          <p className="text-xs text-gray-500 mt-1">Active Batches</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">{batches.reduce((s,b) => s+b.enrolled, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Enrolled</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-amber-600">{batches.reduce((s,b) => s+b.waitlist, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">On Waitlist</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-400">{batches.reduce((s,b) => s+(b.capacity-b.enrolled), 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Available Seats</p>
        </div>
      </div>

      {/* Batch cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {batches.map((b, idx) => {
          const pct = Math.round((b.enrolled / b.capacity) * 100)
          const isFull = b.enrolled >= b.capacity
          return (
            <div key={b.id} className="card p-5 hover:shadow-md transition">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className={`inline-flex items-center gap-1.5 text-xs font-bold text-white px-2.5 py-1 rounded-full mb-2 ${COLORS[idx % COLORS.length]}`}>
                    <Layers size={11} /> {b.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs">
                    <Clock size={12} /> {b.time}
                  </div>
                  {b.days?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {b.days.map(d => (
                        <span key={d} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-semibold">{d}</span>
                      ))}
                    </div>
                  )}
                </div>
                {isFull && (
                  <span className="badge badge-red">Full</span>
                )}
                {b.waitlist > 0 && !isFull && (
                  <span className="badge badge-yellow">{b.waitlist} waiting</span>
                )}
              </div>

              {/* Sports tags */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {b.sports.map(s => (
                  <span key={s} className="badge badge-blue">{s}</span>
                ))}
              </div>

              {/* Capacity bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Capacity</span>
                  <span className="font-bold text-gray-700">{b.enrolled} / {b.capacity}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${isFull ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">{pct}% full · {b.capacity - b.enrolled} seats left</p>
              </div>

              {/* Age range */}
              {(b.ageMin > 0 || b.ageMax < 99) && (
                <p className="text-xs text-gray-400 mb-3">Ages {b.ageMin}–{b.ageMax} yrs</p>
              )}

              {/* Coach */}
              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
                  {(b.coach || 'C')[0]}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-700">{b.coach || 'Unassigned'}</p>
                  <p className="text-xs text-gray-400">Assigned Coach</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showModal && <AddBatchModal onClose={() => setShowModal(false)} onSave={handleAdd} staff={staff} />}
    </div>
  )
}

const ALL_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function AddBatchModal({ onClose, onSave, staff }) {
  const [form, setForm] = useState({
    name: '', startTime: '', endTime: '', sports: [], coach: staff[0]?.name || '',
    capacity: 20, days: [], ageMin: 0, ageMax: 99,
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
    <Modal title="Create New Batch" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Batch Name *</label>
          <input className="input" placeholder="e.g. Morning C" value={form.name} onChange={e => set('name', e.target.value)} />
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
        <button className="btn-primary" onClick={() => onSave(form)}>Create Batch</button>
      </div>
    </Modal>
  )
}
