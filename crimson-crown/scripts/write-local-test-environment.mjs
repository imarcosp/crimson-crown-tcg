import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { assertSafeTestEnvironment } from '../src/lib/environment/production-guards.ts'
import { loadSafeTestEnvironment } from '../src/lib/environment/load-safe-test-environment.ts'

export function buildLocalTestEnvironment(localStatus) {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: localStatus.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localStatus.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: localStatus.SERVICE_ROLE_KEY,
    PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3000',
  }

  assertSafeTestEnvironment(environment)

  return [
    `NEXT_PUBLIC_SUPABASE_URL=${environment.NEXT_PUBLIC_SUPABASE_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${environment.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${environment.SUPABASE_SERVICE_ROLE_KEY}`,
    `PLAYWRIGHT_BASE_URL=${environment.PLAYWRIGHT_BASE_URL}`,
    '',
  ].join('\n')
}

export function writeLocalTestEnvironmentFile(rootDirectory, localStatus) {
  const targetPath = resolve(rootDirectory, '.env.test.local')
  const fileContents = buildLocalTestEnvironment(localStatus)

  writeFileSync(targetPath, fileContents, { encoding: 'utf8', mode: 0o600 })

  try {
    const safeEnvironment = loadSafeTestEnvironment(rootDirectory, {})
    return {
      path: targetPath,
      supabaseHost: new URL(
        safeEnvironment.NEXT_PUBLIC_SUPABASE_URL,
      ).host,
      applicationHost: new URL(safeEnvironment.PLAYWRIGHT_BASE_URL).host,
    }
  } catch (error) {
    rmSync(targetPath, { force: true })
    throw error
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined

if (entryPoint === import.meta.url) {
  const cliPath = process.env.SUPABASE_CLI_PATH
  if (!cliPath) {
    throw new Error(
      'Falta SUPABASE_CLI_PATH para leer el estado del stack local.',
    )
  }

  const statusResult = spawnSync(
    cliPath,
    ['status', '--output', 'json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )

  if (statusResult.status !== 0) {
    throw new Error(
      'No se pudo leer el estado de Supabase local; no se escribió .env.test.local.',
    )
  }

  const localStatus = JSON.parse(statusResult.stdout)
  const result = writeLocalTestEnvironmentFile(process.cwd(), localStatus)

  console.log(
    `Entorno local escrito y validado: Supabase=${result.supabaseHost} aplicación=${result.applicationHost}`,
  )
}
