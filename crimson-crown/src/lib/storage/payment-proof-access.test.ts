import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPaymentProofAccessCore,
  parseLegacyProofPath,
  type PaymentProofAccessDependencies,
  type PaymentProofDomain,
} from './payment-proof-access.ts'

const allowedOrigin = 'https://djfqozfaqkqdoqeoqbzt.supabase.co'
const ownerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const periodId = '44444444-4444-4444-8444-444444444444'
const objectId = '55555555-5555-4555-8555-555555555555'

test('parses only an exact public payment_proofs URL on the allowed origin', () => {
  assert.equal(
    parseLegacyProofPath(
      `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders/${ownerId}/${orderId}/${objectId}.png`,
      allowedOrigin,
    ),
    `orders/${ownerId}/${orderId}/${objectId}.png`,
  )
  assert.equal(
    parseLegacyProofPath(
      'http://127.0.0.1:54621/storage/v1/object/public/payment_proofs/import_19_1712345678901.jpg',
      'http://127.0.0.1:54621',
    ),
    'import_19_1712345678901.jpg',
  )
  assert.equal(
    parseLegacyProofPath(
      `${allowedOrigin}/storage/v1/object/public/payment_proofs/stock_${orderId}_1712345678901.PNG`,
      allowedOrigin,
    ),
    `stock_${orderId}_1712345678901.PNG`,
  )
})

test('rejects foreign origins, executable URLs and ambiguous encoded legacy paths', () => {
  const rejected = [
    'https://jzkxvgntwompkntimrao.supabase.co/storage/v1/object/public/payment_proofs/a.png',
    'javascript:alert(1)',
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/a.png?download=1`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/a.png#fragment`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders%2Fa.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders/%252e%252e/a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders/%2e%2e/a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders/../a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders/./a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders//a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/orders\\a.png`,
    `${allowedOrigin}/storage/v1/object/public/products/a.png`,
    `${allowedOrigin}/storage/v1/object/sign/payment_proofs/a.png`,
    `${allowedOrigin}/storage/v1/object/public/payment_proofs/a.exe`,
  ]

  for (const rawUrl of rejected) {
    assert.equal(parseLegacyProofPath(rawUrl, allowedOrigin), null, rawUrl)
  }
})

function dependencies(input: {
  actor: PaymentProofAccessDependencies['getActor'] extends () => Promise<infer Actor> ? Actor : never
  ownerUserId?: string
  path?: string | null
  legacyUrl?: string | null
  scopeId?: string | null
  legacyScopeKey?: string | null
  now?: number
}) {
  const reads: PaymentProofDomain[] = []
  const signed: Array<{ path: string; expiresIn: number }> = []
  const deps: PaymentProofAccessDependencies = {
    getActor: async () => input.actor,
    fetchRecord: async (domain) => {
      reads.push(domain)
      return {
        ownerUserId: input.ownerUserId ?? ownerId,
        path: input.path ?? null,
        legacyUrl: input.legacyUrl ?? null,
        scopeId: input.scopeId ?? periodId,
        legacyScopeKey: input.legacyScopeKey ?? '2026-08',
      }
    },
    createSignedUrl: async (path, expiresIn) => {
      signed.push({ path, expiresIn })
      return `https://signed.local/${encodeURIComponent(path)}?token=secret`
    },
    allowedOrigin,
    now: () => input.now ?? 1_000,
  }
  return { deps, reads, signed }
}

test('owners read their own stock and import proofs through five-minute signed URLs', async () => {
  for (const [domain, recordId, path] of [
    ['order', orderId, `orders/${ownerId}/${orderId}/${objectId}.png`],
    ['import', '19', `imports/${ownerId}/19/${objectId}.pdf`],
  ] as const) {
    const harness = dependencies({ actor: { userId: ownerId, isAdmin: false }, path })
    const result = await getPaymentProofAccessCore({ domain, recordId }, harness.deps)

    assert.deepEqual(result, {
      url: `https://signed.local/${encodeURIComponent(path)}?token=secret`,
      expiresAt: 301_000,
    })
    assert.deepEqual(harness.reads, [domain])
    assert.deepEqual(harness.signed, [{ path, expiresIn: 300 }])
  }
})

test('prefers a canonical path and uses a strict legacy URL only when the path is null', async () => {
  const canonical = `orders/${ownerId}/${orderId}/${objectId}.webp`
  const legacyPath = `stock_${orderId}_1712345678901.jpg`
  const preferred = dependencies({
    actor: { userId: ownerId, isAdmin: false },
    path: canonical,
    legacyUrl: `${allowedOrigin}/storage/v1/object/public/payment_proofs/${legacyPath}`,
  })
  await getPaymentProofAccessCore({ domain: 'order', recordId: orderId }, preferred.deps)
  assert.deepEqual(preferred.signed, [{ path: canonical, expiresIn: 300 }])

  const fallback = dependencies({
    actor: { userId: ownerId, isAdmin: false },
    legacyUrl: `${allowedOrigin}/storage/v1/object/public/payment_proofs/${legacyPath}`,
  })
  await getPaymentProofAccessCore({ domain: 'order', recordId: orderId }, fallback.deps)
  assert.deepEqual(fallback.signed, [{ path: legacyPath, expiresIn: 300 }])
})

test('binds every legacy fallback path to the requested domain and record', async () => {
  const otherOrderId = '66666666-6666-4666-8666-666666666666'
  const crossRecordCases = [
    {
      domain: 'order' as const,
      recordId: orderId,
      path: `stock_${otherOrderId}_1712345678901.jpg`,
    },
    { domain: 'import' as const, recordId: '19', path: 'import_20_1712345678901.png' },
    {
      domain: 'order' as const,
      recordId: orderId,
      path: `imports/${ownerId}/19/${objectId}.png`,
    },
    {
      domain: 'commission' as const,
      recordId: objectId,
      path: 'commission-payments/2026-13/1712345678901-proof.pdf',
    },
    {
      domain: 'commission' as const,
      recordId: objectId,
      path: 'commission-payments/2026-07/1712345678901-proof.pdf',
    },
  ]

  for (const input of crossRecordCases) {
    const harness = dependencies({
      actor: { userId: ownerId, isAdmin: input.domain === 'commission' },
      legacyUrl: `${allowedOrigin}/storage/v1/object/public/payment_proofs/${input.path}`,
    })
    await assert.rejects(
      getPaymentProofAccessCore(
        { domain: input.domain, recordId: input.recordId },
        harness.deps,
      ),
      { message: 'No se pudo abrir el comprobante.' },
    )
    assert.deepEqual(harness.signed, [])
  }

  const commissionPath = 'commission-payments/2026-08/1712345678901-proof-file.PDF'
  const commission = dependencies({
    actor: { userId: ownerId, isAdmin: true },
    legacyUrl: `${allowedOrigin}/storage/v1/object/public/payment_proofs/${commissionPath}`,
  })
  await getPaymentProofAccessCore(
    { domain: 'commission', recordId: objectId },
    commission.deps,
  )
  assert.deepEqual(commission.signed, [{ path: commissionPath, expiresIn: 300 }])
})

test('denies anonymous and cross-owner proof reads before signing', async () => {
  for (const actor of [null, { userId: otherId, isAdmin: false }]) {
    const harness = dependencies({
      actor,
      path: `orders/${ownerId}/${orderId}/${objectId}.png`,
    })
    await assert.rejects(
      getPaymentProofAccessCore({ domain: 'order', recordId: orderId }, harness.deps),
      { message: 'No se pudo abrir el comprobante.' },
    )
    assert.deepEqual(harness.signed, [])
  }
})

test('requires an app admin for commission proofs and lets admins read all domains', async () => {
  const commissionPath = `commissions/${periodId}/${ownerId}/${objectId}.pdf`
  const standard = dependencies({
    actor: { userId: ownerId, isAdmin: false },
    path: commissionPath,
  })
  await assert.rejects(
    getPaymentProofAccessCore({ domain: 'commission', recordId: objectId }, standard.deps),
    { message: 'No se pudo abrir el comprobante.' },
  )
  assert.deepEqual(standard.signed, [])

  for (const [domain, recordId, path] of [
    ['order', orderId, `orders/${ownerId}/${orderId}/${objectId}.png`],
    ['import', '19', `imports/${ownerId}/19/${objectId}.png`],
    ['commission', objectId, commissionPath],
  ] as const) {
    const admin = dependencies({ actor: { userId: otherId, isAdmin: true }, path })
    await getPaymentProofAccessCore({ domain, recordId }, admin.deps)
    assert.deepEqual(admin.signed, [{ path, expiresIn: 300 }])
  }
})

test('fails closed for missing records, missing proofs and unsafe stored paths', async () => {
  const missing = dependencies({ actor: { userId: ownerId, isAdmin: false } })
  missing.deps.fetchRecord = async () => null

  const cases = [
    missing,
    dependencies({ actor: { userId: ownerId, isAdmin: false } }),
    dependencies({ actor: { userId: ownerId, isAdmin: false }, path: '../orders/a.png' }),
    dependencies({
      actor: { userId: ownerId, isAdmin: false },
      legacyUrl: 'https://evil.example/storage/v1/object/public/payment_proofs/a.png',
    }),
  ]

  for (const harness of cases) {
    await assert.rejects(
      getPaymentProofAccessCore({ domain: 'order', recordId: orderId }, harness.deps),
      { message: 'No se pudo abrir el comprobante.' },
    )
    assert.deepEqual(harness.signed, [])
  }
})

test('rejects noncanonical stored casing and a commission path from another period', async () => {
  const uppercasePath = `orders/${ownerId}/${orderId}/${objectId.toUpperCase()}.PNG`
  const uppercase = dependencies({
    actor: { userId: ownerId, isAdmin: false },
    path: uppercasePath,
  })
  await assert.rejects(
    getPaymentProofAccessCore({ domain: 'order', recordId: orderId }, uppercase.deps),
    { message: 'No se pudo abrir el comprobante.' },
  )
  assert.deepEqual(uppercase.signed, [])

  const otherPeriodId = '77777777-7777-4777-8777-777777777777'
  const wrongPeriod = dependencies({
    actor: { userId: otherId, isAdmin: true },
    path: `commissions/${otherPeriodId}/${ownerId}/${objectId}.pdf`,
    scopeId: periodId,
  })
  await assert.rejects(
    getPaymentProofAccessCore(
      { domain: 'commission', recordId: objectId },
      wrongPeriod.deps,
    ),
    { message: 'No se pudo abrir el comprobante.' },
  )
  assert.deepEqual(wrongPeriod.signed, [])
})
