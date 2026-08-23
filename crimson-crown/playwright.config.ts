import { defineConfig } from '@playwright/test'

import { loadSafeTestEnvironment } from './src/lib/environment/load-safe-test-environment'

const safeTestEnvironment = loadSafeTestEnvironment(process.cwd(), process.env)
Object.assign(process.env, safeTestEnvironment)

const baseURL = safeTestEnvironment.PLAYWRIGHT_BASE_URL as string
const webServerEnvironment = Object.fromEntries(
  Object.entries(safeTestEnvironment).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    env: webServerEnvironment,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
