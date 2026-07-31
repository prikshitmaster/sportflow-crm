import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId:   'com.khelit.app',
  appName: 'Khelit',
  webDir:  'dist',
  server: {
    // Load live Vercel URL so updates deploy instantly without rebuilding APK
    url:             'https://clubcrm-rosy.vercel.app',
    cleartext:       false,
    androidScheme:   'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor:   '#F8FAFC',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration:   2000,
      launchAutoHide:       true,
      backgroundColor:      '#2563eb',
      androidSplashResourceName: 'splash',
      showSpinner:          false,
    },
  },
}

export default config
