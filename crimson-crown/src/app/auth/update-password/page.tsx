"use client"
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock, AlertCircle, CheckCircle } from 'lucide-react'

function UpdatePasswordContent() {
  const router = useRouter()
  const supabase = createClient()
  
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [msg, setMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null)

  // El callback server-side ya canjeó el código PKCE y escribió la sesión.
  useEffect(() => {
    const verifyRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        setVerifying(false)
        return
      }

      setMsg({ type: 'error', text: 'El enlace ha expirado o ya fue utilizado.' })
      setVerifying(false)
    }

    void verifyRecoverySession()
  }, [supabase])

  // 2. ACTUALIZAR CONTRASEÑA
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg(null)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      await supabase.auth.signOut()
      setMsg({ type: 'success', text: '¡Contraseña actualizada! Ya puedes iniciar sesión.' })
      router.replace('/login?password=updated')
    } catch (error: unknown) {
      setMsg({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo actualizar la contraseña.',
      })
    } finally {
      setLoading(false)
    }
  }

  if (verifying) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <Loader2 className="w-10 h-10 animate-spin text-[#9D1B1B] mb-4" />
        <p className="text-slate-500 font-medium">Verificando enlace de seguridad...</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-slate-200">
      <h1 className="text-2xl font-bold text-center mb-6 text-slate-800 flex items-center justify-center gap-2">
        <Lock className="text-[#9D1B1B]" /> Nueva Contraseña
      </h1>
      
      {msg && (
        <div className={`p-4 rounded-lg text-sm mb-6 border flex items-start gap-3 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
          {msg.type === 'success' ? <CheckCircle size={18} className="shrink-0 mt-0.5"/> : <AlertCircle size={18} className="shrink-0 mt-0.5"/>}
          <span className="font-medium">{msg.text}</span>
        </div>
      )}

      {/* Solo mostramos el formulario si no hubo error crítico de sesión */}
      {(!msg || msg.type === 'success') && (
        <form onSubmit={handleUpdate} className="space-y-5">
          <div>
            <label htmlFor="new-password" className="block text-sm font-bold text-slate-700 mb-2">Ingresa tu nueva contraseña</label>
            <input 
              id="new-password"
              type="password" 
              required 
              minLength={6}
              className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#9D1B1B] outline-none text-slate-900 transition-all shadow-sm"
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Mínimo 6 caracteres" 
            />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-[#9D1B1B] hover:bg-[#7E1515] text-white py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-900/10 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed">
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Actualizar Contraseña'}
          </button>
        </form>
      )}
      
      {msg?.type === 'error' && (
          <button onClick={() => router.push('/login')} className="w-full mt-4 text-slate-500 font-bold hover:text-slate-800 text-sm">
              Volver al Login
          </button>
      )}
    </div>
  )
}

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <UpdatePasswordContent />
    </div>
  )
}
