import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildLocalTestEnvironment,
  writeLocalTestEnvironmentFile,
} from './write-local-test-environment.mjs'

test('builds a test env containing only the validated local application keys', () => {
  const fileContents = buildLocalTestEnvironment({
    API_URL: 'http://127.0.0.1:54621',
    ANON_KEY: 'local-anon-key',
    SERVICE_ROLE_KEY: 'local-service-role-key',
    DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54622/postgres',
    JWT_SECRET: 'local-jwt-secret-that-must-not-be-written',
  })

  assert.equal(
    fileContents,
    [
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54621',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key',
      'SUPABASE_SERVICE_ROLE_KEY=local-service-role-key',
      'PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000',
      '',
    ].join('\n'),
  )
  assert.equal(fileContents.includes('postgresql://'), false)
  assert.equal(fileContents.includes('local-jwt-secret'), false)
})

test('writes and validates the ignored local test env without exposing its contents', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'crimson-write-env-'))
  const targetPath = join(fixtureRoot, '.env.test.local')

  try {
    writeFileSync(
      join(fixtureRoot, '.env.local'),
      'SUPABASE_SERVICE_ROLE_KEY=production-service-role-key\n',
    )

    const result = writeLocalTestEnvironmentFile(fixtureRoot, {
      API_URL: 'http://127.0.0.1:54621',
      ANON_KEY: 'local-anon-key',
      SERVICE_ROLE_KEY: 'local-service-role-key',
    })

    assert.equal(result.path, targetPath)
    assert.equal(result.supabaseHost, '127.0.0.1:54621')
    assert.equal(result.applicationHost, '127.0.0.1:3000')
    assert.equal(existsSync(targetPath), true)
    assert.equal(
      readFileSync(targetPath, 'utf8').includes('production-service-role-key'),
      false,
    )
    assert.equal('contents' in result, false)
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
