import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, BATCH_NAMES } from '../data/mockData'
import {
  Search, Plus, MoreVertical, UserCheck, UserX, X, Users as UsersIcon,
  Copy, KeyRound, CheckCheck, RefreshCw, Phone, Calendar, IndianRupee,
  ShieldCheck, Award, ChevronRight, Pencil, Ban, Trash2,
} from 'lucide-react'
import { RecordPaymentModal } from './Payments'

const accountBadge = {
  pending: 'badge-yellow',
  active:  'badge-green',
}

export default function Students() {
  const { students, addStudent, updateStudent, deleteStudent, suspendStudent, reactivateStudent, updateStudentStatus, resetStudentPasswordAdmin, batches, payments, addPayment } = useApp()
  const [search,          setSearch]          = useState('')
  const [sportFilter,     setSportFilter]     = useState('All')
  const [batchFilter,     setBatchFilter]     = useState('All')
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
  const [editStudent,     setEditStudent]     = useState(null)
  const [deleteTarget,    setDeleteTarget]    = useState(null)

  // Close row menu on outside click — delayed so the opening click doesn't immediately close it
  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [openMenu])

  const now          = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  // Has paid_till set AND it has expired → show Overdue badge, will be auto-suspended
  const isOverdue   = (s) => s.status === 'Active' && s.paidTill && s.paidTill < firstOfMonth
  // Has a batch but no paid_till (historical import) → show "No Payment" badge, never auto-suspended
  const isNoPayment = (s) => s.status === 'Active' && s.batchId && !s.paidTill

  const activeStudents    = students.filter(s => s.status !== 'Suspended')
  const suspendedStudents = students.filter(s => s.status === 'Suspended')

  const filtered = activeStudents.filter(s => {
    const q = search.toLowerCase()
    const matchQ = !q ||
      s.name.toLowerCase().includes(q) ||
      (s.parent || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.studentCode || '').toLowerCase().includes(q)
    const matchSport = sportFilter === 'All' || s.sport  === sportFilter
    const matchBatch = batchFilter === 'All' || s.batch === batchFilter
    const matchAcc   = accFilter   === 'All' || s.accountStatus === accFilter
    return matchQ && matchSport && matchBatch && matchAcc
  })

  const suspBatches  = [...new Set(suspendedStudents.map(s => s.lastBatchName).filter(Boolean))]
  const suspFiltered = suspBatchFilter === 'All'
    ? suspendedStudents
    : suspendedStudents.filter(s => s.lastBatchName === suspBatchFilter)

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

          {/* Batch filter + count */}
          <div className="card p-4 flex flex-wrap gap-3 items-center">
            <select className="input w-auto" value={suspBatchFilter} onChange={e => setSuspBatchFilter(e.target.value)}>
              <option value="All">All Batches</option>
              {suspBatches.map(b => <option key={b}>{b}</option>)}
            </select>
            <span className="text-xs text-gray-400 ml-auto">{suspFiltered.length} students</span>
          </div>

          {/* Suspended table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Student / ID', 'Sport', 'Last Batch', 'Suspended Since', 'Monthly Fee', 'Action'].map(h => (
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
                      <td className="px-4 py-3 text-gray-600">{s.lastBatchName || s.batch || '—'}</td>
                      <td className="px-4 py-3 text-red-600 text-xs font-medium">
                        {s.suspendedSince ? new Date(s.suspendedSince).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">₹{(s.fees || 0).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.paidTill && s.paidTill >= firstOfMonth ? (
                            <button
                              className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                              onClick={() => reactivateStudent(s)}
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              className="btn-primary text-xs py-1.5 px-3"
                              onClick={() => { setPayStudent(s); setShowPayModal(true) }}
                            >
                              Record Payment
                            </button>
                          )}
                          <button
                            className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition flex items-center gap-1"
                            onClick={() => setEditStudent(s)}
                          >
                            <Pencil size={11} /> Edit
                          </button>
                          <button
                            className="text-xs py-1.5 px-3 rounded-lg font-semibold bg-red-100 text-red-600 hover:bg-red-200 transition"
                            onClick={() => setDeleteTarget(s)}
                          >
                            Delete
                          </button>
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
        </div>
      )}

      {/* ── STUDENTS TAB ── */}
      {activeTab === 'students' && (<>
      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-48">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
            placeholder="Search by name, parent, phone or ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={sportFilter} onChange={e => { setSportFilter(e.target.value); setBatchFilter('All') }}>
          <option value="All">All Sports</option>
          {SPORTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          <option value="All">All Batches</option>
          {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
        <select className="input w-auto" value={accFilter} onChange={e => setAccFilter(e.target.value)}>
          <option value="All">All Accounts</option>
          <option value="pending">Pending Activation ({pendingCount})</option>
          <option value="active">Activated ({activeCount})</option>
        </select>
        <span className="text-xs text-gray-400 font-medium">{filtered.length} results</span>
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

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Student / ID', 'Parent / Phone', 'Age', 'Sport', 'Batch', 'Monthly Fee', 'Status', 'Account', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60 transition group">
                  <td className="px-4 py-3">
                    <button onClick={() => setProfile(s)} className="flex items-center gap-3 text-left hover:opacity-80 transition">
                      <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                        {s.name[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 hover:text-brand-600 transition">{s.name}</p>
                        {s.studentCode && (
                          <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>
                        )}
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700 font-medium">{s.parent}</p>
                    <p className="text-gray-400 text-xs">{s.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.age} yrs</td>
                  <td className="px-4 py-3">
                    <span className="badge badge-blue">{s.sport}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{s.batch || '—'}</td>
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
                        {/* Show join code for pending accounts */}
                        {s.accountStatus === 'pending' && s.joinCode && (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-bold tracking-wider">
                              {s.joinCode}
                            </span>
                            <button
                              onClick={() => copyToClipboard(`ID: ${s.studentCode}  Join Code: ${s.joinCode}`, s.id)}
                              className="p-0.5 rounded text-gray-400 hover:text-brand-600"
                              title="Copy join details"
                            >
                              {copied === s.id ? <CheckCheck size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 relative">
                    <button
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition relative z-10"
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === s.id ? null : s.id) }}
                    >
                      <MoreVertical size={15} className="text-gray-500" />
                    </button>
                    {openMenu === s.id && (
                      <div className="absolute right-4 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-10 py-1 w-48">
                        <button
                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                          onClick={() => { setEditStudent(s); setOpenMenu(null) }}
                        >
                          <Pencil size={14} /> Edit Student
                        </button>
                        {s.status === 'Active' && (
                          <button
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => { suspendStudent(s); setOpenMenu(null) }}
                          >
                            <Ban size={14} /> Suspend
                          </button>
                        )}
                        <button
                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                          onClick={() => {
                            updateStudentStatus(s.id, s.status === 'Active' ? 'Inactive' : 'Active')
                            setOpenMenu(null)
                          }}
                        >
                          {s.status === 'Active'
                            ? <><UserX size={14} /> Mark Inactive</>
                            : <><UserCheck size={14} /> Mark Active</>
                          }
                        </button>
                        {s.studentCode && (
                          <button
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50"
                            onClick={() => handleReset(s)}
                          >
                            <RefreshCw size={14} /> Reset Password
                          </button>
                        )}
                        {s.studentCode && (
                          <button
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50"
                            onClick={() => {
                              copyToClipboard(`Student ID: ${s.studentCode}\nActivate at: /activate`, s.id)
                              setOpenMenu(null)
                            }}
                          >
                            <Copy size={14} /> Copy Student ID
                          </button>
                        )}
                        <div className="border-t border-gray-100 mt-1 pt-1">
                          <button
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => { setDeleteTarget(s); setOpenMenu(null) }}
                          >
                            <Trash2 size={14} /> Delete Student
                          </button>
                        </div>
                      </div>
                    )}
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

      </>)}

      {showModal && (
        <AddStudentModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addStudent(data); setShowModal(false) }}
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
        />
      )}
    </div>
  )
}

function AddStudentModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', parentPhone: '', age: '', sport: SPORTS[0], paidTill: '', joinDate: '',
  })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.name || !form.phone) return
    setLoading(true)
    try { await onSave(form) } finally { setLoading(false) }
  }

  return (
    <Modal title="Add New Student" onClose={onClose}>
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs text-blue-700">
          A <strong>Student ID</strong> and <strong>Join Code</strong> will be auto-generated.
          Assign a batch and record the first payment after adding.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Student Name *</label>
          <input className="input" placeholder="Full name" value={form.name}
            onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Name</label>
          <input className="input" placeholder="Father / Mother name" value={form.parent}
            onChange={e => set('parent', e.target.value)} />
        </div>
        <div>
          <label className="label">Student Phone *</label>
          <input className="input" placeholder="10-digit mobile" value={form.phone}
            onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Phone</label>
          <input className="input" placeholder="Parent mobile" value={form.parentPhone}
            onChange={e => set('parentPhone', e.target.value)} />
        </div>
        <div>
          <label className="label">Age (years)</label>
          <input className="input" type="number" placeholder="12" value={form.age}
            onChange={e => set('age', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Sport</label>
          <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
            {SPORTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Join Date <span className="text-gray-400 font-normal">(optional — defaults to today)</span></label>
          <input className="input" type="date" value={form.joinDate}
            max={new Date().toISOString().split('T')[0]}
            onChange={e => set('joinDate', e.target.value)} />
        </div>
        <div>
          <label className="label">Paid Till <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" type="month" value={form.paidTill}
            onChange={e => set('paidTill', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>
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

function StudentProfileModal({ student: s, payments, onClose, onEdit, onStatusChange, onReset }) {
  const paid    = payments.filter(p => p.status === 'Paid')
  const pending = payments.filter(p => p.status !== 'Paid')
  const totalPaid = paid.reduce((sum, p) => sum + p.amount, 0)

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
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-2xl font-black text-white">
              {s.name[0]}
            </div>
            <div>
              <h2 className="text-xl font-black text-white">{s.name}</h2>
              <p className="text-brand-200 text-sm">{s.sport} · {s.batch || 'No batch'}</p>
              {s.studentCode && <p className="text-brand-300 text-xs font-mono mt-0.5">{s.studentCode}</p>}
            </div>
          </div>
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{s.age || '—'}</p>
              <p className="text-[10px] text-brand-200">Age</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">₹{(s.fees || 0).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-brand-200">Monthly Fee</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className={`text-lg font-black ${s.status === 'Active' ? 'text-emerald-300' : 'text-red-300'}`}>{s.status}</p>
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
  const paidTillMonth = s.paidTill ? s.paidTill.slice(0, 7) : ''
  const [form, setForm] = useState({
    name:        s.name        || '',
    parent:      s.parent      || '',
    phone:       s.phone       || '',
    parentPhone: s.parentPhone || '',
    age:         s.age         || '',
    sport:       s.sport       || SPORTS[0],
    batchId:     s.batchId     || '',
    batchName:   s.batch       || '',
    fees:        s.fees        || '',
    paidTill:    paidTillMonth,
    joinDate:    s.joinDate    || '',
  })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleBatch = (batchId) => {
    const b = batches.find(x => x.id === Number(batchId))
    setForm(f => ({ ...f, batchId: batchId ? Number(batchId) : '', batchName: b?.name || '' }))
  }

  const handleSave = async () => {
    if (!form.name || !form.phone) return
    setLoading(true)
    try { await onSave(form) } finally { setLoading(false) }
  }

  return (
    <Modal title="Edit Student" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Student Name *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Name</label>
          <input className="input" value={form.parent} onChange={e => set('parent', e.target.value)} />
        </div>
        <div>
          <label className="label">Student Phone *</label>
          <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Phone</label>
          <input className="input" value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} />
        </div>
        <div>
          <label className="label">Age (years)</label>
          <input className="input" type="number" value={form.age} onChange={e => set('age', e.target.value)} />
        </div>
        <div>
          <label className="label">Sport</label>
          <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
            {SPORTS.map(sp => <option key={sp}>{sp}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Batch</label>
          <select className="input" value={form.batchId} onChange={e => handleBatch(e.target.value)}>
            <option value="">— No Batch —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Monthly Fee (₹)</label>
          <input className="input" type="number" value={form.fees} onChange={e => set('fees', e.target.value)} />
        </div>
        <div>
          <label className="label">Join Date</label>
          <input className="input" type="date" value={form.joinDate}
            max={new Date().toISOString().split('T')[0]}
            onChange={e => set('joinDate', e.target.value)} />
        </div>
        <div>
          <label className="label">Paid Till <span className="text-gray-400 font-normal">(month)</span></label>
          <input className="input" type="month" value={form.paidTill} onChange={e => set('paidTill', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={loading}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
