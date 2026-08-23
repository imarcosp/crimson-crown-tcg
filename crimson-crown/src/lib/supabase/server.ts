import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { assertSafeDevelopmentSupabaseUrl } from '@/lib/environment/production-guards'

export async function createClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (process.env.NODE_ENV === 'development') {
    assertSafeDevelopmentSupabaseUrl(url)
  }

  return createServerClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // El método setAll se llama desde un Server Component.
            // Esto puede ignorarse si tienes middleware refrescando la sesión.
          }
        },
      },
    }
  )
}
