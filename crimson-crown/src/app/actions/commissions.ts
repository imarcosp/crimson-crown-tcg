"use server"

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server'
import { ADMIN_EMAILS, OWNER_ADMIN_EMAIL } from '@/lib/constants'
import { COMMISSION_START_PERIOD_KEY, getCurrentCommissionMonthKey } from '@/lib/commissions'
import { siteConfig } from '@/config/site'
import { getResendClient } from '@/lib/email/resend-client'
import {
  finalizePaymentProofCore,
  parseProofUploadReference,
} from '@/lib/storage/proof-finalization-core'
import { verifyTrustedUploadedObject } from '@/lib/storage/upload-server'

type PaymentInput = {
  periodId: string
  currency: 'USD' | 'ARS'
  amount: number
  fxRateArs?: number | null
  paymentMethod: string
  reference?: string
  notes?: string
  proof?: unknown
  paidAt: string
}

type AdjustmentInput = {
  periodId: string
  direction: 'debit' | 'credit'
  amountUsd: number
  reason: string
  notes?: string
}


function createServiceRoleClient() {
  return createAdminClient()
}

async function requireCommissionAdmin(ownerOnly = false) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user?.email || !ADMIN_EMAILS.includes(user.email)) {
    throw new Error('No autorizado para operar con comisiones.')
  }

  if (ownerOnly && user.email !== OWNER_ADMIN_EMAIL) {
    throw new Error('Solo el admin propietario puede realizar esta acción.')
  }

  return user
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function actionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

async function getPeriodKey(admin: ReturnType<typeof createServiceRoleClient>, periodId: string) {
  const { data, error } = await admin
    .from('commission_periods')
    .select('id, period_key')
    .eq('id', periodId)
    .single()

  if (error) throw error

  return data.period_key as string
}

function assertCommissionPeriodAllowed(periodKey: string) {
  if (!periodKey || periodKey < COMMISSION_START_PERIOD_KEY) {
    throw new Error(`Las comisiones solo están habilitadas desde ${COMMISSION_START_PERIOD_KEY}.`)
  }
}

async function getPeriodBalances(admin: ReturnType<typeof createServiceRoleClient>, maxPeriodKey?: string) {
  if (maxPeriodKey && maxPeriodKey < COMMISSION_START_PERIOD_KEY) {
    return []
  }

  let periodsQuery = admin
    .from('commission_periods')
    .select('id, period_key, total_due_usd, status, locked_at')
    .gte('period_key', COMMISSION_START_PERIOD_KEY)
    .order('period_key', { ascending: true })

  if (maxPeriodKey) {
    periodsQuery = periodsQuery.lte('period_key', maxPeriodKey)
  }

  const { data: periods, error: periodsError } = await periodsQuery
  if (periodsError) throw periodsError

  if (!periods?.length) return []

  const periodIds = periods.map((period) => period.id)

  const [{ data: adjustments, error: adjustmentsError }, { data: allocations, error: allocationsError }] = await Promise.all([
    admin
      .from('commission_adjustments')
      .select('period_id, direction, amount_usd')
      .in('period_id', periodIds),
    admin
      .from('commission_payment_allocations')
      .select('period_id, amount_usd')
      .in('period_id', periodIds),
  ])

  if (adjustmentsError) throw adjustmentsError
  if (allocationsError) throw allocationsError

  const adjustmentsByPeriod = new Map<string, number>()
  for (const adjustment of adjustments || []) {
    const current = adjustmentsByPeriod.get(adjustment.period_id) || 0
    const signed = adjustment.direction === 'debit'
      ? Number(adjustment.amount_usd || 0)
      : -Number(adjustment.amount_usd || 0)
    adjustmentsByPeriod.set(adjustment.period_id, roundCurrency(current + signed))
  }

  const allocationsByPeriod = new Map<string, number>()
  for (const allocation of allocations || []) {
    const current = allocationsByPeriod.get(allocation.period_id) || 0
    allocationsByPeriod.set(
      allocation.period_id,
      roundCurrency(current + Number(allocation.amount_usd || 0))
    )
  }

  return periods.map((period) => {
    const baseDue = Number(period.total_due_usd || 0)
    const adjustmentsTotal = adjustmentsByPeriod.get(period.id) || 0
    const allocatedTotal = allocationsByPeriod.get(period.id) || 0
    const effectiveDue = roundCurrency(baseDue + adjustmentsTotal)
    const outstandingUsd = roundCurrency(effectiveDue - allocatedTotal)

    return {
      ...period,
      baseDue,
      adjustmentsTotal,
      allocatedTotal,
      effectiveDue,
      outstandingUsd,
    }
  })
}

async function allocateConfirmedPayment(
  admin: ReturnType<typeof createServiceRoleClient>,
  paymentId: string
) {
  const { data: payment, error: paymentError } = await admin
    .from('commission_payments')
    .select('id, period_id, amount_usd')
    .eq('id', paymentId)
    .single()

  if (paymentError) throw paymentError

  const maxPeriodKey = await getPeriodKey(admin, payment.period_id)
  const balances = await getPeriodBalances(admin, maxPeriodKey)

  const { error: deleteError } = await admin
    .from('commission_payment_allocations')
    .delete()
    .eq('payment_id', paymentId)

  if (deleteError) throw deleteError

  let remaining = Number(payment.amount_usd || 0)
  const allocationsToInsert: Array<{ payment_id: string; period_id: string; amount_usd: number }> = []

  for (const period of balances) {
    if (remaining <= 0) break
    if (period.outstandingUsd <= 0) continue

    const applied = Math.min(period.outstandingUsd, remaining)
    if (applied <= 0) continue

    allocationsToInsert.push({
      payment_id: paymentId,
      period_id: period.id,
      amount_usd: roundCurrency(applied),
    })

    remaining = roundCurrency(remaining - applied)
  }

  if (allocationsToInsert.length > 0) {
    const { error: insertError } = await admin
      .from('commission_payment_allocations')
      .insert(allocationsToInsert)

    if (insertError) throw insertError
  }

  const { error: updateError } = await admin
    .from('commission_payments')
    .update({
      unapplied_usd: roundCurrency(remaining),
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId)

  if (updateError) throw updateError
}

async function sendCommissionPaymentReportedEmail(params: {
  amount: number
  amountUsd: number
  currency: 'USD' | 'ARS'
  paymentMethod: string
  reference?: string
  notes?: string
  paidAt: string
  periodKey: string
}) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || siteConfig.url

  await getResendClient().emails.send({
    from: `${siteConfig.shortName} <ventas@crimsoncrown.com>`,
    to: OWNER_ADMIN_EMAIL,
    subject: `💸 Pago de comisión reportado por Epi (${params.periodKey})`,
    html: `
      <div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;">
        <h2 style="color:#0F172A;">Nuevo pago de comisión reportado</h2>
        <p>Epi reportó un pago que quedó <strong>pendiente de confirmación</strong>.</p>
        <ul style="padding-left:18px;line-height:1.6;">
          <li><strong>Período de referencia:</strong> ${params.periodKey}</li>
          <li><strong>Monto original:</strong> ${params.currency} ${params.amount.toFixed(2)}</li>
          <li><strong>Equivalente USD:</strong> US$ ${params.amountUsd.toFixed(2)}</li>
          <li><strong>Método:</strong> ${params.paymentMethod}</li>
          <li><strong>Fecha del pago:</strong> ${new Date(params.paidAt).toLocaleString('es-AR')}</li>
          ${params.reference ? `<li><strong>Referencia:</strong> ${params.reference}</li>` : ''}
          ${params.notes ? `<li><strong>Notas:</strong> ${params.notes}</li>` : ''}
        </ul>
        <div style="margin-top:24px;">
          <a href="${baseUrl}/admin/commissions" style="background:#0F172A;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Revisar comisiones</a>
        </div>
      </div>
    `,
  })
}

export async function refreshCommissionPeriodAction(periodKey: string) {
  try {
    await requireCommissionAdmin()
    assertCommissionPeriodAllowed(periodKey)

    const admin = createServiceRoleClient()
    const { data, error } = await admin.rpc('refresh_commission_period', {
      p_period_key: periodKey,
    })

    if (error) throw error

    revalidatePath('/admin/commissions')
    return { success: true, periodId: data as string | null }
  } catch (error: unknown) {
    return { success: false, error: actionErrorMessage(error, 'No se pudo actualizar el período.') }
  }
}

export async function lockCommissionPeriodAction(periodKey: string) {
  try {
    const user = await requireCommissionAdmin(true)
    assertCommissionPeriodAllowed(periodKey)

    if (!periodKey || periodKey >= getCurrentCommissionMonthKey()) {
      throw new Error('Solo puedes cerrar meses anteriores al mes actual.')
    }

    const admin = createServiceRoleClient()
    const { data: periodId, error: refreshError } = await admin.rpc('refresh_commission_period', {
      p_period_key: periodKey,
    })

    if (refreshError) throw refreshError
    if (!periodId) throw new Error('No se pudo preparar el período para cerrarlo.')

    const { data: currentPeriod, error: currentError } = await admin
      .from('commission_periods')
      .select('id, locked_at')
      .eq('id', periodId)
      .single()

    if (currentError) throw currentError

    if (!currentPeriod.locked_at) {
      const { error: lockError } = await admin
        .from('commission_periods')
        .update({
          locked_at: new Date().toISOString(),
          locked_by_user_id: user.id,
        })
        .eq('id', currentPeriod.id)

      if (lockError) throw lockError

      const { error: recalcError } = await admin.rpc('recalculate_commission_period_status', {
        p_period_id: currentPeriod.id,
      })

      if (recalcError) throw recalcError
    }

    revalidatePath('/admin/commissions')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: actionErrorMessage(error, 'No se pudo cerrar el período.') }
  }
}

type CommissionPaymentContext = Readonly<{
  periodId: string
  periodKey: string
  userId: string
  isOwner: boolean
  currency: 'USD' | 'ARS'
  amount: number
  amountUsd: number
  normalizedFxRate: number | null
  paymentMethod: string
  reference: string | null
  notes: string | null
  paidAt: string
}>

export async function reportCommissionPaymentAction(input: PaymentInput) {
  const errorMessage = 'No se pudo registrar el pago.'
  try {
    if (!input || typeof input !== 'object') throw new Error(errorMessage)
    const amount = input.amount
    const fxRateArs = input.fxRateArs == null ? null : input.fxRateArs
    const currency = input.currency
    const paymentMethod = typeof input.paymentMethod === 'string'
      ? input.paymentMethod.trim()
      : ''
    if (
      typeof input.periodId !== 'string' ||
      typeof amount !== 'number' ||
      (fxRateArs !== null && typeof fxRateArs !== 'number') ||
      !paymentMethod ||
      paymentMethod.length > 200 ||
      (input.reference !== undefined && typeof input.reference !== 'string') ||
      (input.notes !== undefined && typeof input.notes !== 'string') ||
      (input.reference?.length ?? 0) > 500 ||
      (input.notes?.length ?? 0) > 2_000 ||
      typeof input.paidAt !== 'string' ||
      input.paidAt.length > 100 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !['USD', 'ARS'].includes(currency)
    ) {
      throw new Error(errorMessage)
    }
    const paidAt = new Date(input.paidAt)
    if (Number.isNaN(paidAt.getTime())) throw new Error(errorMessage)

    let amountUsd = amount
    let normalizedFxRate: number | null = null
    if (currency === 'ARS') {
      if (!Number.isFinite(fxRateArs) || (fxRateArs || 0) <= 0) throw new Error(errorMessage)
      normalizedFxRate = fxRateArs as number
      amountUsd = amount / normalizedFxRate
    }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error(errorMessage)

    const proof = input.proof == null ? null : parseProofUploadReference(input.proof)
    const result = await finalizePaymentProofCore<CommissionPaymentContext>(
      { kind: 'commission-proof', recordId: input.periodId, proof },
      {
        authorize: async (_kind, normalizedPeriodId) => {
          const user = await requireCommissionAdmin()
          const admin = createServiceRoleClient()
          const periodKey = await getPeriodKey(admin, normalizedPeriodId)
          assertCommissionPeriodAllowed(periodKey)
          const isOwner = user.email === OWNER_ADMIN_EMAIL
          return Object.freeze({
            actorUserId: user.id,
            proofRequired: false,
            context: Object.freeze({
              periodId: normalizedPeriodId,
              periodKey,
              userId: user.id,
              isOwner,
              currency,
              amount,
              amountUsd,
              normalizedFxRate,
              paymentMethod,
              reference: input.reference?.trim() || null,
              notes: input.notes?.trim() || null,
              paidAt: paidAt.toISOString(),
            }),
          })
        },
        verify: verifyTrustedUploadedObject,
        persist: async (context, proofPath) => {
          const admin = createServiceRoleClient()
          const reviewTimestamp = context.isOwner ? new Date().toISOString() : null
          const { data: insertedPayment, error } = await admin
            .from('commission_payments')
            .insert({
              period_id: context.periodId,
              reported_by_user_id: context.userId,
              reviewed_by_user_id: context.isOwner ? context.userId : null,
              status: context.isOwner ? 'confirmed' : 'reported',
              currency: context.currency,
              amount: Number(context.amount.toFixed(2)),
              fx_rate_ars: context.normalizedFxRate
                ? Number(context.normalizedFxRate.toFixed(2))
                : null,
              amount_usd: Number(context.amountUsd.toFixed(2)),
              payment_method: context.paymentMethod,
              reference: context.reference,
              notes: context.notes,
              proof_path: proofPath,
              paid_at: context.paidAt,
              unapplied_usd: context.isOwner ? Number(context.amountUsd.toFixed(2)) : 0,
              reviewed_at: reviewTimestamp,
              updated_at: new Date().toISOString(),
            })
            .select('id, period_id')
            .single()
          if (error) throw new Error(errorMessage)

          if (context.isOwner) {
            await allocateConfirmedPayment(admin, insertedPayment.id)
          } else {
            await sendCommissionPaymentReportedEmail({
              amount: context.amount,
              amountUsd: context.amountUsd,
              currency: context.currency,
              paymentMethod: context.paymentMethod,
              reference: context.reference || undefined,
              notes: context.notes || undefined,
              paidAt: context.paidAt,
              periodKey: context.periodKey,
            })
          }
        },
      },
    )

    revalidatePath('/admin/commissions')
    return { success: true, proofPath: result.proofPath }
  } catch {
    return { success: false, error: errorMessage }
  }
}

export async function confirmCommissionPaymentAction(paymentId: string) {
  try {
    const user = await requireCommissionAdmin(true)
    const admin = createServiceRoleClient()

    const { error } = await admin
      .from('commission_payments')
      .update({
        status: 'confirmed',
        reviewed_by_user_id: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)

    if (error) throw error

    await allocateConfirmedPayment(admin, paymentId)

    revalidatePath('/admin/commissions')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: actionErrorMessage(error, 'No se pudo confirmar el pago.') }
  }
}

export async function rejectCommissionPaymentAction(paymentId: string, reason: string) {
  try {
    const user = await requireCommissionAdmin(true)
    const admin = createServiceRoleClient()
    const trimmedReason = reason.trim()

    if (!trimmedReason) throw new Error('Debes indicar el motivo del rechazo.')

    const { error } = await admin
      .from('commission_payments')
      .update({
        status: 'rejected',
        reviewed_by_user_id: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: trimmedReason,
        unapplied_usd: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)

    if (error) throw error

    revalidatePath('/admin/commissions')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: actionErrorMessage(error, 'No se pudo rechazar el pago.') }
  }
}

export async function createCommissionAdjustmentAction(input: AdjustmentInput) {
  try {
    const user = await requireCommissionAdmin(true)
    const admin = createServiceRoleClient()
    const amountUsd = Number(input.amountUsd)

    if (!input.periodId) throw new Error('Período inválido.')

    const periodKey = await getPeriodKey(admin, input.periodId)
    assertCommissionPeriodAllowed(periodKey)

    if (!['debit', 'credit'].includes(input.direction)) throw new Error('Tipo de ajuste inválido.')
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Monto inválido.')
    if (!input.reason.trim()) throw new Error('Debes indicar el motivo del ajuste.')

    const { error } = await admin.from('commission_adjustments').insert({
      period_id: input.periodId,
      direction: input.direction,
      amount_usd: roundCurrency(amountUsd),
      reason: input.reason.trim(),
      notes: input.notes?.trim() || null,
      created_by_user_id: user.id,
    })

    if (error) throw error

    revalidatePath('/admin/commissions')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: actionErrorMessage(error, 'No se pudo crear el ajuste.') }
  }
}
