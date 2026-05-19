import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId:   'com.sportflow.crm',
  appName: 'SportFlow',
  webDir:  'dist',
  server: {
    // Load live Vercel URL so updates deploy instantly without rebuilding APK
    url:             'https://clubcrm-rosy.vercel.app',
    cleartext:       false,
    androidScheme:   'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor:   '#ffffff',
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
