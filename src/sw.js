import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Push: show notification
self.addEventListener('push', event => {
  if (!event.data) return
  const { title, body, link, icon } = event.data.json()
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:     icon || '/icon-192.svg',
      badge:    '/icon-192.svg',
      tag:      'sportflow',
      renotify: true,
      data:     { link: link || '/' },
    })
  )
})

// Tap notification → open / focus app at the right route
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const link = event.notification.data?.link || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(link); return client.focus() }
      }
      return clients.openWindow?.(link)
    })
  )
})
