import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

// ── Firebase Cloud Messaging (native Android delivery channel) ────────────────
// Web/PWA keeps using VAPID web-push (see notifications.js); FCM only covers
// the native Android WebView wrapper, where web-push doesn't survive the app
// being backgrounded/killed.

export function fcmSupported() {
  return Capacitor.getPlatform() === 'android'
}

let registrationPromise = null

export function initFcm({ onNotificationTap } = {}) {
  if (!fcmSupported()) return Promise.resolve(null)
  if (registrationPromise) return registrationPromise

  registrationPromise = (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications')

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

    return token
  })()

  return registrationPromise
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
