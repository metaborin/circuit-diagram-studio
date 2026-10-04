import { defineConfig } from '@playwright/test'

const publicUrl = process.env.PLAYWRIGHT_BASE_URL
const port = process.env.PLAYWRIGHT_PORT || '5173'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: publicUrl || `http://127.0.0.1:${port}/circuit-diagram-studio/`,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1600, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: publicUrl ? undefined : {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/circuit-diagram-studio/`,
    reuseExistingServer: false,
  },
})
