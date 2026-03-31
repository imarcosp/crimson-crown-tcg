import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const OWNER_EMAIL = "mjperchezabala@gmail.com"

export async function proxy(request: NextRequest) {
  // Ignorar rutas estáticas y de auth
  if (request.nextUrl.pathname.startsWith('/auth/callback') || request.nextUrl.pathname.startsWith('/auth/update-password')) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set({ name, value, ...options })
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  // --- ANALYTICS TRACKING (ALTOBUSCADOR) ---
  const source = request.nextUrl.searchParams.get('ref') || request.nextUrl.searchParams.get('source')
  if (source && source.toLowerCase() === 'altobuscador') {
      // Registramos la visita de manera no bloqueante (Best Effort)
      await supabase.from('analytics_visits').insert({ source: 'altobuscador' }).catch(err => console.error('Error analytics:', err))
  }

  // --- AUTH & ADMIN ---
  const { data: { user }, error } = await supabase.auth.getUser()

  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (error) console.error("❌ [Middleware] Error Auth:", error.message)
    if (!user) return NextResponse.redirect(new URL('/login', request.url))
    if (user.email !== OWNER_EMAIL) return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}