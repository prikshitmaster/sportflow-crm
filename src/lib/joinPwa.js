// PWA wiring for the public /join registration funnel.
//
// WHY THIS FILE EXISTS
// One origin serves two products: the owner CRM at "/" and the parent-facing
// registration funnel at "/join". vite-plugin-pwa generates exactly one
// manifest, and it describes the CRM — name "Khelit", start_url "/", scope "/"
// (see vite.config.js). A parent who installed from /join therefore got an app
// called "Khelit" that opened the OWNER LOGIN SCREEN. The funnel needs its own
// identity, so useJoinManifest() repoints the document at
// public/join.webmanifest for as long as a /join route is mounted.
//
// A browser honours only the FIRST <link rel="manifest"> in the document, so
// this mutates the existing element's href rather than appending a second one,
// and restores the original on unmount — the owner app and the funnel share a
// single SPA session, and navigating between them must not leave the wrong
// manifest installed.
//
// The service worker needs no change: src/sw.js already routes every
// navigation to index.html, so /join works offline once cached.

import { useEffect, useState, useCallback } from 'react'

const JOIN_MANIFEST = '/join.webmanifest'
const JOIN_ICON     = '/apple-touch-icon.png'
const JOIN_TITLE    = 'Ahmedabad Racquet Academy'
const JOIN_THEME    = '#152449'

/** Swap one <meta name=X content> / <link rel=X href>, returning an undo fn. */
function swapAttr(selector, attr, value) {
  const el = document.querySelector(selector)
  if (!el) return () => {}
  const previous = el.getAttribute(attr)
  el.setAttribute(attr, value)
  return () => {
    if (previous === null) el.removeAttribute(attr)
    else el.setAttribute(attr, previous)
  }
}

/**
 * Points the document at the registration funnel's own manifest, icon, title
 * and theme colour while mounted. Call once, high in the /join tree.
 */
export function useJoinManifest() {
  useEffect(() => {
    const undo = [
      swapAttr('link[rel="manifest"]', 'href', JOIN_MANIFEST),
      // Safari ignores manifest icons entirely and reads apple-touch-icon, and
      // it cannot render the SVG index.html points at — without a real PNG the
      // iOS home-screen icon falls back to a blurred page screenshot.
      swapAttr('link[rel="apple-touch-icon"]', 'href', JOIN_ICON),
      swapAttr('meta[name="apple-mobile-web-app-title"]', 'content', JOIN_TITLE),
      swapAttr('meta[name="theme-color"]', 'content', JOIN_THEME),
    ]
    return () => undo.forEach(fn => fn())
  }, [])
}

const isIOSDevice = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports itself as a Mac, and is only tellable apart by the
  // presence of a touch screen.
  return /iphone|ipad|ipod/i.test(ua) ||
         (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

const isStandalone = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
         window.navigator.standalone === true
}

/**
 * Install affordance state.
 *
 * `canInstall` is true only on browsers that fire beforeinstallprompt (Chrome,
 * Edge, Samsung Internet on Android). Safari fires nothing and exposes no API,
 * so `isIOS` callers must show manual "Share → Add to Home Screen" steps
 * instead — that is not a fallback for a missing feature, it is the only route
 * iOS offers.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e) => {
      // Chrome shows its own mini-infobar unless the event is cancelled. It is
      // easy to miss, which is the whole reason for an in-app row instead.
      e.preventDefault()
      setDeferred(e)
    }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return null
    deferred.prompt()
    const choice = await deferred.userChoice.catch(() => null)
    // A dismissed prompt cannot be re-shown with the same event; Chrome fires a
    // fresh beforeinstallprompt on a later visit if the user is still eligible.
    setDeferred(null)
    return choice?.outcome ?? null
  }, [deferred])

  return {
    canInstall: Boolean(deferred) && !installed,
    promptInstall,
    isIOS: isIOSDevice(),
    isInstalled: installed,
  }
}
