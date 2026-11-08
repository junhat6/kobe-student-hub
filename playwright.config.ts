import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  testIgnore: [
    '**/editor*.spec.ts',
    '**/ordinary-drafts-browser.spec.ts',
    '**/ordinary-draft-deletion-browser.spec.ts',
    '**/session-generation-browser.spec.ts',
    '**/session-registration-browser.spec.ts',
    '**/session-registration-independent-browser.spec.ts',
    '**/pending-pilot-browser.spec.ts',
    '**/retired-trial-browser.spec.ts',
  ],
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:8787', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: !process.env.CI,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
