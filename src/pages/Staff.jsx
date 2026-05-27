import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { UserCog, Plus, Phone, Award, X, Layers, CheckCircle, ChevronRight, ChevronDown, CalendarDays, CalendarCheck, Hourglass, XCircle, ShieldCheck, Link2, Trash2, Pencil, Copy, Check, Camera, Smartphone, Monitor, FileText, ExternalLink } from 'lucide-react'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'
import DevFillButton from '../components/DevFillButton'
import { fillStaff, fillInvite } from '../lib/devFill'
import { ALL_PERMISSIONS, ROLE_PRESETS, PERMISSION_GROUPS, PERM_LABEL, ACCESS_ROLES, ACCESS_ROLE_LABEL, ACCESS_ROLE_COLOR } from '../lib/permissions'
import * as db from '../lib/db'

const ROLES = ['Head Coach', 'Coach', 'Trainer', 'Dance Trainer', 'Admin', 'Support Staff']

export default function Staff() {
  const { staff, batches, updateBatchCoach, leaveRequests, loadLeaveRequests, updateLeave, deleteLeave, role, user, demoMode, inviteStaff, updateStaffAccess, revokeStaffAccess, addStaffMember, removeStaffMember, editStaffMember, editStaffPermissions, hasPermission, showToast, refreshData } = useApp()
  const isOwner       = role === 'owner'
  const canManageStaff = hasPermission('staff.manage')
  // Owners (academy-wide) and branch managers (own branch) may delete staff and
  // edit an existing staff's access. Other staff.manage holders are create-only.
  const canManageStaffFull = isOwner || user?.accessRole === 'branch_manager'
  const [profile,    setProfile]    = useState(null)
  const [showModal,  setShowModal]  = useState(false)
  const [activeTab,  setActiveTab]  = useState('staff')  // 'staff' | 'leaves' | 'access'
  const [attendanceMap, setAttendanceMap] = useState({}) // staffId -> monthly %

  useEffect(() => { loadLeaveRequests?.() }, [])

  // Compute real monthly attendance from staff_attendance check-ins.
  // Falls back to previous month if current month has no records.
  useEffect(() => {
    if (!user?.academyId || demoMode) return
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth() + 1
    const todayDay = now.getDate()

    const compute = (records, year, month, daysInPeriod) => {
      const map = {}
      for (const r of records) {
        const id = r.profile_id
        if (!map[id]) map[id] = new Set()
        map[id].add(r.check_in_date)
      }
      const result = {}
      for (const [id, dates] of Object.entries(map)) {
        result[id] = Math.min(100, Math.round((dates.size / daysInPeriod) * 100))
      }
      return result
    }

    db.fetchStaffAttendanceForMonth(user.academyId, year, month).then(records => {
      if (records.length > 0) {
        setAttendanceMap(compute(records, year, month, todayDay))
      } else {
        // fallback: previous month
        const prevMonth = month === 1 ? 12 : month - 1
        const prevYear  = month === 1 ? year - 1 : year
        const prevDays  = new Date(prevYear, prevMonth, 0).getDate()
        db.fetchStaffAttendanceForMonth(user.academyId, prevYear, prevMonth).then(prev => {
          setAttendanceMap(compute(prev, prevYear, prevMonth, prevDays))
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [user?.academyId, demoMode])

  const pendingLeaves = (leaveRequests || []).filter(r => r.status === 'Pending').length

  // Merge real attendance into staff list
  const staffWithAttendance = staff.map(s => ({
    ...s,
    attendance: attendanceMap[s.id] !== undefined ? attendanceMap[s.id] : 0,
  }))

  const avgAttendance = staffWithAttendance.filter(s => s.status === 'Active').length
    ? Math.round(staffWithAttendance.filter(s => s.status === 'Active').reduce((acc, s) => acc + s.attendance, 0) / staffWithAttendance.filter(s => s.status === 'Active').length)
    : 0

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Staff & Coaches</h2>
          <p className="text-sm text-gray-500">{staff.filter(s => s.status === 'Active').length} active members</p>
        </div>
        {canManageStaff && activeTab === 'staff' && (
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
        {role === 'owner' && (
          <button onClick={() => setActiveTab('attendance')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'attendance' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <CalendarCheck size={14} /> Attendance
          </button>
        )}
      </div>

      {/* Leave requests panel */}
      {activeTab === 'leaves' && (
        <LeaveRequestsPanel leaveRequests={leaveRequests || []} onUpdate={updateLeave} onDelete={deleteLeave} />
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

      {/* Staff attendance panel */}
      {activeTab === 'attendance' && (
        <StaffAttendancePanel staff={staff} user={user} demoMode={demoMode} />
      )}

      {/* Staff list — hidden when on leaves/access tab */}
      {activeTab === 'staff' && (
      <>
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 sm:p-4 text-center">
          <p className="text-xl sm:text-2xl font-black text-gray-900">{staff.length}</p>
          <p className="text-[10px] sm:text-xs text-gray-500 mt-1">Total</p>
        </div>
        <div className="card p-3 sm:p-4 text-center">
          <p className="text-xl sm:text-2xl font-black text-brand-600">{staff.filter(s => s.status === 'Active').length}</p>
          <p className="text-[10px] sm:text-xs text-gray-500 mt-1">Active</p>
        </div>
        <div className="card p-3 sm:p-4 text-center">
          <p className="text-xl sm:text-2xl font-black text-emerald-600">{avgAttendance}%</p>
          <p className="text-[10px] sm:text-xs text-gray-500 mt-1">Attendance</p>
        </div>
      </div>

      <StaffSections staff={staffWithAttendance} batches={batches} onSelect={setProfile} onDelete={removeStaffMember} canDelete={canManageStaffFull} currentUserId={user?.id} branchManagerCount={staff.filter(s => s.accessRole === 'branch_manager').length} onReset={() => refreshData?.()} />
      </>
      )}

      {profile && (
        <StaffProfilePanel
          member={staffWithAttendance.find(s => s.id === profile.id) || profile}
          batches={batches}
          canManageAccess={canManageStaffFull}
          isOwner={isOwner}
          hasPermission={hasPermission}
          currentUserId={user?.id}
          branchManagerCount={staff.filter(s => s.accessRole === 'branch_manager').length}
          onClose={() => setProfile(null)}
          onAssign={async (batchId) => { await updateBatchCoach(batchId, profile.name) }}
          onUnassign={async (batchId) => { await updateBatchCoach(batchId, '') }}
          onDelete={removeStaffMember}
          onEdit={editStaffMember}
          onEditPermissions={editStaffPermissions}
          onResetAccount={async () => {
            try {
              const result = await db.resetStaffAccount(profile.id)
              showToast(`Account reset. New join code: ${result.joinCode}`)
            } catch (e) { showToast(e.message || 'Reset failed', 'error') }
          }}
        />
      )}

      {showModal && (
        <AddStaffModal
          onClose={() => setShowModal(false)}
          onSave={async (form, photoFile, accessConfig) => {
            const codes = await addStaffMember({ ...form }, !demoMode ? photoFile : null, accessConfig)
            return { activationInfo: codes }
          }}
          demoMode={demoMode}
        />
      )}
    </div>
  )
}

// ── Owner-side Leave Requests Panel ──────────────────────────

function StaffCard({ s, batches, onSelect, onDelete, canDelete, currentUserId, branchManagerCount, onReset }) {
  const { sportBranches, role, showToast } = useApp()
  const isOwner = role === 'owner'
  const branchName = s.branchId
    ? (sportBranches || []).find(b => b.id === s.branchId)?.branchName || null
    : null
  const assignedBatches = batches.filter(b => b.coach === s.name)
  const isPending = s.accountStatus === 'pending'
  const isBroken = isOwner && !isPending && s.accountStatus === 'active' && !s.email
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleReset = async (e) => {
    e.stopPropagation()
    setResetting(true)
    try {
      const result = await db.resetStaffAccount(s.id)
      showToast(`Account reset. New join code: ${result.joinCode}`)
      onReset?.()
    } catch (err) { showToast(err.message || 'Reset failed', 'error') }
    finally { setResetting(false) }
  }

  const isSelf    = s.userId === currentUserId
  const isLastBM  = s.accessRole === 'branch_manager' && branchManagerCount <= 1
  const deleteBlockReason = isSelf ? "You can't delete your own account" : isLastBM ? 'Assign another branch manager first' : null

  const handleDelete = async () => {
    setDeleting(true)
    try { await onDelete(s.id) } catch (_) { setDeleting(false); setConfirmDelete(false) }
  }

  return (
    <div className="card p-5 hover:shadow-md transition relative overflow-hidden">
      {/* 2-step delete confirm overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-3">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <p className="font-bold text-gray-900 mb-1">Delete {s.name}?</p>
          <p className="text-xs text-gray-500 mb-5">This will permanently remove them and their sessions.</p>
          <div className="flex gap-3 w-full">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancel</button>
            <button onClick={handleDelete} disabled={deleting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition disabled:opacity-50">
              {deleting ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> : <><Trash2 size={13}/> Delete</>}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-4 mb-4">
        {s.photoUrl ? (
          <img src={s.photoUrl} alt={s.name} className="w-12 h-12 rounded-2xl object-cover flex-shrink-0" />
        ) : (
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white text-lg font-black flex-shrink-0 ${
            s.staffType === 'office'
              ? 'bg-gradient-to-br from-purple-500 to-purple-700'
              : 'bg-gradient-to-br from-brand-500 to-brand-700'
          }`}>
            {s.name[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 truncate">{s.name}</h3>
          <p className="text-xs text-gray-500">{s.role}</p>
          <div className="flex gap-1 mt-1 flex-wrap">
            {!isPending && <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>}
            {isPending && <span className="badge badge-yellow">Not activated</span>}
            {isBroken && <span className="badge bg-orange-100 text-orange-700">Login broken</span>}
            {s.accessRole === 'branch_manager' && (
              <span className={`badge ${ACCESS_ROLE_COLOR['branch_manager']}`}>Branch Mgr</span>
            )}
          </div>
        </div>
        {canDelete && (
          deleteBlockReason ? (
            <div title={deleteBlockReason} className="p-1.5 rounded-lg text-gray-200 cursor-not-allowed flex-shrink-0">
              <Trash2 size={14} />
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition flex-shrink-0"
              title="Delete staff member"
            >
              <Trash2 size={14} />
            </button>
          )
        )}
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone size={13} className="text-gray-400 flex-shrink-0" />
          {s.phone || <span className="text-gray-300 italic text-xs">No phone</span>}
        </div>
        {s.staffCode && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">ID:</span>
            <span className="font-mono text-xs font-bold text-gray-700">{s.staffCode}</span>
            {isPending && s.joinCode && (
              <span className="font-mono text-xs font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                Code: {s.joinCode}
              </span>
            )}
          </div>
        )}
        {s.sports?.length > 0 && (
          <div className="flex items-center gap-2">
            <Award size={13} className="text-gray-400 flex-shrink-0" />
            <div className="flex flex-wrap gap-1">
              {s.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
              {branchName && (
                <span className="badge bg-purple-100 text-purple-700">{branchName}</span>
              )}
            </div>
          </div>
        )}
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
        onClick={() => onSelect(s)}
        className="w-full mt-4 btn-secondary text-xs justify-center py-2 gap-2"
      >
        View Profile & Assign Batch <ChevronRight size={12} />
      </button>

      {isBroken && (
        <button
          onClick={handleReset}
          disabled={resetting}
          className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition disabled:opacity-50"
        >
          {resetting
            ? <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            : <><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reset Account</>
          }
        </button>
      )}
    </div>
  )
}

function StaffSections({ staff, batches, onSelect, onDelete, canDelete, currentUserId, branchManagerCount, onReset }) {
  const coaches = staff.filter(s => s.staffType !== 'office')
  const office  = staff.filter(s => s.staffType === 'office')

  return (
    <div className="space-y-6">
      {/* Coach / Field Staff */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold text-brand-700 bg-brand-50 px-3 py-1 rounded-lg">
            Coaches &amp; Field Staff
          </span>
          <span className="text-xs text-gray-400 font-semibold">{coaches.length}</span>
        </div>
        {coaches.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-gray-400">No coaches added yet.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coaches.map(s => <StaffCard key={s.id} s={s} batches={batches} onSelect={onSelect} onDelete={onDelete} canDelete={canDelete} currentUserId={currentUserId} branchManagerCount={branchManagerCount} onReset={onReset} />)}
          </div>
        )}
      </div>

      {/* Office Staff */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-lg">
            Office Staff
          </span>
          <span className="text-xs text-gray-400 font-semibold">{office.length}</span>
        </div>
        {office.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-gray-400">No office staff added yet.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {office.map(s => <StaffCard key={s.id} s={s} batches={batches} onSelect={onSelect} onDelete={onDelete} canDelete={canDelete} currentUserId={currentUserId} branchManagerCount={branchManagerCount} onReset={onReset} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function LeaveRequestsPanel({ leaveRequests, onUpdate, onDelete }) {
  const [loading,      setLoading]      = useState(null)
  const [deleting,     setDeleting]     = useState(null)
  const [showPast,     setShowPast]     = useState(false)
  const today = new Date().toISOString().split('T')[0]

  const handle = async (id, status) => {
    setLoading(id)
    try { await onUpdate(id, status) } finally { setLoading(null) }
  }

  const handleDelete = async (id) => {
    setDeleting(id)
    try { await onDelete(id) } finally { setDeleting(null) }
  }

  // Sort all by start_date ascending
  const sorted = [...leaveRequests].sort((a, b) => a.start_date?.localeCompare(b.start_date))

  const pending         = sorted.filter(r => r.status === 'Pending')
  const upcomingApproved = sorted.filter(r => r.status === 'Approved' && r.start_date >= today)
  const past            = sorted.filter(r => r.status !== 'Pending' && r.start_date < today)
    .sort((a, b) => b.start_date?.localeCompare(a.start_date)) // past: newest first

  // Group past by month label
  const pastByMonth = past.reduce((acc, r) => {
    const d = new Date(r.start_date + 'T00:00:00')
    const key = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

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

      {/* ── Pending Approval ── */}
      {pending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Hourglass size={13} className="text-amber-500" />
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Pending Approval</p>
            <span className="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{pending.length}</span>
          </div>
          <div className="space-y-3">
            {pending.map(r => {
              const days = dayCount(r.start_date, r.end_date)
              const isUpcoming = r.start_date >= today
              return (
                <div key={r.id} className="card p-4 border-l-4 border-amber-400">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-gray-900 text-sm">{r.staff_name}</p>
                        {isUpcoming
                          ? <span className="text-[10px] bg-brand-50 text-brand-600 font-bold px-1.5 py-0.5 rounded">Upcoming</span>
                          : <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-1.5 py-0.5 rounded">Past date</span>
                        }
                      </div>
                      <p className="text-xs text-gray-500 mt-1 font-semibold">
                        {fmtDateFull(r.start_date)}
                        {r.start_date !== r.end_date && <> → {fmtDateFull(r.end_date)}</>}
                        <span className="text-gray-400 font-normal ml-1">· {days} day{days !== 1 ? 's' : ''}</span>
                      </p>
                      <p className="text-xs text-gray-600 mt-1.5 italic">"{r.reason}"</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                        <Hourglass size={11} /> Pending
                      </span>
                      <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                        className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50" title="Delete request">
                        {deleting === r.id ? '…' : <X size={13} />}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handle(r.id, 'Approved')} disabled={loading === r.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50">
                      <CheckCircle size={13} /> {loading === r.id ? '…' : 'Approve'}
                    </button>
                    <button onClick={() => handle(r.id, 'Rejected')} disabled={loading === r.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 text-xs font-bold transition disabled:opacity-50">
                      <XCircle size={13} /> Reject
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Upcoming Approved ── */}
      {upcomingApproved.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <CalendarCheck size={13} className="text-emerald-600" />
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Upcoming Leaves</p>
            <span className="bg-emerald-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{upcomingApproved.length}</span>
          </div>
          <div className="space-y-2">
            {upcomingApproved.map(r => {
              const days     = dayCount(r.start_date, r.end_date)
              const daysAway = Math.ceil((new Date(r.start_date + 'T00:00:00') - new Date()) / 86400000)
              return (
                <div key={r.id} className="card p-3.5 border-l-4 border-emerald-400 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{r.staff_name}</p>
                      <span className="text-[10px] bg-emerald-50 text-emerald-600 font-bold px-1.5 py-0.5 rounded">
                        {daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 font-semibold">
                      {fmtDateFull(r.start_date)}
                      {r.start_date !== r.end_date && <> → {fmtDateFull(r.end_date)}</>}
                      <span className="text-gray-400 font-normal ml-1">· {days} day{days !== 1 ? 's' : ''}</span>
                    </p>
                    <p className="text-xs text-gray-400 italic mt-0.5">"{r.reason}"</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg">
                      <CheckCircle size={11} /> Approved
                    </span>
                    <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                      className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50" title="Delete request">
                      {deleting === r.id ? '…' : <X size={13} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Past — grouped by month ── */}
      {past.length > 0 && (
        <section>
          <button
            onClick={() => setShowPast(v => !v)}
            className="flex items-center gap-2 mb-3 w-full text-left group"
          >
            <CalendarDays size={13} className="text-gray-400" />
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex-1">Past Leaves ({past.length})</p>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showPast ? 'rotate-180' : ''}`} />
          </button>

          {showPast && (
            <div className="space-y-5">
              {Object.entries(pastByMonth).map(([month, requests]) => (
                <div key={month}>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 pl-1">{month}</p>
                  <div className="space-y-2">
                    {requests.map(r => {
                      const days = dayCount(r.start_date, r.end_date)
                      return (
                        <div key={r.id} className={`card p-3 flex items-start justify-between gap-3 border-l-4 ${
                          r.status === 'Approved' ? 'border-emerald-300' : 'border-red-200'
                        }`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-800">{r.staff_name}</p>
                            <p className="text-xs text-gray-500">
                              {fmtDateFull(r.start_date)}
                              {r.start_date !== r.end_date && <> → {fmtDateFull(r.end_date)}</>}
                              <span className="text-gray-400 ml-1">· {days} day{days !== 1 ? 's' : ''}</span>
                            </p>
                            <p className="text-xs text-gray-400 italic mt-0.5 truncate">"{r.reason}"</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg ${
                              r.status === 'Approved'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
                                : 'text-red-600 bg-red-50 border border-red-100'
                            }`}>
                              {r.status === 'Approved' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                              {r.status}
                            </span>
                            <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                              className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50" title="Delete request">
                              {deleting === r.id ? '…' : <X size={13} />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function fmtDateFull(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function dayCount(start, end) {
  if (!start || !end) return 0
  const diff = (new Date(end) - new Date(start)) / 86400000
  return diff >= 0 ? diff + 1 : 0
}

function StaffProfilePanel({ member: s, batches, canManageAccess, isOwner, hasPermission, currentUserId, branchManagerCount, onClose, onAssign, onUnassign, onDelete, onEdit, onEditPermissions, onResetAccount }) {
  const { selectedSport } = useApp()
  const isFootball = (selectedSport || '').toLowerCase() === 'football'
  const isBrokenAccount = isOwner && s.accountStatus === 'active' && !s.email
  const photoRef = useRef(null)
  const assignedBatches   = batches.filter(b => b.coach === s.name)
  const unassignedBatches = batches.filter(b => b.coach !== s.name)
  const [panelTab,      setPanelTab]      = useState('info')   // 'info' | 'edit' | 'access'
  const [assigning,     setAssigning]     = useState(false)
  const [selectedBatch, setSelectedBatch] = useState('')
  const [batchSaving,   setBatchSaving]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting,      setDeleting]      = useState(false)

  const isSelf   = s.userId === currentUserId
  const isLastBM = s.accessRole === 'branch_manager' && branchManagerCount <= 1
  const deleteBlockReason = isSelf ? "You can't delete your own account" : isLastBM ? 'Assign another branch manager first' : null

  // Edit tab state
  const [editName,      setEditName]      = useState(s.name)
  const [editPhone,     setEditPhone]     = useState(s.phone || '')
  const [editAge,       setEditAge]       = useState(s.age || '')
  const [editPhoto,     setEditPhoto]     = useState(null)
  const [editPreview,   setEditPreview]   = useState(null)
  const [editSaving,    setEditSaving]    = useState(false)
  const [editError,     setEditError]     = useState('')

  // Access tab state
  const [accRole,       setAccRole]       = useState(s.accessRole || 'coach')
  const [accPerms,      setAccPerms]      = useState(s.permissions || [])
  const [accSaving,     setAccSaving]     = useState(false)
  const [accError,      setAccError]      = useState('')

  // Copy activation link
  const [linkCopied,    setLinkCopied]    = useState(false)
  const activationLink = s.staffCode
    ? `${window.location.origin}/staff-activate?id=${s.staffCode}&code=${s.joinCode || '?'}`
    : ''
  const handleCopyLink = () => {
    navigator.clipboard.writeText(activationLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const isPending   = s.accountStatus === 'pending'
  const isField     = s.staffType !== 'office'
  const typeLabel   = isField ? 'Coach / Field Staff' : 'Office Staff'
  const headerColor = isField
    ? 'bg-gradient-to-br from-gray-800 to-gray-900'
    : 'bg-gradient-to-br from-purple-800 to-purple-900'

  const handleBatchAssign = async () => {
    if (!selectedBatch) return
    setBatchSaving(true)
    await onAssign(Number(selectedBatch))
    setBatchSaving(false); setAssigning(false); setSelectedBatch('')
  }

  const handleDelete = async () => {
    setDeleting(true)
    try { await onDelete(s.id); onClose() } catch (_) { setDeleting(false); setConfirmDelete(false) }
  }

  const handleEditSave = async () => {
    if (!editName.trim()) { setEditError('Name is required'); return }
    setEditSaving(true); setEditError('')
    try {
      await onEdit(s.id, { name: editName.trim(), phone: editPhone.trim(), photoFile: editPhoto, photoUrl: s.photoUrl, age: editAge ? Number(editAge) : null })
      setEditPhoto(null); setEditPreview(null)
    } catch (err) { setEditError(err.message || 'Failed to save') }
    finally { setEditSaving(false) }
  }

  const handleAccSave = async () => {
    setAccSaving(true)
    setAccError('')
    try { await onEditPermissions(s.id, { accessRole: accRole, permissions: accPerms }) }
    catch (err) { setAccError(err.message || 'Failed to save permissions') }
    finally { setAccSaving(false) }
  }

  const togglePerm = (p) => setAccPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  const applyPreset = (role) => {
    setAccRole(role)
    const preset = ROLE_PRESETS[role] || []
    // Non-owners can only grant permissions they hold themselves (mirrors the backend escalation guard).
    setAccPerms(isOwner || !hasPermission ? preset : preset.filter(p => hasPermission(p)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">

        {/* Header */}
        <div className={`${headerColor} px-6 pt-6 pb-5`}>
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            <div className="flex items-center gap-2">
              <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
              {isPending && <span className="badge badge-yellow">Not activated</span>}
              {s.accessRole === 'branch_manager' && (
                <span className={`badge ${ACCESS_ROLE_COLOR['branch_manager']}`}>Branch Mgr</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {(editPreview || s.photoUrl) ? (
              <img src={editPreview || s.photoUrl} alt={s.name} className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 border-2 border-white/20" />
            ) : (
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-2xl font-black text-white flex-shrink-0">
                {s.name[0]}
              </div>
            )}
            <div>
              <h2 className="text-xl font-black text-white">{s.name}</h2>
              <p className="text-gray-300 text-sm">{s.role}</p>
              <p className="text-gray-400 text-xs mt-0.5">{typeLabel}</p>
              {s.phone && <p className="text-gray-300 text-xs mt-0.5">{s.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="bg-white/10 rounded-xl p-2.5 text-center">
              <p className="text-lg font-black text-white">{assignedBatches.length}</p>
              <p className="text-[10px] text-gray-400">Batches</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5 text-center">
              <p className="text-lg font-black text-white">{s.attendance}%</p>
              <p className="text-[10px] text-gray-400">Attendance</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5 text-center">
              <p className="text-sm font-black text-white font-mono">{s.staffCode || '—'}</p>
              <p className="text-[10px] text-gray-400">Staff ID</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 bg-white">
          {[
            { id: 'info',   label: 'Info' },
            // Edit Profile: owners + branch managers
            ...(canManageAccess ? [{ id: 'edit', label: 'Edit Profile' }] : []),
            // Access: owners + branch managers may edit access. secure_update_staff_permissions
            // (migrations 0081/0083) lets branch managers edit an EXISTING staff's access too,
            // enforcing branch scope + a no-escalation guard server-side — so it's safe to surface.
            ...(canManageAccess ? [{ id: 'access', label: (isOwner || s.permissions?.length) ? 'Access' : 'Set Access' }] : []),
          ].map(t => (
            <button key={t.id} onClick={() => setPanelTab(t.id)}
              className={`flex-1 py-3 text-xs font-bold transition border-b-2 ${
                panelTab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── INFO TAB ── */}
          {panelTab === 'info' && (<>
            {isPending && s.staffCode && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Activation Pending</p>
                <p className="text-xs text-amber-600 mb-3">Share this link so they can register their account</p>
                <div className="flex items-start gap-2">
                  <p className="text-xs font-mono text-amber-800 break-all bg-amber-100 rounded-lg px-3 py-2 flex-1">
                    {activationLink}
                  </p>
                  <button
                    onClick={handleCopyLink}
                    className={`flex-shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg transition ${
                      linkCopied
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : 'bg-amber-200 text-amber-800 border border-amber-300 hover:bg-amber-300'
                    }`}
                  >
                    {linkCopied ? <Check size={13} /> : <Copy size={13} />}
                    {linkCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {s.sports?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Sports / Expertise</p>
                <div className="flex flex-wrap gap-2">
                  {s.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
                </div>
              </div>
            )}

            {isField && s.licenceUrl && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
                <FileText size={16} className="text-emerald-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-700">Sport Licence</p>
                  <a href={s.licenceUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 underline flex items-center gap-1 mt-0.5">
                    View licence <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assigned Batches</p>
                {unassignedBatches.length > 0 && (
                  <button onClick={() => setAssigning(a => !a)} className="text-xs text-brand-600 font-semibold hover:underline">+ Assign</button>
                )}
              </div>
              {assigning && (
                <div className="flex gap-2 mb-3">
                  <select className="input flex-1 text-xs" value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}>
                    <option value="">— Select batch —</option>
                    {unassignedBatches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''} · {b.time}</option>)}
                  </select>
                  <button onClick={handleBatchAssign} disabled={!selectedBatch || batchSaving} className="btn-primary text-xs px-3 py-2">
                    {batchSaving ? '…' : 'Assign'}
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
                        <p className="text-xs text-brand-500">{b.time} · {b.enrolled}/{b.capacity}</p>
                      </div>
                      <button onClick={() => onUnassign(b.id)} className="p-1 rounded text-gray-400 hover:text-red-500 transition"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Details</p>
              <div className="space-y-2.5">
                {[
                  ['Role',      s.role],
                  ['Type',      typeLabel],
                  ['Phone',     s.phone || '—'],
                  ['Age',       s.age   || '—'],
                  ['Staff ID',  s.staffCode || '—'],
                  ['Join Date', s.joinDate ? new Date(s.joinDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
                  ['Account',   s.accountStatus === 'active' ? 'Activated' : 'Pending activation'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                    <span className="text-xs text-gray-400">{label}</span>
                    <span className="text-xs font-semibold text-gray-800">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {canManageAccess && (deleteBlockReason ? (
              <div className="w-full py-3 px-4 rounded-2xl bg-gray-50 border border-gray-200 text-center">
                <p className="text-xs text-gray-400">{deleteBlockReason}.</p>
              </div>
            ) : !confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-50 text-red-600 font-bold text-sm border border-red-100 hover:bg-red-100 transition">
                <Trash2 size={15} /> Delete Staff Member
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-bold text-red-700 text-center">Delete {s.name}?</p>
                <p className="text-xs text-red-500 text-center">This cannot be undone.</p>
                <div className="flex gap-3">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancel</button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-50">
                    {deleting ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> : <><Trash2 size={13}/> Yes, Delete</>}
                  </button>
                </div>
              </div>
            ))}
          </>)}

          {/* ── EDIT TAB ── */}
          {panelTab === 'edit' && (
            <div className="space-y-4">
              {/* Photo */}
              <div className="flex flex-col items-center gap-2">
                <button type="button" onClick={() => photoRef.current?.click()}
                  className="relative group w-20 h-20 rounded-full overflow-hidden border-2 border-dashed border-gray-300 hover:border-brand-400 transition">
                  {(editPreview || s.photoUrl) ? (
                    <img src={editPreview || s.photoUrl} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center gap-1 text-gray-400">
                      <Camera size={20} /><span className="text-[10px] font-semibold">Photo</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <Camera size={16} className="text-white" />
                  </div>
                </button>
                <p className="text-[11px] text-gray-400">Click to change photo</p>
                <input ref={photoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setEditPhoto(f); setEditPreview(URL.createObjectURL(f)) } }} />
              </div>

              <div>
                <label className="label">Full Name *</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={editPhone} onChange={e => setEditPhone(e.target.value)} type="tel" />
              </div>
              <div>
                <label className="label">Age</label>
                <input className="input" value={editAge} onChange={e => setEditAge(e.target.value)} type="number" min="16" max="70" placeholder="Years" />
              </div>
              <div>
                <label className="label">Email</label>
                {s.email
                  ? <input className="input bg-gray-50 text-gray-500 cursor-not-allowed" value={s.email} readOnly />
                  : isBrokenAccount
                    ? <div className="input bg-orange-50 text-orange-600 text-sm border-orange-200">Account active but no email — reset needed</div>
                    : <div className="input bg-gray-50 text-gray-400 text-sm">Not activated yet</div>
                }
                <p className="text-[11px] text-gray-400 mt-1">Set by staff during account activation — cannot be changed here</p>
                {isBrokenAccount && isOwner && onResetAccount && (
                  <button
                    type="button"
                    onClick={onResetAccount}
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                    Reset Account — Generate New Activation Codes
                  </button>
                )}
              </div>

              {isField && s.licenceUrl && (
                <div className="flex items-center gap-2 text-xs text-brand-600 bg-brand-50 rounded-xl px-3 py-2.5">
                  <FileText size={13} />
                  <a href={s.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
                    View current licence <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {editError && <p className="text-sm text-red-600">{editError}</p>}

              <button onClick={handleEditSave} disabled={editSaving}
                className="w-full btn-primary justify-center py-3 text-sm">
                {editSaving ? '…' : <><Check size={14} /> Save Changes</>}
              </button>
            </div>
          )}

          {/* ── ACCESS TAB ── */}
          {panelTab === 'access' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Role</p>
                <div className="grid grid-cols-2 gap-2">
                  {ACCESS_ROLES.map(r => (
                    <button key={r} onClick={() => applyPreset(r)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border-2 transition ${
                        accRole === r ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                      {ACCESS_ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Selecting a role auto-fills default permissions below. You can still customize.</p>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Permissions</p>
                <div className="space-y-3">
                  {Object.entries(PERMISSION_GROUPS).filter(([group]) => group !== 'Training' || isFootball).map(([group, perms]) => (
                    <div key={group}>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{group}</p>
                      <div className="space-y-1">
                        {perms.map(p => {
                          const isChecked = accPerms.includes(p)
                          // Escalation guard (mirrors the backend): a non-owner can't grant a
                          // permission they don't hold themselves. They may still remove one
                          // that's already set. Owners can grant anything.
                          const cannotGrant = !isOwner && hasPermission && !hasPermission(p)
                          const locked = cannotGrant && !isChecked
                          return (
                            <label key={p} className={`flex items-center gap-2.5 group ${locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                              title={locked ? "You can't grant a permission you don't have" : undefined}>
                              <div onClick={() => { if (!locked) togglePerm(p) }}
                                className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition ${
                                  isChecked ? 'bg-brand-600 border-brand-600' : 'border-gray-300 group-hover:border-brand-400'
                                }`}>
                                {isChecked && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className="text-xs text-gray-700">{PERM_LABEL[p]}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {accError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{accError}</p>
              )}

              <button onClick={handleAccSave} disabled={accSaving}
                className="w-full btn-primary justify-center py-3 text-sm">
                {accSaving ? '…' : <><Check size={14} /> Save Permissions</>}
              </button>

              {!s.accountStatus || s.accountStatus === 'pending' ? (
                <p className="text-xs text-amber-600 text-center bg-amber-50 rounded-xl px-3 py-2">
                  Permissions will apply once staff activates their account.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Access Management Panel ───────────────────────────────

function AccessPanel({ staff, user, demoMode, inviteStaff, updateStaffAccess, revokeStaffAccess }) {
  const [showInvite,    setShowInvite]    = useState(false)
  const [inviteTarget,  setInviteTarget]  = useState(null)   // pre-fill name for HR staff invite
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

      {/* HR staff without portal access */}
      {(() => {
        const linkedIds = new Set(accessUsers.map(u => u.userId))
        const pendingNames = new Set(pendingInvites.map(i => i.name?.trim().toLowerCase()))
        const unlinked = (staff || []).filter(m =>
          m.status === 'Active' &&
          !m.userId &&
          !linkedIds.has(m.userId) &&
          !pendingNames.has(m.name?.trim().toLowerCase())
        )
        if (unlinked.length === 0) return null
        return (
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              HR Staff — No Portal Access ({unlinked.length})
            </p>
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="divide-y divide-gray-50">
                {unlinked.map(m => (
                  <div key={m.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm font-black text-gray-500 flex-shrink-0">
                      {m.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.role}</p>
                    </div>
                    <button
                      onClick={() => { setInviteTarget(m.name); setShowInvite(true) }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100 transition"
                    >
                      Assign Access
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

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
          onClose={() => { setShowInvite(false); setInviteTarget(null) }}
          onGenerated={handleInviteGenerated}
          inviteStaff={inviteStaff}
          initialName={inviteTarget || ''}
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

function InviteModal({ onClose, onGenerated, inviteStaff, initialName = '' }) {
  const [name,        setName]        = useState(initialName)
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
          <div className="flex justify-end -mt-2 -mb-3">
            <DevFillButton onFill={() => {
              const d = fillInvite()
              setName(d.name)
              applyPreset(d.accessRole)
            }} />
          </div>
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
                .filter(([group]) => group !== 'Training' || (selectedSport || '').toLowerCase() === 'football')
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
  const { selectedSport } = useApp()
  const isFootball = (selectedSport || '').toLowerCase() === 'football'
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
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
              {Object.entries(PERMISSION_GROUPS).filter(([group]) => group !== 'Training' || isFootball).map(([group, perms]) => (
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

// ── Staff Attendance Panel (owner view) ───────────────────

function StaffAttendancePanel({ staff, user, demoMode }) {
  const today = new Date().toISOString().split('T')[0]
  const [date,    setDate]    = useState(today)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (demoMode || !user?.academyId) return
    setLoading(true)
    db.fetchStaffAttendanceForDate(user.academyId, date)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [date, user?.academyId, demoMode])

  const activeStaff = staff.filter(s => s.status === 'Active')
  const presentSet  = new Set(records.map(r => r.staff_name?.toLowerCase().trim()))
  const presentCount = activeStaff.filter(s => presentSet.has(s.name?.toLowerCase().trim())).length

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-gray-700">Date</label>
          <input
            type="date"
            className="input py-1.5 text-sm"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <p className="text-xs text-gray-400 hidden sm:block">{dateLabel}</p>
        <div className="flex items-center gap-3 ml-auto">
          <div className="text-center">
            <p className="text-xl font-black text-emerald-600">{presentCount}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Present</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-xl font-black text-red-400">{activeStaff.length - presentCount}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Absent</p>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-center">
            <p className="text-xl font-black text-gray-900">{activeStaff.length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Total</p>
          </div>
        </div>
      </div>

      {demoMode ? (
        <div className="card p-8 text-center">
          <CalendarCheck size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">Not available in demo mode</p>
          <p className="text-xs text-gray-400 mt-1">Staff QR check-ins are recorded here in production</p>
        </div>
      ) : loading ? (
        <div className="card p-8 flex items-center justify-center">
          <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      ) : activeStaff.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-gray-400">No active staff members found.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Name</span>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Role</span>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Status</span>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Clock In</span>
          </div>
          <div className="divide-y divide-gray-50">
            {activeStaff.map(s => {
              const record = records.find(r => r.staff_name?.toLowerCase().trim() === s.name?.toLowerCase().trim())
              return (
                <div key={s.id} className="grid md:grid-cols-[2fr_1fr_1fr_1fr] gap-3 md:gap-4 items-center px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    {s.photoUrl ? (
                      <img src={s.photoUrl} alt={s.name} className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 bg-gradient-to-br from-brand-400 to-brand-600 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {s.name[0]}
                      </div>
                    )}
                    <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                  </div>
                  <p className="text-xs text-gray-500">{s.role}</p>
                  <div>
                    {record ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 rounded-full">
                        <CheckCircle size={11} /> Present
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-0.5 rounded-full">
                        Absent
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-gray-600">{record ? record.check_in_time : '—'}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function AddStaffModal({ onClose, onSave, demoMode }) {
  const { selectedSport, selectedBranch, sportBranches, role, user, permissions: myPerms, allStaff } = useApp()
  const isOwner = role === 'owner'
  // Non-owner creators may only grant permissions they themselves hold (no escalation).
  const allowedPerm = (p) => isOwner || (myPerms || []).includes(p)
  const fileRef = useRef(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoFile,    setPhotoFile]    = useState(null)
  // Owners: auto-set from selected sport. Non-owners: pre-select their own sport (still editable).
  const defaultSports = isOwner
    ? (selectedSport && selectedSport !== 'All' ? [selectedSport] : [])
    : (user?.sports?.length ? [user.sports[0]] : [])
  // Resolve the human-readable name of the auto-linked branch for the hint.
  // Branch managers: their own branch is always auto-linked (migration 0080 enforces server-side).
  const effectiveBranchId = selectedBranch || (role !== 'owner' ? user?.branchId : null) || null
  const linkedBranchName = effectiveBranchId
    ? (sportBranches?.find?.(b => b.id === effectiveBranchId)?.branch_name || null)
    : null
  const [form, setForm] = useState({
    name: '', role: '', phone: '', age: '', sports: defaultSports, status: 'Active', staffType: 'coach',
  })
  // Keep sports in sync with the owner's selected sport (owners only).
  useEffect(() => {
    if (!isOwner) return
    setForm(f => ({ ...f, sports: selectedSport && selectedSport !== 'All' ? [selectedSport] : [] }))
  }, [selectedSport, isOwner])
  const [giveAccess,   setGiveAccess]   = useState(false)
  const [portalType,   setPortalType]   = useState('field')  // 'field' | 'office'
  const [accessRole,   setAccessRole]   = useState('coach')
  const [perms,        setPerms]        = useState([])
  const [inviteLink,   setInviteLink]   = useState(null)
  const [activationInfo, setActivationInfo] = useState(null) // { staffCode, joinCode }
  const [copied,       setCopied]       = useState(false)
  const [codeCopied,   setCodeCopied]   = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [fieldErrors,  setFieldErrors]  = useState({})

  const FIELD_PERMS = ['attendance.manage', 'students.view', 'batches.view'].filter(allowedPerm)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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

  // Office staff permission groups — attendance is field-only.
  // Non-owners only see permission options they themselves hold.
  const OFFICE_GROUPS = Object.entries(PERMISSION_GROUPS)
    .filter(([g]) => g !== 'Attendance')
    .filter(([g]) => g !== 'Training' || (selectedSport || '').toLowerCase() === 'football')
    .map(([g, gPerms]) => [g, gPerms.filter(allowedPerm)])
    .filter(([, gPerms]) => gPerms.length > 0)

  const handleSave = async () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.role.trim()) errs.role = 'HR role is required'
    const ageNum = Number(form.age)
    if (!form.age || !Number.isFinite(ageNum) || ageNum < 16 || ageNum > 70) {
      errs.age = 'Enter an age between 16 and 70'
    }
    const phoneDigits = form.phone.replace('+91', '').replace(/\D/g, '')
    if (phoneDigits.length !== 10) errs.phone = 'Enter a valid 10-digit number'
    else {
      const dup = (allStaff || []).find(m => m.phone?.replace(/^\+91/, '').replace(/\D/g, '') === phoneDigits)
      if (dup) errs.phone = `Number already used by ${dup.name}`
    }
    if (!isOwner && form.sports.length === 0) errs.sport = 'Select a sport'
    if (Object.keys(errs).length) { setFieldErrors(errs); return }
    setFieldErrors({})
    setLoading(true)
    setSaveError('')
    try {
      const accessConfig = giveAccess ? { accessRole, permissions: perms } : null
      const result = await onSave(form, photoFile, accessConfig)
      if (result?.activationInfo) setActivationInfo(result.activationInfo)
      if (result?.inviteLink)     setInviteLink(result.inviteLink)
    } catch (err) {
      setSaveError(err.message || 'Failed to add staff')
    } finally {
      setLoading(false)
    }
  }

  const copyCode = () => {
    if (!activationInfo) return
    const link = `${window.location.origin}/staff-activate?id=${activationInfo.staffCode}&code=${activationInfo.joinCode}`
    navigator.clipboard.writeText(link)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Success screen — show activation codes (and optional invite link)
  if (activationInfo) {
    const regLink = `${window.location.origin}/staff-activate?id=${activationInfo.staffCode}&code=${activationInfo.joinCode}`
    return (
      <Modal title="Staff Added!" onClose={onClose}>
        <div className="text-center py-4 space-y-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={28} className="text-emerald-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900">{form.name} added successfully</p>
            <p className="text-sm text-gray-500 mt-1">Send this link so they can register their email and set a password</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left space-y-2">
            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Registration Link</p>
            <p className="text-xs text-gray-700 break-all font-mono leading-relaxed">{regLink}</p>
          </div>
          <button
            onClick={copyCode}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition ${codeCopied ? 'bg-emerald-600 text-white' : 'bg-brand-600 hover:bg-brand-700 text-white'}`}
          >
            {codeCopied ? <><Check size={14}/> Copied!</> : <><Copy size={14}/> Copy Link</>}
          </button>
          <p className="text-[11px] text-gray-400">Staff opens the link, enters their email and sets a password. They can then login at <span className="font-semibold text-gray-600">/staff-login</span></p>
          <button onClick={onClose} className="w-full btn-secondary text-sm">Done</button>
        </div>
      </Modal>
    )
  }

  const handleDevFill = () => {
    const data = fillStaff({ sportOptions: selectedSport && selectedSport !== 'All' ? [selectedSport] : SPORTS })
    setForm(f => ({
      ...f,
      name: data.name, role: data.role, phone: data.phone, age: data.age,
      // Non-owners have sport locked to their branch — don't override it
      ...(isOwner ? { sports: data.sports } : {}),
    }))
    setGiveAccess(true)
    selectPortalType(Math.random() > 0.5 ? 'field' : 'office')
  }

  return (
    <Modal title="Add Staff Member" onClose={onClose}>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        <div className="flex justify-end -mb-3">
          <DevFillButton onFill={handleDevFill} />
        </div>

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
              <label className="label">Staff Type</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'coach',  label: 'Coach / Field Staff',  color: 'brand' },
                  { value: 'office', label: 'Office Staff',          color: 'purple' },
                ].map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('staffType', t.value)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border-2 transition text-left ${
                      form.staffType === t.value
                        ? t.color === 'brand'
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Full Name *</label>
              <input className={`input ${fieldErrors.name ? 'border-red-400' : ''}`} placeholder="Staff name" value={form.name} onChange={e => { set('name', e.target.value); setFieldErrors(f => ({ ...f, name: '' })) }} />
              {fieldErrors.name && <p className="text-[11px] text-red-500 mt-1">{fieldErrors.name}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">HR Role *</label>
                <input className={`input ${fieldErrors.role ? 'border-red-400' : ''}`} placeholder="e.g. Head Coach, Admin…" value={form.role}
                  onChange={e => { set('role', e.target.value); setFieldErrors(f => ({ ...f, role: '' })) }} />
                {fieldErrors.role && <p className="text-[11px] text-red-500 mt-1">{fieldErrors.role}</p>}
              </div>
              <div>
                <label className="label">Age *</label>
                <input className={`input ${fieldErrors.age ? 'border-red-400' : ''}`} placeholder="Years" type="number" min="16" max="70" value={form.age}
                  onChange={e => { set('age', e.target.value); setFieldErrors(f => ({ ...f, age: '' })) }} />
                {fieldErrors.age && <p className="text-[11px] text-red-500 mt-1">{fieldErrors.age}</p>}
              </div>
            </div>
            <div>
              <label className="label">Phone *</label>
              <div className="flex">
                <span className="flex items-center px-3 bg-gray-50 border border-r-0 border-gray-200 rounded-l-xl text-sm font-semibold text-gray-500 select-none">+91</span>
                <input
                  className={`input rounded-l-none flex-1 ${fieldErrors.phone ? 'border-red-400' : ''}`}
                  placeholder="9876543210"
                  maxLength={10}
                  inputMode="numeric"
                  value={form.phone.startsWith('+91') ? form.phone.slice(3) : form.phone}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
                    set('phone', digits ? '+91' + digits : '')
                    setFieldErrors(f => ({ ...f, phone: '' }))
                  }}
                />
              </div>
              {fieldErrors.phone && <p className="text-[11px] text-red-500 mt-1">{fieldErrors.phone}</p>}
            </div>
            {/* Sport: owners see a read-only hint; branch managers pick explicitly */}
            {isOwner ? (
              (form.sports.length > 0 || linkedBranchName) && (
                <div className="text-[11px] text-gray-400 -mt-1 space-y-0.5">
                  {form.sports.length > 0 && (
                    <div>
                      Sport: <span className="font-semibold text-gray-600">{form.sports.join(', ')}</span>
                      <span className="ml-1">(auto-linked from your sport selection)</span>
                    </div>
                  )}
                  {linkedBranchName && (
                    <div>
                      Branch: <span className="font-semibold text-gray-600">{linkedBranchName}</span>
                      <span className="ml-1">(auto-linked — staff will only see this branch's data)</span>
                    </div>
                  )}
                  {!linkedBranchName && (
                    <div className="text-amber-600">
                      ⚠ No branch selected — this staff will see <strong>all branches</strong>. Switch to a specific branch first if you want them scoped.
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="-mt-1 space-y-1.5">
                <div>
                  <label className="label">Sport</label>
                  <div className="input bg-gray-50 text-gray-700 flex items-center gap-2 cursor-not-allowed select-none">
                    {form.sports[0] || '—'}
                    <span className="ml-auto text-[10px] text-gray-400 font-semibold uppercase tracking-wide">locked to your branch</span>
                  </div>
                  {fieldErrors.sport && <p className="text-[11px] text-red-500 mt-1">{fieldErrors.sport}</p>}
                </div>
                {linkedBranchName && (
                  <div>
                    <label className="label">Branch</label>
                    <div className="input bg-gray-50 text-gray-700 flex items-center gap-2 cursor-not-allowed select-none">
                      {linkedBranchName}
                      <span className="ml-auto text-[10px] text-gray-400 font-semibold uppercase tracking-wide">locked to your branch</span>
                    </div>
                  </div>
                )}
              </div>
            )}
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

      {saveError && (
        <div className="mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 break-all">
          {saveError}
        </div>
      )}
      <div className="flex justify-end gap-3 mt-3 pt-4 border-t border-gray-100">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>
          {loading ? '…' : giveAccess ? 'Add & Send Invite' : 'Add Staff Member'}
        </button>
      </div>
    </Modal>
  )
}
