// A visible "Updating…" overlay shown right before any auto-reload the app
// triggers on its own (new deploy picked up, stale chunk recovered, pull-to-
// refresh). Every one of those reload paths used to just call
// window.location.reload() with zero warning — from a coach or student's
// side that looks identical to the app freezing/crashing, and the reported
// reaction was to force-close and relaunch the whole app rather than wait
// out a reload that was already in progress.
//
// Plain DOM + inline styles, no React/Tailwind dependency: main.jsx's own
// reload paths (stale chunk after a deploy, blank screen after resume) can
// fire before or during a broken render, so this must work independent of
// React ever getting to paint again.

let shown = false

export function showUpdateOverlay(message = 'Updating…') {
  if (shown || typeof document === 'undefined') return
  shown = true

  const overlay = document.createElement('div')
  overlay.setAttribute('id', 'sf-update-overlay')
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(255,255,255,0.96);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `

  const spinner = document.createElement('div')
  spinner.style.cssText = `
    width: 34px; height: 34px; border-radius: 50%;
    border: 3px solid #E5E7EB; border-top-color: #2563EB;
    animation: sf-spin 0.8s linear infinite;
  `

  const label = document.createElement('div')
  label.textContent = message
  label.style.cssText = 'font-size: 14px; font-weight: 600; color: #374151;'

  if (!document.getElementById('sf-spin-kf')) {
    const style = document.createElement('style')
    style.id = 'sf-spin-kf'
    style.textContent = '@keyframes sf-spin { to { transform: rotate(360deg); } }'
    document.head.appendChild(style)
  }

  overlay.appendChild(spinner)
  overlay.appendChild(label)
  document.body.appendChild(overlay)
}
