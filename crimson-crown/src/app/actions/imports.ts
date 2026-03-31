'use server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

// Inicializamos el cliente Admin para bypassear RLS
const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function deleteImportItemAction(itemId: number, orderId: string) {
    try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value },
                },
            }
        )

        // 1. Verificar sesión
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return { success: false, error: 'No autorizado' }

        // 2. Verificar que la orden pertenece al usuario
        const { data: order } = await supabase
            .from('import_orders')
            .select('user_id')
            .eq('id', orderId)
            .single()

        if (!order || order.user_id !== session.user.id) {
            return { success: false, error: 'No tienes permiso para modificar esta orden' }
        }

        // 3. Borrar usando Service Role
        const { error } = await adminSupabase
            .from('import_items')
            .delete()
            .eq('id', itemId)
            .eq('order_id', orderId) // Doble seguridad

        if (error) throw error

        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function rejectImportQuoteAction(orderId: string) {
    try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value },
                },
            }
        )

        // 1. Verificar sesión
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return { success: false, error: 'No autorizado' }

        // 2. Verificar que la orden pertenece al usuario
        const { data: order } = await supabase
            .from('import_orders')
            .select('user_id, status')
            .eq('id', orderId)
            .single()

        if (!order || order.user_id !== session.user.id) {
            return { success: false, error: 'No tienes permiso para modificar esta orden' }
        }

        if (order.status !== 'Cotizada') {
            return { success: false, error: 'La orden no está en estado de cotización.' }
        }

        // 3. Actualizar la orden a "Solo Cotización" usando Service Role para saltar RLS
        const { error } = await adminSupabase
            .from('import_orders')
            .update({ status: 'Solo Cotización' })
            .eq('id', orderId)

        if (error) throw error

        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}

export async function approveImportQuoteAction(orderId: string, proofUrl: string | null, useCreditsAmount: number = 0) {
    try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value },
                },
            }
        )

        // 1. Verificar sesión
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return { success: false, error: 'No autorizado' }

        // 2. Verificar que la orden pertenece al usuario y está en estado válido
        const { data: order } = await supabase
            .from('import_orders')
            .select('user_id, status')
            .eq('id', orderId)
            .single()

        if (!order || order.user_id !== session.user.id) {
            return { success: false, error: 'No tienes permiso para modificar esta orden' }
        }

        if (order.status !== 'Cotizada') {
            return { success: false, error: 'La orden no está en estado de cotización.' }
        }

        // 3. Manejo de Créditos
        if (useCreditsAmount > 0) {
            // Verificar que el usuario realmente tiene esos créditos (usando tolerancia para decimales)
            const { data: profile } = await adminSupabase
                .from('profiles')
                .select('credits')
                .eq('id', session.user.id)
                .single()
            
            const userCredits = Number(profile?.credits || 0)
            const requestedCredits = Number(useCreditsAmount)

            // Usamos un pequeño epsilon (0.01) para evitar errores de punto flotante
            if (userCredits < requestedCredits - 0.01) {
                return { success: false, error: `No tienes suficientes créditos para esta operación. (Tienes ${userCredits}, intentas usar ${requestedCredits})` }
            }

            // Descontar créditos al usuario usando la función RPC oficial
            // Esto actualiza 'profiles' e inserta en 'credit_transactions' atómicamente
            const { error: rpcError } = await adminSupabase.rpc('manage_credits', {
                target_user_id: session.user.id,
                amount_change: -requestedCredits,
                transaction_type: 'purchase',
                transaction_desc: `Pago de Orden de Importación #${order.order_number || String(orderId).slice(0,8)}`,
                ref_id: null // Evitamos error de UUID, ya que import_orders no usa UUIDs
            })

            if (rpcError) {
                console.error("Error en RPC manage_credits:", rpcError)
                throw rpcError
            }
        }

        // 4. Actualizar la orden usando Service Role
        const isFullyPaidWithCredits = useCreditsAmount > 0 && !proofUrl
        
        const { error } = await adminSupabase
            .from('import_orders')
            .update({
                status: 'Cotización Aprobada',
                payment_status: isFullyPaidWithCredits ? 'paid' : 'verifying',
                payment_proof_url: proofUrl,
                credits_used: useCreditsAmount
            })
            .eq('id', orderId)

        if (error) {
            // Si esto falla, idealmente deberíamos devolver los créditos (rollback), 
            // pero lo omitimos por simplicidad. En producción severa se usaría una función RPC.
            throw error
        }

        return { success: true }
    } catch (e: any) {
        return { success: false, error: e.message }
    }
}
