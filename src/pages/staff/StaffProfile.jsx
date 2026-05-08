// Staff "Me" profile tab — notifications + settings + logout

import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, UserCircle, ChevronRight } from 'lucide-react'

export default function StaffProfile() {
  const { user, logoutStaff, leaveRequests, loadLeaveRequests } = useApp()
  const navigate = useNavigate()

  const approvedLeaves = leaveRequests.filter(r => r.status === 'Approved').length
  const rejectedLeaves = leaveRequests.filter(r => r.status === 'Rejected').length

  const handleLogout = async () => {
    await logoutStaff()
    navigate('/login')
  }

  return (
    <div className="px-4 pt-5 pb-4 space-y-4">

      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
        <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center text-2xl font-black text-brand-700 flex-shrink-0">
          {user?.name?.[0] || 'C'}
        </div>
        <div>
          <p className="font-black text-gray-900 text-base">{user?.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{user?.email}</p>
          <p className="text-xs text-brand-600 font-semibold mt-1">{user?.academy}</p>
        </div>
      </div>

      {/* Leave summary */}
      {leaveRequests.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Leave Summary</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-black text-amber-600">{leaveRequests.filter(r => r.status === 'Pending').length}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Pending</p>
            </div>
            <div>
              <p className="text-xl font-black text-emerald-600">{approvedLeaves}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Approved</p>
            </div>
            <div>
              <p className="text-xl font-black text-red-500">{rejectedLeaves}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Rejected</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
        <button onClick={() => navigate('/staff/me')}
          className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left">
          <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center">
            <Bell size={15} className="text-purple-600" />
          </div>
          <span className="text-sm font-semibold text-gray-700 flex-1">Leave & Schedule</span>
          <ChevronRight size={14} className="text-gray-300" />
        </button>
        <button onClick={() => navigate('/staff/roster')}
          className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left">
          <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center">
            <UserCircle size={15} className="text-brand-600" />
          </div>
          <span className="text-sm font-semibold text-gray-700 flex-1">Student Roster</span>
          <ChevronRight size={14} className="text-gray-300" />
        </button>
      </div>

      {/* Logout */}
      <button onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-red-50 text-red-600 font-bold text-sm border border-red-100 active:bg-red-100 transition">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  )
}
