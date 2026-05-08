import { useApp } from '../../context/AppContext'
import { Bell } from 'lucide-react'

export default function StaffNotices() {
  const { announcements } = useApp()
  const sorted = [...(announcements || [])].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  )

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div>
        <h1 className="text-xl font-black text-gray-900">Notices</h1>
        <p className="text-xs text-gray-500 mt-0.5">Academy announcements &amp; updates</p>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <Bell size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">No notices yet</p>
          <p className="text-xs text-gray-400 mt-1">Your academy announcements will appear here</p>
        </div>
      ) : (
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
                    {a.created_at
                      ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                      : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
