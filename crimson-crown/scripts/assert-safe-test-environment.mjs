import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { loadSafeTestEnvironment } from '../src/lib/environment/load-safe-test-environment.ts'

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined

if (entryPoint === import.meta.url) {
  const safeEnvironment = loadSafeTestEnvironment(process.cwd())
  const supabaseHost = new URL(
    safeEnvironment.NEXT_PUBLIC_SUPABASE_URL,
  ).host
  const applicationHost = new URL(safeEnvironment.PLAYWRIGHT_BASE_URL).host

  console.log(
    `Entorno E2E seguro: Supabase=${supabaseHost} aplicación=${applicationHost}`,
  )
}
