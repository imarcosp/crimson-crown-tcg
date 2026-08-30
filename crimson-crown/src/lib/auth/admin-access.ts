const PRODUCTION_ADMIN_EMAILS = [
  'mjperchezabala@gmail.com',
  'crimsoncrownimports@gmail.com',
] as const

const LOCAL_TEST_ADMIN_EMAILS = ['admin.local@example.test'] as const
const STAGING_ADMIN_EMAIL = 'admin.crimson.staging@example.test'
const STAGING_STAFF_EMAIL = 'operator.crimson.staging@example.test'

type PublicAdminEnvironment = Readonly<{
  NEXT_PUBLIC_SUPABASE_URL?: string
  NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF?: string
  NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET?: string
}>

function environment(input?: string | PublicAdminEnvironment): PublicAdminEnvironment {
  return typeof input === 'string'
    ? { NEXT_PUBLIC_SUPABASE_URL: input }
    : (input ?? {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: process.env.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF,
        NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: process.env.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET,
      })
}

function isLoopbackSupabaseUrl(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false

  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase()
    return hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return false
  }
}

export function isAdminEmail(
  email: string | null | undefined,
  input?: string | PublicAdminEnvironment,
): boolean {
  if (!email) return false
  if ((PRODUCTION_ADMIN_EMAILS as readonly string[]).includes(email)) return true

  const env = environment(input)
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL

  return (isLoopbackSupabaseUrl(supabaseUrl) &&
    (LOCAL_TEST_ADMIN_EMAILS as readonly string[]).includes(email)) ||
    (isExactStagingEnvironment(env) && email === STAGING_ADMIN_EMAIL)
}

export function getAdminEmails(
  input?: string | PublicAdminEnvironment,
): string[] {
  const env = environment(input)
  return [
    ...PRODUCTION_ADMIN_EMAILS,
    ...(isLoopbackSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) ? LOCAL_TEST_ADMIN_EMAILS : []),
    ...(isExactStagingEnvironment(env) ? [STAGING_ADMIN_EMAIL] : []),
  ]
}

export function isExactStagingEnvironment(env: PublicAdminEnvironment): boolean {
  const ref = env.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF?.trim()
  if (!ref || env.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET !== 'staging') return false
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (rawUrl !== `https://${ref}.supabase.co`) return false
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.hostname === `${ref}.supabase.co` &&
      !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
  } catch {
    return false
  }
}

export function getOwnerAdminEmail(input?: string | PublicAdminEnvironment): string {
  return isExactStagingEnvironment(environment(input)) ? STAGING_ADMIN_EMAIL : PRODUCTION_ADMIN_EMAILS[0]
}

export function getStaffAdminEmail(input?: string | PublicAdminEnvironment): string {
  return isExactStagingEnvironment(environment(input)) ? STAGING_STAFF_EMAIL : PRODUCTION_ADMIN_EMAILS[1]
}

export function isCommissionAdminEmail(
  email: string | null | undefined,
  input?: string | PublicAdminEnvironment,
): boolean {
  if (!email) return false
  return email === getOwnerAdminEmail(input) || email === getStaffAdminEmail(input)
}
