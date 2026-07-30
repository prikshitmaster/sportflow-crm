import { Search, Menu, Trophy, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect } from 'react'
import NotificationBell from './NotificationBell'

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
  '/performance': 'Student Performance',
  '/sessions':   'Session Planner',
  '/drills':     'Drill Library',
  '/events':     'Events',
}

export default function Header({ onMenuClick }) {
  const { user, role, selectedSport, selectedBranch, sportBranches, students } = useApp()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const title = titles[pathname] || 'SportFlow CRM'

  const branchName = selectedBranch
    ? sportBranches.find(b => b.id === selectedBranch)?.branchName
    : null

  // ── Global student search ───────────────────────────────────────────────
  // `students` from context is already sport/branch-scoped, so results never
  // cross the branch you are viewing.
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef(null)

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) return []
    return (students || []).filter(s =>
      s.name?.toLowerCase().includes(term) ||
      s.parent?.toLowerCase().includes(term) ||
      s.phone?.includes(term) ||
      s.parentPhone?.includes(term) ||
      s.studentCode?.toLowerCase().includes(term)
    ).slice(0, 8)
  }, [q, students])

  useEffect(() => { setCursor(0) }, [q])

  // Click outside closes the dropdown
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (s) => {
    if (!s) return
    setQ(''); setOpen(false)
    // Students reads ?open= and pops that student's profile drawer.
    navigate(`/students?open=${s.id}`)
  }

  const onKeyDown = (e) => {
    if (!results.length) return
    if (e.key === 'ArrowDown')      { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); pick(results[cursor]) }
    else if (e.key === 'Escape')    { setOpen(false) }
  }

  return (
    <header className="bg-white border-b border-gray-100 flex items-center px-4 gap-3 sticky top-0 z-30"
      style={{ minHeight: '4rem', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
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
        {/* Search — students by name, parent, phone or ID */}
        <div ref={boxRef} className="hidden md:block relative">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-52 focus-within:border-gray-300 focus-within:bg-white transition-colors">
            <Search size={14} className="text-gray-400 flex-shrink-0" />
            <input
              placeholder="Search students…"
              value={q}
              onChange={e => { setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
            />
            {q && (
              <button onClick={() => { setQ(''); setOpen(false) }}
                className="text-gray-400 hover:text-gray-600 text-xs shrink-0">✕</button>
            )}
          </div>

          {open && q.trim().length >= 2 && (
            <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
              {results.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400">No students match “{q.trim()}”</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                  {results.map((s, i) => (
                    <li key={s.id}>
                      <button
                        onMouseDown={() => pick(s)}
                        onMouseEnter={() => setCursor(i)}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${i === cursor ? 'bg-gray-50' : 'bg-white'}`}
                      >
                        <span className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold flex items-center justify-center shrink-0">
                          {s.name?.[0]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-gray-900 truncate">{s.name}</span>
                          <span className="block text-[11px] text-gray-400 truncate">
                            {[s.studentCode, s.batch || 'No batch', s.phone].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {s.status !== 'Active' && (
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded shrink-0">
                            {s.status}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <NotificationBell
          recipientType="owner"
          recipientId={user?.id}
          academyId={user?.academyId}
        />

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
