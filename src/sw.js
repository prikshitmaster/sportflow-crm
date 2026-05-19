import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Take control of all clients immediately on install/activate
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// Handle SKIP_WAITING sent by vite-plugin-pwa autoUpdate
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// SPA fallback: all navigation requests → serve cached index.html
// Prevents blank screen when network is slow/offline on cold open
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

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
