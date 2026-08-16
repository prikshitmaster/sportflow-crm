import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bell, X, CheckCheck, Trash2, BellOff, BellRing,
         CreditCard, CalendarDays, Zap, Megaphone, Info, TrendingUp } from 'lucide-react'
import {
  fetchNotifications, markAllRead, markRead, deleteNotification,
  subscribeToNotifications, pushSupported, subscribeToPush, savePushSubscription, purgeOldRead,
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
  enablePush, onMarkAll, onMarkOne, onClearRead, onClose }) {
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
                      {/* Confirming a staff notice ("Got it") happens on the
                          Notices page itself, not here — the bell is just a
                          list. See StaffNotices.jsx for the confirm button. */}
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
  const ref      = useRef(null)   // the bell + its desktop dropdown
  const sheetRef = useRef(null)   // the mobile sheet, which lives in a portal
  const lastSync = useRef(0)
  const purged   = useRef(false)

  const unread = notifs.filter(n => !n.read).length

  const load = useCallback(async () => {
    if (!recipientId) return
    // Sweep read-and-stale rows first so the fetch below returns the trimmed
    // list. Best-effort: a failed purge must never stop notifications loading.
    // Once per mount only — load() now also runs on every panel open and on
    // window focus, and firing a DELETE each time buys nothing.
    if (!purged.current) {
      purged.current = true
      try { await purgeOldRead(recipientType, recipientId, 7) } catch {}
    }
    try { setNotifs(await fetchNotifications(recipientType, recipientId)) } catch {}
  }, [recipientType, recipientId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!recipientId) return
    const ch = subscribeToNotifications(
      recipientType, recipientId,
      n => setNotifs(p => [n, ...p]),
      // Keeps the badge in sync when a notice is marked read/actioned from
      // somewhere other than this dropdown (e.g. StaffNotices' "Got it").
      n => setNotifs(p => p.map(x => x.id === n.id ? n : x)),
    )
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

  // Close on outside click.
  //
  // This used to test `ref.current.contains(e.target)` alone. `ref` wraps the
  // BELL, and on mobile the sheet is portalled to <body> — so it is never
  // inside `ref`, and every tap landing in the sheet counted as "outside".
  // Pointer-down closed the panel, React unmounted the portal, and the click
  // that would have run "Mark read" (or marked a row) never reached a mounted
  // element. The sheet just vanished and nothing was marked, which is exactly
  // what "mark as read doesn't work on mobile" looked like. Desktop was fine
  // because its dropdown IS inside `ref`.
  //
  // `sheetRef` covers the portalled panel so taps inside it are treated as
  // inside. Backdrop taps still close, because the backdrop is a sibling of
  // the sheet, not a child. `pointerdown` rather than `mousedown` so touch,
  // pen and mouse all behave the same.
  useEffect(() => {
    if (!open) return
    const h = e => {
      const t = e.target
      if (ref.current?.contains(t)) return
      if (sheetRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [open])

  // Opening the panel used to mark everything read at once, so unread styling
  // was never actually visible — the list was always fully read by the time you
  // could look at it, and anything you hadn't got to was silently cleared.
  // Now rows stay unread until you tap one (or use "All read"), which is what
  // every mail/chat client does.
  //
  // Opening also resyncs, because the realtime subscription below only ever
  // delivers to the OWNER. Staff and students reach this table as `anon` with
  // an x-staff-token / x-student-token request header, and a websocket can't
  // carry those — so current_staff_academy() is NULL inside realtime, the RLS
  // check drops every row, and neither onNew nor onUpdate ever fires for them.
  // Without this the badge was frozen at whatever it read on mount: a notice
  // confirmed on the Notices page still showed as unread on the bell.
  const handleOpen = () => {
    // Side effect kept OUT of the setState updater — React may call an updater
    // twice (StrictMode), which would fire two fetches per tap.
    if (!open) { lastSync.current = Date.now(); load() }
    setOpen(o => !o)
  }

  // Same gap, from the other direction: coming back to the tab (or resuming the
  // app on mobile) resyncs, throttled to a minute. Mirrors the polling-on-focus
  // refresh AppContext already does for CRM data.
  useEffect(() => {
    if (!recipientId) return
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastSync.current < 60_000) return
      lastSync.current = Date.now()
      load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [recipientId, load])

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
  // Reverts touch ONLY the rows this action changed, keyed by id. Snapshotting
  // the whole array and restoring it wholesale also threw away anything that
  // arrived while the write was in flight — on a slow phone that silently ate
  // freshly-pushed notifications.
  const onMarkAll = async () => {
    const ids = notifs.filter(n => !n.read).map(n => n.id)
    if (!ids.length) return
    const touched = new Set(ids)
    setNotifs(p => p.map(n => touched.has(n.id) ? { ...n, read: true } : n))
    try {
      const updated = await markAllRead(recipientType, recipientId)
      // No error but nothing updated: either RLS refused, or another device got
      // there first. Don't guess which — refetch and let the server say.
      if (!updated.length) await load()
    } catch (err) {
      setNotifs(p => p.map(n => touched.has(n.id) ? { ...n, read: false } : n))
      showToast?.(err.message || 'Could not mark notifications as read', 'error')
    }
  }

  const onMarkOne = async (e, notif) => {
    e.stopPropagation()
    if (notif.read) return
    setNotifs(p => p.map(n => n.id === notif.id ? { ...n, read: true } : n))
    try {
      await markRead(notif.id)
    } catch (err) {
      setNotifs(p => p.map(n => n.id === notif.id ? { ...n, read: false } : n))
      showToast?.(err.message || 'Could not mark as read', 'error')
    }
  }

  // Bulk clear of everything already read — replaces the per-row bin. Unread is
  // deliberately untouched: you should never lose something you have not seen.
  const onClearRead = async () => {
    const rows = notifs.filter(n => n.read)
    if (!rows.length) return
    setNotifs(p => p.filter(n => !n.read))
    const results = await Promise.allSettled(rows.map(n => deleteNotification(n.id)))
    const failed  = rows.filter((_, i) => results[i].status === 'rejected')
    if (failed.length) {
      // Put back only what genuinely survived on the server, still newest-first,
      // instead of leaving the list claiming a delete that never happened.
      const back = new Map(failed.map(n => [n.id, n]))
      setNotifs(p => [...p.filter(n => !back.has(n.id)), ...failed]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
      showToast?.(`Could not clear ${failed.length} notification${failed.length > 1 ? 's' : ''}`, 'error')
    }
  }
  const onClose    = () => setOpen(false)

  const panelProps = { notifs, unread, recipientType, recipientId, pushEnabled, pushLoading, enablePush, onMarkAll, onMarkOne, onClearRead, onClose }

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
            <div ref={sheetRef}
              className="relative bg-white rounded-3xl mx-2 flex flex-col shadow-2xl overflow-hidden
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
