import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import {
  FORBIDDEN_PROJECT_REFS,
  UnsafeEnvironmentError,
  assertSafeRuntimeSupabaseUrl,
} from '../src/lib/environment/supabase-target-policy.mjs'

function expectedDeploymentTarget(env) {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return 'staging'
  return 'local'
}

function assertStagingReferences(env) {
  const privateRef = env.CRIMSON_STAGING_SUPABASE_PROJECT_REF?.trim() ?? ''
  const publicRef = env.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF?.trim() ?? ''

  if (
    !privateRef ||
    !publicRef ||
    privateRef !== publicRef ||
    FORBIDDEN_PROJECT_REFS.includes(privateRef) ||
    FORBIDDEN_PROJECT_REFS.includes(publicRef)
  ) {
    throw new UnsafeEnvironmentError('Referencias Supabase de staging no autorizadas.')
  }
}

export function assertDeploymentEnvironment() {
  if (!process.env.VERCEL) {
    dotenv.config({ path: '.env.local', override: false })
  }

  const env = process.env
  const expectedTarget = expectedDeploymentTarget(env)

  assertSafeRuntimeSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env)

  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
  }

  if (expectedTarget === 'staging') {
    assertStagingReferences(env)
  }

  if ((env.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET ?? 'local') !== expectedTarget) {
    throw new UnsafeEnvironmentError('Target de deployment no autorizado.')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assertDeploymentEnvironment()
  } catch (error) {
    if (error instanceof UnsafeEnvironmentError) {
      console.error(`${error.name}: Entorno de deployment no autorizado.`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
