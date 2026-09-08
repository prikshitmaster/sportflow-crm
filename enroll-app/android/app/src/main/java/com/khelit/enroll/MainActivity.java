package com.khelit.enroll;

import com.getcapacitor.BridgeActivity;

// Capacitor 8's core SystemBars plugin already handles Android 15's mandatory
// edge-to-edge layout — it pads the WebView (or, on newer WebView builds with
// the page's viewport-fit=cover, defers to the WebView's own native
// env(safe-area-inset-*) support) and separately injects reliable
// --safe-area-inset-* CSS variables as a backstop for Chromium builds where
// env() itself doesn't populate correctly inside an embedded WebView
// (https://issues.chromium.org/issues/40699457). A hand-rolled
// OnApplyWindowInsetsListener here ran downstream of that plugin's own
// listener and only fought it — see the /join page's CSS, which now reads
// the injected --safe-area-inset-bottom variable as env()'s fallback instead.
public class MainActivity extends BridgeActivity {}
