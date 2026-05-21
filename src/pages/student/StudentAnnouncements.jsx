import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { Megaphone, Calendar, Trophy, MapPin, Bell } from 'lucide-react'

const typeIcon  = { Holiday: <Calendar size={16} className="text-blue-500"/>, Tournament: <Trophy size={16} className="text-amber-500"/>, Achievement: <Trophy size={16} className="text-yellow-500"/>, Reminder: <Bell size={16} className="text-red-500"/>, Announcement: <Megaphone size={16} className="text-brand-500"/> }
const typeBadge = { Holiday: 'badge-blue', Tournament: 'badge-yellow', Achievement: 'badge-yellow', Reminder: 'badge-red', Announcement: 'badge-blue' }

export default function StudentAnnouncements() {
  const { announcements: ctxAnnouncements, studentUser } = useApp()
  const [announcements, setAnnouncements] = useState([])
  const [events,        setEvents]        = useState([])
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    const academyId = studentUser?.academy_id
    Promise.all([
      // Always fetch fresh — context announcements may be from a different sport scope
      db.fetchAnnouncements(academyId),
      db.fetchEvents(academyId),
    ])
      .then(([ann, evts]) => {
        setAnnouncements(ann || [])
        setEvents(evts || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [studentUser?.academy_id])

  // Scope filters — student only sees content tagged for their sport+branch
  // OR content with no sport/branch tag (= academy-wide).
  const studentSport    = (studentUser?.sport || '').toLowerCase()
  const studentBatchId  = studentUser?.batchId
  const studentBranchId = studentUser?.branch_id || studentUser?.branchId || null

  const sportMatch  = (item) => !item.sport     || item.sport.toLowerCase() === studentSport
  const branchMatch = (item) => !item.branch_id || item.branch_id === studentBranchId

  const visibleEvents = events.filter(e => {
    if (e.status === 'Cancelled') return false
    if (!sportMatch(e))           return false
    if (!e.audience_type || e.audience_type === 'all')      return true
    if (e.audience_type === 'students') return true
    if (e.audience_type === 'batches')  return studentBatchId && (e.audience_ids || []).includes(studentBatchId)
    return false
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const visibleAnnouncements = announcements.filter(a => sportMatch(a) && branchMatch(a))

  const hasContent = visibleEvents.length > 0 || visibleAnnouncements.length > 0

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900">Notices</h1>
        <p className="text-sm text-gray-500">Events, tournaments &amp; academy updates</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : !hasContent ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <Megaphone size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No notices yet</p>
        </div>
      ) : (
        <>
          {visibleEvents.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Events &amp; Tournaments</p>
              <div className="space-y-3">
                {visibleEvents.map(e => (
                  <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${e.type==='tournament'?'bg-amber-50':'bg-brand-50'}`}>
                        {e.type === 'tournament'
                          ? <Trophy size={16} className="text-amber-500" />
                          : <Calendar size={16} className="text-brand-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-bold text-gray-900 text-sm leading-snug">{e.title}</p>
                          <span className={`badge flex-shrink-0 ${e.type==='tournament'?'badge-yellow':'badge-purple'}`}>
                            {e.type==='tournament'?'Tournament':'Event'}
                          </span>
                        </div>
                        {e.description && <p className="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-2">{e.description}</p>}
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          {e.date && <span>{new Date(e.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>}
                          {e.venue && <span className="flex items-center gap-0.5"><MapPin size={10}/>{e.venue}</span>}
                          {e.sport && <span>{e.sport}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleAnnouncements.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Announcements</p>
              <div className="space-y-3">
                {visibleAnnouncements.map(a => (
                  <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                        {typeIcon[a.type] || <Megaphone size={16} className="text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-bold text-gray-900 text-sm leading-snug">{a.title}</p>
                          <span className={`badge flex-shrink-0 ${typeBadge[a.type]||'badge-gray'}`}>{a.type}</span>
                        </div>
                        {a.body && <p className="text-xs text-gray-500 leading-relaxed mb-2">{a.body}</p>}
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{a.date}</span>
                          {a.author && <><span>·</span><span>{a.author}</span></>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
