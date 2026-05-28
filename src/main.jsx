import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
