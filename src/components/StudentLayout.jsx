import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Suspense, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import {
  Home, QrCode, CalendarCheck, CreditCard, Megaphone, LogOut, Zap, Target,
} from 'lucide-react'
import NotificationBell from './NotificationBell'

function PageSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4 animate-pulse">
      <div className="h-28 bg-brand-100 rounded-2xl" />
      <div className="h-16 bg-gray-100 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 bg-gray-100 rounded-2xl" />
        <div className="h-20 bg-gray-100 rounded-2xl" />
      </div>
      <div className="h-24 bg-gray-100 rounded-2xl" />
    </div>
  )
}

const tabs = [
  { to: '/student/dashboard',     label: 'Home',     icon: Home },
  { to: '/student/scan',          label: 'Scan',     icon: QrCode },
  { to: '/student/attendance',    label: 'Attend',   icon: CalendarCheck },
  { to: '/student/progress',      label: 'Progress', icon: Target },
  { to: '/student/payments',      label: 'Fees',     icon: CreditCard },
  { to: '/student/announcements', label: 'Notice',   icon: Megaphone },
]

export default function StudentLayout() {
  const { studentUser, logoutStudent, academyLogo } = useApp()
  const navigate = useNavigate()

  useEffect(() => {
    // Prefetch all student page chunks in background so tab switches are instant
    import('../pages/student/StudentAttendance')
    import('../pages/student/StudentPayments')
    import('../pages/student/StudentAnnouncements')
    import('../pages/student/StudentStats')
    import('../pages/student/StudentProgress')
    import('../pages/student/StudentScan')
  }, [])

  const handleLogout = async () => {
    await logoutStudent()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center overflow-hidden">
            {academyLogo
              ? <img src={academyLogo} alt="logo" className="w-full h-full object-cover" />
              : <Zap size={13} className="text-white" />}
          </div>
          <span className="font-bold text-gray-900 text-sm">SportFlow</span>
        </div>
        <div className="flex items-center gap-2">
          {studentUser && (
            <div className="hidden xs:block text-right">
              <p className="text-xs font-semibold text-gray-800 leading-tight">{studentUser.name}</p>
              <p className="text-[10px] text-brand-600 font-mono leading-tight">{studentUser.student_code}</p>
            </div>
          )}
          <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-sm font-bold text-brand-700">
            {studentUser?.name?.[0] || 'S'}
          </div>
          <NotificationBell
            recipientType="student"
            recipientId={studentUser?.id}
            academyId={studentUser?.academy_id}
          />
          <button onClick={handleLogout} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto pb-20" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        <Suspense fallback={<PageSkeleton />}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
                <span className={`text-[10px] font-semibold ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
