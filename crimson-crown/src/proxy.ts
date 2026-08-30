import { createGuardedServerClient as createServerClient } from '@/lib/supabase/guarded-constructors'
import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_EMAILS } from '@/lib/constants'
import { isCommissionAdminEmail } from '@/lib/auth/admin-access'
import {
  assertSafeRuntimeSupabaseUrl,
  UnsafeEnvironmentError,
} from '@/lib/environment/production-guards'

export async function proxy(request: NextRequest) {
  // Ignorar rutas estáticas y de auth
  if (request.nextUrl.pathname.startsWith('/auth/callback') || request.nextUrl.pathname.startsWith('/auth/update-password')) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  let safeSupabaseUrl: URL
  try {
    safeSupabaseUrl = assertSafeRuntimeSupabaseUrl(supabaseUrl)
    if (!supabaseKey.trim()) {
      throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
    }
  } catch (error) {
    if (error instanceof UnsafeEnvironmentError) {
      console.error('[Proxy] Entorno Supabase bloqueado:', error.name)
    }
    return NextResponse.json(
      { error: 'Entorno no disponible para este deployment.' },
      { status: 503 },
    )
  }

  const supabase = createServerClient(
    safeSupabaseUrl.toString(),
    supabaseKey,
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
      // Registramos la visita de manera no bloqueante (Best Effort).
      const analyticsInsert = supabase
        .from('analytics_visits')
        .insert({ source: 'altobuscador' })
      void Promise.resolve(analyticsInsert)
        .then(({ error: analyticsError }) => {
          if (analyticsError) console.error('Error analytics:', analyticsError.message)
        })
        .catch((analyticsError: unknown) => {
          console.error('Error analytics:', analyticsError instanceof Error ? analyticsError.message : 'desconocido')
        })
  }

  // --- AUTH & ADMIN ---
  const { data: { user }, error } = await supabase.auth.getUser()

  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (error) console.error("❌ [Middleware] Error Auth:", error.message)
    if (!user) return NextResponse.redirect(new URL('/login', request.url))
    const canAccessCommissionStagingRoute = request.nextUrl.pathname.startsWith('/admin/commissions') &&
      isCommissionAdminEmail(user.email)
    if (!user.email || (!ADMIN_EMAILS.includes(user.email) && !canAccessCommissionStagingRoute)) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
