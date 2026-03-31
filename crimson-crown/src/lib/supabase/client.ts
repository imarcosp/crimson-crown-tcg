import { createBrowserClient } from '@supabase/ssr'

// Instancia única (Singleton) para evitar reconexiones múltiples
let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    client = ({
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({ select: async () => ({ data: null }), insert: async () => ({ data: null }) }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    } as any)
    return client
  }

  client = createBrowserClient(url, key, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  })
  
  return client
}
