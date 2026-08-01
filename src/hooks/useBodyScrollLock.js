import { useEffect } from 'react'

// Locks background scroll while a modal is mounted. Without this, the page
// behind a modal stays fully scrollable — scrolling inside the modal can
// also move/repaint the page behind it, which (combined with any backdrop
// blur/overlay) reads as visible lag/jank while scrolling a modal, especially
// on longer forms. No modal in this app locked scroll before this.
export default function useBodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
}
