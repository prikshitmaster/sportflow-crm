import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Plus, X, Trophy, Calendar, MapPin, Tag, CheckCircle, Clock, XCircle, Trash2 } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'

const EVENT_TYPES = ['Tournament', 'Match', 'Training Camp', 'Workshop', 'Holiday', 'Meeting', 'Other']
const STATUS_OPTIONS = ['Upcoming', 'Ongoing', 'Completed', 'Cancelled']

const STATUS_STYLE = {
  Upcoming:  { badge: 'badge-blue',   icon: Clock },
  Ongoing:   { badge: 'badge-green',  icon: CheckCircle },
  Completed: { badge: 'badge-gray',   icon: CheckCircle },
  Cancelled: { badge: 'badge-red',    icon: XCircle },
}

const TYPE_COLOR = {
  Tournament:      'bg-amber-100 text-amber-700',
  Match:           'bg-blue-100 text-blue-700',
  'Training Camp': 'bg-emerald-100 text-emerald-700',
  Workshop:        'bg-purple-100 text-purple-700',
  Holiday:         'bg-red-100 text-red-700',
  Meeting:         'bg-gray-100 text-gray-700',
  Other:           'bg-gray-100 text-gray-600',
}

export default function Events() {
  const { events, addEvent, updateEventStatus, removeEvent } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState('All')

  const today = new Date().toISOString().split('T')[0]

  const filtered = filter === 'All' ? events : events.filter(e => e.status === filter)

  const upcoming  = events.filter(e => e.date >= today && e.status === 'Upcoming').length
  const completed = events.filter(e => e.status === 'Completed').length
  const thisMonth = events.filter(e => e.date?.startsWith(today.slice(0, 7))).length

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Events & Tournaments</h2>
          <p className="text-sm text-gray-500">Matches, tournaments, camps and academy events</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Event
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">{upcoming}</p>
          <p className="text-xs text-gray-500 mt-1">Upcoming</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-amber-600">{thisMonth}</p>
          <p className="text-xs text-gray-500 mt-1">This Month</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-emerald-600">{completed}</p>
          <p className="text-xs text-gray-500 mt-1">Completed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-700">{events.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Events</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['All', 'Upcoming', 'Ongoing', 'Completed', 'Cancelled'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Events list */}
      {filtered.length === 0 ? (
        <div className="card py-16 text-center">
          <Trophy size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-400 text-sm">No events found</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mt-4 mx-auto">Add First Event</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(e => {
            const ss = STATUS_STYLE[e.status] || STATUS_STYLE.Upcoming
            const StatusIcon = ss.icon
            const isPast = e.date < today
            return (
              <div key={e.id} className={`card p-5 hover:shadow-md transition ${isPast && e.status === 'Upcoming' ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TYPE_COLOR[e.type] || TYPE_COLOR.Other}`}>
                    {e.type}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${ss.badge}`}>{e.status}</span>
                    <button
                      onClick={() => removeEvent(e.id)}
                      className="p-1 rounded text-gray-300 hover:text-red-500 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <h3 className="font-black text-gray-900 text-base mb-2 leading-tight">{e.title}</h3>

                <div className="space-y-1.5 mb-4">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Calendar size={12} />
                    {new Date(e.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    {e.end_date && e.end_date !== e.date && (
                      <span> → {new Date(e.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    )}
                  </div>
                  {e.venue && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin size={12} /> {e.venue}
                    </div>
                  )}
                  {e.sport && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Tag size={12} /> {e.sport}
                    </div>
                  )}
                </div>

                {e.description && (
                  <p className="text-xs text-gray-400 mb-4 line-clamp-2">{e.description}</p>
                )}

                {/* Status actions */}
                {e.status === 'Upcoming' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateEventStatus(e.id, 'Ongoing')}
                      className="flex-1 text-xs py-2 rounded-lg bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 transition"
                    >
                      Mark Ongoing
                    </button>
                    <button
                      onClick={() => updateEventStatus(e.id, 'Cancelled')}
                      className="flex-1 text-xs py-2 rounded-lg bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {e.status === 'Ongoing' && (
                  <button
                    onClick={() => updateEventStatus(e.id, 'Completed')}
                    className="w-full text-xs py-2 rounded-lg bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition"
                  >
                    Mark Completed
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <AddEventModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addEvent(data); setShowModal(false) }}
        />
      )}
    </div>
  )
}

function AddEventModal({ onClose, onSave }) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    title: '', type: EVENT_TYPES[0], sport: '', date: today,
    endDate: '', venue: '', description: '', status: 'Upcoming',
  })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.title || !form.date) return
    setLoading(true)
    try { await onSave(form) } finally { setLoading(false) }
  }

  return (
    <Modal title="Add Event / Tournament" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Event Title *</label>
          <input className="input" placeholder="e.g. Inter-Academy Football Tournament" value={form.title} onChange={e => set('title', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
              {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Sport</label>
            <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
              <option value="">All Sports</option>
              {SPORTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start Date *</label>
            <input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input className="input" type="date" value={form.endDate} min={form.date} onChange={e => set('endDate', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Venue</label>
          <input className="input" placeholder="Stadium / Ground name" value={form.venue} onChange={e => set('venue', e.target.value)} />
        </div>
        <div>
          <label className="label">Description / Notes</label>
          <textarea className="input" rows={2} placeholder="Details, instructions, results..." value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading || !form.title}>
          {loading ? '…' : 'Add Event'}
        </button>
      </div>
    </Modal>
  )
}
