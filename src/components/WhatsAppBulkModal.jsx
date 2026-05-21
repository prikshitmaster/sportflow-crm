// Bulk WhatsApp reminder queue.
//
// Browsers block opening multiple tabs at once, and Meta would flag
// true bulk auto-send as spam — so this is a guided queue: one tap
// per parent. Owner clicks 'Send' → wa.me opens with message
// pre-filled → owner hits send in WhatsApp → comes back, clicks Next.
//
// Each parent is marked "sent today" in localStorage so re-opening
// the modal skips already-sent rows.

import { useMemo, useState } from 'react'
import {
  X, MessageCircle, Check, SkipForward, ChevronRight, AlertCircle,
} from 'lucide-react'
import {
  openWhatsAppLink, buildFeesReminderMessage,
  wasSentToday, markSentToday, daysOverdue, normalizePhoneForWhatsApp,
} from '../lib/whatsapp'

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')

export default function WhatsAppBulkModal({ overdueStudents, academy, onClose }) {
  // Build initial queue — students who haven't been sent today, sorted by days overdue desc
  const initialQueue = useMemo(() => {
    return overdueStudents
      .map(s => ({
        ...s,
        days:        daysOverdue(s.paidTill),
        phone:       normalizePhoneForWhatsApp(s.parentPhone || s.phone),
        alreadySent: wasSentToday(s.id),
      }))
      .sort((a, b) => b.days - a.days)
  }, [overdueStudents])

  const [queue]    = useState(initialQueue)
  const [idx, setIdx] = useState(() => initialQueue.findIndex(s => !s.alreadySent && s.phone))
  const [sentIds, setSentIds]   = useState(() => new Set(initialQueue.filter(s => s.alreadySent).map(s => s.id)))
  const [skippedIds, setSkippedIds] = useState(() => new Set())

  const current = idx >= 0 ? queue[idx] : null
  const remaining = queue.filter(s => !sentIds.has(s.id) && !skippedIds.has(s.id) && s.phone).length

  const advance = () => {
    // Find next unsent + un-skipped + has-phone row
    const next = queue.findIndex((s, i) =>
      i > idx && !sentIds.has(s.id) && !skippedIds.has(s.id) && s.phone
    )
    setIdx(next)
  }

  const send = () => {
    if (!current) return
    const message = buildFeesReminderMessage({ student: current, academy })
    openWhatsAppLink(current.phone, message)
    markSentToday(current.id)
    setSentIds(prev => new Set(prev).add(current.id))
    // Don't auto-advance — let owner click "Next" so they can verify it sent
  }

  const skip = () => {
    if (!current) return
    setSkippedIds(prev => new Set(prev).add(current.id))
    advance()
  }

  const allDone = idx === -1 || remaining === 0
  const total       = queue.length
  const sentCount   = sentIds.size
  const skippedCnt  = skippedIds.size
  const noPhoneCnt  = queue.filter(s => !s.phone).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-emerald-600 text-white px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <MessageCircle size={18} />
              <h3 className="font-black text-base">Send WhatsApp Reminders</h3>
            </div>
            <p className="text-[11px] text-emerald-100">
              {sentCount} sent · {remaining} remaining · {skippedCnt} skipped
              {noPhoneCnt > 0 && ` · ${noPhoneCnt} no phone`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-emerald-100">
          <div className="h-1 bg-emerald-500 transition-all"
            style={{ width: total ? `${((sentCount + skippedCnt) / total) * 100}%` : '0%' }} />
        </div>

        {/* Body */}
        {allDone ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mb-3">
              <Check size={28} className="text-emerald-600" />
            </div>
            <p className="font-black text-gray-900">All done</p>
            <p className="text-xs text-gray-500 mt-1">
              {sentCount} reminders sent today
              {skippedCnt > 0 && ` · ${skippedCnt} skipped`}
            </p>
            <button onClick={onClose}
              className="mt-5 px-5 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold">
              Close
            </button>
          </div>
        ) : current && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Player card */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  {idx + 1} of {queue.length}
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  {current.days} {current.days === 1 ? 'day' : 'days'} overdue
                </span>
              </div>
              <p className="text-base font-black text-gray-900">{current.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[current.studentCode, current.sport, current.batch].filter(Boolean).join(' · ')}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-bold">Amount</p>
                  <p className="text-sm font-black text-gray-900">{inr(current.fees)}</p>
                </div>
                <div className="bg-white rounded-lg px-3 py-2 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-bold">To</p>
                  <p className="text-sm font-bold text-gray-900 truncate">{current.parent || '—'}</p>
                  <p className="text-[10px] text-gray-400 font-mono">+{current.phone}</p>
                </div>
              </div>
            </div>

            {/* Message preview */}
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                Message preview
              </p>
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 text-xs text-gray-800 whitespace-pre-line leading-relaxed font-medium">
                {buildFeesReminderMessage({ student: current, academy })}
              </div>
            </div>

            {sentIds.has(current.id) && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 flex items-center gap-2 text-blue-700">
                <Check size={14} />
                <span className="text-xs font-semibold">
                  WhatsApp opened. Send the message there, then click Next.
                </span>
              </div>
            )}

            {!current.phone && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-start gap-2 text-amber-800">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span className="text-xs">
                  No parent phone on file — skip and add it on the student profile.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        {!allDone && current && (
          <div className="border-t border-gray-100 bg-white px-4 py-3 flex items-center gap-2"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            <button
              onClick={skip}
              className="px-3 py-3 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold flex items-center gap-1.5">
              <SkipForward size={13} /> Skip
            </button>

            {sentIds.has(current.id) ? (
              <button
                onClick={advance}
                className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-black text-sm flex items-center justify-center gap-2">
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!current.phone}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center gap-2 disabled:bg-gray-300">
                <MessageCircle size={16} /> Send WhatsApp
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
