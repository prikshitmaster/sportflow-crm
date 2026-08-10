// ─────────────────────────────────────────────────────────────────────────────
// main.jsx — THE ENTRY POINT of the whole app.
//
// index.html has one empty <div id="root">. This file tells React:
// "render the <App/> component inside that div". Everything else (routes,
// pages, state) hangs off <App/>. This file also wires up a few global,
// app-wide behaviours that must exist before any page renders.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'                    // Tailwind + shared classes (btn-primary, card…)
import { initSentry } from './lib/sentry'

// Initialize crash + error reporting before anything else runs.
// No-ops if VITE_SENTRY_DSN is not configured.
initSentry()

// Shared budget for every auto-reload path below. A `let reloading` flag (the
// old guard here) resets to false on every fresh page load — so if WHATEVER
// is triggering the reload (a flaky network, a proxy/AV rewriting responses,
// a stuck service worker) is still true on the reloaded page, the very next
// load re-arms the same trigger and fires again immediately: a page that
// reloads every 1-2 seconds forever, on exactly one machine, is this bug.
// sessionStorage survives the reload (cleared only when the tab closes), so
// the count is real across reloads, not per-load. Same cap/pattern as the
// ErrorBoundary's `_eb_reloads` in App.jsx, which already got this right for
// render-time chunk errors — this covers the two paths that weren't.
const AUTO_RELOAD_KEY = 'sf_auto_reload_count'
const AUTO_RELOAD_MAX = 2
function tryAutoReload(nukeCaches) {
  const n = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0)
  if (n >= AUTO_RELOAD_MAX) return // give up — stay on the page rather than loop forever
  sessionStorage.setItem(AUTO_RELOAD_KEY, String(n + 1))
  if (!nukeCaches) { window.location.reload(); return }
  const nukes = []
  try {
    if ('caches' in window) nukes.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
    if ('serviceWorker' in navigator) nukes.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))))
  } catch {}
  Promise.all(nukes).finally(() => window.location.reload())
}

// A Vite lazy chunk failed to load — almost always a stale cached index.html
// still pointing at a previous deploy's now-deleted chunk hashes. Nuke the
// SW + caches (not just reload) so the next load fetches the real, current
// index.html instead of repeating the same 404 against the same stale cache.
window.addEventListener('vite:preloadError', () => tryAutoReload(true))

// Apply a new deploy on the FIRST launch instead of the second.
// The service worker (registerType: 'autoUpdate' + skipWaiting/clients.claim)
// installs and takes control in the background, but the page already running
// keeps executing the OLD bundle — so a fresh deploy only appeared after
// quitting and reopening a second time, which reliably read as "the change
// didn't ship". Reloading once when control changes collapses that to one.
// No cache nuke here — a controllerchange means a SW update just legitimately
// succeeded; wiping it immediately after would fight the very update this
// exists to apply.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => tryAutoReload(false))
}

// Block long-press context menu on Android Chrome (links, images, etc.)
document.addEventListener('contextmenu', e => e.preventDefault())

// Reload if app resumes from background with a blank screen (Android kills WebView tab)
let _hiddenAt = 0
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _hiddenAt = Date.now()
  } else if (document.visibilityState === 'visible' && Date.now() - _hiddenAt > 20_000) {
    setTimeout(() => {
      const root = document.getElementById('root')
      if (root && root.children.length === 0) window.location.reload()
    }, 800)
  }
})

// StrictMode is a dev-only safety net: it double-invokes effects to surface
// bugs (e.g. missing useEffect cleanups). It renders nothing in production.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
