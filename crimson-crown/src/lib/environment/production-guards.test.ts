import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertNonProductionUrl,
  assertSafeTestEnvironment,
  assertSafeDevelopmentSupabaseUrl,
} from './production-guards.ts'

test('rejects every known Crimson Crown production URL', () => {
  const productionUrls = [
    'https://djfqozfaqkqdoqeoqbzt.supabase.co',
    'postgresql://user:secret-value@db.djfqozfaqkqdoqeoqbzt.supabase.co:5432/postgres',
    'https://www.crimsoncrownimports.com',
    'https://crimsoncrownimports.com/catalog',
  ]

  for (const productionUrl of productionUrls) {
    assert.throws(
      () => assertNonProductionUrl(productionUrl, 'prueba'),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, 'UnsafeEnvironmentError')
        assert.equal(error.message.includes('secret-value'), false)
        return true
      },
    )
  }
})

test('blocks production Supabase URLs when running the development server', () => {
  assert.throws(
    () => assertSafeDevelopmentSupabaseUrl('https://djfqozfaqkqdoqeoqbzt.supabase.co'),
    (error: unknown) => error instanceof Error && error.name === 'UnsafeEnvironmentError',
  )
  assert.doesNotThrow(() => assertSafeDevelopmentSupabaseUrl('http://127.0.0.1:54621'))
})

test('accepts an isolated loopback environment without external side effects', () => {
  assert.doesNotThrow(() =>
    assertSafeTestEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
      PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    }),
  )
})

test('rejects credentials that can trigger external side effects', () => {
  const safeEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
    PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
  }

  for (const variableName of [
    'RESEND_API_KEY',
    'MERCADOPAGO_ACCESS_TOKEN',
    'MERCADO_PAGO_ACCESS_TOKEN',
    'MP_ACCESS_TOKEN',
  ]) {
    assert.throws(
      () =>
        assertSafeTestEnvironment({
          ...safeEnvironment,
          [variableName]: 'external-secret-value',
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, 'UnsafeEnvironmentError')
        assert.equal(error.message.includes('external-secret-value'), false)
        return true
      },
    )
  }
})

test('rejects a local service role key that matches a production secret', () => {
  const productionSecret = 'production-service-role-secret'

  assert.throws(
    () =>
      assertSafeTestEnvironment(
        {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
          PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
          SUPABASE_SERVICE_ROLE_KEY: productionSecret,
        },
        new Set([productionSecret]),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'UnsafeEnvironmentError')
      assert.equal(error.message.includes(productionSecret), false)
      return true
    },
  )
})
