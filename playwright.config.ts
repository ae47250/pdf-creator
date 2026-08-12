import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localBrowser = [edge, macChrome].find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3202',
    trace: 'retain-on-failure',
    launchOptions: localBrowser ? { executablePath: localBrowser } : undefined
  },
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run dev -- -p 3202' : 'npm run dev -- -p 3202',
    url: 'http://127.0.0.1:3202/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PDF_CREATION_TEST: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    }
  }
});
