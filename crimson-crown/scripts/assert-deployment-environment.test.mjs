import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const gate = 'scripts/assert-deployment-environment.mjs'
const syntheticStagingRef = 'crimsonstage12345678'
const productionRef = 'djfqozfaqkqdoqeoqbzt'

function runGate(env) {
  return spawnSync(process.execPath, [gate], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function outputOf(result) {
  return `${result.stdout}${result.stderr}`
}

test('acepta triples locales, staging y production autorizados', () => {
  const cases = [
    {
      VERCEL: '',
      VERCEL_ENV: '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'local',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
    },
    {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SUPABASE_URL: `https://${syntheticStagingRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'staging-anon-key',
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: syntheticStagingRef,
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: syntheticStagingRef,
    },
    {
      VERCEL: '1',
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'production-anon-key',
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'production',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
    },
  ]

  for (const env of cases) {
    const result = runGate(env)
    assert.equal(result.status, 0, outputOf(result))
  }
})

test('rechaza destinos ajenos sin revelar referencias', () => {
  const foreignRef = 'jzkxvgntwompkntimrao'
  const result = runGate({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: `https://${foreignRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'staging-anon-key',
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: foreignRef,
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: foreignRef,
  })

  assert.notEqual(result.status, 0)
  assert.match(outputOf(result), /UnsafeEnvironmentError/)
  assert.doesNotMatch(outputOf(result), new RegExp(foreignRef))
})

test('rechaza referencias de staging públicas y privadas distintas sin revelarlas', () => {
  const privateRef = syntheticStagingRef
  const publicRef = 'otherstage123456789'
  const result = runGate({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: `https://${privateRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'staging-anon-key',
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: privateRef,
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: publicRef,
  })

  assert.notEqual(result.status, 0)
  assert.doesNotMatch(outputOf(result), new RegExp(`${privateRef}|${publicRef}`))
})

test('rechaza metadatos Vercel ausentes o desconocidos aunque el destino sea local', () => {
  const cases = [undefined, 'unexpected']

  for (const vercelEnvironment of cases) {
    const result = runGate({
      VERCEL: '1',
      VERCEL_ENV: vercelEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key',
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'local',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: '',
    })

    assert.notEqual(result.status, 0, outputOf(result))
    assert.match(outputOf(result), /UnsafeEnvironmentError/)
  }
})

test('la importación no altera exitCode; el entry point sí informa el fallo', () => {
  const invalidEnvironment = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: 'https://jzkxvgntwompkntimrao.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'staging-anon-key',
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'jzkxvgntwompkntimrao',
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'jzkxvgntwompkntimrao',
  }
  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { assertDeploymentEnvironment } from './scripts/assert-deployment-environment.mjs'; try { assertDeploymentEnvironment(); } catch { } if (process.exitCode) process.exit(process.exitCode)",
    ],
    { cwd: process.cwd(), env: { ...process.env, ...invalidEnvironment }, encoding: 'utf8' },
  )
  const entryPoint = runGate(invalidEnvironment)

  assert.equal(imported.status, 0, outputOf(imported))
  assert.notEqual(entryPoint.status, 0)
  assert.match(outputOf(entryPoint), /UnsafeEnvironmentError/)
})
