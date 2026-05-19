import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, X, Check, CheckCheck, Trash2, BellOff, BellRing } from 'lucide-react'
import {
  fetchNotifications, markAllRead, markRead, deleteNotification,
  subscribeToNotifications, pushSupported, subscribeToPush, savePushSubscription,
  actionNotification,
} from '../lib/notifications'

const TYPE_ICON = {
  payment:      '💳',
  session:      '📅',
  trial:        '🏃',
  announcement: '📢',
  info:         'ℹ️',
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function NotifPanel({ notifs, unread, recipientType, recipientId, pushEnabled, pushLoading,
  enablePush, onMarkAll, onMarkOne, onDelete, onAction, onClose }) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <span className="font-bold text-gray-900 text-sm">
          Notifications {unread > 0 && <span className="text-brand-600">({unread} new)</span>}
        </span>
        <div className="flex items-center gap-1.5">
          {unread > 0 && (
            <button onClick={onMarkAll}
              className="flex items-center gap-1 text-[11px] text-brand-600 font-semibold hover:text-brand-800 px-2 py-1 rounded-lg hover:bg-brand-50">
              <CheckCheck size={12} /> All read
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Push banner */}
      {pushSupported() && !pushEnabled && Notification.permission !== 'denied' && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-brand-50 border-b border-brand-100 flex-shrink-0">
          <BellRing size={15} className="text-brand-600 flex-shrink-0" />
          <p className="text-xs text-brand-700 flex-1">Get alerts even when app is closed</p>
          <button onClick={enablePush} disabled={pushLoading}
            className="text-[11px] font-semibold bg-brand-600 text-white px-3 py-1 rounded-lg hover:bg-brand-700 disabled:opacity-60">
            {pushLoading ? '…' : 'Enable'}
          </button>
        </div>
      )}
      {pushSupported() && pushEnabled && (
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex-shrink-0">
          <BellRing size={13} className="text-emerald-600" />
          <p className="text-[11px] text-emerald-700 font-medium">Push notifications are on</p>
        </div>
      )}
      {pushSupported() && !pushEnabled && Notification.permission === 'denied' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <BellOff size={13} className="text-gray-400" />
          <p className="text-[11px] text-gray-500">Notifications blocked in browser settings</p>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {notifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Bell size={32} className="mb-2 opacity-25" />
            <p className="text-sm font-medium">No notifications yet</p>
            <p className="text-xs mt-1 text-gray-300">You'll see messages from your academy here</p>
          </div>
        ) : (
          notifs.map(n => (
            <div key={n.id}
              className={`flex gap-3 px-4 py-3.5 active:bg-gray-50 transition group ${!n.read ? 'bg-brand-50/50' : ''}`}>
              <span className="text-lg mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] || TYPE_ICON.info}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                {n.action_label && (
                  n.actioned_at
                    ? <span className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-emerald-600">
                        <Check size={11} /> {n.action_label}
                      </span>
                    : <button onClick={e => onAction(e, n.id)}
                        className="mt-2 text-xs font-semibold bg-brand-600 text-white px-4 py-1.5 rounded-lg active:bg-brand-700 transition">
                        {n.action_label}
                      </button>
                )}
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                {!n.read && (
                  <button onClick={e => onMarkOne(e, n)} className="p-1.5 rounded-lg hover:bg-gray-100 text-brand-400">
                    <Check size={13} />
                  </button>
                )}
                <button onClick={e => onDelete(e, n.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-300 active:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
              {!n.read && <span className="w-2 h-2 rounded-full bg-brand-600 mt-1.5 flex-shrink-0 self-start" />}
            </div>
          ))
        )}
      </div>
    </>
  )
}

export default function NotificationBell({ recipientType, recipientId, academyId }) {
  const [open,        setOpen]        = useState(false)
  const [notifs,      setNotifs]      = useState([])
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const ref = useRef(null)

  const unread = notifs.filter(n => !n.read).length

  const load = useCallback(async () => {
    if (!recipientId) return
    try { setNotifs(await fetchNotifications(recipientType, recipientId)) } catch {}
  }, [recipientType, recipientId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!recipientId) return
    const ch = subscribeToNotifications(recipientType, recipientId, n => setNotifs(p => [n, ...p]))
    return () => ch.unsubscribe()
  }, [recipientType, recipientId])

  useEffect(() => {
    if (!pushSupported()) return
    navigator.serviceWorker.ready
      .then(r => r.pushManager.getSubscription().then(s => setPushEnabled(!!s)))
      .catch(() => {})
  }, [])

  // Close on outside click — desktop only
  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    setOpen(o => !o)
    if (!open && unread > 0) {
      markAllRead(recipientType, recipientId)
      setNotifs(p => p.map(n => ({ ...n, read: true })))
    }
  }

  const enablePush = async () => {
    if (!pushSupported() || pushLoading) return
    setPushLoading(true)
    try {
      if (await Notification.requestPermission() !== 'granted') return
      const sub = await subscribeToPush()
      if (sub && academyId) {
        await savePushSubscription({ userType: recipientType, userId: recipientId, academyId, subscription: sub })
        setPushEnabled(true)
      }
    } catch {} finally { setPushLoading(false) }
  }

  const onMarkAll  = () => { markAllRead(recipientType, recipientId); setNotifs(p => p.map(n => ({ ...n, read: true }))) }
  const onMarkOne  = async (e, notif) => { e.stopPropagation(); if (notif.read) return; await markRead(notif.id); setNotifs(p => p.map(n => n.id === notif.id ? { ...n, read: true } : n)) }
  const onDelete   = async (e, id)   => { e.stopPropagation(); await deleteNotification(id); setNotifs(p => p.filter(n => n.id !== id)) }
  const onAction   = async (e, id)   => { e.stopPropagation(); await actionNotification(id); setNotifs(p => p.map(n => n.id === id ? { ...n, actioned_at: new Date().toISOString(), read: true } : n)) }
  const onClose    = () => setOpen(false)

  const panelProps = { notifs, unread, recipientType, recipientId, pushEnabled, pushLoading, enablePush, onMarkAll, onMarkOne, onDelete, onAction, onClose }

  return (
    <div className="relative" ref={ref}>
      {/* Bell */}
      <button onClick={handleOpen} aria-label="Notifications"
        className="relative p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition">
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 rounded-full
            text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Mobile: full-screen bottom sheet */}
      {open && (
        <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <div className="relative bg-white rounded-t-3xl flex flex-col max-h-[85vh] shadow-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>
            <NotifPanel {...panelProps} />
          </div>
        </div>
      )}

      {/* Desktop: dropdown */}
      {open && (
        <div className="hidden sm:flex flex-col absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden max-h-[500px]">
          <NotifPanel {...panelProps} />
        </div>
      )}
    </div>
  )
}
