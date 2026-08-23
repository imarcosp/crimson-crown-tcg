import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Inicializamos con el Service Role Key para tener permisos de administrador y saltar RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        // Validar seguridad: Solo Vercel Cron u otra llave secreta debería llamar esto
        const authHeader = req.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
        const isLoopback = (() => {
            try {
                const hostname = new URL(supabaseUrl).hostname
                return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
            } catch {
                return false
            }
        })()

        // En producción, la ausencia de CRON_SECRET debe fallar cerrado. Sólo
        // permitimos llamadas sin secreto contra Supabase local.
        if (!cronSecret && !isLoopback) {
            return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 })
        }
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        // Buscamos órdenes que tengan más de 15 minutos y sigan pending_payment con método Mercado Pago
        const expirationTime = new Date(Date.now() - 15 * 60 * 1000).toISOString()

        const { data: expiredOrders, error: fetchError } = await supabase
            .from('orders')
            .select('id, delivery_method')
            .eq('status', 'pending_payment')
            .lte('created_at', expirationTime)
            .ilike('delivery_method', '%Mercado Pago%')

        if (fetchError) throw fetchError

        if (!expiredOrders || expiredOrders.length === 0) {
            return NextResponse.json({ message: 'No hay órdenes vencidas para procesar.' })
        }

        let cancelledCount = 0

        // Iteramos sobre las órdenes vencidas
        for (const order of expiredOrders) {
            // 1. Buscamos los items de esta orden
            const { data: items } = await supabase
                .from('order_items')
                .select('product_id, quantity')
                .eq('order_id', order.id)

            if (items && items.length > 0) {
                // 2. Devolvemos el stock a cada producto
                for (const item of items) {
                    const { data: product } = await supabase
                        .from('products')
                        .select('stock')
                        .eq('id', item.product_id)
                        .single()

                    if (product) {
                        await supabase
                            .from('products')
                            .update({ stock: product.stock + item.quantity })
                            .eq('id', item.product_id)
                    }
                }
            }

            // 3. Marcamos la orden como cancelada y dejamos una nota
            await supabase
                .from('orders')
                .update({ 
                    status: 'cancelled',
                    delivery_notes: 'Cancelada automáticamente por abandono de pago en Mercado Pago.'
                })
                .eq('id', order.id)

            cancelledCount++
        }

        return NextResponse.json({ 
            success: true, 
            message: `Limpieza completada. Órdenes canceladas y stock restaurado: ${cancelledCount}` 
        })

    } catch (error: any) {
        console.error("Error en Cron Job de liberación de stock:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
