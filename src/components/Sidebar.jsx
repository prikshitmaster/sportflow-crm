// Sidebar — owner portal (desktop)
// Nav items are filtered by feature flags set in Settings → Features
// feature: null means always visible (no toggle needed)
// Groups: items with `group` key are collapsed under a single parent row

import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  LayoutDashboard, Users, CalendarCheck, CreditCard, UserPlus,
  Layers, UserCog, BarChart3, Megaphone, Settings, LogOut,
  Zap, ChevronLeft, QrCode, Trophy, RefreshCw, BookOpen, CalendarDays,
  ChevronDown, ChevronRight, UserCircle, ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'

// Items with the same `group` string are nested under a collapsible parent.
// The parent row uses the first item's icon by default; override with `groupIcon`.
const nav = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard, feature: null,        permission: 'dashboard.view' },
  { to: '/students',   label: 'Students',   icon: Users,            feature: null,        permission: 'students.view' },
  // Hidden — parent portal disabled for v1. Uncomment to re-enable:
  // { to: '/parents',    label: 'Parents',    icon: UserCircle,       feature: null,        permission: 'students.view' },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck,   feature: 'attendance', permission: 'attendance.manage' },
  { to: '/payments',   label: 'Payments',   icon: CreditCard,      feature: 'payments',   permission: 'payments.view' },
  { to: '/trials',     label: 'Trials',     icon: UserPlus,        feature: 'trials',     permission: 'trials.manage' },
  { to: '/batches',    label: 'Batches',    icon: Layers,          feature: 'batches',    permission: 'batches.view' },
  { to: '/gate-qr',    label: 'Gate QR',    icon: QrCode,          feature: 'gate_qr',   permission: 'attendance.manage', group: 'qr' },
  { to: '/staff-qr',   label: 'Staff QR',   icon: QrCode,          feature: 'attendance', permission: 'staff.manage',      group: 'qr' },
  { to: '/events',     label: 'Events',     icon: Trophy,          feature: 'events',     permission: 'events.manage' },
  { to: '/sessions',   label: 'Sessions',   icon: CalendarDays,    feature: null,         permission: 'dashboard.view', footballOnly: true, group: 'training' },
  { to: '/drills',     label: 'Drills',     icon: BookOpen,        feature: null,         permission: 'dashboard.view', footballOnly: true, group: 'training' },
  { to: '/coaches',    label: 'Staff',      icon: UserCog,         feature: 'staff',      permission: 'staff.manage' },
  { to: '/reports',    label: 'Reports',    icon: BarChart3,       feature: 'reports',    permission: 'reports.view' },
  { to: '/community',  label: 'Community',  icon: Megaphone,       feature: 'community',  permission: 'community.manage' },
  { to: '/settings',   label: 'Settings',   icon: Settings,        feature: null,         permission: 'settings.manage' },
  { to: '/backups',    label: 'Backups',    icon: ShieldCheck,     feature: null,         permission: 'settings.manage' },
]

const GROUP_META = {
  qr:       { label: 'QR Codes',  icon: QrCode },
  training: { label: 'Training',  icon: CalendarDays },
}

export default function Sidebar({ collapsed, setCollapsed }) {
  const { user, role, isFeatureOn, hasPermission, logoutOwner, selectedSport, selectedBranch, sportBranches } = useApp()
  const currentBranchName = selectedBranch
    ? (sportBranches || []).find(b => b.id === selectedBranch)?.branchName
    : null
  const navigate  = useNavigate()
  const location  = useLocation()

  // Track which groups are open; auto-open if current route is inside the group
  const activeGroups = new Set(
    nav.filter(i => i.group && location.pathname.startsWith(i.to)).map(i => i.group)
  )
  const [openGroups, setOpenGroups] = useState(() => activeGroups)

  const toggleGroup = (key) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const isItemVisible = (item) => {
    const featureOk  = item.feature === null || isFeatureOn(item.feature)
    const permOk     = role === 'owner' || item.permission === null || hasPermission(item.permission)
    const footballOk = !item.footballOnly || !selectedSport || selectedSport.toLowerCase() === 'football'
    return featureOk && permOk && footballOk
  }

  // Build the list of things to render: plain items OR group-header + children
  const rendered = []
  const seenGroups = new Set()

  for (const item of nav) {
    if (!isItemVisible(item)) continue
    if (!item.group) {
      rendered.push({ type: 'item', item })
      continue
    }
    if (!seenGroups.has(item.group)) {
      seenGroups.add(item.group)
      const children = nav.filter(i => i.group === item.group && isItemVisible(i))
      if (children.length > 0) rendered.push({ type: 'group', key: item.group, children })
    }
  }

  const handleLogout = async () => { await logoutOwner(); navigate('/login') }

  const navLinkCls = (isActive) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
      isActive ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
    } ${collapsed ? 'justify-center' : ''}`

  return (
    <aside className={`fixed top-0 left-0 h-full z-40 flex flex-col bg-gray-900 text-white transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-gray-800 ${collapsed ? 'justify-center' : ''}`}
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))' }}>
        <div className="flex-shrink-0 w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center overflow-hidden">
          {user?.academyLogo
            ? <img src={user.academyLogo} alt="logo" className="w-full h-full object-cover" />
            : <Zap size={16} className="text-white" />}
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

      {/* Current sport context (owner only) */}
      {role === 'owner' && selectedSport && (
        collapsed ? (
          <button
            onClick={() => navigate('/sport-select')}
            className="mx-2 my-2 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition flex items-center justify-center"
            title={`${selectedSport} — click to switch`}
          >
            <Trophy size={16} className="text-brand-400" />
          </button>
        ) : (
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">Viewing</p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Trophy size={14} className="text-brand-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{selectedSport}</p>
                  {currentBranchName && (
                    <p className="text-[10px] text-purple-300 truncate leading-tight">· {currentBranchName}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => navigate('/sport-select')}
                className="flex items-center gap-1 text-[10px] font-bold text-brand-400 hover:text-brand-300 transition px-2 py-1 rounded-md hover:bg-gray-800"
                title="Switch sport"
              >
                <RefreshCw size={10} /> Switch
              </button>
            </div>
          </div>
        )
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {rendered.map((entry) => {
          if (entry.type === 'item') {
            const { to, label, icon: Icon } = entry.item
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => navLinkCls(isActive)}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            )
          }

          // Group
          const { key, children } = entry
          const meta      = GROUP_META[key]
          const GroupIcon = meta.icon
          const isOpen    = openGroups.has(key)
          const anyActive = children.some(c => location.pathname.startsWith(c.to))

          return (
            <div key={key}>
              {/* Group header */}
              <button
                onClick={() => {
                  if (collapsed) { setCollapsed(false); setOpenGroups(prev => { const n = new Set(prev); n.add(key); return n }) }
                  else toggleGroup(key)
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full
                  ${anyActive && !isOpen ? 'bg-brand-600/30 text-brand-300' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}
                  ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? meta.label : undefined}
              >
                <GroupIcon size={18} className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{meta.label}</span>
                    {isOpen
                      ? <ChevronDown size={13} className="text-gray-500" />
                      : <ChevronRight size={13} className="text-gray-500" />}
                  </>
                )}
              </button>

              {/* Children */}
              {!collapsed && isOpen && (
                <div className="ml-3 mt-0.5 pl-3 border-l border-gray-700 space-y-0.5">
                  {children.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          isActive ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                        }`
                      }
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
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
