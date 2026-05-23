// Tiny logger — single seam for crash + telemetry tooling.
//
// Forwards to console always, plus Sentry for warn/error in production
// (no-ops if VITE_SENTRY_DSN is unset).
//
// Rules:
//   - Never throw. Logging a problem must never create a new problem.
//   - Treat the `context` arg as a free-form dict for breadcrumbs (where,
//     why, who). Sentry-style.
//   - Stringify Errors with stack; pass everything else through.

import { captureException, captureMessage } from './sentry'

const isProd = import.meta.env.MODE === 'production'

function normalise(err) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  if (err && typeof err === 'object') return err
  return { value: err }
}

export const logger = {
  debug(msg, context) {
    if (isProd) return
    try { console.debug('[debug]', msg, context || '') } catch {}
  },
  info(msg, context) {
    try { console.info('[info]', msg, context || '') } catch {}
  },
  warn(msg, context) {
    try {
      console.warn('[warn]', msg, context || '')
      captureMessage(msg, { level: 'warning', extra: context })
    } catch {}
  },
  error(msg, err, context) {
    try {
      console.error('[error]', msg, normalise(err), context || '')
      // If we have an Error instance, capture as exception (gets stack trace).
      // Otherwise capture the message with the value attached.
      if (err instanceof Error) {
        captureException(err, { extra: { msg, ...(context || {}) } })
      } else {
        captureMessage(msg, { level: 'error', extra: { err, ...(context || {}) } })
      }
    } catch {}
  },
}

// Convenience for fire-and-forget background work where we want to log
// but never crash the caller (e.g. audit log writes).
export function safe(fn, context) {
  return Promise.resolve().then(fn).catch(err => logger.error('safe() caught', err, context))
}
