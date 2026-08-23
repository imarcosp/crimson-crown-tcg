import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loadSafeTestEnvironment } from '../src/lib/environment/load-safe-test-environment.ts'

test('loads the isolated test file over inherited production-like values', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'crimson-safe-env-'))

  try {
    writeFileSync(
      join(fixtureRoot, '.env.test.local'),
      [
        'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54621',
        'PLAYWRIGHT_BASE_URL=http://localhost:3000',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key',
        'SUPABASE_SERVICE_ROLE_KEY=local-service-role-key',
      ].join('\n'),
    )
    writeFileSync(
      join(fixtureRoot, '.env.local'),
      'SUPABASE_SERVICE_ROLE_KEY=production-service-role-key\n',
    )

    const loadedEnvironment = loadSafeTestEnvironment(fixtureRoot, {
      NEXT_PUBLIC_SUPABASE_URL:
        'https://djfqozfaqkqdoqeoqbzt.supabase.co',
    })

    assert.equal(
      loadedEnvironment.NEXT_PUBLIC_SUPABASE_URL,
      'http://127.0.0.1:54621',
    )
    assert.equal(
      loadedEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      'local-service-role-key',
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('rejects a test service role copied from any production env file', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'crimson-safe-env-'))
  const productionSecret = 'production-service-role-secret'

  try {
    writeFileSync(
      join(fixtureRoot, '.env.test.local'),
      [
        'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54621',
        'PLAYWRIGHT_BASE_URL=http://localhost:3000',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key',
        `SUPABASE_SERVICE_ROLE_KEY=${productionSecret}`,
      ].join('\n'),
    )
    writeFileSync(
      join(fixtureRoot, '.env.staging'),
      `SUPABASE_SERVICE_ROLE_KEY=${productionSecret}\n`,
    )

    assert.throws(
      () => loadSafeTestEnvironment(fixtureRoot, {}),
      (error) => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, 'UnsafeEnvironmentError')
        assert.equal(error.message.includes(productionSecret), false)
        return true
      },
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('rejects a missing test env file without exposing its absolute path', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'crimson-safe-env-'))

  try {
    assert.throws(
      () => loadSafeTestEnvironment(fixtureRoot, {}),
      (error) => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, 'UnsafeEnvironmentError')
        assert.equal(error.message.includes(fixtureRoot), false)
        return true
      },
    )
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
