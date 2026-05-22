import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Suspense } from 'react'
import { useApp } from '../context/AppContext'
import { Home, CreditCard, Bell, Settings, LogOut, Zap } from 'lucide-react'

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
  { to: '/parent/home',     label: 'Home',    icon: Home },
  { to: '/parent/payments', label: 'Pay',     icon: CreditCard },
  { to: '/parent/notices',  label: 'Notices', icon: Bell },
  { to: '/parent/me',       label: 'Me',      icon: Settings },
]

export default function ParentLayout() {
  const { parentUser, logoutParent } = useApp()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logoutParent()
    navigate('/parent-login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <Zap size={13} className="text-white" />
          </div>
          <span className="font-bold text-gray-900 text-sm">SportFlow</span>
        </div>
        <div className="flex items-center gap-2">
          {parentUser && (
            <div className="hidden xs:block text-right">
              <p className="text-xs font-semibold text-gray-800 leading-tight">{parentUser.name}</p>
              <p className="text-[10px] text-gray-400 leading-tight">Parent</p>
            </div>
          )}
          <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-sm font-bold text-brand-700">
            {parentUser?.name?.[0] || 'P'}
          </div>
          <button onClick={handleLogout} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-20" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
        <Suspense fallback={<PageSkeleton />}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Suspense>
      </main>

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
