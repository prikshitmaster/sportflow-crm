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

// Auto-reload when a Vite lazy chunk fails to load after a new deploy
window.addEventListener('vite:preloadError', () => window.location.reload())

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
