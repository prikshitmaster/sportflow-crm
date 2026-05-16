import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, BATCH_NAMES } from '../data/mockData'
import {
  Search, Plus, MoreVertical, UserCheck, UserX, X, Users as UsersIcon,
  Copy, KeyRound, CheckCheck, RefreshCw, Phone, Calendar, IndianRupee,
  ShieldCheck, Award, ChevronRight, Pencil, Ban, Trash2,
} from 'lucide-react'
import { RecordPaymentModal } from './Payments'
import { assignStudentToBatch, fetchBatchEnrolments, fetchAllStudentBatches, updateStudentPosition } from '../lib/db'
import StudentAvatar from '../components/StudentAvatar'
import { FOOTBALL_POSITIONS, POSITION_COLORS } from '../lib/performance'
import { isOverdue as ruleIsOverdue, isNoPayment as ruleIsNoPayment } from '../lib/studentRules'

const accountBadge = {
  pending: 'badge-yellow',
  active:  'badge-green',
}

// Fast DOB text input: user types DDMMYYYY, auto-formats to DD/MM/YYYY
function DobInput({ value, onChange, hasError }) {
  const isoToDisplay = (iso) => {
    if (!iso || iso.length < 10) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const [display, setDisplay] = useState(() => isoToDisplay(value))

  useEffect(() => { setDisplay(isoToDisplay(value)) }, [value])

  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let fmt = digits
    if (digits.length > 4) fmt = digits.slice(0,2) + '/' + digits.slice(2,4) + '/' + digits.slice(4)
    else if (digits.length > 2) fmt = digits.slice(0,2) + '/' + digits.slice(2)
    setDisplay(fmt)
    if (digits.length === 8) {
      const iso = `${digits.slice(4)}-${digits.slice(2,4)}-${digits.slice(0,2)}`
      const d = new Date(iso + 'T00:00:00')
      const year = Number(digits.slice(4))
      if (!isNaN(d) && d <= new Date() && year >= 1930 && year <= new Date().getFullYear()) {
        onChange(iso); return
      }
    }
    if (digits.length < 8) onChange('')
  }

  return (
    <input
      className={`input ${hasError ? 'border-red-400' : ''}`}
      placeholder="DD/MM/YYYY"
      value={display}
      onChange={handleChange}
      maxLength={10}
    />
  )
}

export default function Students() {
  const { students, addStudent, updateStudent, deleteStudent, suspendStudent, reactivateStudent, updateStudentStatus, resetStudentPasswordAdmin, batches, payments, addPayment, selectedSport, user } = useApp()
  const [search,          setSearch]          = useState('')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
  const [mbStudentIds,    setMbStudentIds]    = useState(new Set())
  const [allMbRows,       setAllMbRows]       = useState([])
  const [accFilter,       setAccFilter]       = useState('All')
  const [showModal,       setShowModal]       = useState(false)
  const [showPayModal,    setShowPayModal]    = useState(false)
  const [payStudent,      setPayStudent]      = useState(null)
  const [openMenu,        setOpenMenu]        = useState(null)
  const [copied,          setCopied]          = useState(null)
  const [resetResult,     setResetResult]     = useState(null)
  const [profile,         setProfile]         = useState(null)
  const [activeTab,       setActiveTab]       = useState('students') // 'students' | 'suspended'
  const [suspBatchFilter, setSuspBatchFilter] = useState('All')
  const [suspSportFilter, setSuspSportFilter] = useState('All')
  const [suspSearch,      setSuspSearch]      = useState('')
  const [editStudent,     setEditStudent]     = useState(null)
  const [deleteTarget,    setDeleteTarget]    = useState(null)

  // Close row menu on outside click — delayed so the opening click doesn't immediately close it
  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [openMenu])

  // Load multi-batch enrollments when batch filter changes
  useEffect(() => {
    if (batchFilter === 'All') { setMbStudentIds(new Set()); return }
    fetchBatchEnrolments(Number(batchFilter))
      .then(rows => setMbStudentIds(new Set(rows.map(r => r.student_id))))
      .catch(() => setMbStudentIds(new Set()))
  }, [batchFilter])

  // Load all multi-batch rows for the academy (for showing batch chips per student)
  useEffect(() => {
    if (!user?.academyId) return
    fetchAllStudentBatches(user.academyId)
      .then(rows => setAllMbRows(rows))
      .catch(() => {})
  }, [user?.academyId])

  // Build map: studentId → [batchName, ...]  (all batches from student_batches)
  const studentBatchMap = allMbRows.reduce((acc, r) => {
    if (!acc[r.student_id]) acc[r.student_id] = []
    if (r.batch_name && !acc[r.student_id].includes(r.batch_name)) acc[r.student_id].push(r.batch_name)
    return acc
  }, {})

  const now     = new Date()
  const today   = now.toISOString().split('T')[0]
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  // Show Overdue immediately when paidTill < today.
  // Has a batch but no paid_till (historical import) → show "No Payment" badge, never auto-suspended.
  // Logic moved to lib/studentRules; locals are thin wrappers so JSX call sites stay untouched.
  const isOverdue   = (s) => ruleIsOverdue(s, today)
  const isNoPayment = ruleIsNoPayment

  const activeStudents    = useMemo(() => students.filter(s => s.status !== 'Suspended'), [students])
  const suspendedStudents = useMemo(() => students.filter(s => s.status === 'Suspended'), [students])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return activeStudents.filter(s => {
      const matchQ = !q ||
        s.name.toLowerCase().includes(q) ||
        (s.parent || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(q) ||
        (s.studentCode || '').toLowerCase().includes(q)
      const matchSport = sportFilter === 'All' || s.sport  === sportFilter
      const matchBatch = batchFilter === 'All' || String(s.batchId) === batchFilter || mbStudentIds.has(s.id)
      const matchAcc   = accFilter   === 'All' || s.accountStatus === accFilter
      return matchQ && matchSport && matchBatch && matchAcc
    })
  }, [activeStudents, search, sportFilter, batchFilter, accFilter, mbStudentIds])

  const suspBatchName  = (s) => s.lastBatchName || s.batch || ''
  const suspBatches    = useMemo(() => [...new Set(suspendedStudents.map(suspBatchName).filter(Boolean))].sort(), [suspendedStudents])
  const suspSports     = useMemo(() => [...new Set(suspendedStudents.map(s => s.sport).filter(Boolean))].sort(), [suspendedStudents])
  const suspFiltered   = useMemo(() => {
    const q = suspSearch.toLowerCase()
    return suspendedStudents
      .filter(s => suspBatchFilter === 'All' || suspBatchName(s) === suspBatchFilter)
      .filter(s => suspSportFilter === 'All' || s.sport === suspSportFilter)
      .filter(s => !q || s.name.toLowerCase().includes(q) || (s.studentCode || '').toLowerCase().includes(q))
  }, [suspendedStudents, suspBatchFilter, suspSportFilter, suspSearch])

  const pendingCount   = students.filter(s => s.accountStatus === 'pending').length
  const activeCount    = students.filter(s => s.accountStatus === 'active').length
  const overdueCount   = activeStudents.filter(isOverdue).length
  const noPaymentCount = activeStudents.filter(isNoPayment).length

  const copyToClipboard = async (text, studentId) => {
    await navigator.clipboard.writeText(text)
    setCopied(studentId)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleReset = async (s) => {
    setOpenMenu(null)
    const newCode = await resetStudentPasswordAdmin(s.id)
    setResetResult({ id: s.id, studentCode: s.studentCode, joinCode: newCode })
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Students</h2>
          <p className="text-sm text-gray-500">
            {activeCount} active · {overdueCount > 0 && <span className="text-amber-600 font-semibold">{overdueCount} overdue · </span>}{noPaymentCount > 0 && <span className="text-gray-400 font-semibold">{noPaymentCount} no payment · </span>}{pendingCount} pending · {students.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'students' && (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Add Student
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('students')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'students' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <UsersIcon size={14} /> Students
          {overdueCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{overdueCount}</span>}
        </button>
        <button onClick={() => setActiveTab('suspended')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${activeTab === 'suspended' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Suspended
          {suspendedStudents.length > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'suspended' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-600'}`}>{suspendedStudents.length}</span>}
        </button>
      </div>

      {/* ── SUSPENDED TAB ── */}
      {activeTab === 'suspended' && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <p className="text-2xl font-black text-red-600">{suspendedStudents.length}</p>
              <p className="text-xs text-gray-500 mt-1">Suspended</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-black text-amber-600">
                ₹{suspendedStudents.reduce((s, x) => s + (x.fees || 0), 0).toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-500 mt-1">Monthly at Risk</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-black text-gray-600">{suspBatches.length}</p>
              <p className="text-xs text-gray-500 mt-1">Batches Affected</p>
            </div>
          </div>

          {/* Filters */}
          <div className="card p-3 sm:p-4 space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-3 sm:items-center">
            <input className="input w-full sm:w-44" placeholder="Search by name…"
              value={suspSearch} onChange={e => setSuspSearch(e.target.value)} />
            <div className="flex gap-2">
              <select className="input flex-1" value={suspSportFilter} onChange={e => setSuspSportFilter(e.target.value)}>
                <option value="All">All Sports</option>
                {suspSports.map(sp => <option key={sp}>{sp}</option>)}
              </select>
              <select className="input flex-1" value={suspBatchFilter} onChange={e => setSuspBatchFilter(e.target.value)}>
                <option value="All">All Batches</option>
                {suspBatches.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            {(suspSearch || suspSportFilter !== 'All' || suspBatchFilter !== 'All') && (
              <button className="text-xs text-gray-400 hover:text-red-500 transition"
                onClick={() => { setSuspSearch(''); setSuspSportFilter('All'); setSuspBatchFilter('All') }}>
                Clear filters
              </button>
            )}
            <span className="text-xs text-gray-400 sm:ml-auto">{suspFiltered.length} students</span>
          </div>

          {/* Suspended — desktop table */}
          <div className="card overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Student / ID', 'Sport', 'Last Batch', 'Suspended Since', 'Fee', 'Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {suspFiltered.map(s => (
                    <tr key={s.id} className="hover:bg-red-50/30 transition">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{s.name}</p>
                        {s.studentCode && <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>}
                      </td>
                      <td className="px-4 py-3"><span className="badge badge-blue">{s.sport}</span></td>
                      <td className="px-4 py-3 text-gray-600">{suspBatchName(s) || '—'}</td>
                      <td className="px-4 py-3 text-red-600 text-xs font-medium">
                        {s.suspendedSince ? new Date(s.suspendedSince).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">₹{(s.fees || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.paidTill && s.paidTill >= today ? (
                            <button className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition" onClick={() => reactivateStudent(s)}>Reactivate</button>
                          ) : (
                            <button className="btn-primary text-xs py-1.5 px-3" onClick={() => { setPayStudent(s); setShowPayModal(true) }}>Record Payment</button>
                          )}
                          <button className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition flex items-center gap-1" onClick={() => setEditStudent(s)}><Pencil size={11} /> Edit</button>
                          <button className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-red-100 text-red-600 hover:bg-red-200 transition" onClick={() => setDeleteTarget(s)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {suspFiltered.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <UsersIcon size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No suspended students</p>
                </div>
              )}
            </div>
          </div>

          {/* Suspended — mobile card list */}
          <div className="sm:hidden card overflow-hidden divide-y divide-gray-50">
            {suspFiltered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <UsersIcon size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No suspended students</p>
              </div>
            ) : suspFiltered.map(s => (
              <div key={s.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{s.name}</p>
                    {s.studentCode && <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="badge badge-blue text-[10px]">{s.sport}</span>
                      {suspBatchName(s) && <span className="badge badge-gray text-[10px]">{suspBatchName(s)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800">₹{(s.fees || 0).toLocaleString('en-IN')}</p>
                    {s.suspendedSince && (
                      <p className="text-[10px] text-red-500 mt-0.5">
                        Since {new Date(s.suspendedSince).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {s.paidTill && s.paidTill >= today ? (
                    <button className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white active:scale-95 transition" onClick={() => reactivateStudent(s)}>Reactivate</button>
                  ) : (
                    <button className="flex-1 btn-primary justify-center py-2.5" onClick={() => { setPayStudent(s); setShowPayModal(true) }}>Record Payment</button>
                  )}
                  <button className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700 active:scale-95 transition flex items-center gap-1" onClick={() => setEditStudent(s)}><Pencil size={13} /> Edit</button>
                  <button className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-100 text-red-600 active:scale-95 transition" onClick={() => setDeleteTarget(s)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── STUDENTS TAB ── */}
      {activeTab === 'students' && (<>
      {/* Filters */}
      <div className="card p-3 sm:p-4 space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-3 sm:items-center">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 sm:flex-1 sm:min-w-48">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
            placeholder="Search name, parent, phone or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedSport === 'All' && (
            <select className="input flex-1 min-w-0" value={sportFilter} onChange={e => { setSportFilter(e.target.value); setBatchFilter('All') }}>
              <option value="All">All Sports</option>
              {SPORTS.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
          <select className="input flex-1 min-w-0" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="All">All Batches</option>
            {batches.map(b => <option key={b.id} value={String(b.id)}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
          </select>
          <select className="input flex-1 min-w-0" value={accFilter} onChange={e => setAccFilter(e.target.value)}>
            <option value="All">All Accounts</option>
            <option value="pending">Pending ({pendingCount})</option>
            <option value="active">Activated ({activeCount})</option>
          </select>
        </div>
        <span className="text-xs text-gray-400 font-medium hidden sm:inline">{filtered.length} results</span>
      </div>

      {/* Reset password result banner */}
      {resetResult && (
        <div className="card p-4 bg-amber-50 border-amber-200 flex items-start gap-3">
          <KeyRound size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-900">Password Reset Complete</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Share these details with the student:
            </p>
            <div className="flex flex-wrap gap-4 mt-2">
              <div>
                <span className="text-xs text-amber-600 font-medium">Student ID</span>
                <p className="font-mono font-bold text-amber-900">{resetResult.studentCode}</p>
              </div>
              <div>
                <span className="text-xs text-amber-600 font-medium">New Join Code</span>
                <p className="font-mono font-bold text-amber-900 tracking-widest">{resetResult.joinCode}</p>
              </div>
            </div>
          </div>
          <button onClick={() => setResetResult(null)} className="p-1 rounded text-amber-600 hover:bg-amber-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Desktop Table */}
      <div className="card overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Student / ID', 'Parent / Phone', 'Age', 'Sport', 'Batch', 'Fee', 'Status', 'Account', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60 transition group">
                  <td className="px-4 py-3">
                    <button onClick={() => setProfile(s)} className="flex items-center gap-3 text-left hover:opacity-80 transition">
                      <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={32} />
                      <div>
                        <p className="font-semibold text-gray-900 hover:text-brand-600 transition">{s.name}</p>
                        {s.studentCode && <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>}
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700 font-medium">{s.parent}</p>
                    <p className="text-gray-400 text-xs">{s.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.dob ? calcAge(s.dob) : s.age} yrs</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="badge badge-blue">{s.sport}</span>
                      <span className={`badge text-[10px] ${s.trainingType === 'Alternate' ? 'badge-purple' : 'badge-gray'}`}>{s.trainingType || 'Daily'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const batchNames = studentBatchMap[s.id] || (s.batch ? [s.batch] : [])
                      if (!batchNames.length) return <span className="text-gray-400">—</span>
                      if (batchNames.length === 1) return <span className="text-gray-600 text-sm">{batchNames[0]}</span>
                      return (
                        <div className="flex flex-col gap-1">
                          {batchNames.map(n => (
                            <span key={n} className="badge badge-purple text-[10px] whitespace-nowrap">{n}</span>
                          ))}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">₹{(s.fees || 0).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
                      {isOverdue(s)   && <span className="badge badge-yellow text-[10px]">Overdue</span>}
                      {isNoPayment(s) && <span className="badge badge-gray   text-[10px]">No Payment</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.accountStatus ? (
                      <div className="space-y-1">
                        <span className={`badge ${accountBadge[s.accountStatus] || 'badge-gray'}`}>
                          {s.accountStatus === 'pending' ? 'Pending' : 'Active'}
                        </span>
                        {s.accountStatus === 'pending' && s.joinCode && (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold tracking-wider">{s.joinCode}</span>
                            <button onClick={() => copyToClipboard(`ID: ${s.studentCode}  Join Code: ${s.joinCode}`, s.id)}
                              className="p-0.5 rounded text-gray-400 hover:text-brand-600">
                              {copied === s.id ? <CheckCheck size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 relative">
                    <button className="p-1.5 rounded-lg hover:bg-gray-100 transition relative z-10"
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id) }}>
                      <MoreVertical size={15} className="text-gray-500" />
                    </button>
                    {openMenu === s.id && <StudentMenu s={s} onEdit={() => { setEditStudent(s); setOpenMenu(null) }} onSuspend={() => { suspendStudent(s); setOpenMenu(null) }} onStatus={() => { updateStudentStatus(s.id, s.status === 'Active' ? 'Inactive' : 'Active'); setOpenMenu(null) }} onReset={() => handleReset(s)} onCopy={() => { copyToClipboard(`Student ID: ${s.studentCode}\nActivate at: /activate`, s.id); setOpenMenu(null) }} onDelete={() => { setDeleteTarget(s); setOpenMenu(null) }} copied={copied === s.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <UsersIcon size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No students found</p>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Card List */}
      <div className="sm:hidden card overflow-hidden divide-y divide-gray-50">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <UsersIcon size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No students found</p>
          </div>
        ) : filtered.map(s => (
          <div key={s.id} className="p-4">
            <div className="flex items-start gap-3">
              <button onClick={() => setProfile(s)} className="flex-shrink-0 mt-0.5">
                <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={42} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button onClick={() => setProfile(s)} className="font-semibold text-gray-900 text-sm text-left leading-tight">{s.name}</button>
                    {s.studentCode && <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>}
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{s.parent}{s.phone ? ` · ${s.phone}` : ''}</p>
                  </div>
                  <div className="relative flex-shrink-0">
                    <button className="p-2 rounded-xl hover:bg-gray-100 transition"
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id) }}>
                      <MoreVertical size={16} className="text-gray-400" />
                    </button>
                    {openMenu === s.id && <StudentMenu s={s} mobile onEdit={() => { setEditStudent(s); setOpenMenu(null) }} onSuspend={() => { suspendStudent(s); setOpenMenu(null) }} onStatus={() => { updateStudentStatus(s.id, s.status === 'Active' ? 'Inactive' : 'Active'); setOpenMenu(null) }} onReset={() => handleReset(s)} onCopy={() => { copyToClipboard(`Student ID: ${s.studentCode}\nActivate at: /activate`, s.id); setOpenMenu(null) }} onDelete={() => { setDeleteTarget(s); setOpenMenu(null) }} copied={copied === s.id} />}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <span className="badge badge-blue text-[10px]">{s.sport}</span>
                  <span className={`badge text-[10px] ${s.trainingType === 'Alternate' ? 'badge-purple' : 'badge-gray'}`}>{s.trainingType || 'Daily'}</span>
                  {(() => {
                    const batchNames = studentBatchMap[s.id] || (s.batch ? [s.batch] : [])
                    return batchNames.map(n => <span key={n} className="badge badge-gray text-[10px] truncate max-w-[80px]">{n}</span>)
                  })()}
                  <span className={`badge text-[10px] ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
                  {isOverdue(s) && <span className="badge badge-yellow text-[10px]">Overdue</span>}
                  {isNoPayment(s) && <span className="badge badge-gray text-[10px]">No Payment</span>}
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                  <div className="flex items-center gap-2">
                    {s.accountStatus && (
                      <span className={`badge text-[10px] ${accountBadge[s.accountStatus] || 'badge-gray'}`}>
                        {s.accountStatus === 'pending' ? 'Pending' : 'Account Active'}
                      </span>
                    )}
                    {s.accountStatus === 'pending' && s.joinCode && (
                      <button onClick={() => copyToClipboard(`ID: ${s.studentCode}  Join Code: ${s.joinCode}`, s.id)}
                        className="flex items-center gap-1 font-mono text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">
                        {s.joinCode}
                        {copied === s.id ? <CheckCheck size={10} className="text-emerald-500" /> : <Copy size={10} />}
                      </button>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-800">₹{(s.fees || 0).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      </>)}

      {showModal && (
        <AddStudentModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => {
            const newStudent = await addStudent(data)
            if (newStudent && data.additionalBatchIds?.length > 0) {
              for (const bid of data.additionalBatchIds) {
                const bObj = batches.find(b => b.id === bid)
                await assignStudentToBatch(newStudent.id, bid, bObj?.name || '', newStudent.academyId || null).catch(() => {})
              }
            }
            setShowModal(false)
          }}
        />
      )}
      {deleteTarget && (
        <DeleteStudentModal
          student={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => { await deleteStudent(deleteTarget); setDeleteTarget(null) }}
        />
      )}
      {editStudent && (
        <EditStudentModal
          student={editStudent}
          batches={batches}
          onClose={() => setEditStudent(null)}
          onSave={async (data) => { await updateStudent(editStudent.id, data); setEditStudent(null) }}
        />
      )}
      {showPayModal && (
        <RecordPaymentModal
          onClose={() => { setShowPayModal(false); setPayStudent(null) }}
          onSave={async (data) => { await addPayment(data); setShowPayModal(false); setPayStudent(null) }}
          students={students}
          batches={batches}
          initialStudentId={payStudent?.id}
        />
      )}
      {profile && (
        <StudentProfileModal
          student={profile}
          payments={payments.filter(p => p.studentId === profile.id)}
          onClose={() => setProfile(null)}
          onEdit={(s) => { setProfile(null); setEditStudent(s) }}
          onStatusChange={(id, status) => { updateStudentStatus(id, status); setProfile(p => ({ ...p, status })) }}
          onReset={async (s) => { const c = await resetStudentPasswordAdmin(s.id); setResetResult({ id: s.id, studentCode: s.studentCode, joinCode: c }); setProfile(null) }}
          onSuspend={(s) => { suspendStudent(s); setProfile(null) }}
        />
      )}
    </div>
  )
}

function StudentMenu({ s, mobile, onEdit, onSuspend, onStatus, onReset, onCopy, onDelete, copied }) {
  return (
    <div className={`absolute ${mobile ? 'right-0' : 'right-4'} top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 py-1 w-48`}>
      <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50" onClick={onEdit}>
        <Pencil size={14} /> Edit Student
      </button>
      {s.status === 'Active' && (
        <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50" onClick={onSuspend}>
          <Ban size={14} /> Suspend
        </button>
      )}
      <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50" onClick={onStatus}>
        {s.status === 'Active' ? <><UserX size={14} /> Mark Inactive</> : <><UserCheck size={14} /> Mark Active</>}
      </button>
      {s.studentCode && (
        <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50" onClick={onReset}>
          <RefreshCw size={14} /> Reset Password
        </button>
      )}
      {s.studentCode && (
        <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50" onClick={onCopy}>
          {copied ? <CheckCheck size={14} className="text-emerald-500" /> : <Copy size={14} />} Copy Student ID
        </button>
      )}
      <div className="border-t border-gray-100 mt-1 pt-1">
        <button className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50" onClick={onDelete}>
          <Trash2 size={14} /> Delete Student
        </button>
      </div>
    </div>
  )
}

const MO_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PLAN_MOS_MAP = { monthly: 1, quarterly: 3, yearly: 12 }

// Returns YYYY-MM for standard plans, '' for custom
function calcAge(dob) {
  if (!dob) return null
  const today = new Date()
  const birth = new Date(dob + 'T00:00:00')
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

function calcPaidTill(joinDate, feePlan) {
  if (!joinDate || feePlan === 'custom') return ''
  const [yr, mo] = joinDate.split('-').map(Number)
  const planMonths = PLAN_MOS_MAP[feePlan] || 1
  const endDate = new Date(yr, mo - 1 + planMonths - 1, 1)
  return `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`
}

// paidTill: YYYY-MM (standard plans) or YYYY-MM-DD (custom)
function coveragePreview(joinDate, paidTill) {
  if (!joinDate || !paidTill) return null
  const startMo = Number(joinDate.split('-')[1]) - 1
  const startYr = Number(joinDate.split('-')[0])
  // Handle both YYYY-MM and YYYY-MM-DD
  const isFullDate = paidTill.length === 10
  const endYr  = Number(paidTill.slice(0, 4))
  const endMo  = Number(paidTill.slice(5, 7)) - 1
  const months = Math.max(1, (endYr - startYr) * 12 + (endMo - startMo) + 1)
  const dayStr = isFullDate ? ` ${Number(paidTill.slice(8, 10))}` : ''
  const label  = months === 1
    ? `${MO_NAMES[endMo]}${dayStr} ${endYr}`
    : `${MO_NAMES[startMo]}${startYr !== endYr ? ` ${startYr}` : ''}–${MO_NAMES[endMo]}${dayStr} ${endYr}`
  return `${label} · ${months} month${months > 1 ? 's' : ''}`
}

const FEE_PLAN_OPTIONS = [
  { key: 'monthly',   label: 'Monthly',   sub: '1 month'   },
  { key: 'quarterly', label: 'Quarterly', sub: '3 months'  },
  { key: 'yearly',    label: 'Yearly',    sub: '12 months' },
  { key: 'custom',    label: 'Custom',    sub: 'pick dates' },
]
const FEE_LABEL = { monthly: 'Monthly Fee (₹) *', quarterly: 'Quarterly Fee (₹) *', yearly: 'Yearly Fee (₹) *', custom: 'Plan Fee (₹) *' }

function AddStudentModal({ onClose, onSave }) {
  const { batches, selectedSport, feePlans } = useApp()
  const defaultSport = selectedSport && selectedSport !== 'All' ? selectedSport : SPORTS[0]
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', parentPhone: '', dob: '', sport: defaultSport,
    paidTill: '', joinDate: '', fees: '', batchId: '', batchName: '',
    trainingType: 'Daily', feePlan: 'monthly', feePlanId: '',
  })
  const [additionalBatchIds, setAdditionalBatchIds] = useState([])
  const [errors,  setErrors]  = useState({})
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleAdditionalBatch = (id) => {
    setAdditionalBatchIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleBatch = (id) => {
    const b = batches.find(b => String(b.id) === id)
    const batchPlans = feePlans.filter(p => p.batchId === Number(id))
    setForm(f => ({
      ...f,
      batchId:    id ? Number(id) : '',
      batchName:  b ? b.name : '',
      feePlanId:  '',
      // fall back to batch defaults only if no named plans exist
      ...(batchPlans.length === 0 && b?.defaultFee  ? { fees: b.defaultFee }    : {}),
      ...(batchPlans.length === 0 && b?.defaultPlan ? { feePlan: b.defaultPlan } : {}),
    }))
  }

  const handleFeePlanPick = (planId) => {
    const plan = feePlans.find(p => String(p.id) === String(planId))
    if (!plan) { setForm(f => ({ ...f, feePlanId: '' })); return }
    const feeMap = { monthly: plan.monthlyFee, quarterly: plan.quarterlyFee, yearly: plan.yearlyFee }
    setForm(f => ({
      ...f,
      feePlanId:   plan.id,
      trainingType: plan.trainingType === 'alternate' ? 'Alternate' : 'Daily',
      fees:         feeMap[f.feePlan] || plan.monthlyFee || '',
    }))
  }

  const handleJoinDate = (date) => {
    setForm(f => ({
      ...f, joinDate: date,
      paidTill: f.feePlan !== 'custom' ? calcPaidTill(date, f.feePlan) : f.paidTill,
    }))
  }

  const handleFeePlan = (plan) => {
    setForm(f => {
      const selectedPlan = f.feePlanId ? feePlans.find(p => String(p.id) === String(f.feePlanId)) : null
      const feeMap = selectedPlan ? { monthly: selectedPlan.monthlyFee, quarterly: selectedPlan.quarterlyFee, yearly: selectedPlan.yearlyFee } : null
      return {
        ...f, feePlan: plan,
        paidTill: plan !== 'custom' ? calcPaidTill(f.joinDate, plan) : '',
        ...(feeMap && feeMap[plan] ? { fees: feeMap[plan] } : {}),
      }
    })
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim())                    e.name   = 'Required'
    if (!/^\d{10}$/.test(form.phone))         e.phone  = 'Enter 10-digit number'
    if (!form.fees || Number(form.fees) <= 0) e.fees   = 'Required'
    if (!form.batchId)                        e.batchId = 'Select a batch'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setLoading(true)
    try { await onSave({ ...form, age: calcAge(form.dob), additionalBatchIds }) } finally { setLoading(false) }
  }

  const preview = coveragePreview(form.joinDate, form.paidTill)

  return (
    <Modal title="Add New Student" onClose={onClose}>
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs text-blue-700">
          A <strong>Student ID</strong> and <strong>Join Code</strong> will be auto-generated.
          Assign a batch and record the first payment after adding.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Name */}
        <div className="sm:col-span-2">
          <label className="label">Student Name *</label>
          <input className={`input ${errors.name ? 'border-red-400' : ''}`} placeholder="Full name" value={form.name}
            onChange={e => set('name', e.target.value)} />
          {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* Parent */}
        <div>
          <label className="label">Parent Name</label>
          <input className="input" placeholder="Father / Mother name" value={form.parent}
            onChange={e => set('parent', e.target.value)} />
        </div>

        {/* Date of Birth */}
        <div>
          <label className="label">Date of Birth</label>
          <div className="relative">
            <DobInput value={form.dob} onChange={v => set('dob', v)} hasError={!!errors.dob} />
            {form.dob && calcAge(form.dob) !== null && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full pointer-events-none">
                {calcAge(form.dob)} yrs
              </span>
            )}
          </div>
        </div>

        {/* Student Phone */}
        <div>
          <label className="label">Student Phone *</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
            <input
              className={`input rounded-l-none flex-1 ${errors.phone ? 'border-red-400' : ''}`}
              placeholder="10-digit number"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={e => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
          {errors.phone && <p className="text-[11px] text-red-500 mt-1">{errors.phone}</p>}
        </div>

        {/* Parent Phone */}
        <div>
          <label className="label">Parent Phone</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
            <input
              className="input rounded-l-none flex-1"
              placeholder="10-digit number"
              inputMode="numeric"
              maxLength={10}
              value={form.parentPhone}
              onChange={e => set('parentPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
        </div>

        {/* Batch */}
        <div>
          <label className="label">Primary Batch *</label>
          <select className={`input ${errors.batchId ? 'border-red-400' : ''}`} value={form.batchId} onChange={e => handleBatch(e.target.value)}>
            <option value="">— Select Batch —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
          </select>
          {errors.batchId && <p className="text-[11px] text-red-500 mt-1">{errors.batchId}</p>}
        </div>

        {/* Additional Batches */}
        {batches.length > 1 && (
          <div className="sm:col-span-2">
            <label className="label">Additional Batches <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex flex-wrap gap-2 mt-1">
              {batches.filter(b => form.batchId ? b.id !== Number(form.batchId) : true).map(b => {
                const sel = additionalBatchIds.includes(b.id)
                return (
                  <button key={b.id} type="button" onClick={() => toggleAdditionalBatch(b.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition active:scale-95 ${sel ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {sel ? '✓ ' : ''}{b.name}{b.code ? ` (${b.code})` : ''}
                  </button>
                )
              })}
            </div>
            {additionalBatchIds.length > 0 && (
              <p className="text-[11px] text-purple-600 mt-1.5 font-medium">
                +{additionalBatchIds.length} additional batch{additionalBatchIds.length > 1 ? 'es' : ''} selected
              </p>
            )}
          </div>
        )}

        {/* Fee Plan picker — shown only when batch has named plans */}
        {form.batchId && feePlans.some(p => p.batchId === Number(form.batchId)) ? (
          <div className="sm:col-span-2">
            <label className="label">Fee Plan</label>
            <select className="input" value={form.feePlanId} onChange={e => handleFeePlanPick(e.target.value)}>
              <option value="">— Select Plan —</option>
              {feePlans.filter(p => p.batchId === Number(form.batchId)).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.trainingType === 'alternate' ? 'Alternate' : 'Daily'})
                </option>
              ))}
            </select>
            {form.feePlanId && (() => {
              const pl = feePlans.find(p => String(p.id) === String(form.feePlanId))
              if (!pl) return null
              const expectedFee = { monthly: pl.monthlyFee, quarterly: pl.quarterlyFee, yearly: pl.yearlyFee }[form.feePlan] || pl.monthlyFee
              return (
                <div className="mt-1.5 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-brand-700 flex items-center justify-between gap-2">
                  <span className="flex-1 min-w-0">
                    <span className="font-semibold">{pl.name}</span>
                    <span className="text-brand-400 mx-1.5">·</span>
                    {pl.trainingType === 'alternate' ? 'Alternate Day' : 'Daily'}
                    <span className="text-brand-400 mx-1.5">·</span>
                    M ₹{pl.monthlyFee.toLocaleString('en-IN')}
                    {pl.quarterlyFee > 0 && <> · Q ₹{pl.quarterlyFee.toLocaleString('en-IN')}</>}
                    {pl.yearlyFee > 0 && <> · Y ₹{pl.yearlyFee.toLocaleString('en-IN')}</>}
                  </span>
                  <button type="button"
                    className="text-brand-600 font-bold hover:underline whitespace-nowrap flex-shrink-0"
                    onClick={() => set('fees', expectedFee)}>
                    Use this rate
                  </button>
                </div>
              )
            })()}
          </div>
        ) : (
          /* Training Type — manual fallback when no named plans */
          <div>
            <label className="label">Training Type</label>
            <div className="flex gap-2">
              {['Daily','Alternate'].map(t => (
                <button key={t} type="button"
                  onClick={() => set('trainingType', t)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition active:scale-95 ${form.trainingType === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Fee Plan duration */}
        <div className="sm:col-span-2">
          <label className="label">Fee Plan</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FEE_PLAN_OPTIONS.map(p => (
              <button key={p.key} type="button" onClick={() => handleFeePlan(p.key)}
                className={`py-3 rounded-xl text-xs font-bold border transition active:scale-95 ${form.feePlan === p.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <div>{p.label}</div>
                <div className={`font-normal mt-0.5 ${form.feePlan === p.key ? 'text-brand-200' : 'text-gray-400'}`}>{p.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Fee amount */}
        <div>
          <label className="label">{FEE_LABEL[form.feePlan] || 'Fee (₹) *'}</label>
          <input
            className={`input ${errors.fees ? 'border-red-400' : ''} ${
              (() => {
                if (!form.feePlanId) return ''
                const pl = feePlans.find(p => String(p.id) === String(form.feePlanId))
                if (!pl) return ''
                const expected = { monthly: pl.monthlyFee, quarterly: pl.quarterlyFee, yearly: pl.yearlyFee }[form.feePlan] || pl.monthlyFee
                return expected > 0 && Number(form.fees) !== expected ? 'border-amber-400' : ''
              })()
            }`}
            type="number" inputMode="numeric" placeholder="e.g. 2000" value={form.fees}
            onChange={e => set('fees', e.target.value)} />
          {errors.fees && <p className="text-[11px] text-red-500 mt-1">{errors.fees}</p>}
          {(() => {
            if (!form.feePlanId || !form.fees) return null
            const pl = feePlans.find(p => String(p.id) === String(form.feePlanId))
            if (!pl) return null
            const expected = { monthly: pl.monthlyFee, quarterly: pl.quarterlyFee, yearly: pl.yearlyFee }[form.feePlan] || pl.monthlyFee
            if (!expected || Number(form.fees) === expected) return null
            return (
              <div className="flex items-center justify-between mt-1">
                <p className="text-[11px] text-amber-600">⚠ Fee plan rate is ₹{expected.toLocaleString('en-IN')}</p>
                <button type="button" className="text-[11px] text-amber-700 font-bold hover:underline"
                  onClick={() => set('fees', expected)}>
                  Fix
                </button>
              </div>
            )
          })()}
        </div>

        {/* Join Date (non-custom) */}
        {form.feePlan !== 'custom' && (
          <div>
            <label className="label">Join Date</label>
            <input className="input" type="date" value={form.joinDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => handleJoinDate(e.target.value)} />
          </div>
        )}

        {/* Paid Till (non-custom) — month picker */}
        {form.feePlan !== 'custom' && (
          <div className="sm:col-span-2">
            <label className="label">Paid Till</label>
            <input className="input" type="month" value={form.paidTill}
              onChange={e => set('paidTill', e.target.value)} />
            {preview && <p className="text-xs text-brand-600 font-semibold mt-1">Covers: {preview}</p>}
          </div>
        )}

        {/* Custom plan: date range */}
        {form.feePlan === 'custom' && (
          <div className="sm:col-span-2 bg-brand-50 border border-brand-100 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label text-brand-700">Join / Start Date</label>
              <input className="input" type="date"
                max={new Date().toISOString().split('T')[0]}
                value={form.joinDate}
                onChange={e => set('joinDate', e.target.value)} />
            </div>
            <div>
              <label className="label text-brand-700">Paid Till (End Date)</label>
              <input className="input" type="date"
                min={form.joinDate || undefined}
                value={form.paidTill}
                onChange={e => set('paidTill', e.target.value)} />
            </div>
            {preview && (
              <p className="sm:col-span-2 text-xs text-brand-600 font-semibold -mt-2">Covers: {preview}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-6">
        <button className="btn-secondary justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
        <button className="btn-primary justify-center py-3 sm:py-2" onClick={handleSave} disabled={loading}>
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : 'Add Student & Generate Code'}
        </button>
      </div>
    </Modal>
  )
}

function StudentProfileModal({ student: s, payments, onClose, onEdit, onStatusChange, onReset, onSuspend }) {
  const paid    = payments.filter(p => p.status === 'Paid')
  const pending = payments.filter(p => p.status !== 'Paid')
  const totalPaid = paid.reduce((sum, p) => sum + p.amount, 0)

  const isProfileOverdue = ruleIsOverdue(s)

  const infoRow = (label, value, mono = false) => (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-gray-800 text-right ${mono ? 'font-mono tracking-wider' : ''}`}>{value || '—'}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-6 pt-6 pb-8">
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(s)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-brand-700 hover:bg-brand-50 transition"
              >
                Edit
              </button>
              <button
                onClick={() => onStatusChange(s.id, s.status === 'Active' ? 'Inactive' : 'Active')}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
              >
                {s.status === 'Active' ? 'Mark Inactive' : 'Mark Active'}
              </button>
              {isProfileOverdue && onSuspend && (
                <button
                  onClick={() => { onSuspend(s); onClose() }}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition"
                >
                  Suspend Now
                </button>
              )}
              {s.studentCode && (
                <button
                  onClick={() => onReset(s)}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/15 hover:bg-white/25 text-white transition"
                >
                  Reset Password
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {s.photoUrl ? (
              <img src={s.photoUrl} alt={s.name} loading="lazy"
                className="w-16 h-16 rounded-2xl object-cover border-2 border-white/30 flex-shrink-0" />
            ) : (
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-2xl font-black text-white flex-shrink-0">
                {s.name[0]}
              </div>
            )}
            <div>
              <h2 className="text-xl font-black text-white">{s.name}</h2>
              <p className="text-brand-200 text-sm">{s.sport} · {s.batch || 'No batch'}</p>
              {s.studentCode && <p className="text-brand-300 text-xs font-mono mt-0.5">{s.studentCode}</p>}
            </div>
          </div>
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{s.dob ? calcAge(s.dob) : (s.age || '—')}</p>
              <p className="text-[10px] text-brand-200">Age</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">₹{(s.fees || 0).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-brand-200">Fee</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className={`text-lg font-black ${isProfileOverdue ? 'text-amber-300' : s.status === 'Active' ? 'text-emerald-300' : 'text-red-300'}`}>
                {isProfileOverdue ? 'Overdue' : s.status}
              </p>
              <p className="text-[10px] text-brand-200">Status</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Personal Info */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Personal Info</p>
            {infoRow('Parent', s.parent)}
            {infoRow('Student Phone', s.phone)}
            {infoRow('Parent Phone', s.parentPhone)}
            {infoRow('Join Date', s.joinDate ? new Date(s.joinDate).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : null)}
            {infoRow('Paid Till', s.paidTill ? new Date(s.paidTill).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : null)}
          </div>

          {/* Account Info */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Account</p>
            {infoRow('Account Status', s.accountStatus === 'active' ? '✓ Activated' : '⏳ Pending Activation')}
            {s.accountStatus === 'pending' && s.joinCode && infoRow('Join Code', s.joinCode, true)}
            {infoRow('Student ID', s.studentCode, true)}
          </div>

          {/* Payment Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Payments</p>
              <div className="flex gap-2 text-xs">
                <span className="badge badge-green">{paid.length} paid</span>
                {pending.length > 0 && <span className="badge badge-red">{pending.length} due</span>}
              </div>
            </div>
            {payments.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No payment records</p>
            ) : (
              <>
                <div className="bg-emerald-50 rounded-xl p-3 mb-3 flex items-center justify-between">
                  <span className="text-xs text-emerald-700 font-medium">Total Paid</span>
                  <span className="text-sm font-black text-emerald-700">₹{totalPaid.toLocaleString('en-IN')}</span>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {payments.slice(0, 8).map(p => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-gray-700">{p.month}</p>
                        <p className="text-[10px] text-gray-400">{p.date || 'Unpaid'} · {p.mode || '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-gray-800">₹{p.amount.toLocaleString('en-IN')}</p>
                        <span className={`badge text-[10px] ${p.status === 'Paid' ? 'badge-green' : p.status === 'Overdue' ? 'badge-red' : 'badge-yellow'}`}>{p.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteStudentModal({ student: s, onClose, onConfirm }) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const handleFinalDelete = async () => {
    setLoading(true)
    try { await onConfirm() } finally { setLoading(false) }
  }

  return (
    <Modal title="Delete Student" onClose={onClose}>
      <div className="text-center space-y-4">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <Trash2 size={24} className="text-red-600" />
        </div>

        {step === 1 ? (
          <>
            <div>
              <p className="font-bold text-gray-900 text-lg">{s.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                This will permanently delete the student and all their payment records. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 justify-center mt-6">
              <button className="btn-secondary px-6" onClick={onClose}>Cancel</button>
              <button
                className="px-6 py-2.5 rounded-xl text-sm font-bold bg-red-100 text-red-700 hover:bg-red-200 transition"
                onClick={() => setStep(2)}
              >
                Delete Student
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-bold text-red-800">Are you absolutely sure?</p>
              <p className="text-xs text-red-600 mt-1">
                <strong>{s.name}</strong> and all their data will be gone forever.
              </p>
            </div>
            <div className="flex gap-3 justify-center mt-2">
              <button className="btn-secondary px-6" onClick={onClose}>Cancel</button>
              <button
                className="px-6 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition flex items-center gap-2"
                onClick={handleFinalDelete}
                disabled={loading}
              >
                {loading
                  ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <><Trash2 size={14} /> Yes, permanently delete</>
                }
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function EditStudentModal({ student: s, batches, onClose, onSave }) {
  // Normalize paidTill to match the input type:
  // custom → YYYY-MM-DD (pad if YYYY-MM), standard → YYYY-MM (truncate if YYYY-MM-DD)
  const isCustom = s.feePlan === 'custom'
  const normPaidTill = s.paidTill
    ? (isCustom
        ? (s.paidTill.length === 7 ? s.paidTill + '-01' : s.paidTill.slice(0, 10))
        : s.paidTill.slice(0, 7))
    : ''

  const [form, setForm] = useState({
    name:         s.name         || '',
    parent:       s.parent       || '',
    phone:        (s.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(0, 10),
    parentPhone:  (s.parentPhone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(0, 10),
    dob:          s.dob          || '',
    sport:        s.sport        || SPORTS[0],
    batchId:      s.batchId      || '',
    batchName:    s.batch        || '',
    fees:         s.fees         || '',
    paidTill:     normPaidTill,
    joinDate:     s.joinDate     || '',
    trainingType: s.trainingType || 'Daily',
    feePlan:      s.feePlan      || 'monthly',
    position:     s.position     || '',
  })
  const [errors,  setErrors]  = useState({})
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleBatch = (batchId) => {
    const b = batches.find(x => String(x.id) === String(batchId))
    setForm(f => ({ ...f, batchId: batchId ? Number(batchId) : '', batchName: b?.name || '' }))
  }

  const handleJoinDate = (date) => {
    setForm(f => ({
      ...f, joinDate: date,
      paidTill: f.feePlan !== 'custom' ? calcPaidTill(date, f.feePlan) : f.paidTill,
    }))
  }

  const handleFeePlan = (plan) => {
    setForm(f => ({
      ...f, feePlan: plan,
      paidTill: plan !== 'custom' ? calcPaidTill(f.joinDate, plan) : f.paidTill,
    }))
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim())            e.name  = 'Required'
    if (!/^\d{10}$/.test(form.phone)) e.phone = 'Enter 10-digit number'
    if (!form.dob)                    e.dob   = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setLoading(true)
    try { await onSave({ ...form, age: calcAge(form.dob) }) } finally { setLoading(false) }
  }

  const preview = coveragePreview(form.joinDate, form.paidTill)

  return (
    <Modal title="Edit Student" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="label">Student Name *</label>
          <input className={`input ${errors.name ? 'border-red-400' : ''}`} value={form.name}
            onChange={e => set('name', e.target.value)} />
          {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
        </div>
        <div>
          <label className="label">Parent Name</label>
          <input className="input" value={form.parent} onChange={e => set('parent', e.target.value)} />
        </div>
        <div>
          <label className="label">Date of Birth *</label>
          <div className="relative">
            <DobInput value={form.dob} onChange={v => set('dob', v)} hasError={!!errors.dob} />
            {form.dob && calcAge(form.dob) !== null && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full pointer-events-none">
                {calcAge(form.dob)} yrs
              </span>
            )}
          </div>
          {errors.dob && <p className="text-[11px] text-red-500 mt-1">{errors.dob}</p>}
        </div>
        <div>
          <label className="label">Student Phone *</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
            <input
              className={`input rounded-l-none flex-1 ${errors.phone ? 'border-red-400' : ''}`}
              placeholder="10-digit number"
              inputMode="numeric"
              maxLength={10}
              value={form.phone}
              onChange={e => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
          {errors.phone && <p className="text-[11px] text-red-500 mt-1">{errors.phone}</p>}
        </div>
        <div>
          <label className="label">Parent Phone</label>
          <div className="flex">
            <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
            <input
              className="input rounded-l-none flex-1"
              placeholder="10-digit number"
              inputMode="numeric"
              maxLength={10}
              value={form.parentPhone}
              onChange={e => set('parentPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
        </div>
        <div>
          <label className="label">Batch</label>
          <select className="input" value={form.batchId} onChange={e => handleBatch(e.target.value)}>
            <option value="">— No Batch —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{FEE_LABEL[form.feePlan] || 'Fee (₹)'}</label>
          <input className="input" type="number" inputMode="numeric" value={form.fees} onChange={e => set('fees', e.target.value)} />
        </div>
        <div>
          <label className="label">Training Type</label>
          <div className="flex gap-2">
            {['Daily','Alternate'].map(t => (
              <button key={t} type="button"
                onClick={() => set('trainingType', t)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition active:scale-95 ${form.trainingType === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Fee Plan</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FEE_PLAN_OPTIONS.map(p => (
              <button key={p.key} type="button" onClick={() => handleFeePlan(p.key)}
                className={`py-3 rounded-xl text-xs font-bold border transition active:scale-95 ${form.feePlan === p.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                <div>{p.label}</div>
                <div className={`font-normal mt-0.5 ${form.feePlan === p.key ? 'text-brand-200' : 'text-gray-400'}`}>{p.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {form.feePlan !== 'custom' && (<>
          <div>
            <label className="label">Join Date</label>
            <input className="input" type="date" value={form.joinDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => handleJoinDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Paid Till</label>
            <input className="input" type="month" value={form.paidTill}
              onChange={e => set('paidTill', e.target.value)} />
            {preview && <p className="text-xs text-brand-600 font-semibold mt-1">Covers: {preview}</p>}
          </div>
        </>)}

        {form.feePlan === 'custom' && (
          <div className="sm:col-span-2 bg-brand-50 border border-brand-100 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label text-brand-700">Join / Start Date</label>
              <input className="input" type="date"
                max={new Date().toISOString().split('T')[0]}
                value={form.joinDate}
                onChange={e => set('joinDate', e.target.value)} />
            </div>
            <div>
              <label className="label text-brand-700">Paid Till (End Date)</label>
              <input className="input" type="date"
                min={form.joinDate || undefined}
                value={form.paidTill}
                onChange={e => set('paidTill', e.target.value)} />
            </div>
            {preview && (
              <p className="sm:col-span-2 text-xs text-brand-600 font-semibold -mt-2">Covers: {preview}</p>
            )}
          </div>
        )}
        {/* Position */}
        <div className="sm:col-span-2">
          <label className="label">Position</label>
          <input
            className="input text-sm mb-2"
            placeholder="Type any position… (e.g. False 9, Sweeper) or pick below"
            value={form.position}
            onChange={e => set('position', e.target.value)}
            maxLength={40}
          />
          <div className="flex flex-wrap gap-2">
            {FOOTBALL_POSITIONS.map(p => {
              const col    = POSITION_COLORS[p.id]
              const active = form.position === p.id
              return (
                <button key={p.id} type="button"
                  onClick={() => set('position', active ? '' : p.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-black border transition active:scale-95 ${
                    active ? `${col.bg} ${col.text} border-current` : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                  }`}>
                  {p.id} <span className="font-normal opacity-60">· {p.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-6">
        <button className="btn-secondary justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
        <button className="btn-primary justify-center py-3 sm:py-2" onClick={handleSave} disabled={loading}>
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : 'Save Changes'}
        </button>
      </div>
    </Modal>
  )
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg animate-slide-up overflow-hidden">
        {/* Drag handle visible only on mobile */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-5 max-h-[88vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
