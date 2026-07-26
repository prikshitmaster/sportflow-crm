import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

// ── Firebase Cloud Messaging (native Android delivery channel) ────────────────
// Web/PWA keeps using VAPID web-push (see notifications.js); FCM only covers
// the native Android WebView wrapper, where web-push doesn't survive the app
// being backgrounded/killed.

export function fcmSupported() {
  return Capacitor.getPlatform() === 'android'
}

// Without our own channel, FCM drops notifications onto its generic
// "Miscellaneous" fallback channel at IMPORTANCE_DEFAULT — which only files
// them into the shade: no heads-up banner, no vibration. Users read that as
// "push isn't working". MAX importance is what produces the pop-up.
// send-fcm names this id in android.notification.channel_id.
// Versioned: Android freezes a channel's importance/sound once created, so
// changing them means publishing a new id. v1 ('sportflow_default') set
// sound:'default', which Capacitor resolves to res/raw/default — a resource
// this app doesn't ship, leaving the channel silent. Omitting sound entirely
// gets the system default notification tone.
export const FCM_CHANNEL_ID = 'sportflow_alerts_v2'
const LEGACY_CHANNEL_IDS = ['sportflow_default']

let registrationPromise = null

export function initFcm({ onNotificationTap, onForegroundMessage } = {}) {
  if (!fcmSupported()) return Promise.resolve(null)
  if (registrationPromise) return registrationPromise

  registrationPromise = (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Idempotent — re-creating with the same id is a no-op. Must exist before
    // the first message arrives, or Android falls back to the silent channel.
    // Note: importance/sound of an EXISTING channel can't be raised by the app;
    // Android locks user-visible settings once created.
    try {
      await PushNotifications.createChannel({
        id:          FCM_CHANNEL_ID,
        name:        'Academy updates',
        description: 'Announcements, notices and reminders',
        importance:  5,     // MAX → heads-up banner
        visibility:  1,     // public on lockscreen
        vibration:   true,
        lights:      true,
        // No `sound` on purpose — Capacitor maps it to res/raw/<name>, and a
        // missing file yields a silent channel. Omitting it = system default.
      })
      // Tidy up superseded versions so users don't see stale duplicates in
      // Android's notification settings.
      for (const id of LEGACY_CHANNEL_IDS) {
        await PushNotifications.deleteChannel({ id }).catch(() => {})
      }
    } catch { /* older Android / already exists */ }

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return null

    const token = await new Promise(resolve => {
      PushNotifications.addListener('registration', t => resolve(t.value))
      PushNotifications.addListener('registrationError', () => resolve(null))
      PushNotifications.register()
    })

    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const link = action.notification?.data?.link
      onNotificationTap?.(link)
      if (link) window.location.assign(link)
    })

    // Android does NOT draw a tray notification while the app is in the
    // foreground — it hands the message to us instead. Without this the arrival
    // is invisible and it reads as "push isn't working". The bell list is still
    // driven by the Realtime subscription; this is purely the visible cue.
    PushNotifications.addListener('pushNotificationReceived', n => {
      onForegroundMessage?.({
        title: n?.title || 'New notification',
        body:  n?.body  || '',
        link:  n?.data?.link || null,
      })
    })

    return token
  })()

  return registrationPromise
}

// Drop this device's registration on logout. Without this the row keeps
// pointing at the user who just signed out, so a shared/handed-over phone goes
// on receiving their notifications until someone else happens to log in on it.
//
// MUST run while the session is still valid — the anon delete policy resolves
// the academy from the x-staff/x-student token header, so calling this after
// the session is torn down silently does nothing.
export async function unregisterFcm({ userType, userId } = {}) {
  if (!fcmSupported()) return
  try {
    const token = registrationPromise ? await registrationPromise : null
    if (token) {
      await supabase.from('fcm_tokens').delete().eq('token', token)
    } else if (userType && userId) {
      // We never held the token this session (e.g. reloaded before logging out).
      // Clear this user's rows so the handover case still stops their pushes.
      await supabase.from('fcm_tokens').delete()
        .eq('user_type', userType).eq('user_id', String(userId))
    }
  } catch { /* best effort — never block logout */ }
  registrationPromise = null
}

export async function saveFcmToken({ userType, userId, academyId, token }) {
  if (!token) return
  await supabase.from('fcm_tokens').upsert({
    user_type:  userType,
    user_id:    String(userId),
    academy_id: academyId,
    token,
    platform:   'android',
  }, { onConflict: 'token' })
}

export async function sendFcmToUser({ recipientType, recipientId, academyId, title, body, link }) {
  const { data: tokens } = await supabase
    .from('fcm_tokens')
    .select('token')
    .eq('user_type', recipientType)
    .eq('user_id', String(recipientId))
    .eq('academy_id', academyId)

  if (!tokens?.length) return

  await Promise.allSettled(tokens.map(async ({ token }) => {
    const res = await supabase.functions.invoke('send-fcm', { body: { token, title, body, link } })
    // unregistered/invalid token — clean it up
    if (res.error?.context?.status === 404 || res.data?.invalidToken) {
      await supabase.from('fcm_tokens').delete().eq('token', token)
    }
  }))
}
