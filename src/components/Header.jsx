import { Bell, Search, Menu, Trophy, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocation, useNavigate } from 'react-router-dom'

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
  const { user, role, selectedSport, selectedBranch, sportBranches } = useApp()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const title = titles[pathname] || 'SportFlow CRM'

  const branchName = selectedBranch
    ? sportBranches.find(b => b.id === selectedBranch)?.branchName
    : null

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center px-4 gap-3 sticky top-0 z-30">
      <button onClick={onMenuClick} className="p-2 rounded-lg hover:bg-gray-100 transition lg:hidden">
        <Menu size={20} className="text-gray-600" />
      </button>

      <div className="min-w-0">
        <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
      </div>

      {/* Sport/branch chip — mobile only (desktop sidebar handles this) */}
      {role === 'owner' && selectedSport && selectedSport !== 'All' && (
        <button
          onClick={() => navigate('/sport-select')}
          className="lg:hidden flex items-center gap-1.5 bg-brand-50 border border-brand-200 text-brand-700 rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 max-w-[130px]"
        >
          <Trophy size={11} className="flex-shrink-0" />
          <span className="truncate">{branchName || selectedSport}</span>
          <RefreshCw size={10} className="flex-shrink-0 text-brand-500" />
        </button>
      )}

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
