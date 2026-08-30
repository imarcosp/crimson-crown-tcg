import { NextResponse, type NextRequest } from 'next/server'
import { resolveAuthCallbackPath } from '@/lib/auth/callback'
import { createClient } from '@/lib/supabase/server'

// Evitamos que Next.js guarde caché de esta ruta
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = resolveAuthCallbackPath(requestUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    }
  }

  const failureUrl = new URL('/login', requestUrl.origin)
  failureUrl.searchParams.set('error', 'auth-callback')
  return NextResponse.redirect(failureUrl)
}
