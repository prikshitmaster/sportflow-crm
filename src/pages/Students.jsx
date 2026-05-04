import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, BATCH_NAMES } from '../data/mockData'
import {
  Search, Plus, MoreVertical, UserCheck, UserX, X, Users as UsersIcon,
  Copy, KeyRound, CheckCheck, RefreshCw,
} from 'lucide-react'

const accountBadge = {
  pending: 'badge-yellow',
  active:  'badge-green',
}

export default function Students() {
  const { students, addStudent, updateStudentStatus, resetStudentPasswordAdmin, batches } = useApp()
  const [search,       setSearch]       = useState('')
  const [sportFilter,  setSportFilter]  = useState('All')
  const [accFilter,    setAccFilter]    = useState('All')   // All / pending / active
  const [showModal,    setShowModal]    = useState(false)
  const [openMenu,     setOpenMenu]     = useState(null)
  const [copied,       setCopied]       = useState(null)   // student id whose code was copied
  const [resetResult,  setResetResult]  = useState(null)   // { id, code }

  const filtered = students.filter(s => {
    const q = search.toLowerCase()
    const matchQ = !q ||
      s.name.toLowerCase().includes(q) ||
      (s.parent || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.studentCode || '').toLowerCase().includes(q)
    const matchSport = sportFilter === 'All' || s.sport === sportFilter
    const matchAcc   = accFilter   === 'All' || s.accountStatus === accFilter
    return matchQ && matchSport && matchAcc
  })

  const pendingCount = students.filter(s => s.accountStatus === 'pending').length
  const activeCount  = students.filter(s => s.accountStatus === 'active').length

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
            {activeCount} active · {pendingCount} pending activation · {students.length} total
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Student
        </button>
      </div>

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
        <select className="input w-auto" value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
          <option value="All">All Sports</option>
          {SPORTS.map(s => <option key={s}>{s}</option>)}
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
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                        {s.name[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{s.name}</p>
                        {s.studentCode && (
                          <p className="text-[10px] font-mono text-gray-400">{s.studentCode}</p>
                        )}
                      </div>
                    </div>
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
                    <span className={`badge ${s.status === 'Active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
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
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition opacity-0 group-hover:opacity-100"
                      onClick={() => setOpenMenu(openMenu === s.id ? null : s.id)}
                    >
                      <MoreVertical size={15} className="text-gray-500" />
                    </button>
                    {openMenu === s.id && (
                      <div className="absolute right-4 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-10 py-1 w-48">
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

      {showModal && (
        <AddStudentModal
          onClose={() => setShowModal(false)}
          onSave={async (data) => { await addStudent(data); setShowModal(false) }}
          batches={batches}
        />
      )}
      {openMenu && <div className="fixed inset-0 z-0" onClick={() => setOpenMenu(null)} />}
    </div>
  )
}

function AddStudentModal({ onClose, onSave, batches = [] }) {
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', parentPhone: '', age: '',
    sport: SPORTS[0], batchId: '', batchName: '',
    fees: 2500, feeAmount: 2500, feeDueDay: 5,
  })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleBatchChange = (batchId) => {
    const batch = batches.find(b => String(b.id) === String(batchId))
    set('batchId', batchId)
    set('batchName', batch?.name || '')
  }

  const handleSave = async () => {
    if (!form.name || !form.phone) return
    setLoading(true)
    try {
      await onSave(form)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Add New Student" onClose={onClose}>
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs text-blue-700">
          A <strong>Student ID</strong> and <strong>Join Code</strong> will be auto-generated.
          Share them with the student to activate their account.
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
        <div>
          <label className="label">Sport</label>
          <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
            {SPORTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Assign Batch</label>
          <select className="input" value={form.batchId} onChange={e => handleBatchChange(e.target.value)}>
            <option value="">— Select batch —</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.name} {b.days?.length ? `(${b.days.join(',')})` : ''} · {b.capacity - b.enrolled} seats
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Monthly Fee (₹)</label>
          <input className="input" type="number" value={form.fees}
            onChange={e => { set('fees', Number(e.target.value)); set('feeAmount', Number(e.target.value)) }} />
        </div>
        <div>
          <label className="label">Fee Due Day</label>
          <input className="input" type="number" min="1" max="31" placeholder="5"
            value={form.feeDueDay} onChange={e => set('feeDueDay', e.target.value)} />
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
