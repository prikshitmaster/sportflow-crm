import { useState, useEffect, useCallback } from 'react'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 2 * 60 * 1000
const LOCK_MS    = 60 * 1000

export function useLoginThrottle(key) {
  const storageKey = `lf_${key}`

  function read() {
    try { return JSON.parse(localStorage.getItem(storageKey)) || null }
    catch { return null }
  }

  const [secondsLeft, setSecondsLeft] = useState(() => {
    const s = read()
    if (s?.lockedUntil && s.lockedUntil > Date.now())
      return Math.ceil((s.lockedUntil - Date.now()) / 1000)
    return 0
  })

  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setInterval(() => setSecondsLeft(n => (n <= 1 ? (clearInterval(t), 0) : n - 1)), 1000)
    return () => clearInterval(t)
  }, [secondsLeft])

  const recordFailure = useCallback(() => {
    const now = Date.now()
    const s   = read()
    const inWindow = s && (now - s.windowStart < WINDOW_MS)
    const count    = inWindow ? s.count + 1 : 1
    const windowStart = inWindow ? s.windowStart : now

    if (count >= MAX_ATTEMPTS) {
      localStorage.setItem(storageKey, JSON.stringify({ count, windowStart, lockedUntil: now + LOCK_MS }))
      setSecondsLeft(Math.ceil(LOCK_MS / 1000))
    } else {
      localStorage.setItem(storageKey, JSON.stringify({ count, windowStart, lockedUntil: null }))
    }
  }, [storageKey])

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey)
    setSecondsLeft(0)
  }, [storageKey])

  return { blocked: secondsLeft > 0, secondsLeft, recordFailure, reset }
}
