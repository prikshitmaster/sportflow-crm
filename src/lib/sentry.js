// Sentry init — no-ops if VITE_SENTRY_DSN is not set, so local/dev work
// without the env var. Production should set VITE_SENTRY_DSN in Vercel.

import * as Sentry from '@sentry/react'

let initialized = false

export function initSentry() {
  if (initialized) return
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

  try {
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
    if (typeof window !== 'undefined') {
      console.info('[sentry] initialized', { env: import.meta.env.MODE })
      window.__sentry = { ready: true, env: import.meta.env.MODE }
    }
  } catch (err) {
    if (typeof window !== 'undefined') {
      console.error('[sentry] init failed', err)
      window.__sentry = { ready: false, reason: err?.message || 'init threw' }
    }
  }
}

// Identify the current user so errors are tied to who hit them.
// Call after login; pass null on logout.
export function setSentryUser(user) {
  if (!initialized) return
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

// Re-exports so other files can capture without importing @sentry/react directly
export const captureException = (...args) => initialized && Sentry.captureException(...args)
export const captureMessage   = (...args) => initialized && Sentry.captureMessage(...args)
