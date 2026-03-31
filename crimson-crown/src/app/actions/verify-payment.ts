"use server"

import { MercadoPagoConfig, Payment } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'

const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || '' 
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function forceVerifyPayment(orderId: string) {
    try {
        console.log(`[Force Verify] Buscando orden ${orderId} en Mercado Pago...`)
        
        // 1. Verificar si la orden ya está pagada en Supabase (para no gastar peticiones a MP)
        const { data: order } = await supabase.from('orders').select('status, delivery_method').eq('id', orderId).single()
        if (order?.status === 'paid') return { success: true, status: 'paid' }
        if (!order?.delivery_method?.includes('Mercado Pago')) return { success: false, error: 'Not MP' }

        // 2. Buscar en Mercado Pago todos los pagos asociados a este external_reference (orderId)
        const paymentClient = new Payment(client)
        const searchResult = await paymentClient.search({
            options: {
                external_reference: orderId,
                status: 'approved'
            }
        })

        // 3. Si hay al menos un pago aprobado para esta orden, la forzamos a pagada
        if (searchResult.results && searchResult.results.length > 0) {
            const latestPayment = searchResult.results[0]
            
            await supabase
                .from('orders')
                .update({ 
                    status: 'paid',
                    delivery_notes: `Pago confirmado (Verificación Forzada) (Ref: ${latestPayment.id})`
                })
                .eq('id', orderId)
                .eq('status', 'pending_payment')

            console.log(`✅ [Force Verify] Orden ${orderId} marcada como PAGADA.`)
            return { success: true, status: 'paid' }
        }

        return { success: true, status: 'pending' }

    } catch (error: any) {
        console.error('[Force Verify] Error:', error)
        return { success: false, error: error.message }
    }
}
