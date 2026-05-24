// Fill Demo button — visible in:
//   1. Local dev (vite dev)
//   2. Any environment where ?demo=1 has been added to the URL once.
//      The flag is saved to localStorage so it persists across pages and
//      reloads until the user clears it with ?demo=0.
//
// Use this on the deployed app: visit any page with ?demo=1 once and the
// buttons will appear on every form from then on, even in production.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'sf_demo_mode'
const IS_DEV = import.meta.env.DEV

function readDemoFlag() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') {
      localStorage.setItem(STORAGE_KEY, '1')
      return true
    }
    if (params.get('demo') === '0') {
      localStorage.removeItem(STORAGE_KEY)
      return false
    }
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch { return false }
}

export default function DevFillButton({ onFill }) {
  const [enabled, setEnabled] = useState(() => IS_DEV || readDemoFlag())

  useEffect(() => {
    if (IS_DEV) return
    const handler = () => setEnabled(readDemoFlag())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  if (!enabled) return null
  return (
    <button
      type="button"
      onClick={onFill}
      className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 active:scale-95 transition select-none"
      title="Fill form with demo data (demo mode — disable with ?demo=0)"
    >
      Fill Demo
    </button>
  )
}
