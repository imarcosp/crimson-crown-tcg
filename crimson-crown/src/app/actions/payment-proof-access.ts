'use server'

import { isAdminEmail } from '@/lib/auth/admin-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import {
  getPaymentProofAccessCore,
  type PaymentProofAccessInput,
  type PaymentProofAccessResult,
  type PaymentProofDomain,
  type PaymentProofRecord,
} from '@/lib/storage/payment-proof-access'

const ACCESS_ERROR_MESSAGE = 'No se pudo abrir el comprobante.'

function parseInput(rawInput: unknown): PaymentProofAccessInput {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error(ACCESS_ERROR_MESSAGE)
  }

  const input = rawInput as Record<string, unknown>
  if (
    Object.keys(input).length !== 2 ||
    typeof input.domain !== 'string' ||
    !['order', 'import', 'commission'].includes(input.domain) ||
    typeof input.recordId !== 'string'
  ) {
    throw new Error(ACCESS_ERROR_MESSAGE)
  }

  return Object.freeze({
    domain: input.domain as PaymentProofDomain,
    recordId: input.recordId,
  })
}

async function fetchProofRecord(
  domain: PaymentProofDomain,
  recordId: string,
): Promise<PaymentProofRecord | null> {
  const admin = createAdminClient()

  if (domain === 'order') {
    const { data, error } = await admin
      .from('orders')
      .select('user_id, payment_proof_path, payment_proof_url')
      .eq('id', recordId)
      .maybeSingle()
    if (error || !data) return null
    return Object.freeze({
      ownerUserId: data.user_id,
      path: data.payment_proof_path,
      legacyUrl: data.payment_proof_url,
      scopeId: null,
      legacyScopeKey: null,
    })
  }

  if (domain === 'import') {
    const { data, error } = await admin
      .from('import_orders')
      .select('user_id, payment_proof_path, payment_proof_url')
      .eq('id', recordId)
      .maybeSingle()
    if (error || !data) return null
    return Object.freeze({
      ownerUserId: data.user_id,
      path: data.payment_proof_path,
      legacyUrl: data.payment_proof_url,
      scopeId: null,
      legacyScopeKey: null,
    })
  }

  const { data, error } = await admin
    .from('commission_payments')
    .select('reported_by_user_id, period_id, proof_path, proof_url')
    .eq('id', recordId)
    .maybeSingle()
  if (error || !data) return null
  const { data: period, error: periodError } = await admin
    .from('commission_periods')
    .select('period_key')
    .eq('id', data.period_id)
    .maybeSingle()
  if (periodError || !period) return null
  return Object.freeze({
    ownerUserId: data.reported_by_user_id,
    path: data.proof_path,
    legacyUrl: data.proof_url,
    scopeId: data.period_id,
    legacyScopeKey: period.period_key,
  })
}

export async function getPaymentProofUrlAction(rawInput: unknown): Promise<PaymentProofAccessResult> {
  try {
    const input = parseInput(rawInput)
    return await getPaymentProofAccessCore(input, {
      getActor: async () => {
        const supabase = await createServerClient()
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()
        if (error || !user) return null
        return Object.freeze({
          userId: user.id,
          isAdmin: isAdminEmail(user.email),
        })
      },
      fetchRecord: fetchProofRecord,
      createSignedUrl: async (path, expiresIn) => {
        const admin = createAdminClient()
        const { data, error } = await admin.storage
          .from('payment_proofs')
          .createSignedUrl(path, expiresIn)
        if (error || !data?.signedUrl) throw new Error(ACCESS_ERROR_MESSAGE)
        return data.signedUrl
      },
      allowedOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    })
  } catch {
    throw new Error(ACCESS_ERROR_MESSAGE)
  }
}
