'use server'

import { createGuardedServerClient as createServerClient } from '@/lib/supabase/guarded-constructors'
import { cookies } from 'next/headers'

type ActionResult = { success: true } | { success: false; error: string }

async function getAdminClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set() {},
        remove() {},
      },
    },
  )
}

async function callRpc(name: string, params: Record<string, unknown>): Promise<ActionResult> {
  try {
    const supabase = await getAdminClient()
    const { error } = await supabase.rpc(name, params)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo completar la operación.' }
  }
}

export async function cancelOrder(orderId: string, restock = true, refundCredits = true) {
  return callRpc('cancel_order_atomic', {
    order_id_input: orderId,
    restock_input: restock,
    refund_credits_input: refundCredits,
  })
}

export async function refundOrder(orderId: string, restock = true, creditAmount = 0) {
  return callRpc('refund_order_atomic', {
    order_id_input: orderId,
    restock_input: restock,
    credit_amount_input: Math.max(0, Number(creditAmount || 0)),
  })
}

export async function removeOrderItem(orderItemId: string, quantity = 1, restock = true) {
  return callRpc('remove_order_item_atomic', {
    order_item_id_input: orderItemId,
    quantity_input: Math.max(1, Math.floor(Number(quantity || 1))),
    restock_input: restock,
  })
}
