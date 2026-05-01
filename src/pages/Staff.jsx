import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { UserCog, Plus, Phone, IndianRupee, Award, CheckCircle } from 'lucide-react'
import { Modal } from './Students'

const ROLES = ['Head Coach', 'Coach', 'Trainer', 'Dance Trainer', 'Admin', 'Support Staff']

export default function Staff() {
  const { staff, addStaffMember } = useApp()
  const [showModal, setShowModal] = useState(false)

  const totalSalary = staff.reduce((s, m) => s + m.salary, 0)
  const avgAttendance = Math.round(staff.reduce((s, m) => s + m.attendance, 0) / staff.length)

  return (
    <div className="space-y-5 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Staff & Coaches</h2>
          <p className="text-sm text-gray-500">{staff.filter(s=>s.status==='Active').length} active members</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Staff
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{staff.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Staff</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">{staff.filter(s=>s.status==='Active').length}</p>
          <p className="text-xs text-gray-500 mt-1">Active</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-emerald-600">{avgAttendance}%</p>
          <p className="text-xs text-gray-500 mt-1">Avg Attendance</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-purple-600">₹{(totalSalary/1000).toFixed(0)}k</p>
          <p className="text-xs text-gray-500 mt-1">Monthly Payroll</p>
        </div>
      </div>

      {/* Staff cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map(s => (
          <div key={s.id} className="card p-5 hover:shadow-md transition">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-700 rounded-2xl flex items-center justify-center text-white text-lg font-black flex-shrink-0">
                {s.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 truncate">{s.name}</h3>
                <p className="text-xs text-gray-500">{s.role}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone size={13} className="text-gray-400 flex-shrink-0" />
                {s.phone}
              </div>
              {s.sports.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
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
            </div>

            {/* Attendance bar */}
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

            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1 text-xs justify-center py-2">View Details</button>
              <button className="btn-secondary flex-1 text-xs justify-center py-2">Pay Salary</button>
            </div>
          </div>
        ))}
      </div>

      {showModal && <AddStaffModal onClose={() => setShowModal(false)} onSave={addStaffMember} />}
    </div>
  )
}

function AddStaffModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', role: ROLES[1], phone: '', sports: [], salary: 25000,
    joinDate: new Date().toISOString().split('T')[0], status: 'Active',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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
        <button className="btn-primary" onClick={() => { onSave(form); onClose() }}>Add Staff</button>
      </div>
    </Modal>
  )
}
