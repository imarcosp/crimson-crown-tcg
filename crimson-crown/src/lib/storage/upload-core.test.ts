import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

import {
  createUploadTicketCore,
  verifyUploadedObjectCore,
  type CreateUploadTicketDependencies,
  type StoredObjectMetadata,
  type UploadActor,
  type VerifyUploadedObjectDependencies,
} from './upload-core.ts'
import { validateUploadIntent } from './upload-policy.ts'

const MiB = 1024 * 1024
const userId = '11111111-1111-4111-8111-111111111111'
const recordId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const inventoryId = '44444444-4444-4444-8444-444444444444'
const importRecordId = '42'
const orderPath = `orders/${userId}/${recordId}/${objectId}.png`
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const standardActor: UploadActor = Object.freeze({
  userId,
  email: 'tester@example.test',
  isAdmin: false,
  isCommissionAdmin: false,
})

function makeTicketDependencies(
  overrides: Partial<CreateUploadTicketDependencies> = {},
): CreateUploadTicketDependencies {
  return {
    randomUUID: () => objectId,
    getActor: async () => standardActor,
    assertRecordAccess: async () => undefined,
    createSignedUploadUrl: async (_bucket, path) => ({ token: 'signed-token', path }),
    ...overrides,
  }
}

test('authenticates, canonicalizes and authorizes an order before signing one exact non-upsert path', async () => {
  const calls: string[] = []
  const ticket = await createUploadTicketCore(
    { kind: 'order-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' },
    makeTicketDependencies({
      getActor: async () => {
        calls.push('authenticate')
        return standardActor
      },
      assertRecordAccess: async (request) => {
        calls.push('authorize-record')
        assert.deepEqual(request, { kind: 'order-proof', recordId, actor: standardActor })
      },
      randomUUID: () => {
        calls.push('random-path')
        return objectId
      },
      createSignedUploadUrl: async (bucket, path, options) => {
        calls.push('sign')
        assert.equal(bucket, 'payment_proofs')
        assert.equal(path, orderPath)
        assert.deepEqual(options, { upsert: false })
        return { token: 'signed-token', path }
      },
    }),
  )

  assert.deepEqual(calls, ['authenticate', 'random-path', 'authorize-record', 'sign'])
  assert.deepEqual(ticket, {
    bucket: 'payment_proofs',
    path: orderPath,
    token: 'signed-token',
  })
  assert.equal(Object.isFrozen(ticket), true)
})

test('derives each bucket and canonical identity scope before signing', async () => {
  const cases = [
    {
      input: { kind: 'customer-product-request', name: 'request.png', size: 8, mimeType: 'image/png' } as const,
      actor: standardActor,
      expectedBucket: 'products',
      expectedPath: `requests/${userId}/${objectId}.png`,
      expectedRecord: null,
    },
    {
      input: { kind: 'admin-product-image', inventoryId, name: 'card.jpg', size: 8, mimeType: 'image/jpeg' } as const,
      actor: { ...standardActor, isAdmin: true },
      expectedBucket: 'products',
      expectedPath: `catalog/${inventoryId}/${objectId}.jpg`,
      expectedRecord: inventoryId,
    },
    {
      input: { kind: 'banner', name: 'hero.webp', size: 8, mimeType: 'image/webp' } as const,
      actor: { ...standardActor, isAdmin: true },
      expectedBucket: 'banners',
      expectedPath: `site/${objectId}.webp`,
      expectedRecord: null,
    },
    {
      input: { kind: 'import-proof', recordId: importRecordId, name: 'proof.pdf', size: 8, mimeType: 'application/pdf' } as const,
      actor: standardActor,
      expectedBucket: 'payment_proofs',
      expectedPath: `imports/${userId}/${importRecordId}/${objectId}.pdf`,
      expectedRecord: importRecordId,
    },
    {
      input: { kind: 'commission-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' } as const,
      actor: { ...standardActor, isCommissionAdmin: true },
      expectedBucket: 'payment_proofs',
      expectedPath: `commissions/${recordId}/${userId}/${objectId}.png`,
      expectedRecord: recordId,
    },
  ]

  for (const fixture of cases) {
    const authorizedRecords: string[] = []
    const ticket = await createUploadTicketCore(
      fixture.input,
      makeTicketDependencies({
        getActor: async () => fixture.actor,
        assertRecordAccess: async ({ recordId: authorizedRecordId }) => {
          authorizedRecords.push(authorizedRecordId)
        },
      }),
    )

    assert.equal(ticket.bucket, fixture.expectedBucket)
    assert.equal(ticket.path, fixture.expectedPath)
    assert.deepEqual(
      authorizedRecords,
      fixture.expectedRecord === null ? [] : [fixture.expectedRecord],
    )
  }
})

test('validates and canonicalizes every path locator before record access or signing', async () => {
  const malformedCases = [
    {
      input: { kind: 'admin-product-image', inventoryId: 'not-a-uuid', name: 'card.png', size: 8, mimeType: 'image/png' } as const,
      actor: { ...standardActor, isAdmin: true },
      randomUUID: objectId,
    },
    {
      input: { kind: 'order-proof', recordId: 'not-a-uuid', name: 'proof.png', size: 8, mimeType: 'image/png' } as const,
      actor: standardActor,
      randomUUID: objectId,
    },
    {
      input: { kind: 'import-proof', recordId: '9'.repeat(5_000), name: 'proof.pdf', size: 8, mimeType: 'application/pdf' } as const,
      actor: standardActor,
      randomUUID: objectId,
    },
    {
      input: { kind: 'order-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' } as const,
      actor: { ...standardActor, userId: 'not-a-uuid' },
      randomUUID: objectId,
    },
    {
      input: { kind: 'order-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' } as const,
      actor: standardActor,
      randomUUID: 'not-a-uuid',
    },
  ]

  for (const fixture of malformedCases) {
    let accessCalls = 0
    let signCalls = 0

    await assert.rejects(
      createUploadTicketCore(
        fixture.input,
        makeTicketDependencies({
          getActor: async () => fixture.actor,
          randomUUID: () => fixture.randomUUID,
          assertRecordAccess: async () => {
            accessCalls += 1
          },
          createSignedUploadUrl: async (_bucket, path) => {
            signCalls += 1
            return { token: 'signed-token', path }
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo autorizar la carga.' },
    )

    assert.equal(accessCalls, 0)
    assert.equal(signCalls, 0)
  }

  const uppercaseRecordId = recordId.toUpperCase()
  const canonicalRecordIds: string[] = []
  await createUploadTicketCore(
    { kind: 'order-proof', recordId: uppercaseRecordId, name: 'proof.png', size: 8, mimeType: 'image/png' },
    makeTicketDependencies({
      assertRecordAccess: async ({ recordId: authorizedRecordId }) => {
        canonicalRecordIds.push(authorizedRecordId)
      },
    }),
  )

  assert.deepEqual(canonicalRecordIds, [recordId])
})

test('rejects catalog and banner tickets for non-admins before record access or signing', async () => {
  for (const input of [
    { kind: 'admin-product-image', inventoryId, name: 'card.png', size: 8, mimeType: 'image/png' } as const,
    { kind: 'banner', name: 'hero.png', size: 8, mimeType: 'image/png' } as const,
  ]) {
    let authorized = false
    let signed = false
    await assert.rejects(
      createUploadTicketCore(
        input,
        makeTicketDependencies({
          assertRecordAccess: async () => {
            authorized = true
          },
          createSignedUploadUrl: async (_bucket, path) => {
            signed = true
            return { token: 'signed-token', path }
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo autorizar la carga.' },
    )
    assert.equal(authorized, false)
    assert.equal(signed, false)
  }
})

test('rejects commission tickets without commission authority before access or signing', async () => {
  let authorized = false
  let signed = false

  await assert.rejects(
    createUploadTicketCore(
      { kind: 'commission-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' },
      makeTicketDependencies({
        getActor: async () => ({ ...standardActor, isAdmin: true, isCommissionAdmin: false }),
        assertRecordAccess: async () => {
          authorized = true
        },
        createSignedUploadUrl: async (_bucket, path) => {
          signed = true
          return { token: 'signed-token', path }
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo autorizar la carga.' },
  )
  assert.equal(authorized, false)
  assert.equal(signed, false)
})

test('rejects unauthenticated and wrong-owner requests before signing without leaking dependency details', async () => {
  const secret = 'service-role-secret-value'
  const email = 'victim@example.test'
  const path = 'orders/victim/private.png'
  let signed = false

  for (const getActor of [
    async () => null,
    async () => standardActor,
  ]) {
    const error = await createUploadTicketCore(
      { kind: 'order-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' },
      makeTicketDependencies({
        getActor,
        assertRecordAccess: async () => {
          throw new Error(`${secret} ${email} ${path}`)
        },
        createSignedUploadUrl: async (_bucket, requestedPath) => {
          signed = true
          return { token: 'signed-token', path: requestedPath }
        },
      }),
    ).then(
      () => null,
      (caught: unknown) => caught,
    )

    assert.ok(error instanceof Error)
    assert.equal(error.message, 'No se pudo autorizar la carga.')
    assert.doesNotMatch(error.message, new RegExp(`${secret}|${email}|victim|private`, 'u'))
  }
  assert.equal(signed, false)
})

test('rejects signer errors, empty tokens and returned path drift with one generic error', async () => {
  const cases: CreateUploadTicketDependencies['createSignedUploadUrl'][] = [
    async () => {
      throw new Error('service-key=secret path=private email=user@example.test')
    },
    async (_bucket, path) => ({ token: '', path }),
    async () => ({ token: 'signed-token', path: 'site/other.png' }),
  ]

  for (const createSignedUploadUrl of cases) {
    await assert.rejects(
      createUploadTicketCore(
        { kind: 'order-proof', recordId, name: 'proof.png', size: 8, mimeType: 'image/png' },
        makeTicketDependencies({ createSignedUploadUrl }),
      ),
      { name: 'Error', message: 'No se pudo autorizar la carga.' },
    )
  }
})

const validatedPngIntent = validateUploadIntent({
  kind: 'order-proof',
  name: 'proof.png',
  size: pngBytes.byteLength,
  mimeType: 'image/png',
})

const storedIdentity: Readonly<{ etag: string; version: string }> = Object.freeze({
  etag: '"storage-etag-v1"',
  version: '55555555-5555-4555-8555-555555555555',
})

const validStoredMetadata: StoredObjectMetadata = Object.freeze({
  bucket: 'payment_proofs',
  path: orderPath,
  mimeType: 'image/png',
  size: pngBytes.byteLength,
  ...storedIdentity,
})

function makeVerifyDependencies(
  overrides: Partial<VerifyUploadedObjectDependencies> = {},
): VerifyUploadedObjectDependencies {
  return {
    getStoredObjectMetadata: async () => validStoredMetadata,
    readObjectBytes: async () => pngBytes,
    removeExactObject: async () => undefined,
    ...overrides,
  }
}

function verifyInput() {
  return {
    bucket: 'payment_proofs' as const,
    path: orderPath,
    expectedBucket: 'payment_proofs' as const,
    expectedPath: orderPath,
    intent: validatedPngIntent,
  }
}

test('passes the validated eight-byte intent as the adapter read limit', async () => {
  const calls: string[] = []

  await verifyUploadedObjectCore(
    verifyInput(),
    makeVerifyDependencies({
      getStoredObjectMetadata: async (bucket, path) => {
        calls.push('metadata')
        assert.equal(bucket, 'payment_proofs')
        assert.equal(path, orderPath)
        return validStoredMetadata
      },
      readObjectBytes: async (bucket, path, identity, maxBytes) => {
        calls.push('read')
        assert.equal(bucket, 'payment_proofs')
        assert.equal(path, orderPath)
        assert.deepEqual(identity, storedIdentity)
        assert.equal(maxBytes, pngBytes.byteLength)
        return pngBytes
      },
      removeExactObject: async () => {
        assert.fail('a valid object must not be removed')
      },
    }),
  )

  assert.deepEqual(calls, ['metadata', 'read'])
})

test('fails closed on a missing object without reading, removing or changing business state', async () => {
  const calls: string[] = []

  await assert.rejects(
    verifyUploadedObjectCore(
      verifyInput(),
      makeVerifyDependencies({
        getStoredObjectMetadata: async () => {
          calls.push('metadata-missing')
          return null
        },
        readObjectBytes: async () => {
          calls.push('read')
          return pngBytes
        },
        removeExactObject: async () => {
          calls.push('remove')
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )

  assert.deepEqual(calls, ['metadata-missing'])
})

test('does not remove an untrusted bucket or path when the reference differs from the expected ticket', async () => {
  const calls: string[] = []

  await assert.rejects(
    verifyUploadedObjectCore(
      { ...verifyInput(), bucket: 'products', path: `catalog/${inventoryId}/${objectId}.png` },
      makeVerifyDependencies({
        getStoredObjectMetadata: async () => {
          calls.push('metadata')
          return validStoredMetadata
        },
        removeExactObject: async () => {
          calls.push('remove')
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )

  assert.deepEqual(calls, [])
})

test('rejects a malformed import bigint path generically before touching Storage', async () => {
  const malformedPath = `imports/${userId}/not-decimal/${objectId}.pdf`
  const calls: string[] = []

  await assert.rejects(
    verifyUploadedObjectCore(
      {
        bucket: 'payment_proofs',
        path: malformedPath,
        expectedBucket: 'payment_proofs',
        expectedPath: malformedPath,
        intent: validateUploadIntent({
          kind: 'import-proof',
          name: 'proof.pdf',
          size: 8,
          mimeType: 'application/pdf',
        }),
      },
      makeVerifyDependencies({
        getStoredObjectMetadata: async () => {
          calls.push('metadata')
          return null
        },
        removeExactObject: async () => {
          calls.push('remove')
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )

  assert.deepEqual(calls, [])
})

test('rejects an arbitrarily long import path before bigint conversion or Storage access', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BigInt')
  const originalBigInt = globalThis.BigInt
  const hugeRecordId = '9'.repeat(5_000)
  const hugePath = `imports/${userId}/${hugeRecordId}/${objectId}.pdf`
  let conversions = 0
  let storageCalls = 0

  assert.ok(originalDescriptor)

  Object.defineProperty(globalThis, 'BigInt', {
    configurable: true,
    value(value: string | number | bigint | boolean) {
      conversions += 1
      return originalBigInt(value)
    },
  })

  try {
    await assert.rejects(
      verifyUploadedObjectCore(
        {
          bucket: 'payment_proofs',
          path: hugePath,
          expectedBucket: 'payment_proofs',
          expectedPath: hugePath,
          intent: validateUploadIntent({
            kind: 'import-proof',
            name: 'proof.pdf',
            size: 8,
            mimeType: 'application/pdf',
          }),
        },
        makeVerifyDependencies({
          getStoredObjectMetadata: async () => {
            storageCalls += 1
            return null
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.equal(conversions, 0)
    assert.equal(storageCalls, 0)
  } finally {
    Object.defineProperty(globalThis, 'BigInt', originalDescriptor)
  }
})

test('removes only the exact expected object when stored MIME, size or path metadata is invalid', async () => {
  const invalidMetadata: StoredObjectMetadata[] = [
    { ...validStoredMetadata, mimeType: 'image/jpeg' },
    { ...validStoredMetadata, size: pngBytes.byteLength + 1 },
    { ...validStoredMetadata, size: 5 * MiB + 1 },
    { ...validStoredMetadata, path: `${orderPath}.drift` },
    { ...validStoredMetadata, bucket: 'products' },
  ]

  for (const metadata of invalidMetadata) {
    const removals: Array<[string, string, typeof storedIdentity]> = []
    let read = false
    await assert.rejects(
      verifyUploadedObjectCore(
        verifyInput(),
        makeVerifyDependencies({
          getStoredObjectMetadata: async () => metadata,
          readObjectBytes: async () => {
            read = true
            return pngBytes
          },
          removeExactObject: async (bucket, path, identity) => {
            removals.push([bucket, path, identity])
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.equal(read, false)
    assert.deepEqual(removals, [['payment_proofs', orderPath, storedIdentity]])
  }
})

test('requires a non-empty etag and version before reading or removing an object', async () => {
  for (const metadata of [
    { ...validStoredMetadata, etag: '' },
    { ...validStoredMetadata, etag: '*' },
    { ...validStoredMetadata, etag: 'W/"weak-etag"' },
    { ...validStoredMetadata, etag: '"one", "two"' },
    { ...validStoredMetadata, etag: '"white space"' },
    { ...validStoredMetadata, version: 'not-a-storage-version' },
    { ...validStoredMetadata, version: '00000000-0000-0000-0000-000000000000' },
    { ...validStoredMetadata, etag: undefined },
    { ...validStoredMetadata, version: null },
  ]) {
    const calls: string[] = []
    await assert.rejects(
      verifyUploadedObjectCore(
        verifyInput(),
        makeVerifyDependencies({
          getStoredObjectMetadata: async () => metadata,
          readObjectBytes: async () => {
            calls.push('read')
            return pngBytes
          },
          removeExactObject: async () => {
            calls.push('remove')
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.deepEqual(calls, [])
  }
})

test('canonicalizes a safe bare etag and uppercase storage version before reading', async () => {
  const identities: Array<Readonly<{ etag: string; version: string }>> = []
  await verifyUploadedObjectCore(
    verifyInput(),
    makeVerifyDependencies({
      getStoredObjectMetadata: async () => ({
        ...validStoredMetadata,
        etag: 'BareHash1234567890',
        version: storedIdentity.version.toUpperCase(),
      }),
      readObjectBytes: async (_bucket, _path, identity) => {
        identities.push(identity)
        return pngBytes
      },
    }),
  )

  assert.deepEqual(identities, [{
    etag: '"BareHash1234567890"',
    version: storedIdentity.version,
  }])
})

test('removes only the exact object when bytes exceed limits, disagree with size, or fail signature', async () => {
  const oneByteOversize = new Uint8Array(pngBytes.byteLength + 1)
  oneByteOversize.set(pngBytes)
  const byteFixtures = [
    oneByteOversize,
    pngBytes.subarray(0, pngBytes.byteLength - 1),
    new TextEncoder().encode('<script>'),
  ]

  for (const bytes of byteFixtures) {
    const removals: Array<[string, string, typeof storedIdentity]> = []
    await assert.rejects(
      verifyUploadedObjectCore(
        verifyInput(),
        makeVerifyDependencies({
          readObjectBytes: async (_bucket, _path, identity, maxBytes) => {
            assert.deepEqual(identity, storedIdentity)
            assert.equal(maxBytes, pngBytes.byteLength)
            return bytes
          },
          removeExactObject: async (bucket, path, identity) => {
            removals.push([bucket, path, identity])
          },
        }),
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.deepEqual(removals, [['payment_proofs', orderPath, storedIdentity]])
  }
})

test('accepts an exact 5 MiB intent without an off-by-one rejection', async () => {
  const exactLimitBytes = new Uint8Array(5 * MiB)
  exactLimitBytes.set(pngBytes)
  const exactLimitIntent = validateUploadIntent({
    kind: 'order-proof',
    name: 'proof.png',
    size: exactLimitBytes.byteLength,
    mimeType: 'image/png',
  })

  await verifyUploadedObjectCore(
    { ...verifyInput(), intent: exactLimitIntent },
    makeVerifyDependencies({
      getStoredObjectMetadata: async () => ({
        ...validStoredMetadata,
        size: exactLimitBytes.byteLength,
      }),
      readObjectBytes: async (_bucket, _path, _identity, maxBytes) => {
        assert.equal(maxBytes, 5 * MiB)
        return exactLimitBytes
      },
      removeExactObject: async () => assert.fail('an exact-limit object must not be removed'),
    }),
  )
})

test('does not remove an object when the identity-conditional read fails', async () => {
  const removals: string[] = []
  await assert.rejects(
    verifyUploadedObjectCore(
      verifyInput(),
      makeVerifyDependencies({
        readObjectBytes: async (_bucket, _path, identity) => {
          assert.deepEqual(identity, storedIdentity)
          throw new Error('412 precondition failed')
        },
        removeExactObject: async () => {
          removals.push('remove')
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )
  assert.deepEqual(removals, [])
})

test('treats a disappearance during bounded read as missing and does not remove anything', async () => {
  const removals: Array<[string, string]> = []

  await assert.rejects(
    verifyUploadedObjectCore(
      verifyInput(),
      makeVerifyDependencies({
        readObjectBytes: async () => null,
        removeExactObject: async (bucket, path) => {
          removals.push([bucket, path])
        },
      }),
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )
  assert.deepEqual(removals, [])
})

test('never leaks storage errors, keys, emails or paths during verification or cleanup', async () => {
  const caught = await verifyUploadedObjectCore(
    verifyInput(),
    makeVerifyDependencies({
      readObjectBytes: async () => new TextEncoder().encode('<script>'),
      removeExactObject: async () => {
        throw new Error(`service-role-key user@example.test ${orderPath}`)
      },
    }),
  ).then(
    () => null,
    (error: unknown) => error,
  )

  assert.ok(caught instanceof Error)
  assert.equal(caught.message, 'No se pudo verificar el archivo.')
  assert.doesNotMatch(caught.message, /service|example|orders|payment_proofs/u)
})

test('keeps admin secrets outside the client graph and enforces exact SDK options', async () => {
  const [adminSource, actionSource, clientSource] = await Promise.all([
    readFile(new URL('../supabase/admin.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../app/actions/storage-uploads.ts', import.meta.url), 'utf8'),
    readFile(new URL('./upload-client.ts', import.meta.url), 'utf8'),
  ])

  assert.match(adminSource, /^import 'server-only'/u)
  assert.match(adminSource, /assertSafeRuntimeSupabaseUrl/u)
  assert.ok(adminSource.indexOf('assertSafeRuntimeSupabaseUrl') < adminSource.lastIndexOf('createClient('))
  assert.match(adminSource, /persistSession:\s*false/u)
  assert.match(adminSource, /autoRefreshToken:\s*false/u)
  assert.match(adminSource, /detectSessionInUrl:\s*false/u)
  assert.doesNotMatch(adminSource, /NEXT_PUBLIC_[A-Z0-9_]*SERVICE/u)
  assert.deepEqual(
    [...adminSource.matchAll(/\bexport\s+(?:async\s+)?function\s+(\w+)/gu)].map((match) => match[1]),
    ['createAdminClient'],
  )

  assert.match(actionSource, /^'use server'/u)
  assert.doesNotMatch(actionSource, /signedUrl|SUPABASE_SERVICE_ROLE_KEY/u)
  assert.match(clientSource, /^'use client'/u)
  assert.equal((clientSource.match(/\.uploadToSignedUrl\(/gu) ?? []).length, 1)
  assert.match(clientSource, /contentType:\s*file\.type/u)
  assert.match(clientSource, /upsert:\s*false/u)
  assert.doesNotMatch(clientSource, /supabase\/(admin|server)/u)

  const sourceRoot = new URL('../../', import.meta.url)
  const relativeFiles = await readdir(sourceRoot, { recursive: true })
  const clientServerSecretImports: string[] = []

  for (const relativeFile of relativeFiles) {
    if (!/\.(?:ts|tsx)$/u.test(relativeFile)) continue
    const source = await readFile(new URL(relativeFile.replaceAll('\\', '/'), sourceRoot), 'utf8')
    if (!/^\s*['"]use client['"]/u.test(source)) continue
    if (/['"]@\/lib\/supabase\/(?:admin|server)['"]/u.test(source)) {
      clientServerSecretImports.push(relativeFile)
    }
  }

  assert.deepEqual(clientServerSecretImports, [])
})
