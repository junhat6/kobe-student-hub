import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'retired-trial-browser.spec.ts',
  workers: 1,
  outputDir: 'test-results-retired-trial',
  use: { baseURL: 'https://127.0.0.1:8792', ignoreHTTPSErrors: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && node scripts/retired-trial-preview.mjs',
    url: 'https://127.0.0.1:8792/api/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
  reporter: [['list']],
});
