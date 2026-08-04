import type { CapacitorConfig } from '@capacitor/cli'

// *** PLACEHOLDER — confirm appId/appName/colors before a real release build.
// appId is provisional; once set and published to the Play Store it should
// never change (it's the permanent package identity for that listing).
const config: CapacitorConfig = {
  appId:   'com.khelit.enroll',
  appName: 'Ahmedabad Racquet Academy',
  webDir:  'www',
  server: {
    // Same live Vercel deployment as the main app (com.khelit.app) — just a
    // different route. No second deployment needed; vercel.json's catch-all
    // SPA rewrite already serves /join correctly on first load and refresh.
    url:             'https://clubcrm-rosy.vercel.app/join',
    cleartext:       false,
    androidScheme:   'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor:   '#1B4332', // placeholder green — swap for the real logo hex
  },
  plugins: {
    SplashScreen: {
      launchShowDuration:   2000,
      launchAutoHide:       true,
      backgroundColor:      '#1B4332', // placeholder green — swap for the real logo hex
      androidSplashResourceName: 'splash',
      showSpinner:          false,
    },
  },
}

export default config
