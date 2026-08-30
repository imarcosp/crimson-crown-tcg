import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { defineConfig } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

const stagingEnvFile = resolve(process.cwd(), '.env.staging.test')
if (existsSync(stagingEnvFile)) loadEnv({ path: stagingEnvFile, override: false })

// Deliberately runs before Playwright receives any configuration. A missing or
// ambiguous target must fail closed without opening a browser.
const guard = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/staging/assert-crimson-staging.mjs')], {
  env: process.env,
  encoding: 'utf8',
  shell: false,
})
if (guard.status !== 0) throw new Error(guard.stderr.trim() || 'Crimson staging no autorizado.')
const staging = JSON.parse(guard.stdout) as { appOrigin: string }

export default defineConfig({
  testDir: './e2e/staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: staging.appOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
