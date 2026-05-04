import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { UserCog, Plus, Phone, IndianRupee, Award, X, Layers, CheckCircle, ChevronRight } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'

const ROLES = ['Head Coach', 'Coach', 'Trainer', 'Dance Trainer', 'Admin', 'Support Staff']

export default function Staff() {
  const { staff, addStaffMember, batches, updateBatchCoach } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [profile, setProfile] = useState(null)

  const totalSalary  = staff.reduce((s, m) => s + m.salary, 0)
  const avgAttendance = staff.length ? Math.round(staff.reduce((s, m) => s + m.attendance, 0) / staff.length) : 0

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Staff & Coaches</h2>
          <p className="text-sm text-gray-500">{staff.filter(s => s.status === 'Active').length} active members</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Staff
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{staff.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Staff</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">{staff.filter(s => s.status === 'Active').length}</p>
          <p className="text-xs text-gray-500 mt-1">Active</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-emerald-600">{avgAttendance}%</p>
          <p className="text-xs text-gray-500 mt-1">Avg Attendance</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-purple-600">₹{(totalSalary / 1000).toFixed(0)}k</p>
          <p className="text-xs text-gray-500 mt-1">Monthly Payroll</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map(s => {
          const assignedBatches = batches.filter(b => b.coach === s.name)
          return (
            <div key={s.id} className="card p-5 hover:shadow-md transition">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-700 rounded-2xl flex items-center justify-center text-white text-lg font-black flex-shrink-0">
                  {s.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{s.name}</h3>
                  <p className="text-xs text-gray-500">{s.role}</p>
                  <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'} mt-1`}>{s.status}</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone size={13} className="text-gray-400 flex-shrink-0" />
                  {s.phone}
                </div>
                {s.sports?.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Award size={13} className="text-gray-400 flex-shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {s.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <IndianRupee size={13} className="text-gray-400 flex-shrink-0" />
                  ₹{s.salary.toLocaleString('en-IN')} / month
                </div>
                {assignedBatches.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Layers size={13} className="text-gray-400 flex-shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {assignedBatches.map(b => (
                        <span key={b.id} className="text-[10px] bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-semibold">{b.name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Monthly Attendance</span>
                  <span className="font-bold text-gray-700">{s.attendance}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${s.attendance >= 95 ? 'bg-emerald-500' : s.attendance >= 85 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${s.attendance}%` }}
                  />
                </div>
              </div>

              <button
                onClick={() => setProfile(s)}
                className="w-full mt-4 btn-secondary text-xs justify-center py-2 gap-2"
              >
                View Profile & Assign Batch <ChevronRight size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {showModal && (
        <AddStaffModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addStaffMember(data); setShowModal(false) }}
        />
      )}

      {profile && (
        <StaffProfilePanel
          member={profile}
          batches={batches}
          onClose={() => setProfile(null)}
          onAssign={async (batchId) => {
            await updateBatchCoach(batchId, profile.name)
          }}
          onUnassign={async (batchId) => {
            await updateBatchCoach(batchId, '')
          }}
        />
      )}
    </div>
  )
}

function StaffProfilePanel({ member: s, batches, onClose, onAssign, onUnassign }) {
  const assignedBatches   = batches.filter(b => b.coach === s.name)
  const unassignedBatches = batches.filter(b => b.coach !== s.name)
  const [assigning, setAssigning] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAssign = async () => {
    if (!selectedBatch) return
    setSaving(true)
    await onAssign(Number(selectedBatch))
    setSaving(false)
    setAssigning(false)
    setSelectedBatch('')
  }

  const handleUnassign = async (batchId) => {
    await onUnassign(batchId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 px-6 pt-6 pb-8">
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-2xl font-black text-white">
              {s.name[0]}
            </div>
            <div>
              <h2 className="text-xl font-black text-white">{s.name}</h2>
              <p className="text-gray-300 text-sm">{s.role}</p>
              <p className="text-gray-400 text-xs mt-0.5">{s.phone}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-white/10 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{assignedBatches.length}</p>
              <p className="text-[10px] text-gray-400">Batches</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{s.attendance}%</p>
              <p className="text-[10px] text-gray-400">Attendance</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">₹{(s.salary / 1000).toFixed(0)}k</p>
              <p className="text-[10px] text-gray-400">Salary</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sports */}
          {s.sports?.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Sports / Expertise</p>
              <div className="flex flex-wrap gap-2">
                {s.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
              </div>
            </div>
          )}

          {/* Assigned Batches */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assigned Batches</p>
              {unassignedBatches.length > 0 && (
                <button
                  onClick={() => setAssigning(a => !a)}
                  className="text-xs text-brand-600 font-semibold hover:underline"
                >
                  + Assign Batch
                </button>
              )}
            </div>

            {assigning && (
              <div className="flex gap-2 mb-3">
                <select
                  className="input flex-1 text-xs"
                  value={selectedBatch}
                  onChange={e => setSelectedBatch(e.target.value)}
                >
                  <option value="">— Select batch —</option>
                  {unassignedBatches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.time})</option>
                  ))}
                </select>
                <button
                  onClick={handleAssign}
                  disabled={!selectedBatch || saving}
                  className="btn-primary text-xs px-3 py-2"
                >
                  {saving ? '…' : 'Assign'}
                </button>
              </div>
            )}

            {assignedBatches.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No batches assigned yet</p>
            ) : (
              <div className="space-y-2">
                {assignedBatches.map(b => (
                  <div key={b.id} className="flex items-center justify-between bg-brand-50 rounded-xl px-3 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-brand-700">{b.name}</p>
                      <p className="text-xs text-brand-500">{b.time} · {b.enrolled}/{b.capacity} students</p>
                    </div>
                    <button
                      onClick={() => handleUnassign(b.id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 transition"
                      title="Remove assignment"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Personal Info */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Details</p>
            <div className="space-y-2.5">
              {[
                ['Join Date', s.joinDate ? new Date(s.joinDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
                ['Monthly Salary', `₹${s.salary.toLocaleString('en-IN')}`],
                ['Role', s.role],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                  <span className="text-xs text-gray-400">{label}</span>
                  <span className="text-xs font-semibold text-gray-800">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddStaffModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', role: ROLES[1], phone: '', sports: [], salary: 25000,
    joinDate: new Date().toISOString().split('T')[0], status: 'Active',
  })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleSport = (sp) => setForm(f => ({
    ...f,
    sports: f.sports.includes(sp) ? f.sports.filter(s => s !== sp) : [...f.sports, sp],
  }))

  const handleSave = async () => {
    if (!form.name) return
    setLoading(true)
    try { await onSave(form) } finally { setLoading(false) }
  }

  return (
    <Modal title="Add Staff Member" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Full Name *</label>
          <input className="input" placeholder="Staff name" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" placeholder="Mobile number" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Sports / Expertise</label>
          <div className="flex flex-wrap gap-2">
            {SPORTS.map(sp => (
              <button key={sp} type="button" onClick={() => toggleSport(sp)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  form.sports.includes(sp) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>{sp}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Monthly Salary (₹)</label>
          <input className="input" type="number" value={form.salary} onChange={e => set('salary', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Join Date</label>
          <input className="input" type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>
          {loading ? '…' : 'Add Staff Member'}
        </button>
      </div>
    </Modal>
  )
}
