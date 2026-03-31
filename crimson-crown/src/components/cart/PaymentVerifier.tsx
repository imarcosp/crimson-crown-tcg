"use client"

import { useEffect, useState } from 'react'
import { forceVerifyPayment } from '@/app/actions/verify-payment'

export default function PaymentVerifier({ orderId, isMercadoPago }: { orderId: string, isMercadoPago: boolean }) {
    const [verifying, setVerifying] = useState(isMercadoPago)
    const [verified, setVerified] = useState(false)

    useEffect(() => {
        if (!isMercadoPago) return

        let mounted = true
        
        const verify = async () => {
            try {
                // Hacemos la llamada a la Server Action
                const res = await forceVerifyPayment(orderId)
                if (mounted) {
                    setVerifying(false)
                    setVerified(res.status === 'paid')
                }
            } catch (e) {
                if (mounted) setVerifying(false)
            }
        }

        // Le damos 2 segundos al webhook para que intente llegar primero
        const timer = setTimeout(() => {
            verify()
        }, 2000)

        return () => {
            mounted = false
            clearTimeout(timer)
        }
    }, [orderId, isMercadoPago])

    if (!isMercadoPago) return null

    if (verifying) {
        return (
            <div className="bg-blue-50 border border-blue-100 text-blue-700 text-xs p-3 rounded-lg mb-6 flex items-center justify-center gap-2 animate-pulse">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                Verificando estado del pago con Mercado Pago...
            </div>
        )
    }

    if (verified) {
        return (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs p-3 rounded-lg mb-6 font-bold flex items-center justify-center gap-2">
                ✅ ¡Pago de Mercado Pago confirmado!
            </div>
        )
    }

    return null
}
