import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Home, Users, UserCircle, QrCode, Bell, CalendarCheck, Zap, LogOut, ClipboardList } from 'lucide-react'

const coachTabs = [
  { to: '/staff/home',       label: 'Home',   icon: Home },
  { to: '/staff/attendance', label: 'Attend', icon: CalendarCheck },
  { to: '/staff/assess',     label: 'Assess', icon: ClipboardList },
  { to: '/staff/notices',    label: 'Notices',icon: Bell },
  { to: '/staff/profile',    label: 'Me',     icon: UserCircle },
]

const officeTabs = [
  { to: '/staff/home',       label: 'Home',    icon: Home },
  { to: '/staff/scan-in',    label: 'Scan In', icon: QrCode },
  { to: '/staff/notices',    label: 'Notices', icon: Bell },
  { to: '/staff/profile',    label: 'Me',      icon: UserCircle },
]

export default function StaffLayout() {
  const { user, logoutStaff } = useApp()
  const navigate = useNavigate()

  const isOffice = user?.accessRole && !['coach', 'staff'].includes(user.accessRole)
  const tabs = isOffice ? officeTabs : coachTabs
  const badge = isOffice ? 'Office' : 'Coach'
  const badgeColor = isOffice ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'

  const handleLogout = async () => { await logoutStaff(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
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
          {user && <p className="text-xs font-semibold text-gray-700 truncate max-w-[140px]">{user.name}</p>}
          <button onClick={handleLogout} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-20 animate-fade-in">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex max-w-md mx-auto">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-2.5 transition-all ${
                isActive ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-xl ${isActive ? 'bg-brand-50' : ''}`}>
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                </div>
                <span className="text-[10px] font-semibold">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
