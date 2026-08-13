// Sentry init — no-ops if VITE_SENTRY_DSN is not set, so local/dev work
// without the env var. Production should set VITE_SENTRY_DSN in Vercel.
//
// @sentry/react is loaded with a DYNAMIC import, not a static one. Statically
// it lands in the eager entry chunk, so every visitor — including a parent
// opening /join on mobile data, who will never benefit from it — downloads
// the SDK plus its tracing and replay integrations before the page can paint.
// Loaded this way it costs nothing until the browser is idle.
//
// The trade-off: errors thrown in the first moment after load happen before
// the SDK exists. They're queued below and sent once it arrives, so nothing
// is lost — but the page-load performance transaction is (tracesSampleRate is
// 0.1, so that was a tenth of loads anyway).

let Sentry = null
let initialized = false
let starting = null
const pending = []          // captures raised before the SDK finished loading
let pendingUser = undefined // undefined = nothing to apply, null = explicit logout

function flushPending() {
  if (pendingUser !== undefined) {
    const user = pendingUser
    pendingUser = undefined
    try { setSentryUser(user) } catch { /* never let reporting break the app */ }
  }
  while (pending.length) {
    const [kind, args] = pending.shift()
    try { Sentry[kind](...args) } catch { /* never let reporting break the app */ }
  }
}

export function initSentry() {
  if (initialized || starting) return starting
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    // Diagnostic — visible in browser console on the deployed app so we can
    // tell at a glance whether the env var made it through the build.
    if (typeof window !== 'undefined') {
      console.warn('[sentry] VITE_SENTRY_DSN missing — error capture disabled')
      window.__sentry = { ready: false, reason: 'no DSN' }
    }
    return
  }

  starting = (async () => {
    Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Sample rates — keep low to avoid burning the 5K/mo free quota
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
      ],
      // Don't send noisy errors from extensions / network drops
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        'NetworkError when attempting to fetch resource',
        'Failed to fetch',
      ],
      beforeSend(event, hint) {
        // Drop noise from non-app sources (extensions injecting scripts)
        const stack = event.exception?.values?.[0]?.stacktrace?.frames || []
        if (stack.some(f => /chrome-extension|moz-extension/.test(f.filename || ''))) return null
        return event
      },
    })
    initialized = true
    flushPending()
    if (typeof window !== 'undefined') {
      console.info('[sentry] initialized', { env: import.meta.env.MODE })
      window.__sentry = { ready: true, env: import.meta.env.MODE }
    }
  })().catch(err => {
    starting = null
    pending.length = 0   // nothing will ever send these; don't leak them
    if (typeof window !== 'undefined') {
      console.error('[sentry] init failed', err)
      window.__sentry = { ready: false, reason: err?.message || 'init threw' }
    }
  })
  return starting
}

// Identify the current user so errors are tied to who hit them.
// Call after login; pass null on logout.
//
// Remembered rather than dropped when the SDK isn't up yet: a restored
// session identifies its user within milliseconds of boot, long before the
// idle init fires, and losing that would leave every early error anonymous.
export function setSentryUser(user) {
  if (!initialized) { pendingUser = user; return }
  if (!user) { Sentry.setUser(null); return }
  Sentry.setUser({
    id:       String(user.id ?? ''),
    email:    user.email || undefined,
    username: user.name || undefined,
    role:     user.role,
    academy:  user.academyId,
    branch:   user.branchId,
  })
}

// Re-exports so other files can capture without importing @sentry/react
// directly. Anything raised before the SDK lands is queued rather than dropped
// — early errors are exactly the ones worth seeing.
// Queue whenever a DSN exists and the SDK isn't live yet — that covers both
// "still downloading" and "idle callback hasn't fired yet", which is exactly
// the window a crash on first paint lands in.
const queueable = () => !!import.meta.env.VITE_SENTRY_DSN && pending.length < 20

export const captureException = (...args) => {
  if (initialized) return Sentry.captureException(...args)
  if (queueable()) pending.push(['captureException', args])
}
export const captureMessage = (...args) => {
  if (initialized) return Sentry.captureMessage(...args)
  if (queueable()) pending.push(['captureMessage', args])
}
