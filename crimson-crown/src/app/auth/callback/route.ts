import { NextResponse, type NextRequest } from 'next/server'

// Evitamos que Next.js guarde caché de esta ruta
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  if (code) {
    const targetUrl = new URL('/auth/update-password', origin)
    targetUrl.searchParams.set('code', code)
    return NextResponse.redirect(targetUrl)
  }

  // Si no hay código, algo anda mal
  return NextResponse.redirect(`${origin}/login?error=no-code-provided`)
}
