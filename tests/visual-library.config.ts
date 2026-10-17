import { defineConfig } from '@playwright/test';
import base from '../playwright.config.ts';

// Reuse installed browsers/profiles without starting the platform or opening SQLite.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'visual-library.spec.ts',
  webServer: undefined,
  outputDir: '../.local/micro029-browser',
  projects: base.projects!.map(p => p.name === 'chromium-360'
    ? { ...p, use: { ...p.use, viewport: { width: 360, height: 640 } } } : p)
});
