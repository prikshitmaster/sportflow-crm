import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { Bell, Calendar, Trophy, MapPin, Send, Megaphone } from 'lucide-react'
import SendStaffNoticeModal from '../../components/SendStaffNoticeModal'
import { staffMatchesAudience } from '../../lib/announcementAudience'
import { fetchNoticeReceipts } from '../../lib/notifications'

export default function StaffNotices() {
  // `events` and `announcements` from context are already sport+branch scoped
  // for the logged-in staff (staffScopedEvents / staffScopedAnnouncements) —
  // never fetch raw academy-wide rows here or branch isolation breaks.
  const { announcements, events, user, hasPermission, sendStaffNotice, staff, dataLoading } = useApp()
  const [showNotice, setShowNotice] = useState(false)
  const canSend  = hasPermission('staff.manage')  // messaging all staff — see Community.jsx
  const loading  = dataLoading

  // Events visible to this staff member (audience filter on top of branch/sport scope)
  const visibleEvents = (events || []).filter(e => {
    if (e.status === 'Cancelled') return false
    if (!e.audience_type || e.audience_type === 'all')   return true
    if (e.audience_type === 'staff') return true
    if (e.audience_type === 'staff_members') return (e.audience_ids || []).includes(user?.id)
    return false
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Audience filter belongs here, not in the context memo — the Community
  // management page shares that list and an author must still see their own
  // student-targeted posts. This is the staff inbox, so it shows only what is
  // actually addressed to this staff member.
  // Sort: `date` is day-precision, so same-day posts tie — id desc breaks it
  // and keeps the newest on top instead of bottom.
  const sorted = (announcements || [])
    .filter(a => staffMatchesAudience({ id: user?.id }, a))
    .sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')) || (b.id - a.id))

  // Staff Notices (sent via "Send Notice" on this page) get their own history
  // section, separate from Community's regular Announcements — same table,
  // told apart by type so the two lists don't blur together.
  const staffNotices         = sorted.filter(a => a.type === 'Staff Notice')
  const generalAnnouncements = sorted.filter(a => a.type !== 'Staff Notice')

  // Read/confirm receipts — only useful to whoever can send notices (a
  // recipient doesn't need to see who else confirmed). Fetched once per
  // visible notice; each notification row's announcement_id (migration 0127)
  // is what makes "who has this been sent to, and who confirmed" queryable.
  const [receipts, setReceipts] = useState({})   // { [noticeId]: [{recipient_id, read, actioned_at}] }
  const noticeIdsKey = staffNotices.map(a => a.id).join(',')
  useEffect(() => {
    if (!canSend || staffNotices.length === 0) return
    let alive = true
    Promise.all(staffNotices.map(a => fetchNoticeReceipts(a.id).then(rows => [a.id, rows])))
      .then(pairs => { if (alive) setReceipts(Object.fromEntries(pairs)) })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSend, noticeIdsKey])

  const staffById = Object.fromEntries((staff || []).map(s => [String(s.id), s]))

  const hasContent = visibleEvents.length > 0 || staffNotices.length > 0 || generalAnnouncements.length > 0

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

      {!loading && staffNotices.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Staff Notices</p>
          <div className="space-y-3">
            {staffNotices.map(a => {
              const rows      = receipts[a.id] || []
              const confirmed = rows.filter(r => r.actioned_at)
              return (
                <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bell size={15} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{a.title}</p>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">{a.body}</p>
                      <p className="text-[10px] text-gray-400 mt-2">
                        {a.date ? new Date(a.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''}
                      </p>
                      {canSend && rows.length > 0 && (
                        <div className="flex items-center gap-2 mt-2.5">
                          {confirmed.length > 0 && (
                            <div className="flex -space-x-2">
                              {confirmed.slice(0, 5).map(r => {
                                const m = staffById[r.recipient_id]
                                return (
                                  <div key={r.recipient_id}
                                    title={`${m?.name || 'Staff'} — confirmed`}
                                    className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-emerald-700">
                                    {m?.name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                )
                              })}
                              {confirmed.length > 5 && (
                                <div className="w-6 h-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[9px] font-bold text-gray-500">
                                  +{confirmed.length - 5}
                                </div>
                              )}
                            </div>
                          )}
                          <span className="text-[11px] text-gray-400">
                            {confirmed.length}/{rows.length} confirmed
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && generalAnnouncements.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Announcements</p>
          <div className="space-y-3">
            {generalAnnouncements.map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Megaphone size={15} className="text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">{a.body}</p>
                    <p className="text-[10px] text-gray-400 mt-2">
                      {a.date ? new Date(a.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''}
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
