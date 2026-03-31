"use client"
import { useEffect, useState } from 'react'
import AdminNav from '@/components/admin/AdminNav'
import { Lock } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [isVerified, setIsVerified] = useState(false)
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sessionPin = typeof window !== 'undefined' ? sessionStorage.getItem('admin_pin_verified') : null
    if (sessionPin === 'true') setIsVerified(true)
    setLoading(false)
  }, [])

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pin === '1234') {
      setIsVerified(true)
      sessionStorage.setItem('admin_pin_verified', 'true')
    } else {
      alert('PIN Incorrecto')
      setPin('')
    }
  }

  if (loading) return null

  if (!isVerified) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-2xl max-w-sm w-full text-center">
          <div className="mx-auto bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mb-4 text-red-600">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-slate-800">Acceso Restringido</h2>
          <p className="text-slate-500 mb-6">Ingresa el PIN de seguridad del sistema.</p>
          <form onSubmit={handlePinSubmit}>
            <input
              type="password"
              className="w-full text-center text-2xl tracking-widest p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#E91E63] outline-none mb-4"
              maxLength={4}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
            />
            <button className="w-full bg-[#E91E63] text-white py-3 rounded-lg font-bold hover:bg-[#D81B60]">
              Desbloquear Panel
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminNav />
      <div className="container mx-auto py-8">
        {children}
      </div>
    </div>
  )
}

