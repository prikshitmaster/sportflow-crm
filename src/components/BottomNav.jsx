// BottomNav — owner mobile navigation
// Primary 4 items always visible; "More" sheet shows the rest
// Both lists are filtered by feature flags

import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  LayoutDashboard, Users, CalendarCheck, CreditCard,
  MoreHorizontal, X, LogOut,
  UserPlus, Layers, UserCog, BarChart3, Megaphone, Settings, QrCode, Trophy, RefreshCw, BookOpen, CalendarDays,
} from 'lucide-react'

// Primary bar items
const primaryItems = [
  { to: '/dashboard',  label: 'Home',       icon: LayoutDashboard, feature: null,         permission: 'dashboard.view' },
  { to: '/students',   label: 'Students',   icon: Users,            feature: null,         permission: 'students.view' },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck,   feature: 'attendance', permission: 'attendance.manage' },
  { to: '/payments',   label: 'Payments',   icon: CreditCard,      feature: 'payments',   permission: 'payments.view' },
]

// "More" sheet — everything else
const moreItems = [
  { to: '/trials',    label: 'Trials',    icon: UserPlus,  feature: 'trials',    permission: 'trials.manage' },
  { to: '/batches',   label: 'Batches',   icon: Layers,    feature: 'batches',   permission: 'batches.view' },
  { to: '/gate-qr',   label: 'Gate QR',   icon: QrCode,    feature: 'gate_qr',  permission: 'attendance.manage' },
  { to: '/events',    label: 'Events',    icon: Trophy,    feature: 'events',   permission: 'events.manage' },
  { to: '/coaches',   label: 'Staff',     icon: UserCog,   feature: 'staff',    permission: 'staff.manage' },
  { to: '/reports',   label: 'Reports',   icon: BarChart3, feature: 'reports',  permission: 'reports.view' },
  { to: '/drills',    label: 'Drills',    icon: BookOpen,    feature: null,       permission: 'dashboard.view', footballOnly: true },
  { to: '/sessions',  label: 'Sessions',  icon: CalendarDays,feature: null,       permission: 'dashboard.view', footballOnly: true },
  { to: '/community', label: 'Community', icon: Megaphone, feature: 'community',permission: 'community.manage' },
  { to: '/settings',  label: 'Settings',  icon: Settings,  feature: null,       permission: 'settings.manage' },
]

export default function BottomNav() {
  const [showMore, setShowMore] = useState(false)
  const { isFeatureOn, logoutOwner, role, hasPermission, selectedSport, selectedBranch, sportBranches } = useApp()
  const navigate = useNavigate()

  const branchName = selectedBranch
    ? sportBranches.find(b => b.id === selectedBranch)?.branchName
    : null
  const sportLabel = branchName || selectedSport

  const allow = item => {
    const featureOk  = item.feature === null || isFeatureOn(item.feature)
    const permOk     = role === 'owner' || item.permission === null || hasPermission(item.permission)
    const footballOk = !item.footballOnly || !selectedSport || selectedSport.toLowerCase() === 'football'
    return featureOk && permOk && footballOk
  }

  const primary = primaryItems.filter(allow)
  const more    = moreItems.filter(allow)

  const handleLogout = async () => { await logoutOwner(); navigate('/login') }

  return (
    <>
      {/* "More" sheet overlay */}
      {showMore && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowMore(false)} />
          <div className="fixed bottom-16 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-gray-900">More</p>
              <button onClick={() => setShowMore(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            {/* Sport / branch switcher */}
            {role === 'owner' && sportLabel && sportLabel !== 'All' && (
              <button
                onClick={() => { setShowMore(false); navigate('/sport-select') }}
                className="w-full flex items-center gap-3 px-4 py-3 mb-3 rounded-xl bg-brand-50 border border-brand-100 text-brand-700"
              >
                <Trophy size={16} className="text-brand-500 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs text-brand-500 font-medium leading-none mb-0.5">Currently viewing</p>
                  <p className="text-sm font-bold truncate">{sportLabel}</p>
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold text-brand-600">
                  <RefreshCw size={12} /> Switch
                </div>
              </button>
            )}

            <div className="grid grid-cols-3 gap-3">
              {more.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-semibold transition ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  <Icon size={22} /> {label}
                </NavLink>
              ))}
            </div>
            <button onClick={handleLogout}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition">
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </>
      )}

      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex items-center safe-pb">
        {primary.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
                isActive ? 'text-brand-600' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-xl transition ${isActive ? 'bg-brand-50' : ''}`}>
                  <Icon size={20} />
                </div>
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={() => setShowMore(s => !s)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-gray-400"
        >
          <div className="p-1.5 rounded-xl"><MoreHorizontal size={20} /></div>
          More
        </button>
      </nav>
    </>
  )
}
