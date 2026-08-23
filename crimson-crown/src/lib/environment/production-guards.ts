const CRIMSON_PRODUCTION_PROJECT_REF = 'djfqozfaqkqdoqeoqbzt'
const CRIMSON_PRODUCTION_DOMAIN = 'crimsoncrownimports.com'
const CRIMSON_LOCAL_SUPABASE_API_PORT = '54621'
const EXTERNAL_SIDE_EFFECT_CREDENTIALS = [
  'RESEND_API_KEY',
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADO_PAGO_ACCESS_TOKEN',
  'MP_ACCESS_TOKEN',
] as const

type Environment = Record<string, string | undefined>

export class UnsafeEnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeEnvironmentError'
  }
}

export function assertNonProductionUrl(rawUrl: string, purpose: string): URL {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new UnsafeEnvironmentError(
      `Entorno inseguro: la URL de ${purpose} no es válida.`,
    )
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  const isCrimsonDomain =
    hostname === CRIMSON_PRODUCTION_DOMAIN ||
    hostname.endsWith(`.${CRIMSON_PRODUCTION_DOMAIN}`)
  const isCrimsonSupabase = hostname.includes(CRIMSON_PRODUCTION_PROJECT_REF)

  if (isCrimsonDomain || isCrimsonSupabase) {
    throw new UnsafeEnvironmentError(
      `Entorno inseguro: ${purpose} apunta a un destino productivo.`,
    )
  }

  return parsedUrl
}

export function assertSafeDevelopmentSupabaseUrl(rawUrl: string): URL {
  return assertNonProductionUrl(rawUrl, 'Supabase de desarrollo')
}

export function assertSafeRuntimeSupabaseUrl(
  rawUrl: string,
  env: Environment = process.env,
): URL {
  if (env.VERCEL_ENV?.trim().toLowerCase() === 'production') {
    try {
      return new URL(rawUrl)
    } catch {
      throw new UnsafeEnvironmentError(
        'Entorno inseguro: la URL de Supabase del despliegue no es válida.',
      )
    }
  }

  return assertNonProductionUrl(rawUrl, 'Supabase del despliegue no productivo')
}

function requireEnvironmentValue(env: Environment, name: string): string {
  const value = env[name]?.trim()

  if (!value) {
    throw new UnsafeEnvironmentError(
      `Entorno inseguro: falta la variable requerida ${name}.`,
    )
  }

  return value
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

export function assertSafeTestEnvironment(
  env: Environment,
  forbiddenSecretValues: Iterable<string> = [],
): void {
  const supabaseUrl = assertNonProductionUrl(
    requireEnvironmentValue(env, 'NEXT_PUBLIC_SUPABASE_URL'),
    'Supabase para pruebas',
  )
  const playwrightUrl = assertNonProductionUrl(
    requireEnvironmentValue(env, 'PLAYWRIGHT_BASE_URL'),
    'Playwright',
  )

  if (
    !isLoopbackHostname(supabaseUrl.hostname) ||
    supabaseUrl.port !== CRIMSON_LOCAL_SUPABASE_API_PORT
  ) {
    throw new UnsafeEnvironmentError(
      `Entorno inseguro: Supabase para pruebas debe usar loopback en el puerto ${CRIMSON_LOCAL_SUPABASE_API_PORT}.`,
    )
  }

  if (!isLoopbackHostname(playwrightUrl.hostname)) {
    throw new UnsafeEnvironmentError(
      'Entorno inseguro: Playwright debe usar un servidor loopback.',
    )
  }

  requireEnvironmentValue(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const serviceRoleKey = requireEnvironmentValue(
    env,
    'SUPABASE_SERVICE_ROLE_KEY',
  )
  const forbiddenSecrets = new Set(
    Array.from(forbiddenSecretValues, (value) => value.trim()).filter(Boolean),
  )

  if (forbiddenSecrets.has(serviceRoleKey)) {
    throw new UnsafeEnvironmentError(
      'Entorno inseguro: la service role local coincide con una credencial prohibida.',
    )
  }

  for (const variableName of EXTERNAL_SIDE_EFFECT_CREDENTIALS) {
    if (env[variableName]?.trim()) {
      throw new UnsafeEnvironmentError(
        `Entorno inseguro: ${variableName} debe estar ausente durante las pruebas.`,
      )
    }
  }
}
