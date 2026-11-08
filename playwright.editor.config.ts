import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: 'editor*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  outputDir: 'test-results-editor',
  use: { baseURL: 'https://127.0.0.1:8788', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'editor-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'editor-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run editor:preview',
    url: 'https://127.0.0.1:8788',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: [['list']],
});
