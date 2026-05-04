import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { Megaphone, Calendar, Trophy, Bell, Tag } from 'lucide-react'

const typeIcon = {
  Holiday:      <Calendar size={16} className="text-blue-500" />,
  Tournament:   <Trophy size={16} className="text-amber-500" />,
  Achievement:  <Trophy size={16} className="text-yellow-500" />,
  Reminder:     <Bell size={16} className="text-red-500" />,
  Announcement: <Megaphone size={16} className="text-brand-500" />,
}

const typeBadge = {
  Holiday:      'badge-blue',
  Tournament:   'badge-yellow',
  Achievement:  'badge-yellow',
  Reminder:     'badge-red',
  Announcement: 'badge-blue',
}

export default function StudentAnnouncements() {
  const { announcements: ctxAnnouncements } = useApp()
  const [list,    setList]    = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (ctxAnnouncements?.length) {
      setList(ctxAnnouncements)
    } else {
      setLoading(true)
      db.fetchAnnouncements()
        .then(setList)
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [ctxAnnouncements])

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900">Notices</h1>
        <p className="text-sm text-gray-500">Academy announcements and updates</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <Megaphone size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(a => (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  {typeIcon[a.type] || <Megaphone size={16} className="text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-bold text-gray-900 text-sm leading-snug">{a.title}</p>
                    <span className={`badge flex-shrink-0 ${typeBadge[a.type] || 'badge-gray'}`}>{a.type}</span>
                  </div>
                  {a.body && <p className="text-xs text-gray-500 leading-relaxed mb-2">{a.body}</p>}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{a.date}</span>
                    <span>·</span>
                    <span>{a.author}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
