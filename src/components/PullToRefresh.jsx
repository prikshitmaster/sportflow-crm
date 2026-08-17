import { useRef, useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { showUpdateOverlay } from '../lib/updateOverlay'

const THRESHOLD = 70

// Drop-in replacement for a layout's scrollable <main> — IS the scroll
// container (className/style pass straight through) rather than wrapping
// one, so there's no separate "find the nearest scrollable ancestor" step.
// Swipe down from the very top past THRESHOLD to reload: picks up whatever
// deploy/service-worker update is pending (main.jsx's own auto-reload paths
// already show the same overlay) plus a full data refetch on remount,
// without the app having to be force-closed and relaunched to see either.
//
// touchmove is a REAL (non-passive) listener, not a JSX prop — React's
// synthetic touch handlers are passive by default, which silently makes
// preventDefault() a no-op there and lets the page rubber-band under the
// pull gesture instead of the custom indicator taking over.
export default function PullToRefresh({ className, style, children }) {
  const scrollRef = useRef(null)
  const startY = useRef(0)
  const draggingRef = useRef(false)
  const pullYRef = useRef(0)
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const setPull = (v) => { pullYRef.current = v; setPullY(v) }

    const onStart = (e) => {
      if (refreshing || el.scrollTop > 0) { draggingRef.current = false; return }
      startY.current = e.touches[0].clientY
      draggingRef.current = true
    }
    const onMove = (e) => {
      if (!draggingRef.current || refreshing) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0 || el.scrollTop > 0) {
        if (pullYRef.current !== 0) setPull(0)
        return
      }
      e.preventDefault()
      setPull(Math.min(dy * 0.5, THRESHOLD * 1.6))
    }
    const onEnd = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (pullYRef.current >= THRESHOLD) {
        setRefreshing(true)
        showUpdateOverlay('Loading latest…')
        window.location.reload()
      } else {
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [refreshing])

  return (
    <div ref={scrollRef} className={className} style={style}>
      <div style={{
        height: pullY, display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', transition: draggingRef.current ? 'none' : 'height 0.2s ease',
      }}>
        {pullY > 8 && (
          <RefreshCw size={18} color="#9CA3AF"
            style={{ transform: `rotate(${Math.min(pullY / THRESHOLD, 1) * 360}deg)` }} />
        )}
      </div>
      {children}
    </div>
  )
}
