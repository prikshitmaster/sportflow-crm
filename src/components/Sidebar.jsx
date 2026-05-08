// Sidebar — owner portal (desktop)
// Nav items are filtered by feature flags set in Settings → Features
// feature: null means always visible (no toggle needed)

import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  LayoutDashboard, Users, CalendarCheck, CreditCard, UserPlus,
  Layers, UserCog, BarChart3, Megaphone, Settings, LogOut,
  Zap, ChevronLeft, QrCode, Trophy,
} from 'lucide-react'
import { useState } from 'react'

const nav = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard, feature: null,        permission: 'dashboard.view' },
  { to: '/students',   label: 'Students',   icon: Users,            feature: null,        permission: 'students.view' },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck,   feature: 'attendance', permission: 'attendance.manage' },
  { to: '/payments',   label: 'Payments',   icon: CreditCard,      feature: 'payments',   permission: 'payments.view' },
  { to: '/trials',     label: 'Trials',     icon: UserPlus,        feature: 'trials',     permission: 'trials.manage' },
  { to: '/batches',    label: 'Batches',    icon: Layers,          feature: 'batches',    permission: 'batches.view' },
  { to: '/gate-qr',    label: 'Gate QR',    icon: QrCode,          feature: 'gate_qr',   permission: 'attendance.manage' },
  { to: '/events',     label: 'Events',     icon: Trophy,          feature: 'events',     permission: 'events.manage' },
  { to: '/coaches',    label: 'Staff',      icon: UserCog,         feature: 'staff',      permission: 'staff.manage' },
  { to: '/reports',    label: 'Reports',    icon: BarChart3,       feature: 'reports',    permission: 'reports.view' },
  { to: '/community',  label: 'Community',  icon: Megaphone,       feature: 'community',  permission: 'community.manage' },
  { to: '/settings',   label: 'Settings',   icon: Settings,        feature: null,         permission: 'settings.manage' },
]

export default function Sidebar({ collapsed, setCollapsed }) {
  const { user, role, isFeatureOn, hasPermission, logoutOwner } = useApp()
  const navigate = useNavigate()

  // Owner sees all feature-enabled items; admin sees only items they have permission for
  const visible = nav.filter(item => {
    const featureOk = item.feature === null || isFeatureOn(item.feature)
    const permOk    = role === 'owner' || item.permission === null || hasPermission(item.permission)
    return featureOk && permOk
  })

  const handleLogout = async () => { await logoutOwner(); navigate('/login') }

  return (
    <aside className={`fixed top-0 left-0 h-full z-40 flex flex-col bg-gray-900 text-white transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-gray-800 ${collapsed ? 'justify-center' : ''}`}>
        <div className="flex-shrink-0 w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
          <Zap size={16} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-sm font-bold text-white leading-tight">SportFlow</p>
            <p className="text-[10px] text-gray-400 leading-tight">CRM</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className={`ml-auto p-1 rounded-md hover:bg-gray-800 transition ${collapsed ? 'hidden' : ''}`}
        >
          <ChevronLeft size={14} className="text-gray-400" />
        </button>
      </div>

      {/* Academy + role badge */}
      {!collapsed && user && (
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400">Academy</p>
          <p className="text-xs font-semibold text-gray-200 truncate">{user.academy}</p>
          <span className="inline-block mt-1 text-[10px] bg-brand-800 text-brand-300 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide">
            {user.role === 'owner' ? 'Owner' : user.role}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visible.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-gray-800 px-2 py-3">
        {!collapsed && user && (
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-semibold text-white truncate">{user.name}</p>
            <p className="text-[11px] text-gray-400 truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-red-400 transition w-full ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Logout' : undefined}
        >
          <LogOut size={18} />
          {!collapsed && 'Logout'}
        </button>
      </div>
    </aside>
  )
}
