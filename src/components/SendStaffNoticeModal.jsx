import { useState } from 'react'
import { X, Send, Users, User, CheckSquare, Square } from 'lucide-react'

const ACTION_PRESETS = ['Got it', 'Acknowledge', 'Confirm', 'Done', 'Will do']

export default function SendStaffNoticeModal({ staff = [], onSend, onClose }) {
  const [title,       setTitle]       = useState('')
  const [body,        setBody]        = useState('')
  const [actionLabel, setActionLabel] = useState('')
  const [allStaff,    setAllStaff]    = useState(true)
  const [selected,    setSelected]    = useState(new Set())
  const [sending,     setSending]     = useState(false)

  const toggleMember = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const recipientIds = allStaff ? staff.map(s => s.id) : [...selected]
  const canSend = title.trim() && body.trim() && recipientIds.length > 0

  const handleSend = async () => {
    if (!canSend || sending) return
    setSending(true)
    try {
      await onSend({ title: title.trim(), body: body.trim(), actionLabel: actionLabel.trim() || null, recipientIds })
      onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900">Send Staff Notice</h2>
            <p className="text-xs text-gray-500 mt-0.5">Staff see this in their notification bell</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              placeholder="e.g. Attendance reminder, Training update…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
            />
          </div>

          {/* Message */}
          <div>
            <label className="label">Message</label>
            <textarea
              className="input min-h-[80px] resize-none"
              placeholder="Write your message to the staff…"
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={300}
            />
            <p className="text-[10px] text-gray-400 mt-1 text-right">{body.length}/300</p>
          </div>

          {/* Action button label (optional) */}
          <div>
            <label className="label">Action Button <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              className="input"
              placeholder="e.g. Got it, Acknowledge, Confirm…"
              value={actionLabel}
              onChange={e => setActionLabel(e.target.value)}
              maxLength={30}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ACTION_PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActionLabel(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${actionLabel === p ? 'bg-brand-600 text-white border-brand-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            {actionLabel && (
              <p className="text-[11px] text-gray-500 mt-2">
                Staff will see a <span className="font-semibold text-brand-600">"{actionLabel}"</span> button. You can track who tapped it.
              </p>
            )}
          </div>

          {/* Recipients */}
          <div>
            <label className="label">Recipients</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAllStaff(true)}
                className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-xl border text-sm font-semibold transition ${allStaff ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                <Users size={15} /> All Staff ({staff.length})
              </button>
              <button
                type="button"
                onClick={() => setAllStaff(false)}
                className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-xl border text-sm font-semibold transition ${!allStaff ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                <User size={15} /> Select ({selected.size})
              </button>
            </div>

            {!allStaff && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {staff.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No staff members found</p>
                )}
                {staff.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleMember(s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition text-left"
                  >
                    {selected.has(s.id)
                      ? <CheckSquare size={16} className="text-brand-600 flex-shrink-0" />
                      : <Square size={16} className="text-gray-300 flex-shrink-0" />}
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">
                      {s.name?.[0] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{s.accessRole || s.role || 'staff'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={handleSend}
            disabled={!canSend || sending}
            className="w-full btn-primary justify-center py-3 disabled:opacity-50"
          >
            {sending
              ? <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Sending…</span>
              : <><Send size={15} /> Send to {allStaff ? `all ${staff.length} staff` : `${selected.size} staff`}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
