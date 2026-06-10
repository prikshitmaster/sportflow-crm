import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { Bell, Calendar, Trophy, MapPin, Send } from 'lucide-react'
import SendStaffNoticeModal from '../../components/SendStaffNoticeModal'
import { todayStr } from '../../lib/dates'

export default function StaffNotices() {
  const { announcements, user, hasPermission, sendStaffNotice, staff } = useApp()
  const [events,     setEvents]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showNotice, setShowNotice] = useState(false)
  const canSend = hasPermission('community.manage')

  useEffect(() => {
    db.fetchEvents(user?.academyId)
      .then(rows => setEvents(rows || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user?.academyId])

  const today = todayStr()

  // Events visible to this staff member
  const visibleEvents = events.filter(e => {
    if (e.status === 'Cancelled') return false
    if (!e.audience_type || e.audience_type === 'all')   return true
    if (e.audience_type === 'staff') return true
    if (e.audience_type === 'staff_members') return (e.audience_ids || []).includes(user?.id)
    return false
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const sorted = [...(announcements || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  const hasContent = visibleEvents.length > 0 || sorted.length > 0

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-900">Notices</h1>
          <p className="text-xs text-gray-500 mt-0.5">Events, tournaments &amp; announcements</p>
        </div>
        {canSend && (
          <button onClick={() => setShowNotice(true)} className="btn-primary py-2 text-sm">
            <Send size={14} /> Send Notice
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      )}

      {!loading && !hasContent && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Bell size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">No notices yet</p>
        </div>
      )}

      {!loading && visibleEvents.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Events &amp; Tournaments</p>
          <div className="space-y-3">
            {visibleEvents.map(e => (
              <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${e.type === 'tournament' ? 'bg-amber-50' : 'bg-brand-50'}`}>
                    {e.type === 'tournament'
                      ? <Trophy size={15} className="text-amber-500" />
                      : <Calendar size={15} className="text-brand-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold text-gray-900 truncate">{e.title}</p>
                      {e.sport && <span className="badge badge-blue flex-shrink-0">{e.sport}</span>}
                    </div>
                    {e.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{e.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                      <span>{e.date ? new Date(e.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''}</span>
                      {e.venue && <span className="flex items-center gap-0.5"><MapPin size={9}/>{e.venue}</span>}
                      <span className={`badge ${e.type==='tournament'?'badge-yellow':'badge-purple'} py-0`}>{e.type==='tournament'?'Tournament':'Event'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Announcements</p>
          <div className="space-y-3">
            {sorted.map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bell size={15} className="text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">{a.message}</p>
                    <p className="text-[10px] text-gray-400 mt-2">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showNotice && (
        <SendStaffNoticeModal
          staff={staff}
          onClose={() => setShowNotice(false)}
          onSend={sendStaffNotice}
        />
      )}
    </div>
  )
}
