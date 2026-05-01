import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CalendarCheck, CreditCard, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Layers, UserCog, BarChart3, Megaphone, Settings, UserPlus, LogOut, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const primary = [
  { to: '/dashboard',  label: 'Home',       icon: LayoutDashboard },
  { to: '/students',   label: 'Students',   icon: Users },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/payments',   label: 'Payments',   icon: CreditCard },
]

const more = [
  { to: '/trials',    label: 'Trials',     icon: UserPlus },
  { to: '/batches',   label: 'Batches',    icon: Layers },
  { to: '/staff',     label: 'Staff',      icon: UserCog },
  { to: '/reports',   label: 'Reports',    icon: BarChart3 },
  { to: '/community', label: 'Community',  icon: Megaphone },
  { to: '/settings',  label: 'Settings',   icon: Settings },
]

export default function BottomNav() {
  const [showMore, setShowMore] = useState(false)
  const { logout } = useApp()
  const navigate = useNavigate()

  return (
    <>
      {/* More sheet overlay */}
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
            <div className="grid grid-cols-3 gap-3">
              {more.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-semibold transition ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                    }`
                  }
                >
                  <Icon size={22} />
                  {label}
                </NavLink>
              ))}
            </div>
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition"
            >
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </>
      )}

      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex items-center safe-pb">
        {primary.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
          <div className="p-1.5 rounded-xl">
            <MoreHorizontal size={20} />
          </div>
          More
        </button>
      </nav>
    </>
  )
}
