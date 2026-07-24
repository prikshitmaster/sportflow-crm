// Staff Roster — coach's student list
// Shows all active students in the coach's batches
// Photo avatar, name, parent contact (WhatsApp tap), batch, sport
// Search by name or parent

import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Search, Phone, Users, FolderOpen, Lock, X } from 'lucide-react'
import * as db from '../../lib/db'
import StudentDocumentsCard from '../../components/StudentDocumentsCard'

export default function StaffRoster() {
  const { user, batches, students, hasPermission } = useApp()
  const [search, setSearch] = useState('')
  const [batchFilter, setBatchFilter] = useState('all')
  const [docsStudent, setDocsStudent] = useState(null)   // student whose docs sheet is open
  const [lockMsg, setLockMsg] = useState(false)
  const canViewDocs = hasPermission('documents.view')

  const openDocs = (s) => {
    if (!canViewDocs) {
      setLockMsg(true)
      setTimeout(() => setLockMsg(false), 3000)
      return
    }
    setDocsStudent(s)
  }

  const pad2  = n => String(n).padStart(2, '0')
  const now   = new Date()
  const today = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`

  const [todayAtt, setTodayAtt] = useState({})
  useEffect(() => {
    db.fetchAttendanceForDate(today).then(setTodayAtt).catch(() => {})
  }, [today])

  // Coach's assigned batches
  const myBatches = useMemo(() => {
    const assigned = batches.filter(b =>
      b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
    )
    return assigned.length > 0 ? assigned : batches
  }, [batches, user])

  // All active students in those batches
  const rosterStudents = useMemo(() => {
    return students.filter(s =>
      s.status === 'Active' &&
      myBatches.some(b => b.id === s.batchId || b.name === s.batch)
    )
  }, [students, myBatches])

  // Apply search + batch filter
  const visible = useMemo(() => {
    const q = search.toLowerCase()
    return rosterStudents.filter(s => {
      const matchBatch  = batchFilter === 'all' || s.batch === batchFilter || String(s.batchId) === batchFilter
      const matchSearch = !q || s.name.toLowerCase().includes(q) || (s.parent || '').toLowerCase().includes(q)
      return matchBatch && matchSearch
    })
  }, [rosterStudents, search, batchFilter])

  const attStatus = (id) => todayAtt[id] || 'Unmarked'
  const attColor  = { Present: 'bg-emerald-100 text-emerald-700', Absent: 'bg-red-100 text-red-700', Late: 'bg-amber-100 text-amber-700', Unmarked: 'bg-gray-100 text-gray-500' }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">Student Roster</h2>
            <p className="text-xs text-gray-400">{rosterStudents.length} students · {myBatches.length} batches</p>
          </div>
          {/* Live count badge */}
          <div className="text-right">
            <p className="text-lg font-black text-emerald-600">
              {rosterStudents.filter(s => todayAtt[s.id] === 'Present').length}
            </p>
            <p className="text-[10px] text-gray-400 leading-tight">present<br/>today</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-8 py-2 text-sm"
            placeholder="Search by name or parent…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Batch filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setBatchFilter('all')}
            className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition ${
              batchFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            All
          </button>
          {myBatches.map(b => (
            <button key={b.id}
              onClick={() => setBatchFilter(b.name)}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition ${
                batchFilter === b.name ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <Users size={32} className="text-gray-200 mb-3" />
            <p className="text-sm text-gray-500">{search ? 'No students match your search' : 'No students in your batches yet'}</p>
          </div>
        ) : visible.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3 bg-white">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-sm font-black text-brand-700 flex-shrink-0">
              {s.name[0]}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-gray-900 truncate">{s.name}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${attColor[attStatus(s.id)]}`}>
                  {attStatus(s.id)}
                </span>
              </div>
              <p className="text-xs text-gray-400 truncate">
                {s.batch} · {s.sport} · Age {s.age}
              </p>
              {s.parent && (
                <p className="text-xs text-gray-400 truncate">{s.parent}</p>
              )}
            </div>

            {/* Documents — needs documents.view granted by owner/manager */}
            <button
              onClick={() => openDocs(s)}
              className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition ${
                canViewDocs
                  ? 'bg-brand-50 text-brand-600 active:bg-brand-100'
                  : 'bg-gray-50 text-gray-300'
              }`}
              title={canViewDocs ? 'View documents' : 'Document access not granted'}
            >
              {canViewDocs ? <FolderOpen size={15} /> : <Lock size={14} />}
            </button>

            {/* Phone / WhatsApp tap */}
            {(s.parentPhone || s.phone) && (
              <a
                href={`https://wa.me/91${(s.parentPhone || s.phone).replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex-shrink-0 w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center text-green-600 active:bg-green-100 transition"
              >
                <Phone size={15} />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* No-permission toast */}
      {lockMsg && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-gray-900 text-white text-xs font-semibold rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg">
          <Lock size={14} className="flex-shrink-0" />
          Document access hasn't been granted to you — ask your manager or owner to enable "View Student Documents" for your account.
        </div>
      )}

      {/* Documents bottom sheet */}
      {docsStudent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={e => e.target === e.currentTarget && setDocsStudent(null)}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setDocsStudent(null)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-white px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="font-bold text-gray-900 text-sm">{docsStudent.name}</p>
                <p className="text-[11px] text-gray-400">
                  Documents{docsStudent.crsNumber ? ` · CRS ${docsStudent.crsNumber}` : ''}{docsStudent.heightCm ? ` · ${docsStudent.heightCm} cm` : ''}
                </p>
              </div>
              <button onClick={() => setDocsStudent(null)} className="p-1.5 text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              {/* Coaches can view/download only — upload/delete needs students.manage via owner app */}
              <StudentDocumentsCard studentId={docsStudent.id} canUpload={false} canDelete={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
