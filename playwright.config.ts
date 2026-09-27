import { defineConfig, devices } from '@playwright/test'

/**
 * E2E gegen den lokalen Dev-Server (`npm run dev`). Läuft er schon, wird er wiederverwendet.
 * Start: `npx playwright test`
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    acceptDownloads: true,
    // Deutsch als Standard; der i18n-Test setzt Englisch explizit.
    locale: 'de-CH',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/v1/health',
    reuseExistingServer: true,
    timeout: 180_000
  }
})
