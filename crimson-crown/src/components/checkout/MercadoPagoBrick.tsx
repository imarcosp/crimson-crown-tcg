"use client"
import { useEffect, useState } from 'react'
import { initMercadoPago, Payment } from '@mercadopago/sdk-react'
import { Loader2 } from 'lucide-react'

// Inicializar Mercado Pago con la Public Key
// Es importante que la Public Key esté expuesta en el cliente (NEXT_PUBLIC_)
const mpPublicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY || ''
if (mpPublicKey) {
  initMercadoPago(mpPublicKey, { locale: 'es-AR' })
}

type Props = {
  amount: number
  onPaymentSuccess?: (paymentId: string) => void
  onPaymentError?: (error: string) => void
}

export default function MercadoPagoBrick({ amount, onPaymentSuccess, onPaymentError }: Props) {
  const [isReady, setIsReady] = useState(false)

  // Asegurarnos de que el Brick solo se renderice en el cliente
  useEffect(() => {
    setIsReady(true)
  }, [])

  const initialization = {
    amount: amount,
    // preferenceId: '<PREFERENCE_ID>', // Opcional: Si quieres usar una preferencia creada en el backend
  }

  const customization = {
    paymentMethods: {
      creditCard: 'all' as const,
      debitCard: 'all' as const,
      mercadoPago: 'all' as const,
      // Los tickets (PagoFácil, Rapipago) se omiten para evitar pagos diferidos
    },
    visual: {
      style: {
        theme: 'default' as const, // Puedes usar 'dark' o 'bootstrap'
      },
    },
  }

  const onSubmit = async (formData: any) => {
    try {
      // El Brick de MP a veces envía los datos directamente en formData, 
      // o agrupados en formData.formData. Por seguridad, extraemos lo correcto.
      const payload = formData.formData || formData

      // Si el Brick no envió el transaction_amount (raro, pero posible en algunos métodos), 
      // lo inyectamos nosotros para asegurar que el backend no falle.
      if (!payload.transaction_amount) {
        payload.transaction_amount = amount
      }

      // Realizamos el POST a nuestro endpoint backend
      const response = await fetch('/api/checkout/process-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok || data.status === 'rejected') {
        // Mapear los errores más comunes de Mercado Pago a mensajes amigables
        let friendlyError = data.status_detail || 'Error procesando el pago'
        switch (data.status_detail) {
          case 'cc_rejected_other_reason':
            friendlyError = 'Mercado Pago rechazó el pago. (Si estás en pruebas, usa otra tarjeta o un email distinto al del vendedor).'
            break
          case 'cc_rejected_call_for_authorize':
            friendlyError = 'Debes autorizar el pago con la emisora de tu tarjeta.'
            break
          case 'cc_rejected_insufficient_amount':
            friendlyError = 'Tu tarjeta no tiene fondos suficientes.'
            break
          case 'cc_rejected_bad_filled_security_code':
            friendlyError = 'Código de seguridad incorrecto.'
            break
          case 'cc_rejected_bad_filled_date':
            friendlyError = 'Fecha de vencimiento incorrecta.'
            break
          case 'cc_rejected_bad_filled_other':
            friendlyError = 'Revisa los datos de la tarjeta.'
            break
        }
        throw new Error(friendlyError)
      }

      // Si es exitoso
      if (onPaymentSuccess) {
        onPaymentSuccess(data.id)
      }
      
    } catch (error: any) {
      console.error("Error en onSubmit:", error)
      if (onPaymentError) {
        onPaymentError(error.message)
      }
    }
  }

  const onError = async (error: any) => {
    // callback llamado para todos los casos de error de Brick
    console.error("Error en Brick de Mercado Pago:", error)
  }

  const onReady = async () => {
    /*
      Callback llamado cuando el Brick está listo.
      Aquí puedes ocultar loadings de tu sitio, por ejemplo.
    */
    console.log("Mercado Pago Brick listo")
  }

  if (!isReady) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-slate-400" /></div>
  }

  if (!mpPublicKey) {
    return <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">Falta la clave pública de Mercado Pago.</div>
  }

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <Payment
        initialization={initialization}
        customization={customization}
        onSubmit={onSubmit}
        onReady={onReady}
        onError={onError}
      />
    </div>
  )
}
