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
  testIgnore: '**/staging/**',
  // Las pruebas locales comparten usuarios y fixtures mutables de Supabase.
  // Ejecutarlas en serie evita que un flujo invalide la sesión o los datos de otro.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1',
    env: webServerEnvironment,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
