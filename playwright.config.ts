import { defineConfig, devices } from '@playwright/test';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '.local/playwright';
const testPort=Number(process.env.YAPLIX_PLAY_PORT??3210);
if(!Number.isSafeInteger(testPort)||testPort<1024||testPort>65535)throw Error('INVALID_TEST_PORT');
export default defineConfig({
  testDir: './tests', testMatch: ['arena.spec.ts','runtime.spec.ts', 'mvp.spec.ts', 'mobile.spec.ts', 'phone.spec.ts', 'production.spec.ts', 'generation.spec.ts', 'telegram.spec.ts','jobs.spec.ts','arcades.spec.ts','orchestrator.spec.ts','micro027.spec.ts','canvas-contract.spec.ts','strict-canvas.spec.ts','strict-offline.spec.ts','strict-providers.spec.ts'], outputDir: '.local/playwright-results',
  fullyParallel: false, workers: 1, reporter: 'list', timeout: 20_000,
  use: { baseURL: 'http://127.0.0.1:'+testPort, trace: 'retain-on-failure' },
  webServer: { command: 'node tests/browser-server.ts', url: 'http://127.0.0.1:'+testPort+'/api/health', reuseExistingServer: false },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
    { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1366, height: 768 } } },
    { name: 'chromium-320', use: { ...devices['Pixel 5'], viewport: { width: 320, height: 568 } } },
    { name: 'chromium-390', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'chromium-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
    { name: 'chromium-430', use: { ...devices['Pixel 5'], viewport: { width: 430, height: 932 } } },
    { name: 'chromium-tablet', use: { ...devices['Pixel 5'], viewport: { width: 768, height: 1024 } } },
    { name: 'webkit-320', use: { ...devices['iPhone 13'], viewport: { width: 320, height: 568 } } },
    { name: 'webkit-390', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit-360', use: { ...devices['iPhone 13'], viewport: { width: 360, height: 800 } } },
    { name: 'webkit-430', use: { ...devices['iPhone 13'], viewport: { width: 430, height: 932 } } },
    { name: 'webkit-tablet', use: { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } } }
  ]
});
