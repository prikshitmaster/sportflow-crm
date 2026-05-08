import { Bell, Search, Menu } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocation } from 'react-router-dom'

const titles = {
  '/dashboard':  'Dashboard',
  '/students':   'Students',
  '/attendance': 'Attendance',
  '/payments':   'Payments',
  '/trials':     'Trial Management',
  '/batches':    'Batch Management',
  '/coaches':    'Staff & Coaches',
  '/reports':    'Reports & Analytics',
  '/community':  'Community Updates',
  '/settings':   'Settings',
  '/gate-qr':    'Gate QR Code',
}

export default function Header({ onMenuClick }) {
  const { user } = useApp()
  const { pathname } = useLocation()
  const title = titles[pathname] || 'SportFlow CRM'

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center px-6 gap-4 sticky top-0 z-30">
      <button onClick={onMenuClick} className="p-2 rounded-lg hover:bg-gray-100 transition lg:hidden">
        <Menu size={20} className="text-gray-600" />
      </button>

      <div>
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-52">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            placeholder="Search..."
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
          />
        </div>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition">
          <Bell size={20} className="text-gray-600" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

        {/* Avatar */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold">
            {user?.name?.[0] || 'A'}
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-semibold text-gray-800 leading-tight">{user?.name}</p>
            <p className="text-[10px] text-gray-400 leading-tight capitalize">{user?.role || 'Owner'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
