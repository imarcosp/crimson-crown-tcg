"use client"
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft } from 'lucide-react'
import { siteConfig } from '@/config/site'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [view, setView] = useState<'sign-in' | 'sign-up' | 'forgot-password'>('sign-in')
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        router.replace('/')
      } else {
        setCheckingSession(false)
      }
    }
    checkUser()
  }, [router, supabase])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    
    const origin = window.location.origin

    try {
      if (view === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.refresh()
        router.push('/')
      } else if (view === 'sign-up') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${origin}/auth/callback`,
            data: { first_name: firstName, last_name: lastName },
          },
        })
        if (error) throw error
        setSuccessMsg('Registro exitoso. Revisa tu email para confirmar la cuenta.')
        setView('sign-in')
      } else if (view === 'forgot-password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback`,
        })
        if (error) throw error
        setSuccessMsg('Te enviamos un correo con el link de recuperación.')
        setView('sign-in')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Ocurrió un error')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-[#9D1B1B]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-slate-200">
        <h1 className="text-2xl font-bold text-center mb-2 text-slate-800">
          {view === 'sign-in' && 'Iniciar Sesión'}
          {view === 'sign-up' && 'Crear Cuenta'}
          {view === 'forgot-password' && 'Recuperar Contraseña'}
        </h1>
        <p className="text-center text-slate-500 mb-6 text-sm">{siteConfig.name}</p>
        
        {successMsg && <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg text-sm mb-4 border border-emerald-200 font-medium">{successMsg}</div>}
        {errorMsg && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 border border-red-200">{errorMsg}</div>}
        
        <form onSubmit={handleAuth} className="space-y-4">
          {view === 'sign-up' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
                <input type="text" required className="input-auth" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Apellido</label>
                <input type="text" required className="input-auth" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" required className="input-auth" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
          </div>
          
          {view !== 'forgot-password' && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-slate-700">Contraseña</label>
                {view === 'sign-in' && (
                  <button type="button" onClick={() => { setView('forgot-password'); setErrorMsg(null); setSuccessMsg(null) }} className="text-xs text-[#9D1B1B] hover:underline cursor-pointer">
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
              <input type="password" required className="input-auth" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}
          
          <button type="submit" disabled={loading} className="w-full bg-[#9D1B1B] hover:bg-[#7E1515] text-white py-2.5 rounded-lg font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-900/10 cursor-pointer disabled:cursor-not-allowed">
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (
              view === 'sign-in' ? 'Ingresar' :
              view === 'sign-up' ? 'Registrarse' : 'Enviar Link de Recuperación'
            )}
          </button>
        </form>
        
        <div className="mt-6 text-center text-sm space-y-2">
          {view === 'forgot-password' ? (
            <button onClick={() => setView('sign-in')} className="text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 mx-auto cursor-pointer">
              <ArrowLeft size={14}/> Volver al Login
            </button>
          ) : (
            <button onClick={() => { setView(view === 'sign-in' ? 'sign-up' : 'sign-in'); setErrorMsg(null); setSuccessMsg(null) }} className="text-slate-500 hover:text-[#9D1B1B] underline cursor-pointer">
              {view === 'sign-in' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
            </button>
          )}
        </div>
      </div>
      <style jsx>{`
        .input-auth { @apply w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#9D1B1B] outline-none text-slate-900 transition-all; }
      `}</style>
    </div>
  )
}
