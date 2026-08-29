import 'server-only'

import { UnsafeEnvironmentError, assertSafeRuntimeSupabaseUrl } from '@/lib/environment/production-guards'
import { createGuardedSupabaseClient as createClient } from '@/lib/supabase/guarded-constructors'

export function createAdminClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const safeUrl = assertSafeRuntimeSupabaseUrl(rawUrl)

  if (!serviceRoleKey.trim()) {
    throw new UnsafeEnvironmentError('Entorno Supabase incompleto para este deployment.')
  }

  return createClient(safeUrl.toString(), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
