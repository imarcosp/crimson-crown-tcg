const PRODUCTION_ADMIN_EMAILS = [
  'mjperchezabala@gmail.com',
  'crimsoncrownimports@gmail.com',
] as const

const LOCAL_TEST_ADMIN_EMAILS = ['admin.local@example.test'] as const

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
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (!email) return false
  if ((PRODUCTION_ADMIN_EMAILS as readonly string[]).includes(email)) return true

  return isLoopbackSupabaseUrl(supabaseUrl) &&
    (LOCAL_TEST_ADMIN_EMAILS as readonly string[]).includes(email)
}

export function getAdminEmails(
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string[] {
  return [
    ...PRODUCTION_ADMIN_EMAILS,
    ...(isLoopbackSupabaseUrl(supabaseUrl) ? LOCAL_TEST_ADMIN_EMAILS : []),
  ]
}
