import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  assertSafeRuntimeSupabaseUrl,
  UnsafeEnvironmentError,
} from '@/lib/environment/production-guards'

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const safeUrl = assertSafeRuntimeSupabaseUrl(url)
  if (!key.trim()) {
    throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
  }
  const cookieStore = await cookies()

  return createServerClient(
    safeUrl.toString(),
    key,
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
