"use client"
import { useEffect, useState } from 'react'
import { initMercadoPago, Wallet } from '@mercadopago/sdk-react'
import { Loader2 } from 'lucide-react'

const mpPublicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || ''
if (mpPublicKey) {
  initMercadoPago(mpPublicKey, { locale: 'es-AR' })
}

type Props = {
  amount: number
}

export default function MercadoPagoWallet({ amount }: Props) {
  const [preferenceId, setPreferenceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Cuando el componente carga, pedimos la preferencia al backend
    const createPreference = async () => {
      try {
        const res = await fetch('/api/checkout/create-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, description: 'Compra de prueba' })
        })
        const data = await res.json()
        if (data.id) {
          setPreferenceId(data.id)
        }
      } catch (e) {
        console.error("Error pidiendo preferencia:", e)
      } finally {
        setLoading(false)
      }
    }

    createPreference()
  }, [amount])

  if (!mpPublicKey) {
    return <div className="text-red-500 text-sm">Falta la clave pública de MP</div>
  }

  if (loading) {
    return <div className="flex justify-center p-4"><Loader2 className="animate-spin text-blue-500" /></div>
  }

  if (!preferenceId) {
    return <div className="text-red-500 text-sm">Error al cargar el botón de pago.</div>
  }

  return (
    <div className="w-full">
      {/* Wallet renderiza el botón azul clásico de Mercado Pago */}
      <Wallet 
        initialization={{ preferenceId: preferenceId, redirectMode: 'self' }}
        customization={{ valueProp: 'security_details' }}
      />
    </div>
  )
}
