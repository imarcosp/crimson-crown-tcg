import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const playwrightCli = resolve(root, 'node_modules/playwright/cli.js')

test('la colección E2E local excluye las pruebas exclusivas de staging', () => {
  const environment = { ...process.env }

  for (const name of [
    'CRIMSON_STAGING_FIXTURE_PASSWORD',
    'CRIMSON_STAGING_SUPABASE_PROJECT_REF',
    'NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF',
  ]) {
    delete environment[name]
  }

  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', '--list', '--config=playwright.config.ts'],
    {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      shell: false,
    },
  )
  const output = `${result.stdout}${result.stderr}`

  assert.equal(
    result.status,
    0,
    'la configuración local debe recolectar sus pruebas sin variables de staging',
  )
  assert.match(output, /Listing tests:/u)
  assert.doesNotMatch(output, /staging[\\/]p0-smoke\.spec\.ts/u)
})
