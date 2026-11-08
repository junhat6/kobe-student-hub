import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: [
    'session-generation-browser.spec.ts',
    'session-registration-browser.spec.ts',
    'session-registration-independent-browser.spec.ts',
    'ordinary-drafts-browser.spec.ts',
    'ordinary-draft-deletion-browser.spec.ts',
    'ordinary-publication-browser.spec.ts',
    'ordinary-projects-browser.spec.ts',
    'ordinary-media-browser.spec.ts',
  ],
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  outputDir: 'test-results-generation',
  use: { baseURL: 'https://127.0.0.1:8790', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'account-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'account-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/session-browser-preview.mjs',
    url: 'https://127.0.0.1:8790/__control/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: [['list']],
});
