import assert from 'node:assert/strict'
import test from 'node:test'

import {
  guardBrowserSupabaseConstructor,
  guardRuntimeSupabaseConstructor,
} from '../supabase/guarded-constructors.ts'
import {
  assertLegacyRpcMigrationOptIn,
  guardOperationalSupabaseConstructor,
} from '../../../scripts/lib/guarded-supabase-client.mjs'

const productionUrl = 'https://djfqozfaqkqdoqeoqbzt.supabase.co'
const stagingRef = 'crimsonstage12345678'
const stagingUrl = `https://${stagingRef}.supabase.co`
const localUrl = 'http://127.0.0.1:54621'
const normalizedProductionUrl = `${productionUrl}/`
const normalizedStagingUrl = `${stagingUrl}/`
const normalizedLocalUrl = `${localUrl}/`

function recordingConstructor(calls: string[]) {
  return (url: string) => {
    calls.push(url)
    return { url }
  }
}

test('runtime and browser adapters validate the target before delegating', () => {
  const runtimeCalls: string[] = []
  const runtimeConstructor = guardRuntimeSupabaseConstructor(
    recordingConstructor(runtimeCalls),
    { VERCEL_ENV: 'production' },
  )

  assert.throws(() => runtimeConstructor(stagingUrl))
  assert.deepEqual(runtimeCalls, [])
  assert.deepEqual(runtimeConstructor(productionUrl), { url: normalizedProductionUrl })
  assert.deepEqual(runtimeCalls, [normalizedProductionUrl])

  const browserCalls: string[] = []
  const browserConstructor = guardBrowserSupabaseConstructor(
    recordingConstructor(browserCalls),
    {
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    },
  )

  assert.throws(() => browserConstructor(productionUrl))
  assert.deepEqual(browserCalls, [])
  assert.deepEqual(browserConstructor(stagingUrl), { url: normalizedStagingUrl })
  assert.deepEqual(browserCalls, [normalizedStagingUrl])
})

test('operational adapters default to pinned local and require an explicit hosted target', () => {
  assert.throws(() => assertLegacyRpcMigrationOptIn({}))
  assert.doesNotThrow(() =>
    assertLegacyRpcMigrationOptIn({ CRIMSON_ENABLE_LEGACY_RPC_MIGRATION: 'true' }),
  )

  const implicitCalls: string[] = []
  const implicitConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(implicitCalls),
    { SUPABASE_SERVICE_ROLE_KEY: 'credential-must-not-select-a-target' },
  )

  assert.throws(() => implicitConstructor(productionUrl))
  assert.throws(() => implicitConstructor('http://127.0.0.1:54321'))
  assert.deepEqual(implicitCalls, [])
  assert.deepEqual(implicitConstructor(localUrl), { url: normalizedLocalUrl })
  assert.deepEqual(implicitCalls, [normalizedLocalUrl])

  const productionCalls: string[] = []
  const productionConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(productionCalls),
    { CRIMSON_OPERATION_TARGET: 'production' },
  )
  assert.deepEqual(productionConstructor(productionUrl), { url: normalizedProductionUrl })
  assert.deepEqual(productionCalls, [normalizedProductionUrl])

  const stagingCalls: string[] = []
  const stagingConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(stagingCalls),
    {
      CRIMSON_OPERATION_TARGET: 'staging',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    },
  )
  assert.deepEqual(stagingConstructor(stagingUrl), { url: normalizedStagingUrl })
  assert.deepEqual(stagingCalls, [normalizedStagingUrl])
})
