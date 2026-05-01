import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, BATCH_NAMES } from '../data/mockData'
import { Search, Plus, MoreVertical, UserCheck, UserX, X, Users as UsersIcon } from 'lucide-react'

const statusColors = { Active: 'badge-green', Inactive: 'badge-gray' }

export default function Students() {
  const { students, addStudent, updateStudentStatus } = useApp()
  const [search, setSearch] = useState('')
  const [sportFilter, setSportFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [openMenu, setOpenMenu] = useState(null)

  const filtered = students.filter(s => {
    const q = search.toLowerCase()
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.parent.toLowerCase().includes(q) || s.phone.includes(q)
    const matchSport = sportFilter === 'All' || s.sport === sportFilter
    const matchStatus = statusFilter === 'All' || s.status === statusFilter
    return matchQ && matchSport && matchStatus
  })

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Students</h2>
          <p className="text-sm text-gray-500">{students.filter(s=>s.status==='Active').length} active · {students.length} total</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Student
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-48">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
            placeholder="Search by name, parent or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
          <option value="All">All Sports</option>
          {SPORTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <span className="text-xs text-gray-400 font-medium">{filtered.length} results</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Student', 'Parent / Phone', 'Age', 'Sport', 'Batch', 'Join Date', 'Monthly Fee', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60 transition group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                        {s.name[0]}
                      </div>
                      <span className="font-semibold text-gray-900">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700 font-medium">{s.parent}</p>
                    <p className="text-gray-400 text-xs">{s.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.age} yrs</td>
                  <td className="px-4 py-3">
                    <span className="badge badge-blue">{s.sport}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{s.batch}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(s.joinDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">₹{s.fees.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusColors[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 relative">
                    <button
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition opacity-0 group-hover:opacity-100"
                      onClick={() => setOpenMenu(openMenu === s.id ? null : s.id)}
                    >
                      <MoreVertical size={15} className="text-gray-500" />
                    </button>
                    {openMenu === s.id && (
                      <div className="absolute right-4 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-10 py-1 w-44">
                        <button
                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                          onClick={() => { updateStudentStatus(s.id, s.status === 'Active' ? 'Inactive' : 'Active'); setOpenMenu(null) }}
                        >
                          {s.status === 'Active' ? <><UserX size={14} /> Mark Inactive</> : <><UserCheck size={14} /> Mark Active</>}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <UsersIcon size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No students found</p>
            </div>
          )}
        </div>
      </div>

      {showModal && <AddStudentModal onClose={() => setShowModal(false)} onSave={addStudent} />}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}

function AddStudentModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', age: '', sport: SPORTS[0],
    batch: BATCH_NAMES[0], joinDate: new Date().toISOString().split('T')[0],
    status: 'Active', fees: 2500, paidTill: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name || !form.parent || !form.phone) return
    onSave(form)
    onClose()
  }

  return (
    <Modal title="Add New Student" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Student Name *</label>
          <input className="input" placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Name *</label>
          <input className="input" placeholder="Father / Mother name" value={form.parent} onChange={e => set('parent', e.target.value)} />
        </div>
        <div>
          <label className="label">Phone Number *</label>
          <input className="input" placeholder="10-digit mobile" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Age (years)</label>
          <input className="input" type="number" placeholder="12" value={form.age} onChange={e => set('age', e.target.value)} />
        </div>
        <div>
          <label className="label">Sport</label>
          <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
            {SPORTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Batch</label>
          <select className="input" value={form.batch} onChange={e => set('batch', e.target.value)}>
            {BATCH_NAMES.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Monthly Fee (₹)</label>
          <input className="input" type="number" value={form.fees} onChange={e => set('fees', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Join Date</label>
          <input className="input" type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>Add Student</button>
      </div>
    </Modal>
  )
}


export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
