'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  finalizePaymentProofCore,
  parseProofUploadReference,
} from '@/lib/storage/proof-finalization-core'
import { verifyTrustedUploadedObject } from '@/lib/storage/upload-server'

const FINALIZE_ERROR_MESSAGE = 'No se pudo finalizar el comprobante.'

async function authenticatedUser() {
  const supabase = await createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new Error('No autorizado')
  return user
}

export async function deleteImportItemAction(itemId: number, orderId: string) {
  try {
    const user = await authenticatedUser()
    const admin = createAdminClient()
    const { data: order, error: orderError } = await admin
      .from('import_orders')
      .select('user_id')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError || !order || order.user_id !== user.id) {
      return { success: false, error: 'No tienes permiso para modificar esta orden' }
    }

    const { error } = await admin
      .from('import_items')
      .delete()
      .eq('id', itemId)
      .eq('order_id', orderId)
    if (error) throw error
    return { success: true }
  } catch {
    return { success: false, error: 'No se pudo eliminar el artículo.' }
  }
}

export async function rejectImportQuoteAction(orderId: string) {
  try {
    const user = await authenticatedUser()
    const admin = createAdminClient()
    const { data: order, error: orderError } = await admin
      .from('import_orders')
      .select('user_id, status')
      .eq('id', orderId)
      .maybeSingle()

    if (orderError || !order || order.user_id !== user.id) {
      return { success: false, error: 'No tienes permiso para modificar esta orden' }
    }
    if (order.status !== 'Cotizada') {
      return { success: false, error: 'La orden no está en estado de cotización.' }
    }

    const { error } = await admin
      .from('import_orders')
      .update({ status: 'Solo Cotización' })
      .eq('id', orderId)
    if (error) throw error
    return { success: true }
  } catch {
    return { success: false, error: 'No se pudo rechazar la cotización.' }
  }
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function quotedTotal(items: ReadonlyArray<Record<string, unknown>>): number {
  const total = items.reduce((sum, item) => {
    const unitPrice = Number(item.unit_price ?? 0)
    const taxPercent = Number(item.tax_percent ?? 0)
    const shipping = Number(item.shipping_cost ?? 0)
    const quantity = Number(item.quantity ?? 1)
    if (
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(taxPercent) ||
      !Number.isFinite(shipping) ||
      !Number.isSafeInteger(quantity) ||
      unitPrice < 0 ||
      taxPercent < 0 ||
      shipping < 0 ||
      quantity <= 0
    ) {
      throw new Error(FINALIZE_ERROR_MESSAGE)
    }
    return sum + (unitPrice * (1 + taxPercent / 100) + shipping) * quantity
  }, 0)
  if (!Number.isFinite(total) || total < 0) throw new Error(FINALIZE_ERROR_MESSAGE)
  return roundCurrency(total)
}

type ImportFinalizationContext = Readonly<{
  orderId: string
  orderNumber: string | null
  userId: string
  credits: number
  fullyPaidWithCredits: boolean
}>

export async function approveImportQuoteAction(
  orderId: unknown,
  proofInput: unknown,
  useCreditsAmount: unknown = 0,
): Promise<Readonly<{ success: true; proofPath: string | null }> | Readonly<{ success: false; error: string }>> {
  try {
    if (typeof orderId !== 'string') throw new Error(FINALIZE_ERROR_MESSAGE)
    if (typeof useCreditsAmount !== 'number') throw new Error(FINALIZE_ERROR_MESSAGE)
    const requestedCredits = useCreditsAmount
    if (!Number.isFinite(requestedCredits) || requestedCredits < 0) {
      throw new Error(FINALIZE_ERROR_MESSAGE)
    }
    const credits = roundCurrency(requestedCredits)
    if (Math.abs(credits - requestedCredits) > 0.01) throw new Error(FINALIZE_ERROR_MESSAGE)
    const proof = proofInput === null ? null : parseProofUploadReference(proofInput)

    const result = await finalizePaymentProofCore<ImportFinalizationContext>(
      { kind: 'import-proof', recordId: orderId, proof },
      {
        authorize: async (_kind, normalizedOrderId) => {
          const user = await authenticatedUser()
          const admin = createAdminClient()
          const [orderResult, itemsResult, profileResult] = await Promise.all([
            admin
              .from('import_orders')
              .select('id, user_id, status, order_number')
              .eq('id', normalizedOrderId)
              .maybeSingle(),
            admin
              .from('import_items')
              .select('unit_price, tax_percent, shipping_cost, quantity')
              .eq('order_id', normalizedOrderId),
            admin
              .from('profiles')
              .select('credits')
              .eq('id', user.id)
              .maybeSingle(),
          ])
          const order = orderResult.data
          if (
            orderResult.error ||
            itemsResult.error ||
            profileResult.error ||
            !order ||
            order.user_id !== user.id ||
            order.status !== 'Cotizada'
          ) {
            throw new Error(FINALIZE_ERROR_MESSAGE)
          }

          const total = quotedTotal((itemsResult.data ?? []) as Array<Record<string, unknown>>)
          const availableCredits = Number(profileResult.data?.credits ?? 0)
          if (
            !Number.isFinite(availableCredits) ||
            availableCredits < credits - 0.01 ||
            credits > total + 0.01
          ) {
            throw new Error(FINALIZE_ERROR_MESSAGE)
          }
          const fullyPaidWithCredits = total - credits <= 0.01

          return Object.freeze({
            actorUserId: user.id,
            proofRequired: !fullyPaidWithCredits,
            context: Object.freeze({
              orderId: normalizedOrderId,
              orderNumber: typeof order.order_number === 'string' ? order.order_number : null,
              userId: user.id,
              credits,
              fullyPaidWithCredits,
            }),
          })
        },
        verify: verifyTrustedUploadedObject,
        persist: async (context, proofPath) => {
          const admin = createAdminClient()
          if (context.credits > 0) {
            const { error: creditsError } = await admin.rpc('manage_credits', {
              target_user_id: context.userId,
              amount_change: -context.credits,
              transaction_type: 'purchase',
              transaction_desc: `Pago de Orden de Importación #${context.orderNumber ?? context.orderId}`,
              ref_id: null,
            })
            if (creditsError) throw new Error(FINALIZE_ERROR_MESSAGE)
          }

          const { error } = await admin
            .from('import_orders')
            .update({
              status: 'Cotización Aprobada',
              payment_status: context.fullyPaidWithCredits ? 'paid' : 'verifying',
              payment_proof_path: proofPath,
              credits_used: context.credits,
            })
            .eq('id', context.orderId)
            .eq('user_id', context.userId)
            .eq('status', 'Cotizada')
          if (error) throw new Error(FINALIZE_ERROR_MESSAGE)
        },
      },
    )

    return Object.freeze({ success: true, proofPath: result.proofPath })
  } catch {
    return Object.freeze({ success: false, error: FINALIZE_ERROR_MESSAGE })
  }
}
