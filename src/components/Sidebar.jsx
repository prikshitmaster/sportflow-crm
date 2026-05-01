import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  LayoutDashboard, Users, CalendarCheck, CreditCard, UserPlus,
  Layers, UserCog, BarChart3, Megaphone, Settings, LogOut, Zap, ChevronLeft,
} from 'lucide-react'
import { useState } from 'react'

const nav = [
  { to: '/dashboard',  label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/students',   label: 'Students',    icon: Users },
  { to: '/attendance', label: 'Attendance',  icon: CalendarCheck },
  { to: '/payments',   label: 'Payments',    icon: CreditCard },
  { to: '/trials',     label: 'Trials',      icon: UserPlus },
  { to: '/batches',    label: 'Batches',     icon: Layers },
  { to: '/staff',      label: 'Staff',       icon: UserCog },
  { to: '/reports',    label: 'Reports',     icon: BarChart3 },
  { to: '/community',  label: 'Community',   icon: Megaphone },
  { to: '/settings',   label: 'Settings',    icon: Settings },
]

export default function Sidebar({ collapsed, setCollapsed }) {
  const { user, logout } = useApp()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/') }

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

      {/* Academy name */}
      {!collapsed && user && (
        <div className="px-4 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-400">Academy</p>
          <p className="text-xs font-semibold text-gray-200 truncate">{user.academy}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
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
