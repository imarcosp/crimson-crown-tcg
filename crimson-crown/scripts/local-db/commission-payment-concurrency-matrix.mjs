import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'

import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

if (!url || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
if (!loopbackHosts.has(new URL(url).hostname)) {
  throw new Error('La matriz de comisiones sólo puede usar Supabase local.')
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function oneRow(result, label) {
  assert.ifError(result.error)
  assert.equal(result.data?.length, 1, `${label} debe devolver exactamente una fila`)
  return result.data[0]
}

async function main() {
  const runId = randomUUID()
  const periodId = randomUUID()
  const reportedOperationKey = randomUUID()
  const ownerOperationKey = randomUUID()
  let reportedPaymentId = null
  let ownerPaymentId = null

  const profile = await service.from('profiles').select('id').order('id').limit(1).single()
  assert.ifError(profile.error)
  assert.ok(profile.data?.id, 'la copia local debe tener un perfil de prueba')

  const existingPeriod = await service
    .from('commission_periods')
    .select('id')
    .eq('period_key', '2099-11')
    .maybeSingle()
  assert.ifError(existingPeriod.error)
  assert.equal(existingPeriod.data, null, 'el período reservado 2099-11 debe estar libre')

  try {
    const insertedPeriod = await service.from('commission_periods').insert({
      id: periodId,
      period_key: '2099-11',
      period_start: '2099-11-01T00:00:00.000Z',
      period_end: '2099-12-01T00:00:00.000Z',
      total_due_usd: 100,
      notes: `commission-concurrency:${runId}`,
    })
    assert.ifError(insertedPeriod.error)

    const reported = oneRow(await service.rpc('report_commission_payment_atomic', {
      operation_key_input: reportedOperationKey,
      period_id_input: periodId,
      reported_by_user_id_input: profile.data.id,
      is_owner_input: false,
      currency_input: 'USD',
      amount_input: 40,
      fx_rate_ars_input: null,
      amount_usd_input: 40,
      payment_method_input: 'local-concurrency',
      reference_input: `reported:${runId}`,
      notes_input: null,
      proof_path_input: null,
      paid_at_input: '2099-11-15T12:00:00.000Z',
    }), 'el reporte previo')
    reportedPaymentId = reported.payment_id

    const [confirmationResult, ownerReportResult] = await Promise.all([
      service.rpc('confirm_commission_payment_atomic', {
        payment_id_input: reportedPaymentId,
        reviewer_id_input: profile.data.id,
      }),
      service.rpc('report_commission_payment_atomic', {
        operation_key_input: ownerOperationKey,
        period_id_input: periodId,
        reported_by_user_id_input: profile.data.id,
        is_owner_input: true,
        currency_input: 'USD',
        amount_input: 60,
        fx_rate_ars_input: null,
        amount_usd_input: 60,
        payment_method_input: 'local-concurrency',
        reference_input: `owner:${runId}`,
        notes_input: null,
        proof_path_input: null,
        paid_at_input: '2099-11-16T12:00:00.000Z',
      }),
    ])

    const confirmation = oneRow(confirmationResult, 'la confirmación concurrente')
    const ownerReport = oneRow(ownerReportResult, 'el reporte del propietario concurrente')
    ownerPaymentId = ownerReport.payment_id
    assert.equal(confirmation.changed, true)
    assert.equal(ownerReport.created, true)

    const payments = await service
      .from('commission_payments')
      .select('id,status,amount_usd,unapplied_usd')
      .in('id', [reportedPaymentId, ownerPaymentId])
    assert.ifError(payments.error)
    assert.equal(payments.data?.length, 2)
    assert.ok(payments.data.every((payment) => payment.status === 'confirmed'))
    assert.ok(payments.data.every((payment) => Number(payment.unapplied_usd) === 0))

    const allocations = await service
      .from('commission_payment_allocations')
      .select('payment_id,period_id,amount_usd')
      .in('payment_id', [reportedPaymentId, ownerPaymentId])
    assert.ifError(allocations.error)
    assert.equal(allocations.data?.reduce((sum, row) => sum + Number(row.amount_usd), 0), 100)

    const [periods, adjustments, allAllocations] = await Promise.all([
      service.from('commission_periods').select('id,total_due_usd').gte('period_key', '2026-06').lte('period_key', '2099-11'),
      service.from('commission_adjustments').select('period_id,direction,amount_usd'),
      service.from('commission_payment_allocations').select('period_id,amount_usd'),
    ])
    assert.ifError(periods.error)
    assert.ifError(adjustments.error)
    assert.ifError(allAllocations.error)
    for (const period of periods.data || []) {
      const adjustmentTotal = (adjustments.data || [])
        .filter((row) => row.period_id === period.id)
        .reduce((sum, row) => sum + (row.direction === 'debit' ? 1 : -1) * Number(row.amount_usd), 0)
      const allocationTotal = (allAllocations.data || [])
        .filter((row) => row.period_id === period.id)
        .reduce((sum, row) => sum + Number(row.amount_usd), 0)
      assert.ok(
        allocationTotal <= Number(period.total_due_usd) + adjustmentTotal + 0.001,
        `la concurrencia no debe sobreasignar el período ${period.id}`,
      )
    }

    const repeated = oneRow(await service.rpc('confirm_commission_payment_atomic', {
      payment_id_input: reportedPaymentId,
      reviewer_id_input: profile.data.id,
    }), 'la reconfirmación')
    assert.equal(repeated.changed, false)

    const afterRetry = await service
      .from('commission_payment_allocations')
      .select('amount_usd')
      .in('payment_id', [reportedPaymentId, ownerPaymentId])
    assert.ifError(afterRetry.error)
    assert.equal(afterRetry.data?.reduce((sum, row) => sum + Number(row.amount_usd), 0), 100)

    console.log(JSON.stringify({ ok: true, concurrentWriters: 2, allocatedUsd: 100, retry: 'no-op' }))
  } finally {
    const paymentIds = [reportedPaymentId, ownerPaymentId].filter(Boolean)
    if (paymentIds.length) {
      const cleanupPayments = await service.from('commission_payments').delete().in('id', paymentIds)
      if (cleanupPayments.error) throw new Error('No se pudieron limpiar los pagos sintéticos locales.')
    }
    const cleanupPeriod = await service
      .from('commission_periods')
      .delete()
      .eq('id', periodId)
      .eq('notes', `commission-concurrency:${runId}`)
    if (cleanupPeriod.error) throw new Error('No se pudo limpiar el período sintético local.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
