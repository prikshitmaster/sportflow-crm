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

export default function NotificationBell({ recipientType, recipientId, academyId }) {
  const [open,         setOpen]         = useState(false)
  const [notifs,       setNotifs]        = useState([])
  const [pushEnabled,  setPushEnabled]   = useState(false)
  const [pushLoading,  setPushLoading]   = useState(false)
  const ref = useRef(null)

  const unread = notifs.filter(n => !n.read).length

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!recipientId) return
    try {
      const data = await fetchNotifications(recipientType, recipientId)
      setNotifs(data)
    } catch {}
  }, [recipientType, recipientId])

  useEffect(() => { load() }, [load])

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!recipientId) return
    const channel = subscribeToNotifications(recipientType, recipientId, (newNotif) => {
      setNotifs(prev => [newNotif, ...prev])
    })
    return () => { channel.unsubscribe() }
  }, [recipientType, recipientId])

  // ── Push permission check ─────────────────────────────────────────────────
  useEffect(() => {
    if (!pushSupported()) return
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => setPushEnabled(!!sub))
    ).catch(() => {})
  }, [])

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Open: mark all read ───────────────────────────────────────────────────
  const handleOpen = () => {
    setOpen(o => !o)
    if (!open && unread > 0) {
      markAllRead(recipientType, recipientId)
      setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    }
  }

  // ── Enable push ───────────────────────────────────────────────────────────
  const enablePush = async () => {
    if (!pushSupported() || pushLoading) return
    setPushLoading(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushLoading(false); return }
      const sub = await subscribeToPush()
      if (sub && academyId) {
        await savePushSubscription({ userType: recipientType, userId: recipientId, academyId, subscription: sub })
        setPushEnabled(true)
      }
    } catch {}
    setPushLoading(false)
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await deleteNotification(id)
    setNotifs(prev => prev.filter(n => n.id !== id))
  }

  const handleMarkOne = async (e, notif) => {
    e.stopPropagation()
    if (notif.read) return
    await markRead(notif.id)
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
  }

  const handleAction = async (e, id) => {
    e.stopPropagation()
    await actionNotification(id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, actioned_at: new Date().toISOString(), read: true } : n))
  }

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
        aria-label="Notifications"
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 rounded-full
            text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-bold text-gray-900 text-sm">Notifications</span>
            <div className="flex items-center gap-1.5">
              {unread > 0 && (
                <button
                  onClick={() => { markAllRead(recipientType, recipientId); setNotifs(p => p.map(n => ({ ...n, read: true }))) }}
                  className="flex items-center gap-1 text-[11px] text-brand-600 font-semibold hover:text-brand-800 px-2 py-1 rounded-lg hover:bg-brand-50"
                >
                  <CheckCheck size={12} /> All read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Push enable banner */}
          {pushSupported() && !pushEnabled && Notification.permission !== 'denied' && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-brand-50 border-b border-brand-100">
              <BellRing size={15} className="text-brand-600 flex-shrink-0" />
              <p className="text-xs text-brand-700 flex-1">Get alerts even when app is closed</p>
              <button
                onClick={enablePush}
                disabled={pushLoading}
                className="text-[11px] font-semibold bg-brand-600 text-white px-3 py-1 rounded-lg hover:bg-brand-700 disabled:opacity-60"
              >
                {pushLoading ? '…' : 'Enable'}
              </button>
            </div>
          )}
          {pushSupported() && pushEnabled && (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100">
              <BellRing size={13} className="text-emerald-600" />
              <p className="text-[11px] text-emerald-700 font-medium">Push notifications are on</p>
            </div>
          )}
          {pushSupported() && !pushEnabled && Notification.permission === 'denied' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
              <BellOff size={13} className="text-gray-400" />
              <p className="text-[11px] text-gray-500">Notifications blocked in browser settings</p>
            </div>
          )}

          {/* List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50">
            {notifs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Bell size={28} className="mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifs.map(n => (
                <div
                  key={n.id}
                  className={`flex gap-3 px-4 py-3 hover:bg-gray-50 transition group ${!n.read ? 'bg-brand-50/50' : ''}`}
                >
                  <span className="text-base mt-0.5 flex-shrink-0">{TYPE_ICON[n.type] || TYPE_ICON.info}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {n.title}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    {n.action_label && (
                      n.actioned_at
                        ? <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-semibold text-emerald-600">
                            <Check size={10} /> {n.action_label}
                          </span>
                        : <button
                            onClick={e => handleAction(e, n.id)}
                            className="mt-1.5 text-[11px] font-semibold bg-brand-600 text-white px-3 py-1 rounded-lg hover:bg-brand-700 transition"
                          >
                            {n.action_label}
                          </button>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                    {!n.read && (
                      <button onClick={e => handleMarkOne(e, n)} className="p-1 rounded hover:bg-gray-200 text-brand-500">
                        <Check size={11} />
                      </button>
                    )}
                    <button onClick={e => handleDelete(e, n.id)} className="p-1 rounded hover:bg-red-50 text-red-400">
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {!n.read && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-600 mt-1.5 flex-shrink-0 self-start" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
