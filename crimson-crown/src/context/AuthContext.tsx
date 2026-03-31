"use client"
import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client' // USAR ESTE CLIENTE SIEMPRE EN CLIENT COMPONENTS

type AuthCtx = {
  user: any | null
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({ user: null, signOut: async () => {} })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null)
  // Instanciamos el cliente aquí para asegurar contexto del navegador
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [supabase])

  const signOut = async () => { await supabase.auth.signOut() }

  return <Ctx.Provider value={{ user, signOut }}>{children}</Ctx.Provider>
}

export function useAuth() { return useContext(Ctx) }