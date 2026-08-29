import assert from 'node:assert/strict'
import test from 'node:test'

import {
  finalizePaymentProofCore,
  type ProofFinalizationDependencies,
  type ProofUploadReference,
} from './proof-finalization-core.ts'

const userId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const periodId = '33333333-3333-4333-8333-333333333333'
const objectId = '44444444-4444-4444-8444-444444444444'

function proof(path: string, overrides: Partial<ProofUploadReference> = {}): ProofUploadReference {
  return Object.freeze({
    bucket: 'payment_proofs',
    path,
    name: 'proof.png',
    size: 8,
    mimeType: 'image/png',
    ...overrides,
  })
}

function dependencies(
  calls: string[],
  overrides: Partial<ProofFinalizationDependencies<{ id: string }>> = {},
): ProofFinalizationDependencies<{ id: string }> {
  return {
    authorize: async () => {
      calls.push('authorize-owner')
      return Object.freeze({ actorUserId: userId, proofRequired: true, context: { id: 'row' } })
    },
    verify: async () => {
      calls.push('verify-object')
    },
    persist: async () => {
      calls.push('persist-path-and-status')
    },
    ...overrides,
  }
}

test('authorizes, verifies the exact canonical object, then persists its private path', async () => {
  const calls: string[] = []
  const path = `orders/${userId}/${orderId}/${objectId}.png`
  let persistedPath: string | null | undefined
  let verificationPath: string | undefined

  const result = await finalizePaymentProofCore(
    { kind: 'order-proof', recordId: orderId, proof: proof(path) },
    dependencies(calls, {
      verify: async (input) => {
        calls.push('verify-object')
        verificationPath = input.expectedPath
        assert.equal(input.intent.size, 8)
        assert.equal(input.intent.mimeType, 'image/png')
      },
      persist: async (_context, proofPath) => {
        calls.push('persist-path-and-status')
        persistedPath = proofPath
      },
    }),
  )

  assert.deepEqual(calls, [
    'authorize-owner',
    'verify-object',
    'persist-path-and-status',
  ])
  assert.equal(verificationPath, path)
  assert.equal(persistedPath, path)
  assert.deepEqual(result, { proofPath: path })
  assert.ok(Object.isFrozen(result))
})

test('canonicalizes a positive bigint import id before authorization', async () => {
  const calls: string[] = []
  const path = `imports/${userId}/1/${objectId}.png`
  let authorizedRecordId = ''

  await finalizePaymentProofCore(
    { kind: 'import-proof', recordId: '1', proof: proof(path) },
    dependencies(calls, {
      authorize: async (_kind, recordId) => {
        calls.push('authorize-owner')
        authorizedRecordId = recordId
        return Object.freeze({ actorUserId: userId, proofRequired: true, context: { id: '1' } })
      },
    }),
  )

  assert.equal(authorizedRecordId, '1')
  assert.deepEqual(calls, ['authorize-owner', 'verify-object', 'persist-path-and-status'])
})

test('rejects malformed identifiers and noncanonical paths before database access', async () => {
  const rejected = [
    { kind: 'import-proof' as const, recordId: '01', path: `imports/${userId}/01/${objectId}.png` },
    { kind: 'import-proof' as const, recordId: '9'.repeat(5_000), path: `imports/${userId}/1/${objectId}.png` },
    { kind: 'order-proof' as const, recordId: '../orders', path: `orders/${userId}/${orderId}/${objectId}.png` },
    { kind: 'commission-proof' as const, recordId: periodId, path: `commissions/${periodId}/${userId}/${objectId}.jpg` },
  ]

  for (const input of rejected) {
    const calls: string[] = []
    await assert.rejects(
      finalizePaymentProofCore(
        { kind: input.kind, recordId: input.recordId, proof: proof(input.path) },
        dependencies(calls),
      ),
      { message: 'No se pudo finalizar el comprobante.' },
    )
    assert.deepEqual(calls, [])
  }
})

test('does not persist when byte verification fails', async () => {
  const calls: string[] = []
  const path = `orders/${userId}/${orderId}/${objectId}.png`

  await assert.rejects(
    finalizePaymentProofCore(
      { kind: 'order-proof', recordId: orderId, proof: proof(path) },
      dependencies(calls, {
        verify: async () => {
          calls.push('verify-object')
          throw new Error('private storage detail')
        },
      }),
    ),
    { message: 'No se pudo finalizar el comprobante.' },
  )
  assert.deepEqual(calls, ['authorize-owner', 'verify-object'])
})

test('rejects a canonical path owned by a different user after authorization', async () => {
  const calls: string[] = []
  const otherUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const path = `orders/${otherUserId}/${orderId}/${objectId}.png`

  await assert.rejects(
    finalizePaymentProofCore(
      { kind: 'order-proof', recordId: orderId, proof: proof(path) },
      dependencies(calls),
    ),
    { message: 'No se pudo finalizar el comprobante.' },
  )
  assert.deepEqual(calls, ['authorize-owner'])
})

test('keeps a verified object for bounded orphan cleanup when persistence fails', async () => {
  const calls: string[] = []
  const path = `commissions/${periodId}/${userId}/${objectId}.png`

  await assert.rejects(
    finalizePaymentProofCore(
      { kind: 'commission-proof', recordId: periodId, proof: proof(path) },
      dependencies(calls, {
        persist: async () => {
          calls.push('persist-path-and-status')
          throw new Error('database row and private path')
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'No se pudo finalizar el comprobante.')
      assert.doesNotMatch(error.message, /database|private|orders|commissions/u)
      return true
    },
  )
  assert.deepEqual(calls, ['authorize-owner', 'verify-object', 'persist-path-and-status'])
})

test('allows a fully credit-paid import without proof and never verifies storage', async () => {
  const calls: string[] = []
  let persistedPath: string | null | undefined

  const result = await finalizePaymentProofCore(
    { kind: 'import-proof', recordId: '9223372036854775807', proof: null },
    dependencies(calls, {
      authorize: async () => {
        calls.push('authorize-owner')
        return Object.freeze({ actorUserId: userId, proofRequired: false, context: { id: 'max' } })
      },
      persist: async (_context, proofPath) => {
        calls.push('persist-path-and-status')
        persistedPath = proofPath
      },
    }),
  )

  assert.deepEqual(calls, ['authorize-owner', 'persist-path-and-status'])
  assert.equal(persistedPath, null)
  assert.deepEqual(result, { proofPath: null })
})

test('rejects a missing required proof without verification or persistence', async () => {
  const calls: string[] = []

  await assert.rejects(
    finalizePaymentProofCore(
      { kind: 'order-proof', recordId: orderId, proof: null },
      dependencies(calls),
    ),
    { message: 'No se pudo finalizar el comprobante.' },
  )
  assert.deepEqual(calls, ['authorize-owner'])
})
