import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { UserCog, Plus, Phone, IndianRupee, Award, X, Layers, CheckCircle, ChevronRight, CalendarDays, Hourglass, XCircle, ShieldCheck, Link2, Trash2, Pencil, Copy, Check, Camera, Smartphone, Monitor } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'
import { ALL_PERMISSIONS, ROLE_PRESETS, PERMISSION_GROUPS, PERM_LABEL, ACCESS_ROLES, ACCESS_ROLE_LABEL, ACCESS_ROLE_COLOR } from '../lib/permissions'
import * as db from '../lib/db'

const ROLES = ['Head Coach', 'Coach', 'Trainer', 'Dance Trainer', 'Admin', 'Support Staff']

export default function Staff() {
  const { staff, batches, updateBatchCoach, leaveRequests, loadLeaveRequests, updateLeave, role, user, demoMode, inviteStaff, updateStaffAccess, revokeStaffAccess, addStaffMember } = useApp()
  const [profile,    setProfile]    = useState(null)
  const [showModal,  setShowModal]  = useState(false)
  const [activeTab,  setActiveTab]  = useState('staff')  // 'staff' | 'leaves' | 'access'

  useEffect(() => { loadLeaveRequests?.() }, [])

  const pendingLeaves = (leaveRequests || []).filter(r => r.status === 'Pending').length

  const totalSalary   = staff.reduce((s, m) => s + m.salary, 0)
  const avgAttendance = staff.length ? Math.round(staff.reduce((s, m) => s + m.attendance, 0) / staff.length) : 0

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Staff & Coaches</h2>
          <p className="text-sm text-gray-500">{staff.filter(s => s.status === 'Active').length} active members</p>
        </div>
        {(role === 'owner' || role === 'admin') && activeTab === 'staff' && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} /> Add Staff
          </button>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setActiveTab('staff')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'staff' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <UserCog size={14} /> Staff
        </button>
        <button onClick={() => setActiveTab('leaves')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'leaves' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <CalendarDays size={14} /> Leave Requests
          {pendingLeaves > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingLeaves}</span>
          )}
        </button>
        {role === 'owner' && (
          <button onClick={() => setActiveTab('access')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'access' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <ShieldCheck size={14} /> Access
          </button>
        )}
      </div>

      {/* Leave requests panel */}
      {activeTab === 'leaves' && (
        <LeaveRequestsPanel leaveRequests={leaveRequests || []} onUpdate={updateLeave} />
      )}

      {/* Access management panel */}
      {activeTab === 'access' && (
        <AccessPanel
          staff={staff}
          user={user}
          demoMode={demoMode}
          inviteStaff={inviteStaff}
          updateStaffAccess={updateStaffAccess}
          revokeStaffAccess={revokeStaffAccess}
        />
      )}

      {/* Staff list — hidden when on leaves/access tab */}
      {activeTab === 'staff' && (
      <>
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
                {s.photoUrl ? (
                  <img src={s.photoUrl} alt={s.name} className="w-12 h-12 rounded-2xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-700 rounded-2xl flex items-center justify-center text-white text-lg font-black flex-shrink-0">
                    {s.name[0]}
                  </div>
                )}
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
      </>
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

      {showModal && (
        <AddStaffModal
          onClose={() => setShowModal(false)}
          onSave={async (form, photoFile, accessConfig) => {
            let photoUrl = null
            if (photoFile && !demoMode) {
              try { photoUrl = await db.uploadStaffPhoto(photoFile, form.name) } catch (_) {}
            }
            await addStaffMember({ ...form, photoUrl })
            if (accessConfig) {
              const link = await inviteStaff(form.name, accessConfig.accessRole, accessConfig.permissions)
              return link
            }
            setShowModal(false)
            return null
          }}
          demoMode={demoMode}
        />
      )}
    </div>
  )
}

// ── Owner-side Leave Requests Panel ──────────────────────────

function LeaveRequestsPanel({ leaveRequests, onUpdate }) {
  const [loading, setLoading] = useState(null) // id of request being processed

  const pending  = leaveRequests.filter(r => r.status === 'Pending')
  const resolved = leaveRequests.filter(r => r.status !== 'Pending')

  const handle = async (id, status) => {
    setLoading(id)
    try { await onUpdate(id, status) } finally { setLoading(null) }
  }

  if (leaveRequests.length === 0) {
    return (
      <div className="card p-8 text-center">
        <CalendarDays size={32} className="text-gray-200 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-500">No leave requests yet</p>
        <p className="text-xs text-gray-400 mt-1">Staff-submitted requests will appear here for approval</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Pending */}
      {pending.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
            Pending Approval ({pending.length})
          </p>
          <div className="space-y-3">
            {pending.map(r => (
              <div key={r.id} className="card p-4 border-l-4 border-amber-400">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{r.staff_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                      {' · '}{dayCount(r.start_date, r.end_date)} day{dayCount(r.start_date, r.end_date) !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-600 mt-1.5 italic">"{r.reason}"</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg flex-shrink-0">
                    <Hourglass size={11} /> Pending
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handle(r.id, 'Approved')}
                    disabled={loading === r.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50"
                  >
                    <CheckCircle size={13} /> {loading === r.id ? '…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handle(r.id, 'Rejected')}
                    disabled={loading === r.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 text-xs font-bold transition disabled:opacity-50"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
            Resolved ({resolved.length})
          </p>
          <div className="space-y-2">
            {resolved.map(r => (
              <div key={r.id}
                className={`card p-3.5 flex items-start justify-between gap-3 ${
                  r.status === 'Approved' ? 'border-l-4 border-emerald-400' : 'border-l-4 border-red-300'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 truncate">{r.staff_name}</p>
                  <p className="text-xs text-gray-500">{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate italic">"{r.reason}"</p>
                </div>
                <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0 ${
                  r.status === 'Approved'
                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                    : 'text-red-600 bg-red-50 border border-red-100'
                }`}>
                  {r.status === 'Approved'
                    ? <><CheckCircle size={11} /> Approved</>
                    : <><XCircle size={11} /> Rejected</>
                  }
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function dayCount(start, end) {
  if (!start || !end) return 0
  const diff = (new Date(end) - new Date(start)) / 86400000
  return diff >= 0 ? diff + 1 : 0
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

// ── Access Management Panel ───────────────────────────────

function AccessPanel({ staff, user, demoMode, inviteStaff, updateStaffAccess, revokeStaffAccess }) {
  const [showInvite,    setShowInvite]    = useState(false)
  const [editTarget,    setEditTarget]    = useState(null)   // { userId, name, accessRole, permissions }
  const [accessUsers,   setAccessUsers]   = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [fetching,      setFetching]      = useState(!demoMode)
  const [deletingId,    setDeletingId]    = useState(null)

  // In demo: derive access users from staff array
  useEffect(() => {
    if (demoMode) {
      setAccessUsers(
        staff.filter(s => s.userId).map(s => ({
          userId: s.userId, name: s.name, accessRole: s.accessRole, permissions: s.permissions || [],
        }))
      )
      setPendingInvites([])
      setFetching(false)
      return
    }
    if (!user?.academyId) return
    Promise.all([
      db.fetchAccessUsers(user.academyId),
      db.fetchPendingInvites(user.academyId),
    ]).then(([users, invites]) => {
      setAccessUsers(users)
      setPendingInvites(invites)
    }).finally(() => setFetching(false))
  }, [demoMode, user?.academyId])

  // Called by InviteModal after link is generated
  const handleInviteGenerated = ({ name, accessRole, permissions }) => {
    if (demoMode) {
      // Add directly to local state — no DB in demo mode
      setPendingInvites(prev => [...prev, {
        id:          'demo-' + Date.now(),
        token:       'demo-xxx',
        name,
        accessRole,
        permissions,
        expiresAt:   new Date(Date.now() + 7 * 86400000).toISOString(),
      }])
      return
    }
    // Real DB — re-fetch
    if (!user?.academyId) return
    db.fetchPendingInvites(user.academyId).then(setPendingInvites)
  }

  const handleDeleteInvite = async (id) => {
    setDeletingId(id)
    try {
      await db.deleteInvite(id)
      setPendingInvites(prev => prev.filter(i => i.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const handleRevoke = async (userId, name) => {
    if (!confirm(`Remove portal access for ${name}?`)) return
    await revokeStaffAccess(userId)
    setAccessUsers(prev => prev.filter(u => u.userId !== userId))
  }

  const handleSaveEdit = async (userId, accessRole, permissions) => {
    await updateStaffAccess(userId, accessRole, permissions)
    setAccessUsers(prev => prev.map(u => u.userId === userId ? { ...u, accessRole, permissions } : u))
    setEditTarget(null)
  }

  if (fetching) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-gray-400">Loading access data…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">
            {accessUsers.length} active portal {accessUsers.length === 1 ? 'user' : 'users'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Staff with login access to the portal</p>
        </div>
        <button className="btn-primary" onClick={() => setShowInvite(true)}>
          <Link2 size={15} /> Invite Staff
        </button>
      </div>

      {/* Active portal users */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Portal Users</p>
        {accessUsers.length === 0 ? (
          <div className="card p-6 text-center">
            <ShieldCheck size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No staff have portal access yet. Invite someone to get started.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[2fr_1fr_2fr_auto] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Name</span>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Role</span>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Permissions</span>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Actions</span>
            </div>
            <div className="divide-y divide-gray-50">
              {accessUsers.map(u => (
                <div key={u.userId} className="grid md:grid-cols-[2fr_1fr_2fr_auto] gap-3 md:gap-4 items-center px-5 py-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{u.name}</p>
                  </div>
                  <div>
                    <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${ACCESS_ROLE_COLOR[u.accessRole] || 'bg-gray-100 text-gray-700'}`}>
                      {ACCESS_ROLE_LABEL[u.accessRole] || u.accessRole}
                    </span>
                  </div>
                  <div>
                    {u.accessRole === 'admin' ? (
                      <span className="text-xs text-gray-500">Full access ({ALL_PERMISSIONS.length} permissions)</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(u.permissions || []).slice(0, 3).map(p => (
                          <span key={p} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                            {PERM_LABEL[p] || p}
                          </span>
                        ))}
                        {(u.permissions || []).length > 3 && (
                          <span className="text-[10px] text-gray-400">+{u.permissions.length - 3} more</span>
                        )}
                        {(u.permissions || []).length === 0 && (
                          <span className="text-xs text-gray-400">No permissions</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditTarget(u)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                      title="Edit permissions"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleRevoke(u.userId, u.name)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      title="Revoke access"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
            Pending Invites ({pendingInvites.length})
          </p>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="divide-y divide-gray-50">
              {pendingInvites.map(inv => (
                <div key={inv.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{inv.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACCESS_ROLE_COLOR[inv.accessRole] || 'bg-gray-100 text-gray-700'}`}>
                        {ACCESS_ROLE_LABEL[inv.accessRole] || inv.accessRole}
                      </span>
                      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                        Pending
                      </span>
                      <span className="text-xs text-gray-400">
                        Expires {new Date(inv.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteInvite(inv.id)}
                    disabled={deletingId === inv.id}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                    title="Delete invite"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onGenerated={handleInviteGenerated}
          inviteStaff={inviteStaff}
        />
      )}

      {editTarget && (
        <PermissionPanel
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  )
}

// ── Invite Modal ──────────────────────────────────────────

function InviteModal({ onClose, onGenerated, inviteStaff }) {
  const [name,        setName]        = useState('')
  const [accessRole,  setAccessRole]  = useState('coach')
  const [permissions, setPermissions] = useState([...ROLE_PRESETS.coach])
  const [link,        setLink]        = useState('')
  const [copied,      setCopied]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

  const applyPreset = (role) => {
    setAccessRole(role)
    setPermissions([...(ROLE_PRESETS[role] || [])])
  }

  const togglePerm = (perm) => {
    setPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    )
  }

  const handleGenerate = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    setLoading(true)
    try {
      const url = await inviteStaff(name.trim(), accessRole, permissions)
      setLink(url)
      onGenerated?.({ name: name.trim(), accessRole, permissions })
    } catch (err) {
      setError(err.message || 'Failed to generate invite')
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal title="Invite Staff Member" onClose={onClose}>
      {!link ? (
        <div className="space-y-5">
          <div>
            <label className="label">Staff Name *</label>
            <input
              className="input"
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="label mb-2">Access Role</label>
            <div className="flex flex-wrap gap-2">
              {ACCESS_ROLES.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => applyPreset(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    accessRole === r
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {ACCESS_ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Selecting a role auto-fills permissions below. You can customize them.
            </p>
          </div>

          <div>
            <label className="label mb-2">Permissions</label>
            <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
              {Object.entries(PERMISSION_GROUPS)
                .filter(([group]) => accessRole === 'coach' || group !== 'Batches')
                .map(([group, perms]) => (
                <div key={group} className="px-4 py-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {perms.map(perm => (
                      <label key={perm} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permissions.includes(perm)}
                          onChange={() => togglePerm(perm)}
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-gray-700">{PERM_LABEL[perm]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
              <Link2 size={14} /> {loading ? 'Generating…' : 'Generate Link'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
            <CheckCircle size={28} className="text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-900">Invite link created!</p>
            <p className="text-xs text-gray-500 mt-1">Share this link with <strong>{name}</strong>. It expires in 7 days.</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-700 break-all font-mono leading-relaxed">
            {link}
          </div>
          <div className="flex gap-3">
            <button className="btn-primary flex-1 justify-center" onClick={copyLink}>
              {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Link</>}
            </button>
            <button className="btn-secondary" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Permission Panel (slide-over) ─────────────────────────

function PermissionPanel({ target, onClose, onSave }) {
  const [accessRole,  setAccessRole]  = useState(target.accessRole || 'staff')
  const [permissions, setPermissions] = useState([...(target.permissions || [])])
  const [saving,      setSaving]      = useState(false)

  const applyPreset = (role) => {
    setAccessRole(role)
    setPermissions([...(ROLE_PRESETS[role] || [])])
  }

  const togglePerm = (perm) => {
    setPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try { await onSave(target.userId, accessRole, permissions) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">Edit Access</h3>
            <p className="text-xs text-gray-500 mt-0.5">{target.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Role selector */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Access Role</p>
            <div className="flex flex-wrap gap-2">
              {ACCESS_ROLES.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => applyPreset(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    accessRole === r
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {ACCESS_ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Permission checkboxes */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Permissions</p>
            <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
              {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
                <div key={group} className="px-4 py-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
                  <div className="space-y-2">
                    {perms.map(perm => (
                      <label key={perm} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permissions.includes(perm)}
                          onChange={() => togglePerm(perm)}
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                        />
                        <span className="text-sm text-gray-700">{PERM_LABEL[perm]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 flex gap-3">
          <button className="btn-secondary flex-1 justify-center" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1 justify-center" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddStaffModal({ onClose, onSave, demoMode }) {
  const fileRef = useRef(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoFile,    setPhotoFile]    = useState(null)
  const [form, setForm] = useState({
    name: '', role: ROLES[1], phone: '', sports: [], salary: 25000,
    joinDate: new Date().toISOString().split('T')[0], status: 'Active',
  })
  const [giveAccess,  setGiveAccess]  = useState(false)
  const [portalType,  setPortalType]  = useState('field')  // 'field' | 'office'
  const [accessRole,  setAccessRole]  = useState('coach')
  const [perms,       setPerms]       = useState([])
  const [inviteLink,  setInviteLink]  = useState(null)
  const [copied,      setCopied]      = useState(false)
  const [loading,     setLoading]     = useState(false)

  const FIELD_PERMS = ['attendance.manage', 'students.view', 'batches.view']

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleSport = sp => setForm(f => ({
    ...f, sports: f.sports.includes(sp) ? f.sports.filter(s => s !== sp) : [...f.sports, sp],
  }))

  const handlePhoto = e => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const selectPortalType = type => {
    setPortalType(type)
    if (type === 'field') {
      setAccessRole('coach')
      setPerms(FIELD_PERMS)
    } else {
      setAccessRole('admin')
      setPerms([])
    }
  }

  const togglePerm = perm => setPerms(prev =>
    prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
  )

  // Office staff permission groups — attendance is field-only
  const OFFICE_GROUPS = Object.entries(PERMISSION_GROUPS).filter(([g]) => g !== 'Attendance')

  const handleSave = async () => {
    if (!form.name.trim()) return
    setLoading(true)
    try {
      const accessConfig = giveAccess ? { accessRole, permissions: perms } : null
      const link = await onSave(form, photoFile, accessConfig)
      if (giveAccess && link) setInviteLink(link)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Success screen — shown after invite is generated
  if (inviteLink) {
    return (
      <Modal title="Staff Added!" onClose={onClose}>
        <div className="text-center py-4 space-y-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={28} className="text-emerald-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900">{form.name} added successfully</p>
            <p className="text-sm text-gray-500 mt-1">Share this invite link so they can create their account</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-left">
            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Invite Link</p>
            <p className="text-xs text-gray-700 break-all font-mono">{inviteLink}</p>
          </div>
          <button
            onClick={copyLink}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition ${copied ? 'bg-emerald-600 text-white' : 'bg-brand-600 hover:bg-brand-700 text-white'}`}
          >
            {copied ? <><Check size={14}/> Copied!</> : <><Copy size={14}/> Copy Link</>}
          </button>
          <button onClick={onClose} className="w-full btn-secondary text-sm">Done</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add Staff Member" onClose={onClose}>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">

        {/* Photo */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group w-20 h-20 rounded-full overflow-hidden flex-shrink-0 border-2 border-dashed border-gray-300 hover:border-brand-400 transition bg-gray-50"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full gap-1 text-gray-400 group-hover:text-brand-500 transition">
                <Camera size={20} />
                <span className="text-[10px] font-semibold">Photo</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <Camera size={16} className="text-white" />
            </div>
          </button>
          <p className="text-[11px] text-gray-400">Optional photo</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
        </div>

        {/* HR Details */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Staff Details</p>
          <div className="space-y-3">
            <div>
              <label className="label">Full Name *</label>
              <input className="input" placeholder="Staff name" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">HR Role</label>
                <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" placeholder="Mobile number" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Monthly Salary (₹)</label>
                <input className="input" type="number" value={form.salary} onChange={e => set('salary', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Join Date</label>
                <input className="input" type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} />
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
          </div>
        </div>

        {/* Portal Access toggle */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <p className="text-sm font-bold text-gray-900">Portal Access</p>
              <p className="text-xs text-gray-500">Let this staff member log in to the portal</p>
            </div>
            <button
              type="button"
              onClick={() => setGiveAccess(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${giveAccess ? 'bg-brand-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${giveAccess ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {giveAccess && (
            <div className="mt-4 space-y-4">
              {/* Portal type cards */}
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Portal Type</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => selectPortalType('field')}
                  className={`relative flex flex-col items-start gap-2 p-4 rounded-2xl border-2 text-left transition ${
                    portalType === 'field'
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {portalType === 'field' && (
                    <span className="absolute top-2 right-2 w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center">
                      <Check size={11} className="text-white" />
                    </span>
                  )}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${portalType === 'field' ? 'bg-brand-600' : 'bg-gray-100'}`}>
                    <Smartphone size={18} className={portalType === 'field' ? 'text-white' : 'text-gray-500'} />
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${portalType === 'field' ? 'text-brand-700' : 'text-gray-800'}`}>Field Staff</p>
                    <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Mobile portal · Attendance & schedule</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => selectPortalType('office')}
                  className={`relative flex flex-col items-start gap-2 p-4 rounded-2xl border-2 text-left transition ${
                    portalType === 'office'
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {portalType === 'office' && (
                    <span className="absolute top-2 right-2 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                      <Check size={11} className="text-white" />
                    </span>
                  )}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${portalType === 'office' ? 'bg-purple-600' : 'bg-gray-100'}`}>
                    <Monitor size={18} className={portalType === 'office' ? 'text-white' : 'text-gray-500'} />
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${portalType === 'office' ? 'text-purple-700' : 'text-gray-800'}`}>Office Staff</p>
                    <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Desktop portal · Custom permissions</p>
                  </div>
                </button>
              </div>

              {/* Field Staff: read-only permission badges */}
              {portalType === 'field' && (
                <div className="bg-brand-50 border border-brand-100 rounded-xl p-3">
                  <p className="text-[11px] font-bold text-brand-700 uppercase tracking-wide mb-2">Included Permissions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FIELD_PERMS.map(p => (
                      <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand-100 text-brand-700">
                        <Check size={10} /> {PERM_LABEL[p]}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-brand-500 mt-2">Only coaches & field staff can mark attendance.</p>
                </div>
              )}

              {/* Office Staff: custom permission checkboxes */}
              {portalType === 'office' && (
                <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                  {OFFICE_GROUPS.map(([group, groupPerms]) => (
                    <div key={group} className="px-4 py-3">
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">{group}</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {groupPerms.map(perm => (
                          <label key={perm} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={perms.includes(perm)}
                              onChange={() => togglePerm(perm)}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs text-gray-700">{PERM_LABEL[perm]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                <Link2 size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">An invite link will be generated after saving. Share it with the staff member to complete their account setup.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-gray-100">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading || !form.name.trim()}>
          {loading ? '…' : giveAccess ? 'Add & Send Invite' : 'Add Staff Member'}
        </button>
      </div>
    </Modal>
  )
}
