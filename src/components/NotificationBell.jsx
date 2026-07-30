import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bell, X, Check, CheckCheck, Trash2, BellOff, BellRing,
         CreditCard, CalendarDays, Zap, Megaphone, Info, TrendingUp } from 'lucide-react'
import {
  fetchNotifications, markAllRead, markRead, deleteNotification,
  subscribeToNotifications, pushSupported, subscribeToPush, savePushSubscription, purgeOldRead,
  actionNotification,
} from '../lib/notifications'
import { fcmSupported, initFcm, saveFcmToken } from '../lib/fcm'
import { useApp } from '../context/AppContext'

// Emoji rendered inconsistently across devices and read as clutter at list
// density. Tinted icon chips scan faster and let type be identified by colour.
const TYPE_STYLE = {
  payment:      { Icon: CreditCard,  fg: 'text-emerald-600', bg: 'bg-emerald-50' },
  session:      { Icon: CalendarDays, fg: 'text-blue-600',   bg: 'bg-blue-50'    },
  trial:        { Icon: Zap,          fg: 'text-amber-600',  bg: 'bg-amber-50'   },
  announcement: { Icon: Megaphone,    fg: 'text-violet-600', bg: 'bg-violet-50'  },
  performance:  { Icon: TrendingUp,   fg: 'text-indigo-600', bg: 'bg-indigo-50'  },
  info:         { Icon: Info,         fg: 'text-gray-500',   bg: 'bg-gray-100'   },
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Day headers give the list rhythm instead of one undifferentiated wall.
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

function groupByDay(list) {
  const today     = startOfDay(new Date())
  const yesterday = today - 86400000
  const buckets   = { Today: [], Yesterday: [], Earlier: [] }
  for (const n of list) {
    const t = startOfDay(new Date(n.created_at))
    if      (t === today)     buckets.Today.push(n)
    else if (t === yesterday) buckets.Yesterday.push(n)
    else                      buckets.Earlier.push(n)
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0)
}

function NotifPanel({ notifs, unread, recipientType, recipientId, pushEnabled, pushLoading,
  enablePush, onMarkAll, onMarkOne, onClearRead, onAction, onClose }) {
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
              <CheckCheck size={12} /> Mark read
            </button>
          )}
          {notifs.some(n => n.read) && (
            <button onClick={onClearRead}
              className="flex items-center gap-1 text-[11px] text-gray-500 font-semibold hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100">
              <Trash2 size={12} /> Clear read
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
      <div className="flex-1 overflow-y-auto">
        {notifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <Bell size={20} className="text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-gray-500">You're all caught up</p>
            <p className="text-xs mt-1 text-gray-400">Messages from your academy appear here</p>
          </div>
        ) : (
          groupByDay(notifs).map(([label, rows]) => (
            <div key={label}>
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-gray-50/95 backdrop-blur-sm border-y border-gray-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
              </div>
              {rows.map(n => {
                const { Icon, fg, bg } = TYPE_STYLE[n.type] || TYPE_STYLE.info
                return (
                  <div key={n.id}
                    onClick={e => !n.read && onMarkOne(e, n)}
                    className={`relative flex gap-3 px-4 py-3.5 border-b border-gray-50 transition group
                      ${n.read ? 'bg-white hover:bg-gray-50/70'
                               : 'bg-brand-50/40 hover:bg-brand-50/70 cursor-pointer'}`}>
                    {/* Accent rail: unread is legible at a glance, not just by weight */}
                    {!n.read && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-600" />}

                    <div className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon size={16} className={fg} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={`text-sm leading-snug flex-1 min-w-0
                          ${n.read ? 'text-gray-700' : 'font-bold text-gray-900'}`}>
                          {n.title}
                        </p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-brand-600 flex-shrink-0 mt-1.5" />}
                      </div>
                      {n.body && (
                        <p className={`text-xs mt-0.5 leading-relaxed line-clamp-2
                          ${n.read ? 'text-gray-400' : 'text-gray-600'}`}>{n.body}</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1.5">{timeAgo(n.created_at)}</p>
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

                    {/* No per-row bin: a delete control on every line is visual
                        noise for something that clears itself. Bulk "Clear read"
                        lives in the header, and read rows expire on their own. */}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </>
  )
}

export default function NotificationBell({ recipientType, recipientId, academyId }) {
  const { showToast } = useApp()
  const [open,        setOpen]        = useState(false)
  const [notifs,      setNotifs]      = useState([])
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const ref = useRef(null)

  const unread = notifs.filter(n => !n.read).length

  const load = useCallback(async () => {
    if (!recipientId) return
    // Sweep read-and-stale rows first so the fetch below returns the trimmed
    // list. Best-effort: a failed purge must never stop notifications loading.
    try { await purgeOldRead(recipientType, recipientId, 7) } catch {}
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

  // Native Android: register for FCM silently, no manual "Enable" button needed
  useEffect(() => {
    if (!fcmSupported() || !recipientId || !academyId) return
    initFcm({
      onNotificationTap: link => link && markAllRead(recipientType, recipientId),
      // App open = Android suppresses the tray notification, so surface it here.
      onForegroundMessage: ({ title, body }) => showToast?.(body ? `${title} — ${body}` : title),
    })
      .then(token => token && saveFcmToken({ userType: recipientType, userId: recipientId, academyId, token }))
      .catch(() => {})
  }, [recipientType, recipientId, academyId, showToast])

  // Close on outside click — desktop only
  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Opening the panel used to mark everything read at once, so unread styling
  // was never actually visible — the list was always fully read by the time you
  // could look at it, and anything you hadn't got to was silently cleared.
  // Now rows stay unread until you tap one (or use "All read"), which is what
  // every mail/chat client does.
  const handleOpen = () => setOpen(o => !o)

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

  // Both handlers update optimistically, then REVERT if the write did not land.
  // Previously the local state was set regardless, so a refused or zero-row
  // update left the badge cleared until the next fetch put the count straight
  // back — which reads as "marking read doesn't work".
  const onMarkAll = async () => {
    const before = notifs
    setNotifs(p => p.map(n => ({ ...n, read: true })))
    try {
      await markAllRead(recipientType, recipientId)
    } catch (err) {
      setNotifs(before)
      showToast?.(err.message || 'Could not mark notifications as read', 'error')
    }
  }

  const onMarkOne = async (e, notif) => {
    e.stopPropagation()
    if (notif.read) return
    const before = notifs
    setNotifs(p => p.map(n => n.id === notif.id ? { ...n, read: true } : n))
    try {
      await markRead(notif.id)
    } catch (err) {
      setNotifs(before)
      showToast?.(err.message || 'Could not mark as read', 'error')
    }
  }
  // Bulk clear of everything already read — replaces the per-row bin. Unread is
  // deliberately untouched: you should never lose something you have not seen.
  const onClearRead = async () => {
    const readIds = notifs.filter(n => n.read).map(n => n.id)
    if (!readIds.length) return
    setNotifs(p => p.filter(n => !n.read))
    await Promise.allSettled(readIds.map(id => deleteNotification(id)))
  }
  const onAction   = async (e, id)   => { e.stopPropagation(); await actionNotification(id); setNotifs(p => p.map(n => n.id === id ? { ...n, actioned_at: new Date().toISOString(), read: true } : n)) }
  const onClose    = () => setOpen(false)

  const panelProps = { notifs, unread, recipientType, recipientId, pushEnabled, pushLoading, enablePush, onMarkAll, onMarkOne, onClearRead, onAction, onClose }

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
        createPortal(
          // Portalled to <body> on purpose. This bell sits inside a
          // `sticky z-30` header, which forms a stacking context — so the
          // sheet's z-50 was being resolved *inside* z-30 and lost to the
          // bottom nav (also z-30, but later in the DOM). The panel rendered
          // trapped behind the tab bar. At body level the z-index is absolute
          // again and the sheet covers the nav as intended.
          <div className="sm:hidden fixed inset-0 z-[60] flex flex-col justify-end h-[100dvh]">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            {/* Rounded bottom + bottom margin so the sheet visibly floats CLEAR
                of the fixed tab bar rather than tucking behind it, and 100dvh
                above so it measures the visible viewport, not the layout one. */}
            <div className="relative bg-white rounded-3xl mx-2 flex flex-col shadow-2xl overflow-hidden
                            min-h-[45dvh] max-h-[75dvh]"
              style={{ marginBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
              {/* drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 bg-gray-200 rounded-full" />
              </div>
              <NotifPanel {...panelProps} />
            </div>
          </div>,
          document.body
        )
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
