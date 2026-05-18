import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/example.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL:    'http://localhost:5173',
    headless:   false,
    slowMo:     250,
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
