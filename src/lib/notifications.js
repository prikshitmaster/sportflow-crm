import { supabase } from './supabase'

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function fetchNotifications(recipientType, recipientId, limit = 40) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_type', recipientType)
    .eq('recipient_id', String(recipientId))
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function markAllRead(recipientType, recipientId) {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('recipient_type', recipientType)
    .eq('recipient_id', String(recipientId))
    .eq('read', false)
}

export async function markRead(id) {
  await supabase.from('notifications').update({ read: true }).eq('id', id)
}

export async function deleteNotification(id) {
  await supabase.from('notifications').delete().eq('id', id)
}

export async function insertNotification({ academyId, recipientType, recipientId, title, body, type = 'info', link = null }) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({ academy_id: academyId, recipient_type: recipientType, recipient_id: String(recipientId), title, body, type, link })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Realtime ──────────────────────────────────────────────────────────────────

export function subscribeToNotifications(recipientType, recipientId, onNew) {
  return supabase
    .channel(`notif:${recipientType}:${recipientId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_id=eq.${String(recipientId)}`,
    }, payload => {
      // double-check type in case of id collision across user types
      if (payload.new.recipient_type === recipientType) onNew(payload.new)
    })
    .subscribe()
}

// ── Web Push ──────────────────────────────────────────────────────────────────

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC
}

export async function subscribeToPush() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  })
}

export async function savePushSubscription({ userType, userId, academyId, subscription }) {
  const json = subscription.toJSON()
  await supabase.from('push_subscriptions').upsert({
    user_type:  userType,
    user_id:    String(userId),
    academy_id: academyId,
    endpoint:   json.endpoint,
    p256dh:     json.keys.p256dh,
    auth:       json.keys.auth,
  }, { onConflict: 'endpoint' })
}

export async function sendPushToUser({ recipientType, recipientId, academyId, title, body, link }) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_type', recipientType)
    .eq('user_id', String(recipientId))
    .eq('academy_id', academyId)

  if (!subs?.length) return

  await Promise.allSettled(subs.map(async sub => {
    const res = await supabase.functions.invoke('send-push', {
      body: {
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        title, body, link,
      },
    })
    // 410 = expired subscription — clean it up
    if (res.error?.context?.status === 410) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }))
}

// ── Convenience: insert + push in one call ────────────────────────────────────

export async function notify({ academyId, recipientType, recipientId, title, body, type = 'info', link = null }) {
  await Promise.allSettled([
    insertNotification({ academyId, recipientType, recipientId, title, body, type, link }),
    sendPushToUser({ recipientType, recipientId, academyId, title, body, link }),
  ])
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
