import { defineConfig, devices } from '@playwright/test';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '.local/playwright';
export default defineConfig({
  testDir: './tests', testMatch: 'runtime.spec.ts', outputDir: '.local/playwright-results',
  fullyParallel: false, workers: 1, reporter: 'list', timeout: 20_000,
  use: { baseURL: 'http://127.0.0.1:3210', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/browser-server.ts', url: 'http://127.0.0.1:3210/api/health', reuseExistingServer: false },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'chromium-320', use: { ...devices['Pixel 5'], viewport: { width: 320, height: 568 } } },
    { name: 'chromium-390', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit-320', use: { ...devices['iPhone 13'], viewport: { width: 320, height: 568 } } },
    { name: 'webkit-390', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }
  ]
});
