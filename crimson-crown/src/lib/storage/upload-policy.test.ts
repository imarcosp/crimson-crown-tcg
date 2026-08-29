import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStoragePath, validateUploadIntent } from './upload-policy.ts'
import type { AllowedUploadExtension, UploadIntent } from './upload-policy.ts'

const MiB = 1024 * 1024
const userId = '11111111-1111-4111-8111-111111111111'
const recordId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const inventoryId = '44444444-4444-4444-8444-444444444444'
const importRecordId = '9223372036854775807'

test('accepts every supported upload kind at the exact 5 MiB boundary', () => {
  const imageKinds = [
    'customer-product-request',
    'admin-product-image',
    'banner',
    'order-proof',
    'import-proof',
    'commission-proof',
  ] as const

  for (const kind of imageKinds) {
    assert.deepEqual(
      validateUploadIntent({ kind, name: 'safe.PNG', size: 5 * MiB, mimeType: 'image/png' }),
      { kind, extension: 'png', size: 5 * MiB, mimeType: 'image/png' },
    )
  }

  assert.deepEqual(
    validateUploadIntent({
      kind: 'order-proof',
      name: 'proof.PDF',
      size: 5 * MiB,
      mimeType: 'application/pdf',
    }),
    {
      kind: 'order-proof',
      extension: 'pdf',
      size: 5 * MiB,
      mimeType: 'application/pdf',
    },
  )
})

test('accepts both conventional JPEG extensions and normalizes their case', () => {
  assert.equal(
    validateUploadIntent({
      kind: 'admin-product-image',
      name: 'front.JPG',
      size: 100,
      mimeType: 'image/jpeg',
    }).extension,
    'jpg',
  )
  assert.equal(
    validateUploadIntent({
      kind: 'admin-product-image',
      name: 'back.JpEg',
      size: 100,
      mimeType: 'image/jpeg',
    }).extension,
    'jpeg',
  )
})

test('rejects unsupported MIME types and PDF uploads outside proof kinds', () => {
  assert.throws(() =>
    validateUploadIntent({
      kind: 'banner',
      name: 'payload.svg',
      size: 100,
      mimeType: 'image/svg+xml',
    }),
  )
  assert.throws(() =>
    validateUploadIntent({
      kind: 'customer-product-request',
      name: 'catalog.pdf',
      size: 100,
      mimeType: 'application/pdf',
    }),
  )
})

test('rejects inherited object property names as unsupported MIME types with a stable error', () => {
  for (const mimeType of ['toString', 'constructor', '__proto__']) {
    assert.throws(
      () =>
        validateUploadIntent({
          kind: 'banner',
          name: 'image.png',
          size: 100,
          mimeType,
        }),
      { name: 'Error', message: 'Tipo de archivo no permitido.' },
    )
  }
})

test('accepts an untrusted MIME string at the input boundary and rejects it with a stable error', () => {
  const untrustedMimeType: string = 'application/x-untrusted'

  assert.throws(
    () =>
      validateUploadIntent({
        kind: 'order-proof',
        name: 'proof.png',
        size: 100,
        mimeType: untrustedMimeType,
      }),
    { name: 'Error', message: 'Tipo de archivo no permitido.' },
  )
})

test('returns a frozen validated value that cannot be mutated after authorization', () => {
  const intent: UploadIntent = Object.freeze({
    kind: 'order-proof',
    name: 'proof.png',
    size: 100,
    mimeType: 'image/png',
  })
  const validated = validateUploadIntent(intent)
  const mutableView = validated as unknown as { extension: AllowedUploadExtension }

  assert.equal(Object.isFrozen(validated), true)
  assert.throws(() => {
    mutableView.extension = 'pdf'
  }, TypeError)
  assert.equal(validated.extension, 'png')
})

test('rejects sizes that are empty, negative, fractional, non-finite, unsafe or over 5 MiB', () => {
  for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 5 * MiB + 1]) {
    assert.throws(() =>
      validateUploadIntent({
        kind: 'order-proof',
        name: 'proof.png',
        size,
        mimeType: 'image/png',
      }),
    )
  }
})

test('rejects mismatches between the declared MIME type and filename extension', () => {
  assert.throws(() =>
    validateUploadIntent({
      kind: 'order-proof',
      name: 'proof.jpg',
      size: 100,
      mimeType: 'image/png',
    }),
  )
  assert.throws(() =>
    validateUploadIntent({
      kind: 'order-proof',
      name: 'proof.png',
      size: 100,
      mimeType: 'image/jpeg',
    }),
  )
})

test('rejects path syntax, traversal, NULs and double extensions in incoming names', () => {
  const dangerousNames = [
    '../escape.png',
    '..\\escape.png',
    'folder/file.png',
    'folder\\file.png',
    `nul\0byte.png`,
    'archive.tar.png',
    'proof.pdf.png',
    '.png',
  ]

  for (const name of dangerousNames) {
    assert.throws(() =>
      validateUploadIntent({
        kind: 'admin-product-image',
        name,
        size: 100,
        mimeType: 'image/png',
      }),
    )
  }
})

test('rejects unknown upload kinds at runtime', () => {
  assert.throws(() =>
    validateUploadIntent({
      kind: 'other' as never,
      name: 'image.png',
      size: 100,
      mimeType: 'image/png',
    }),
  )
})

test('builds the six canonical path shapes from validated identifiers only', () => {
  assert.equal(
    buildStoragePath({
      kind: 'customer-product-request',
      userId,
      objectId,
      extension: 'png',
    }),
    `requests/${userId}/${objectId}.png`,
  )
  assert.equal(
    buildStoragePath({
      kind: 'admin-product-image',
      inventoryId,
      objectId,
      extension: 'jpg',
    }),
    `catalog/${inventoryId}/${objectId}.jpg`,
  )
  assert.equal(
    buildStoragePath({ kind: 'banner', objectId, extension: 'webp' }),
    `site/${objectId}.webp`,
  )
  assert.equal(
    buildStoragePath({ kind: 'order-proof', userId, recordId, objectId, extension: 'png' }),
    `orders/${userId}/${recordId}/${objectId}.png`,
  )
  assert.equal(
    buildStoragePath({
      kind: 'import-proof',
      userId,
      recordId: importRecordId,
      objectId,
      extension: 'pdf',
    }),
    `imports/${userId}/${importRecordId}/${objectId}.pdf`,
  )
  assert.equal(
    buildStoragePath({
      kind: 'commission-proof',
      userId,
      recordId,
      objectId,
      extension: 'jpeg',
    }),
    `commissions/${recordId}/${userId}/${objectId}.jpeg`,
  )
})

test('accepts only positive canonical PostgreSQL bigint IDs for import proof paths', () => {
  assert.equal(
    buildStoragePath({ kind: 'import-proof', userId, recordId: '1', objectId, extension: 'png' }),
    `imports/${userId}/1/${objectId}.png`,
  )
  assert.equal(
    buildStoragePath({
      kind: 'import-proof',
      userId,
      recordId: '9223372036854775807',
      objectId,
      extension: 'pdf',
    }),
    `imports/${userId}/9223372036854775807/${objectId}.pdf`,
  )

  for (const invalidRecordId of [
    '0',
    '-1',
    '+1',
    '01',
    ' 1',
    '1 ',
    '1.0',
    '1e3',
    '1/2',
    '1\\2',
    '9223372036854775808',
  ]) {
    assert.throws(() =>
      buildStoragePath({
        kind: 'import-proof',
        userId,
        recordId: invalidRecordId,
        objectId,
        extension: 'pdf',
      }),
    )
  }
})

test('rejects an arbitrarily long import ID before attempting bigint conversion', () => {
  const originalBigInt = globalThis.BigInt
  let conversions = 0

  Object.defineProperty(globalThis, 'BigInt', {
    configurable: true,
    value(value: string | number | bigint | boolean) {
      conversions += 1
      return originalBigInt(value)
    },
  })

  try {
    assert.throws(() =>
      buildStoragePath({
        kind: 'import-proof',
        userId,
        recordId: '9'.repeat(5_000),
        objectId,
        extension: 'pdf',
      }),
    )
    assert.equal(conversions, 0)
  } finally {
    Object.defineProperty(globalThis, 'BigInt', {
      configurable: true,
      value: originalBigInt,
    })
  }
})

test('normalizes valid uppercase UUIDs to canonical lowercase paths', () => {
  assert.equal(
    buildStoragePath({
      kind: 'order-proof',
      userId: userId.toUpperCase(),
      recordId: recordId.toUpperCase(),
      objectId: objectId.toUpperCase(),
      extension: 'PNG' as 'png',
    }),
    `orders/${userId}/${recordId}/${objectId}.png`,
  )
})

test('rejects malformed, nil, unsupported-version and invalid-variant UUIDs', () => {
  const invalidIds = [
    'not-a-uuid',
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-0111-8111-111111111111',
    '11111111-1111-4111-7111-111111111111',
  ]

  for (const invalidId of invalidIds) {
    assert.throws(() =>
      buildStoragePath({
        kind: 'order-proof',
        userId: invalidId,
        recordId,
        objectId,
        extension: 'png',
      }),
    )
  }
})

test('rejects missing IDs and extensions not authorized for the selected kind', () => {
  assert.throws(() =>
    buildStoragePath({
      kind: 'admin-product-image',
      objectId,
      extension: 'png',
    } as never),
  )
  assert.throws(() =>
    buildStoragePath({
      kind: 'banner',
      objectId,
      extension: 'pdf' as never,
    }),
  )
  assert.throws(() =>
    buildStoragePath({
      kind: 'order-proof',
      userId,
      recordId,
      objectId,
      extension: '../png' as never,
    }),
  )
})
