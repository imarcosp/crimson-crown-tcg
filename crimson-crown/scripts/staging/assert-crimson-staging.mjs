import { fileURLToPath } from 'node:url'

import {
  UnsafeEnvironmentError,
  classifySupabaseTarget,
} from '../../src/lib/environment/supabase-target-policy.mjs'

const CRIMSON_PRODUCTION_DOMAIN = 'crimsoncrownimports.com'
const SIDE_EFFECT_VARIABLE = /(?:RESEND|MERCADO_?PAGO|^MP_|WEBHOOK)/iu
const APP_URL_VARIABLE = /^(?:PLAYWRIGHT_BASE_URL|NEXT_PUBLIC_BASE_URL|APP_BASE_URL|APP_URL|NEXT_PUBLIC_APP_URL|SITE_URL|NEXT_PUBLIC_SITE_URL)$/u

function unsafeStaging() {
  return new UnsafeEnvironmentError('Crimson staging no autorizado.')
}

function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw unsafeStaging()
  return value
}

function parseAppOrigin(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw unsafeStaging()
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    hostname === CRIMSON_PRODUCTION_DOMAIN ||
    hostname.endsWith(`.${CRIMSON_PRODUCTION_DOMAIN}`)
  ) {
    throw unsafeStaging()
  }

  return url.origin
}

export function assertCrimsonStagingEnvironment(env = process.env) {
  const privateRef = required(env, 'CRIMSON_STAGING_SUPABASE_PROJECT_REF')
  const publicRef = required(env, 'NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF')
  if (privateRef !== publicRef) throw unsafeStaging()

  let target
  try {
    target = classifySupabaseTarget(required(env, 'NEXT_PUBLIC_SUPABASE_URL'), privateRef)
  } catch {
    throw unsafeStaging()
  }
  if (target.kind !== 'staging' || target.projectRef !== privateRef) throw unsafeStaging()

  if (required(env, 'NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET') !== 'staging') throw unsafeStaging()
  if (required(env, 'DISABLE_EXTERNAL_SIDE_EFFECTS') !== 'true') throw unsafeStaging()
  if (required(env, 'CRIMSON_STAGING_EMAIL_DOMAIN') !== 'example.test') throw unsafeStaging()

  for (const [name, rawValue] of Object.entries(env)) {
    const value = rawValue?.trim()
    if (!value) continue
    if (SIDE_EFFECT_VARIABLE.test(name)) throw unsafeStaging()
    if (APP_URL_VARIABLE.test(name)) parseAppOrigin(value)
  }

  const appOrigin = parseAppOrigin(required(env, 'PLAYWRIGHT_BASE_URL'))
  return Object.freeze({ projectRef: privateRef, appOrigin })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = assertCrimsonStagingEnvironment(process.env)
    console.log(JSON.stringify(result))
  } catch (error) {
    if (error instanceof UnsafeEnvironmentError) {
      console.error(`${error.name}: Crimson staging no autorizado.`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
