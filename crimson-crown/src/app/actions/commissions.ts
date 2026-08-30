"use server"

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server'
import { OWNER_ADMIN_EMAIL, STAFF_ADMIN_EMAIL } from '@/lib/constants'
import { COMMISSION_START_PERIOD_KEY, getCurrentCommissionMonthKey } from '@/lib/commissions'
import { siteConfig } from '@/config/site'
import { getResendClient } from '@/lib/email/resend-client'
import {
  finalizePaymentProofCore,
  parseProofUploadReference,
} from '@/lib/storage/proof-finalization-core'
import { verifyTrustedUploadedObject } from '@/lib/storage/upload-server'
import {
  assertNotificationProviderResult,
  deliverCommissionPaymentNotification,
} from '@/lib/commissions/payment-notification'

type PaymentInput = {
  operationKey: string
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

  if (error || !user?.email || ![OWNER_ADMIN_EMAIL, STAFF_ADMIN_EMAIL].includes(user.email)) {
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

  const delivery = await getResendClient().emails.send({
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
  assertNotificationProviderResult(delivery)
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
  operationKey: string
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
      typeof input.operationKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.operationKey) ||
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
              operationKey: input.operationKey.toLowerCase(),
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
          const { data, error } = await admin.rpc('report_commission_payment_atomic', {
            operation_key_input: context.operationKey,
            period_id_input: context.periodId,
            reported_by_user_id_input: context.userId,
            is_owner_input: context.isOwner,
            currency_input: context.currency,
            amount_input: Number(context.amount.toFixed(2)),
            fx_rate_ars_input: context.normalizedFxRate
              ? Number(context.normalizedFxRate.toFixed(2))
              : null,
            amount_usd_input: Number(context.amountUsd.toFixed(2)),
            payment_method_input: context.paymentMethod,
            reference_input: context.reference,
            notes_input: context.notes,
            proof_path_input: proofPath,
            paid_at_input: context.paidAt,
          })
          if (error) throw new Error(errorMessage)
          const row = Array.isArray(data) ? data[0] : data
          if (!row || typeof row !== 'object' || typeof row.created !== 'boolean') {
            throw new Error(errorMessage)
          }

          if (!context.isOwner && row.created) {
            await deliverCommissionPaymentNotification({
              disabled: process.env.DISABLE_EXTERNAL_SIDE_EFFECTS === 'true',
              send: () => sendCommissionPaymentReportedEmail({
                amount: context.amount,
                amountUsd: context.amountUsd,
                currency: context.currency,
                paymentMethod: context.paymentMethod,
                reference: context.reference || undefined,
                notes: context.notes || undefined,
                paidAt: context.paidAt,
                periodKey: context.periodKey,
              }),
              onFailure: () => console.error('No se pudo enviar la notificación del pago de comisión.'),
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
    if (typeof paymentId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(paymentId)) {
      throw new Error('Pago inválido.')
    }
    const user = await requireCommissionAdmin(true)
    const admin = createServiceRoleClient()

    const { data, error } = await admin.rpc('confirm_commission_payment_atomic', {
      payment_id_input: paymentId,
      reviewer_id_input: user.id,
    })

    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object' || typeof row.changed !== 'boolean') {
      throw new Error('No se pudo confirmar el pago.')
    }

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

    const { data, error } = await admin
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
      .eq('status', 'reported')
      .select('id')
      .single()

    if (error || !data?.id) throw error || new Error('El pago no está pendiente de rechazo.')

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
