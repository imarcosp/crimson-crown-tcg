import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { assertCrimsonStagingEnvironment } from './assert-crimson-staging.mjs'

const stagingRef = 'crimsonstage12345678'

function stagingEnvFor(projectRef = stagingRef) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: projectRef,
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: projectRef,
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
    PLAYWRIGHT_BASE_URL: 'https://crimson-preview.vercel.app',
    NEXT_PUBLIC_BASE_URL: 'https://crimson-preview.vercel.app',
    DISABLE_EXTERNAL_SIDE_EFFECTS: 'true',
    CRIMSON_STAGING_EMAIL_DOMAIN: 'example.test',
  }
}

test('acepta staging cuando URL, referencias, origen y aislamiento coinciden', () => {
  assert.deepEqual(assertCrimsonStagingEnvironment(stagingEnvFor()), {
    projectRef: stagingRef,
    appOrigin: 'https://crimson-preview.vercel.app',
  })
})

test('rechaza producción y proyectos extranjeros conocidos sin revelar referencias', () => {
  for (const projectRef of [
    'djfqozfaqkqdoqeoqbzt',
    'jzkxvgntwompkntimrao',
    'tszglqwrklthnzhqdffn',
    'shwqihiueeuqeumdoepn',
  ]) {
    assert.throws(
      () => assertCrimsonStagingEnvironment(stagingEnvFor(projectRef)),
      (error) => error instanceof Error && !error.message.includes(projectRef),
    )
  }
})

test('rechaza URL Supabase no canónica o distinta de las dos referencias', () => {
  const cases = [
    { NEXT_PUBLIC_SUPABASE_URL: `http://${stagingRef}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co/path` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co?redirect=1` },
    { NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'otherstage12345678' },
    { CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'otherstage12345678' },
  ]

  for (const override of cases) {
    assert.throws(() => assertCrimsonStagingEnvironment({ ...stagingEnvFor(), ...override }))
  }
})

test('exige target, efectos externos desactivados y dominio sintético exactos', () => {
  for (const override of [
    { NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'production' },
    { DISABLE_EXTERNAL_SIDE_EFFECTS: 'false' },
    { DISABLE_EXTERNAL_SIDE_EFFECTS: 'TRUE' },
    { CRIMSON_STAGING_EMAIL_DOMAIN: 'gmail.com' },
    { CRIMSON_STAGING_EMAIL_DOMAIN: '@example.test' },
  ]) {
    assert.throws(() => assertCrimsonStagingEnvironment({ ...stagingEnvFor(), ...override }))
  }
})

test('rechaza credenciales de Resend, Mercado Pago y cualquier webhook sin revelar valores', () => {
  const configured = [
    ['RESEND_API_KEY', 'resend-super-secret'],
    ['RESEND_FROM_EMAIL', 'sender-secret@example.test'],
    ['MERCADOPAGO_ACCESS_TOKEN', 'mercadopago-super-secret'],
    ['MERCADO_PAGO_PUBLIC_KEY', 'mercadopago-public-secret'],
    ['ORDER_WEBHOOK_URL', 'https://hooks.example.test/private-token'],
  ]

  for (const [name, value] of configured) {
    assert.throws(
      () => assertCrimsonStagingEnvironment({ ...stagingEnvFor(), [name]: value }),
      (error) => error instanceof Error && !error.message.includes(value),
    )
  }
})

test('rechaza cualquier origen productivo de Crimson sin revelar su valor', () => {
  for (const override of [
    { PLAYWRIGHT_BASE_URL: 'https://www.crimsoncrownimports.com' },
    { NEXT_PUBLIC_BASE_URL: 'https://checkout.crimsoncrownimports.com' },
    { APP_BASE_URL: 'https://crimsoncrownimports.com/private' },
  ]) {
    const value = Object.values(override)[0]
    assert.throws(
      () => assertCrimsonStagingEnvironment({ ...stagingEnvFor(), ...override }),
      (error) => error instanceof Error && !error.message.includes(value),
    )
  }
})

test('no interpreta conexiones de base de datos como orígenes de la aplicación', () => {
  assert.doesNotThrow(() => assertCrimsonStagingEnvironment({
    ...stagingEnvFor(),
    DATABASE_URL: 'postgresql://staging-user:secret@db.example.test:5432/postgres',
  }))
})

test('el CLI falla de forma genérica y no imprime secretos', () => {
  const secret = 'do-not-print-this-webhook'
  const result = spawnSync(process.execPath, ['scripts/staging/assert-crimson-staging.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...stagingEnvFor(), ORDER_WEBHOOK_SECRET: secret },
    encoding: 'utf8',
  })
  const output = `${result.stdout}${result.stderr}`

  assert.notEqual(result.status, 0)
  assert.match(output, /Crimson staging no autorizado/u)
  assert.doesNotMatch(output, new RegExp(secret))
})
