import { useEffect, useState } from 'react'
import * as db from '../../lib/db'
import { Bell } from 'lucide-react'

export default function ParentNotices() {
  const [loading, setLoading] = useState(true)
  const [items, setItems]     = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dash = await db.fetchParentDashboard()
        if (cancelled) return
        const academyId = dash?.parent?.academy_id
        if (!academyId) { setItems([]); return }
        const list = await db.fetchAnnouncements(academyId).catch(() => [])
        setItems(list || [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-5 space-y-2">
        <div className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 text-center">
        <Bell className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No announcements yet.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
      <h1 className="text-xl font-black text-gray-900">Notices</h1>
      {items.map(a => (
        <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center text-brand-700">
              <Bell size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-sm">{a.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {a.author || 'Academy'} · {a.date}
              </p>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{a.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
