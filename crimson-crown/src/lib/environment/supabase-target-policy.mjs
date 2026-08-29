export const CRIMSON_PRODUCTION_PROJECT_REF = 'djfqozfaqkqdoqeoqbzt'
export const CRIMSON_LOCAL_SUPABASE_API_PORT = '54621'
export const FORBIDDEN_PROJECT_REFS = Object.freeze([
  'jzkxvgntwompkntimrao',
  'tszglqwrklthnzhqdffn',
  'shwqihiueeuqeumdoepn',
])

/** @typedef {'local' | 'staging' | 'production'} SupabaseTargetKind */
/** @typedef {{ kind: SupabaseTargetKind, projectRef: string | null, url: URL }} SupabaseTarget */
/** @typedef {Record<string, string | undefined>} SupabaseEnvironment */

export class UnsafeEnvironmentError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'UnsafeEnvironmentError'
  }
}

function unsafeTarget() {
  return new UnsafeEnvironmentError('Destino Supabase no autorizado.')
}

function parseWithoutEcho(rawUrl) {
  try {
    return new URL(rawUrl)
  } catch {
    throw unsafeTarget()
  }
}

function isLoopback(url) {
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
}

function extractHostedProjectRef(url) {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return null
  }

  const match = /^([a-z0-9]+)\.supabase\.(?:co|in)$/.exec(url.hostname)
  return match?.[1] ?? null
}

/**
 * @param {string} rawUrl
 * @param {string} [stagingRef]
 * @returns {SupabaseTarget}
 */
export function classifySupabaseTarget(rawUrl, stagingRef = '') {
  const url = parseWithoutEcho(rawUrl)
  if (isLoopback(url) && url.protocol === 'http:' && url.port === CRIMSON_LOCAL_SUPABASE_API_PORT) {
    return { kind: 'local', projectRef: null, url }
  }
  const projectRef = extractHostedProjectRef(url)
  if (!projectRef || FORBIDDEN_PROJECT_REFS.includes(projectRef)) throw unsafeTarget()
  if (projectRef === CRIMSON_PRODUCTION_PROJECT_REF) return { kind: 'production', projectRef, url }
  if (stagingRef && projectRef === stagingRef && !FORBIDDEN_PROJECT_REFS.includes(stagingRef)) {
    return { kind: 'staging', projectRef, url }
  }
  throw unsafeTarget()
}

/**
 * @param {string} rawUrl
 * @param {SupabaseEnvironment} [env]
 * @returns {URL}
 */
export function assertSafeRuntimeSupabaseUrl(rawUrl, env = process.env) {
  const target = classifySupabaseTarget(rawUrl, env.CRIMSON_STAGING_SUPABASE_PROJECT_REF)
  const expected = env.VERCEL_ENV === 'production'
    ? 'production'
    : env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development'
      ? 'staging'
      : 'local'

  if (target.kind !== expected) {
    throw new UnsafeEnvironmentError('Entorno Supabase no autorizado para este deployment.')
  }

  return target.url
}

/**
 * @param {string} rawUrl
 * @param {SupabaseTargetKind} expectedTarget
 * @param {string} [stagingRef]
 * @returns {URL}
 */
export function assertSafeClientSupabaseUrl(rawUrl, expectedTarget, stagingRef = '') {
  const target = classifySupabaseTarget(rawUrl, stagingRef)

  if (target.kind !== expectedTarget) {
    throw new UnsafeEnvironmentError('Entorno Supabase no autorizado para este deployment.')
  }

  return target.url
}
