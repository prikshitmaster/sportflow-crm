import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Suspense, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Home, Users, UserCircle, QrCode, Bell, CalendarCheck, Zap, LogOut, ClipboardList, UserPlus, CalendarDays } from 'lucide-react'
import NotificationBell from './NotificationBell'
import AiAssistant from './AiAssistant'

function PageSkeleton() {
  return (
    <div className="px-4 pt-5 space-y-4 animate-pulse">
      <div className="h-14 bg-gray-100 rounded-2xl" />
      <div className="h-20 bg-gray-100 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    </div>
  )
}

const BASE_COACH_TABS = [
  { to: '/staff/home',       label: 'Home',    icon: Home },
  { to: '/staff/sessions',   label: 'Sessions',icon: CalendarDays },
  { to: '/staff/attendance', label: 'Attend',  icon: CalendarCheck },
  { to: '/staff/assess',     label: 'Assess',  icon: ClipboardList },
  { to: '/staff/profile',    label: 'Me',      icon: UserCircle },
]

const BASE_OFFICE_TABS = [
  { to: '/staff/home',       label: 'Home',    icon: Home },
  { to: '/staff/scan-in',    label: 'Scan In', icon: QrCode },
  { to: '/staff/notices',    label: 'Notices', icon: Bell },
  { to: '/staff/profile',    label: 'Me',      icon: UserCircle },
]

const TRIALS_TAB = { to: '/staff/trials', label: 'Trials', icon: UserPlus }

export default function StaffLayout() {
  const { user, logoutStaff, hasPermission, selectedSport } = useApp()
  const navigate = useNavigate()

  // Use the staff member's own assigned sports (not the owner's context switcher)
  const isFootball = !user?.sports?.length ||
    user.sports.some(s => s.toLowerCase() === 'football')

  useEffect(() => {
    // Prefetch all staff page chunks so tab switches are instant
    import('../pages/staff/StaffMe')
    import('../pages/staff/StaffProfile')
    import('../pages/staff/StaffRoster')
    import('../pages/staff/StaffNotices')
    import('../pages/staff/StaffAttendance')
    import('../pages/staff/StaffScanIn')
    import('../pages/staff/StaffAssess')
    import('../pages/staff/StaffPulse')
    import('../pages/staff/StaffTrials')
    import('../pages/staff/SessionPlanner')
  }, [])

  const isOffice    = user?.accessRole && !['coach', 'staff'].includes(user.accessRole)
  const hasTrials   = hasPermission('trials.manage')
  const hasTraining = hasPermission('training.manage')
  const hasAttend   = hasPermission('attendance.manage')
  // Filter coach tabs by sport (football-only) and permissions
  const coachTabs = (isFootball
    ? BASE_COACH_TABS
    : BASE_COACH_TABS.filter(t => t.to !== '/staff/sessions' && t.to !== '/staff/assess')
  ).filter(t =>
    (t.to !== '/staff/sessions'   || hasTraining) &&
    (t.to !== '/staff/assess'     || hasTraining) &&
    (t.to !== '/staff/attendance' || hasAttend)
  )
  const baseTabs  = isOffice ? BASE_OFFICE_TABS : coachTabs
  const tabs = hasTrials
    ? isOffice
      ? [baseTabs[0], TRIALS_TAB, ...baseTabs.slice(1)]
      : [...baseTabs.slice(0, 3), TRIALS_TAB, ...baseTabs.slice(3)]
    : baseTabs
  const badge = isOffice ? 'Office' : 'Coach'
  const badgeColor = isOffice ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'

  const handleLogout = async () => { await logoutStaff(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center overflow-hidden">
            {user?.academyLogo
              ? <img src={user.academyLogo} alt="logo" className="w-full h-full object-cover" />
              : <Zap size={13} className="text-white" />}
          </div>
          <span className="font-bold text-gray-900 text-sm">SportFlow</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badgeColor}`}>{badge}</span>
        </div>
        <div className="flex items-center gap-2">
          {user && <p className="hidden xs:block text-xs font-semibold text-gray-700 truncate max-w-[100px]">{user.name}</p>}
          <NotificationBell
            recipientType="staff"
            recipientId={user?.id}
            academyId={user?.academyId}
          />
          <button onClick={handleLogout} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        <Suspense fallback={<PageSkeleton />}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex max-w-md mx-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 transition-all active:scale-90 ${
                isActive ? 'text-brand-600' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`relative p-1.5 rounded-xl transition-all duration-150 ${isActive ? 'bg-brand-50' : ''}`}>
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                  {isActive && (
                    <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-600" />
                  )}
                </div>
                <span className="text-[10px] font-semibold">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {isOffice && <AiAssistant />}
    </div>
  )
}
