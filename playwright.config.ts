import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  workers: process.env.CI ? 2 : 4,
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: true,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
  webServer: { command: 'node tests/host/server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
