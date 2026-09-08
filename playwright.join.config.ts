import { defineConfig, devices } from '@playwright/test'

// Dedicated config for the /join funnel spec.
//
// Deliberately does NOT use tests/global-setup.ts: that provisions a
// disposable QA academy against the real production database, which the
// funnel's own tests have no need for. /join browses anon-readable data
// (migration 0140), so this suite reads the existing academy and never
// writes. The spec also stops short of submitting a registration — a submit
// requires a phone OTP and would create a real trial lead in production.
export default defineConfig({
  testDir: './tests',
  testMatch: 'join-funnel.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL:    process.env.JOIN_BASE_URL || 'http://localhost:5173',
    headless:   true,
    screenshot: 'only-on-failure',
    trace:      'off',
  },
  projects: [
    // The funnel is a phone-first app shell; 412x892 is the design's own
    // artboard size (see android-frame.jsx hint-size).
    { name: 'pixel', use: { ...devices['Pixel 5'] } },
    // Narrowest phone still worth supporting — catches horizontal overflow
    // the 412 viewport hides.
    { name: 'small', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, isMobile: false } },
    // Above the shell's 440px max-width, so the centred-column path is exercised.
    { name: 'wide', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 90_000,
  },
})
