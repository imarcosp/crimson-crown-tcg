import { NextResponse } from 'next/server'
import { createGuardedSupabaseClient as createClient } from '@/lib/supabase/guarded-constructors'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  try {
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

    // La RPC bloquea cada orden y producto dentro de una única transacción.
    // Así dos invocaciones concurrentes no pueden devolver stock dos veces.
    const { data: cancelledCount, error } = await supabase.rpc('release_expired_orders_atomic', {
      p_age_minutes: 15,
      p_payment_marker: 'Mercado Pago',
    })
    if (error) throw error

    const count = Number(cancelledCount || 0)
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('La RPC devolvió una cantidad de cancelaciones inválida.')
    }

    if (count === 0) {
      return NextResponse.json({ message: 'No hay órdenes vencidas para procesar.' })
    }

    return NextResponse.json({
      success: true,
      message: `Limpieza completada. Órdenes canceladas y stock restaurado: ${count}`,
    })
  } catch (error: any) {
    console.error('Error en Cron Job de liberación de stock:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
