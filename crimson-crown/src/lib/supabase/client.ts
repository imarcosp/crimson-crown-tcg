import { createBrowserClient } from '@supabase/ssr'
import {
  assertSafeClientSupabaseUrl,
  UnsafeEnvironmentError,
} from '@/lib/environment/production-guards'

// Instancia única (Singleton) para evitar reconexiones múltiples
let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const expectedTarget = (process.env.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET ?? 'local') as
    | 'local'
    | 'staging'
    | 'production'
  const safeUrl = assertSafeClientSupabaseUrl(
    url,
    expectedTarget,
    process.env.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF ?? '',
  )

  if (!key.trim()) {
    throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
  }

  client = createBrowserClient(safeUrl.toString(), key, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  })
  
  return client
}
