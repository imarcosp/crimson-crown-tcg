import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import dotenv from 'dotenv'

import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'
import {
  assertExactLocalCrimsonStack,
  classifyLegacyProof,
  classifyStorageObjectResult,
  chunkCandidates,
  fetchBackfillRecords,
  formatBackfillOutput,
  loadLocalBackfillEnvironment,
  runPaymentProofBackfill,
} from './payment-proof-backfill.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const LOCAL_ORIGIN = 'http://127.0.0.1:54621'
const CRIMSON_ORIGIN = 'https://djfqozfaqkqdoqeoqbzt.supabase.co'
const FOREIGN_ORIGIN = 'https://jzkxvgntwompkntimrao.supabase.co'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

test('acepta sólo URL legacy estricta y vinculada al dominio/registro', () => {
  const orderId = '11111111-1111-4111-8111-111111111111'
  const importId = '8765432101234'
  const commissionId = '22222222-2222-4222-8222-222222222222'

  assert.deepEqual(classifyLegacyProof({
    domain: 'order', id: orderId, path: null,
    legacyUrl: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/stock_${orderId}_1777777777777.PNG`,
  }), {
    kind: 'candidate',
    path: `stock_${orderId}_1777777777777.PNG`,
  })
  assert.deepEqual(classifyLegacyProof({
    domain: 'import', id: importId, path: null,
    legacyUrl: `${CRIMSON_ORIGIN}/storage/v1/object/public/payment_proofs/import_${importId}_1777777777777.pdf`,
  }), {
    kind: 'candidate',
    path: `import_${importId}_1777777777777.pdf`,
  })
  assert.deepEqual(classifyLegacyProof({
    domain: 'commission', id: commissionId, path: null, legacyScopeKey: '2099-07',
    legacyUrl: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/commission-payments/2099-07/1777777777777-bank.png`,
  }), {
    kind: 'candidate',
    path: 'commission-payments/2099-07/1777777777777-bank.png',
  })

  assert.deepEqual(classifyLegacyProof({
    domain: 'order', id: orderId, path: null,
    legacyUrl: `${FOREIGN_ORIGIN}/storage/v1/object/public/payment_proofs/stock_${orderId}_1777777777777.png`,
  }), { kind: 'foreignUrl' })
  for (const legacyUrl of [
    `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/stock_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_1777777777777.png`,
    `${LOCAL_ORIGIN}/storage/v1/object/sign/payment_proofs/stock_${orderId}_1777777777777.png?token=secret`,
    'javascript:alert(1)',
  ]) {
    assert.deepEqual(classifyLegacyProof({
      domain: 'order', id: orderId, path: null, legacyUrl,
    }), { kind: 'invalidFormat' })
  }
})

test('rechaza identidad local imprecisa y clasifica sólo 404 exacto como objeto ausente', () => {
  assert.throws(
    () => loadLocalBackfillEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54621',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    }),
    /127\.0\.0\.1:54621/u,
  )
  assert.deepEqual(loadLocalBackfillEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: `${LOCAL_ORIGIN}/`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  }), {
    url: `${LOCAL_ORIGIN}/`, anonKey: 'anon', serviceKey: 'service',
  })

  assert.equal(classifyStorageObjectResult(null, { name: 'StorageApiError', status: 404, statusCode: '404' }), 'missing')
  assert.equal(classifyStorageObjectResult(null, { name: 'StorageApiError', status: 400, statusCode: '404' }), 'missing')
  assert.equal(classifyStorageObjectResult({ id: 'object' }, null), 'exists')
  for (const error of [
    null,
    { name: 'StorageApiError', status: 401, statusCode: '401' },
    { name: 'StorageApiError', status: 403, statusCode: '403' },
    { name: 'StorageApiError', status: 500, statusCode: '500' },
    { name: 'StorageUnknownError', status: 404, statusCode: '404' },
  ]) {
    assert.throws(() => classifyStorageObjectResult(null, error), /no es verificable/u)
  }
})

test('limita cada lote de actualización a 50 candidatos', () => {
  const chunks = chunkCandidates(Array.from({ length: 101 }, (_, index) => index))
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 1])
})

test('dry-run no muta; apply rellena rutas exactas una vez y no pisa una carrera', async () => {
  const environment = loadLocalBackfillEnvironment(process.env)
  assertExactLocalCrimsonStack()
  const service = createClient(environment.url, environment.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const marker = `backfill-task8-${Date.now()}-${randomUUID()}`
  const profile = await service.from('profiles').select('id').order('id').limit(1).single()
  assert.ifError(profile.error)
  const ownerId = profile.data.id
  const orderIds = Array.from({ length: 6 }, () => randomUUID())
  const objectPaths = []
  let importId = null
  let periodId = null
  let commissionId = null
  let raceOrderId = null

  const uploadObject = async (path) => {
    objectPaths.push(path)
    const result = await service.storage.from('payment_proofs').upload(
      path,
      new Blob([PNG_BYTES], { type: 'image/png' }),
      { contentType: 'image/png', upsert: false },
    )
    assert.ifError(result.error)
  }

  try {
    const orderPaths = {
      valid: `stock_${orderIds[0]}_1777777777701.png`,
      missing: `stock_${orderIds[1]}_1777777777702.png`,
      foreign: `stock_${orderIds[2]}_1777777777703.png`,
      existing: `orders/${ownerId}/${orderIds[3]}/${randomUUID()}.png`,
      invalid: `stock_${orderIds[5]}_1777777777705.png`,
    }
    const orders = await service.from('orders').insert([
      {
        id: orderIds[0], user_id: ownerId, status: 'pending_payment', total_amount: 1,
        payment_method: marker,
        payment_proof_url: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/${orderPaths.valid}`,
      },
      {
        id: orderIds[1], user_id: ownerId, status: 'pending_payment', total_amount: 1,
        payment_method: marker,
        payment_proof_url: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/${orderPaths.missing}`,
      },
      {
        id: orderIds[2], user_id: ownerId, status: 'pending_payment', total_amount: 1,
        payment_method: marker,
        payment_proof_url: `${FOREIGN_ORIGIN}/storage/v1/object/public/payment_proofs/${orderPaths.foreign}`,
      },
      {
        id: orderIds[3], user_id: ownerId, status: 'pending_payment', total_amount: 1,
        payment_method: marker, payment_proof_path: orderPaths.existing,
        payment_proof_url: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/stock_${orderIds[3]}_1777777777704.png`,
      },
      {
        id: orderIds[4], user_id: ownerId, status: 'pending_payment', total_amount: 1,
        payment_method: marker,
        payment_proof_url: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/${orderPaths.invalid}`,
      },
    ])
    assert.ifError(orders.error)
    await uploadObject(orderPaths.valid)

    const importInsert = await service.from('import_orders').insert({
      user_id: ownerId, status: 'Iniciada', user_notes: marker,
    }).select('id').single()
    assert.ifError(importInsert.error)
    importId = String(importInsert.data.id)
    const importPath = `import_${importId}_1777777777710.png`
    const importUpdate = await service.from('import_orders').update({
      payment_proof_url: `${CRIMSON_ORIGIN}/storage/v1/object/public/payment_proofs/${importPath}`,
    }).eq('id', importId)
    assert.ifError(importUpdate.error)
    await uploadObject(importPath)

    const randomYear = 2200 + Number.parseInt(randomUUID().slice(0, 4), 16) % 500
    const periodKey = `${randomYear}-07`
    const period = await service.from('commission_periods').insert({
      period_key: periodKey,
      period_start: `${randomYear}-07-01T00:00:00.000Z`,
      period_end: `${randomYear}-08-01T00:00:00.000Z`,
      notes: marker,
    }).select('id').single()
    assert.ifError(period.error)
    periodId = period.data.id
    const commissionPath = `commission-payments/${periodKey}/1777777777720-bank.png`
    const payment = await service.from('commission_payments').insert({
      period_id: periodId,
      reported_by_user_id: ownerId,
      currency: 'USD',
      amount: 1,
      amount_usd: 1,
      payment_method: marker,
      proof_url: `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/${commissionPath}`,
      paid_at: new Date().toISOString(),
    }).select('id').single()
    assert.ifError(payment.error)
    commissionId = payment.data.id
    await uploadObject(commissionPath)

    const allRecords = await fetchBackfillRecords(service)
    const targetIds = new Set([...orderIds.slice(0, 5), importId, commissionId])
    const records = allRecords.filter((record) => targetIds.has(String(record.id)))
    assert.equal(records.length, 7)

    const expectedDryRun = {
      scanned: 7,
      resolvable: 3,
      missingObject: 1,
      foreignUrl: 1,
      invalidFormat: 1,
      alreadyPathed: 1,
    }
    const dryRun = await runPaymentProofBackfill({ service, records, apply: false })
    assert.deepEqual(dryRun.report, expectedDryRun)

    const beforeApply = await fetchBackfillRecords(service)
    for (const id of [orderIds[0], importId, commissionId]) {
      assert.equal(beforeApply.find((record) => String(record.id) === id)?.path, null)
    }

    const safeOutput = formatBackfillOutput(dryRun)
    assert.doesNotMatch(safeOutput, /supabase\.co|127\.0\.0\.1|@|storage\/v1|token=/u)
    const parsedOutput = JSON.parse(safeOutput)
    assert.deepEqual(parsedOutput.report, expectedDryRun)
    assert.ok(parsedOutput.exceptions.every((entry) => /^[a-zA-Z0-9]{8}$/u.test(entry.id)))

    const applied = await runPaymentProofBackfill({ service, records, apply: true })
    assert.deepEqual(applied.report, expectedDryRun)
    const afterApply = await fetchBackfillRecords(service)
    assert.equal(afterApply.find((record) => String(record.id) === orderIds[0])?.path, orderPaths.valid)
    assert.equal(afterApply.find((record) => String(record.id) === importId)?.path, importPath)
    assert.equal(afterApply.find((record) => String(record.id) === commissionId)?.path, commissionPath)

    const secondRecords = afterApply.filter((record) => targetIds.has(String(record.id)))
    const second = await runPaymentProofBackfill({ service, records: secondRecords, apply: true })
    assert.deepEqual(second.report, {
      scanned: 7,
      resolvable: 0,
      missingObject: 1,
      foreignUrl: 1,
      invalidFormat: 1,
      alreadyPathed: 4,
    })

    raceOrderId = randomUUID()
    const racePath = `stock_${raceOrderId}_1777777777730.png`
    const raceUrl = `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/${racePath}`
    const raceInsert = await service.from('orders').insert({
      id: raceOrderId, user_id: ownerId, status: 'pending_payment', total_amount: 1,
      payment_method: marker, payment_proof_url: raceUrl,
    })
    assert.ifError(raceInsert.error)
    await uploadObject(racePath)
    const raceRecord = (await fetchBackfillRecords(service))
      .find((record) => record.id === raceOrderId)
    assert.ok(raceRecord)
    const racedUrl = `${LOCAL_ORIGIN}/storage/v1/object/public/payment_proofs/stock_${raceOrderId}_1777777777731.png`
    assert.ifError((await service.from('orders').update({ payment_proof_url: racedUrl }).eq('id', raceOrderId)).error)
    await assert.rejects(
      runPaymentProofBackfill({ service, records: [raceRecord], apply: true }),
      /carrera concurrente/u,
    )
    const racedState = await service.from('orders')
      .select('payment_proof_path,payment_proof_url').eq('id', raceOrderId).single()
    assert.ifError(racedState.error)
    assert.equal(racedState.data.payment_proof_path, null)
    assert.equal(racedState.data.payment_proof_url, racedUrl)
  } finally {
    if (objectPaths.length) {
      const removed = await service.storage.from('payment_proofs').remove(objectPaths)
      assert.ifError(removed.error)
    }
    const ids = [...orderIds, ...(raceOrderId ? [raceOrderId] : [])]
    assert.ifError((await service.from('orders').delete().in('id', ids)).error)
    if (importId) assert.ifError((await service.from('import_orders').delete().eq('id', importId)).error)
    if (commissionId) assert.ifError((await service.from('commission_payments').delete().eq('id', commissionId)).error)
    if (periodId) assert.ifError((await service.from('commission_periods').delete().eq('id', periodId)).error)

    const residue = await Promise.all([
      service.from('orders').select('id', { count: 'exact', head: true }).eq('payment_method', marker),
      service.from('import_orders').select('id', { count: 'exact', head: true }).eq('user_notes', marker),
      service.from('commission_periods').select('id', { count: 'exact', head: true }).eq('notes', marker),
    ])
    for (const result of residue) {
      assert.ifError(result.error)
      assert.equal(result.count, 0)
    }
    for (const path of objectPaths) {
      const info = await service.storage.from('payment_proofs').info(path)
      assert.equal(classifyStorageObjectResult(info.data, info.error), 'missing')
    }
  }
})
