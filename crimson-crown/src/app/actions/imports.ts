'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  finalizePaymentProofCore,
  parseProofUploadReference,
} from '@/lib/storage/proof-finalization-core'
import { verifyTrustedUploadedObject } from '@/lib/storage/upload-server'
import { normalizeProofRecordId } from '@/lib/storage/upload-policy'

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

export async function deleteImportItemAction(itemId: unknown, orderId: unknown) {
  try {
    const normalizedItemId = normalizeProofRecordId('import-proof', itemId)
    const normalizedOrderId = normalizeProofRecordId('import-proof', orderId)
    const user = await authenticatedUser()
    const admin = createAdminClient()
    const { error } = await admin.rpc('delete_import_item_atomic', {
      item_id_input: normalizedItemId,
      order_id_input: normalizedOrderId,
      user_id_input: user.id,
    })
    if (error) throw new Error('No se pudo eliminar el artículo.')
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
  if (items.length < 1) throw new Error(FINALIZE_ERROR_MESSAGE)
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
  const rounded = roundCurrency(total)
  if (!Number.isFinite(rounded) || rounded <= 0) throw new Error(FINALIZE_ERROR_MESSAGE)
  return rounded
}

type ImportFinalizationContext = Readonly<{
  orderId: string
  userId: string
  credits: number
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
          const orderResult = await admin
            .from('import_orders')
            .select('id, user_id, status')
            .eq('id', normalizedOrderId)
            .maybeSingle()
          const order = orderResult.data
          if (
            orderResult.error ||
            !order ||
            order.user_id !== user.id ||
            order.status !== 'Cotizada'
          ) {
            throw new Error(FINALIZE_ERROR_MESSAGE)
          }

          const [itemsResult, profileResult] = await Promise.all([
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
          if (
            itemsResult.error ||
            profileResult.error ||
            !profileResult.data
          ) {
            throw new Error(FINALIZE_ERROR_MESSAGE)
          }

          const total = quotedTotal((itemsResult.data ?? []) as Array<Record<string, unknown>>)
          const availableCredits = Number(profileResult.data?.credits ?? 0)
          if (
            !Number.isFinite(availableCredits) ||
            availableCredits < credits ||
            credits > total
          ) {
            throw new Error(FINALIZE_ERROR_MESSAGE)
          }
          const fullyPaidWithCredits = credits === total

          return Object.freeze({
            actorUserId: user.id,
            proofRequired: !fullyPaidWithCredits,
            context: Object.freeze({
              orderId: normalizedOrderId,
              userId: user.id,
              credits,
            }),
          })
        },
        verify: verifyTrustedUploadedObject,
        persist: async (context, proofPath) => {
          const admin = createAdminClient()
          const { error } = await admin.rpc('approve_import_quote_atomic', {
            order_id_input: context.orderId,
            user_id_input: context.userId,
            proof_path_input: proofPath,
            credits_input: context.credits,
          })
          if (error) throw new Error(FINALIZE_ERROR_MESSAGE)
        },
      },
    )

    return Object.freeze({ success: true, proofPath: result.proofPath })
  } catch {
    return Object.freeze({ success: false, error: FINALIZE_ERROR_MESSAGE })
  }
}
