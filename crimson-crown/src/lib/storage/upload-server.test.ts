import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import * as nodeModule from 'node:module'
import test from 'node:test'

const sourceRoot = new URL('../../', import.meta.url)
const MiB = 1024 * 1024

const registerModuleHooks = (nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown
  }): void
}).registerHooks

registerModuleHooks({
  resolve(
    specifier: string,
    context: unknown,
    nextResolve: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === 'server-only') {
      return { shortCircuit: true, url: 'data:text/javascript,export%20{}' }
    }
    if (specifier.startsWith('@/')) {
      return {
        shortCircuit: true,
        url: new URL(`${specifier.slice(2)}.ts`, sourceRoot).href,
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  createUploadVerificationDependencies,
  verifyTrustedUploadedObject,
} = await import('./upload-server.ts')

const localEnvironment = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
})
const storageIdentity: Readonly<{ etag: string; version: string }> = Object.freeze({
  etag: '"storage-etag-v1"',
  version: '55555555-5555-4555-8555-555555555555',
})

function storedInfo(
  path: string,
  identity: Readonly<{ etag: string; version: string }> = storageIdentity,
) {
  return {
    bucketId: 'payment_proofs',
    name: path,
    contentType: 'image/png',
    size: 8,
    ...identity,
  }
}

function makeAdminClient(options: {
  info?: (path: string) => Promise<{ data: unknown; error: unknown }>
  remove?: (paths: string[]) => Promise<{ data: unknown; error: unknown }>
  buckets?: string[]
}) {
  return {
    storage: {
      from(bucket: string) {
        options.buckets?.push(bucket)
        return {
          info: options.info ?? (async () => ({ data: null, error: null })),
          remove: options.remove ?? (async () => ({ data: [], error: null })),
        }
      },
    },
  }
}

test('maps exact Supabase info metadata and treats only a 404 as missing', async () => {
  const buckets: string[] = []
  const paths: string[] = []
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({
      buckets,
      info: async (path) => {
        paths.push(path)
        return {
          data: storedInfo('orders/user/order/object.png'),
          error: null,
        }
      },
    }),
    fetch: async () => assert.fail('metadata lookup must use Storage info'),
  })

  assert.deepEqual(
    await dependencies.getStoredObjectMetadata(
      'payment_proofs',
      'orders/user/order/object.png',
    ),
    {
      bucket: 'payment_proofs',
      path: 'orders/user/order/object.png',
      mimeType: 'image/png',
      size: 8,
      ...storageIdentity,
    },
  )
  assert.deepEqual(buckets, ['payment_proofs'])
  assert.deepEqual(paths, ['orders/user/order/object.png'])

  const missing = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({
      info: async () => ({ data: null, error: { status: 404 } }),
    }),
    fetch: async () => assert.fail('metadata lookup must use Storage info'),
  })
  assert.equal(
    await missing.getStoredObjectMetadata('payment_proofs', 'orders/missing.png'),
    null,
  )
})

test('accepts only one strong top-level FileObjectV2 identity and canonicalizes bare hashes', async () => {
  const objectPath = 'orders/user/order/object.png'

  for (const fixture of [
    { etag: '"QuotedHash1234567890"', expected: '"QuotedHash1234567890"' },
    { etag: 'BareHash1234567890', expected: '"BareHash1234567890"' },
  ]) {
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        info: async () => ({
          data: storedInfo(objectPath, { ...storageIdentity, etag: fixture.etag }),
          error: null,
        }),
      }),
      fetch: async () => assert.fail('metadata lookup must use Storage info'),
    })
    const metadata = await dependencies.getStoredObjectMetadata('payment_proofs', objectPath)
    assert.equal(metadata?.etag, fixture.expected)
    assert.equal(metadata?.version, storageIdentity.version)
  }

  const invalidIdentities = [
    { etag: '*', version: storageIdentity.version },
    { etag: '"*"', version: storageIdentity.version },
    { etag: 'W/"weak"', version: storageIdentity.version },
    { etag: '"one", "two"', version: storageIdentity.version },
    { etag: 'white space', version: storageIdentity.version },
    { etag: '"line\nfeed"', version: storageIdentity.version },
    { etag: '"one" "two"', version: storageIdentity.version },
    { etag: storageIdentity.etag, version: 'not-a-uuid' },
    { etag: storageIdentity.etag, version: '00000000-0000-0000-0000-000000000000' },
  ]

  for (const identity of invalidIdentities) {
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        info: async () => ({ data: storedInfo(objectPath, identity), error: null }),
      }),
      fetch: async () => assert.fail('metadata lookup must use Storage info'),
    })
    const metadata = await dependencies.getStoredObjectMetadata('payment_proofs', objectPath)
    assert.equal(metadata?.etag, undefined)
    assert.equal(metadata?.version, undefined)
  }

  const metadataOnly = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({
      info: async () => ({
        data: {
          bucketId: 'payment_proofs',
          name: objectPath,
          metadata: {
            ...storageIdentity,
            mimetype: 'image/png',
            size: 8,
          },
        },
        error: null,
      }),
    }),
    fetch: async () => assert.fail('metadata lookup must use Storage info'),
  })
  const fallback = await metadataOnly.getStoredObjectMetadata('payment_proofs', objectPath)
  assert.equal(fallback?.mimeType, 'image/png')
  assert.equal(fallback?.size, 8)
  assert.equal(fallback?.etag, undefined)
  assert.equal(fallback?.version, undefined)
})

test('performs one authenticated, encoded and range-bounded streaming GET even when status is 200', async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([1, 2]))
            controller.enqueue(Uint8Array.from([3, 4]))
            controller.close()
          },
        }),
        { status: 200 },
      )
    },
  })

  const bytes = await dependencies.readObjectBytes(
    'payment_proofs',
    'folder/card #1.png',
    storageIdentity,
    4,
  )

  assert.deepEqual(bytes, Uint8Array.from([1, 2, 3, 4]))
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url,
    'http://127.0.0.1:54621/storage/v1/object/payment_proofs/folder/card%20%231.png',
  )
  assert.deepEqual(requests[0]?.init, {
    cache: 'no-store',
    headers: {
      apikey: 'test-service-role-key',
      Authorization: 'Bearer test-service-role-key',
      'If-Match': storageIdentity.etag,
      Range: 'bytes=0-4',
    },
    method: 'GET',
    redirect: 'error',
  })
})

test('rejects redirects, precondition failures and unexpected 2xx without following locations', async () => {
  const statuses = [201, 302, 412] as const

  for (const status of statuses) {
    const requests: RequestInit[] = []
    let cancelCalls = 0
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({}),
      fetch: async (_input, init) => {
        requests.push(init ?? {})
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from([1]))
          },
          cancel() {
            cancelCalls += 1
            if (status === 412) throw new Error('secret cancellation failure')
          },
        }), {
          status,
          headers: status === 302
            ? { Location: 'https://attacker.example/steal' }
            : undefined,
        })
      },
    })

    await assert.rejects(
      dependencies.readObjectBytes(
        'payment_proofs',
        'orders/private.png',
        storageIdentity,
        8,
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.redirect, 'error')
    assert.equal(cancelCalls, 1)
  }
})

test('requires a consistent Content-Range for 206 and preserves max-plus-one sentinel semantics', async () => {
  const invalidRanges = [
    null,
    'bytes 1-4/10',
    'bytes 0-5/10',
    'bytes 0-3/3',
    'bytes 0-2/4',
  ]

  for (const contentRange of invalidRanges) {
    let cancelCalls = 0
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({}),
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3, 4]))
        },
        cancel() {
          cancelCalls += 1
        },
      }), {
        status: 206,
        headers: contentRange === null ? undefined : { 'Content-Range': contentRange },
      }),
    })

    await assert.rejects(
      dependencies.readObjectBytes(
        'payment_proofs',
        'folder/object.png',
        storageIdentity,
        4,
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.equal(cancelCalls, 1)
  }

  for (const fixture of [
    {
      body: Uint8Array.from([1, 2, 3, 4]),
      contentRange: 'bytes 0-3/4',
      expectedLength: 4,
    },
    {
      body: Uint8Array.from([1, 2, 3, 4, 5]),
      contentRange: 'bytes 0-4/6',
      expectedLength: 5,
    },
  ]) {
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({}),
      fetch: async () => new Response(fixture.body, {
        status: 206,
        headers: { 'Content-Range': fixture.contentRange },
      }),
    })
    const bytes = await dependencies.readObjectBytes(
      'payment_proofs',
      'folder/object.png',
      storageIdentity,
      4,
    )
    assert.equal(bytes?.byteLength, fixture.expectedLength)
  }
})

test('uses one max-plus-one buffer, ignores empty chunks, and cancels known oversize bodies', async () => {
  const streamed = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(0))
        controller.enqueue(Uint8Array.from([1, 2]))
        controller.enqueue(new Uint8Array(0))
        controller.enqueue(Uint8Array.from([3]))
        controller.close()
      },
    }), { status: 200 }),
  })

  const bytes = await streamed.readObjectBytes(
    'payment_proofs',
    'folder/object.png',
    storageIdentity,
    4,
  )
  assert.deepEqual(bytes, Uint8Array.from([1, 2, 3]))
  assert.equal(bytes?.buffer.byteLength, 5)

  let cancelled = false
  let pulls = 0
  const knownOversize = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(Uint8Array.from([1]))
      },
      cancel() {
        cancelled = true
      },
    }), {
      status: 200,
      headers: { 'Content-Length': '6' },
    }),
  })

  const sentinel = await knownOversize.readObjectBytes(
    'payment_proofs',
    'folder/object.png',
    storageIdentity,
    5,
  )
  assert.equal(sentinel?.byteLength, 6)
  assert.equal(cancelled, true)
  assert.ok(pulls <= 1)

  let invalidHeaderCancels = 0
  const invalidHeader = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]))
      },
      cancel() {
        invalidHeaderCancels += 1
      },
    }), {
      status: 200,
      headers: { 'Content-Length': 'not-a-number' },
    }),
  })
  await assert.rejects(
    invalidHeader.readObjectBytes(
      'payment_proofs',
      'folder/object.png',
      storageIdentity,
      5,
    ),
    { name: 'Error', message: 'No se pudo verificar el archivo.' },
  )
  assert.equal(invalidHeaderCancels, 1)
})

test('cancels a chunked response as soon as it exceeds the limit', async () => {
  let cancelled = false
  let pulls = 0
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async () => new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array(3 * MiB))
        },
        cancel() {
          cancelled = true
        },
      }),
      { status: 200 },
    ),
  })

  const bytes = await dependencies.readObjectBytes(
    'payment_proofs',
    'folder/object.png',
    storageIdentity,
    5 * MiB,
  )

  assert.equal(bytes?.byteLength, 5 * MiB + 1)
  assert.equal(cancelled, true)
  assert.ok(pulls <= 3)
})

test('accepts exactly 5 MiB while retaining the expected-size-plus-one sentinel buffer', async () => {
  const exactLimit = 5 * MiB
  const requests: RequestInit[] = []
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({}),
    fetch: async (_input, init) => {
      requests.push(init ?? {})
      return new Response(new Uint8Array(exactLimit), {
        status: 206,
        headers: { 'Content-Range': `bytes 0-${exactLimit - 1}/${exactLimit}` },
      })
    },
  })

  const bytes = await dependencies.readObjectBytes(
    'payment_proofs',
    'folder/object.png',
    storageIdentity,
    exactLimit,
  )

  assert.equal(
    requests[0]?.headers && new Headers(requests[0].headers).get('Range'),
    `bytes=0-${exactLimit}`,
  )
  assert.equal(bytes?.byteLength, exactLimit)
  assert.equal(bytes?.buffer.byteLength, exactLimit + 1)
})

test('returns null for a download 404 and removes only the exact requested object', async () => {
  const buckets: string[] = []
  const removals: string[][] = []
  let missingBodyCancels = 0
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({
      buckets,
      info: async (path) => ({ data: storedInfo(path), error: null }),
      remove: async (paths) => {
        removals.push(paths)
        return { data: [], error: null }
      },
    }),
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]))
      },
      cancel() {
        missingBodyCancels += 1
      },
    }), { status: 404 }),
  })

  assert.equal(
    await dependencies.readObjectBytes(
      'payment_proofs',
      'orders/missing.png',
      storageIdentity,
      8,
    ),
    null,
  )
  assert.equal(missingBodyCancels, 1)
  await dependencies.removeExactObject(
    'payment_proofs',
    'orders/exact.png',
    storageIdentity,
  )
  assert.ok(buckets.length >= 1)
  assert.deepEqual([...new Set(buckets)], ['payment_proofs'])
  assert.deepEqual(removals, [['orders/exact.png']])
})

test('rechecks etag and version immediately before exact removal', async () => {
  for (const currentIdentity of [
    { ...storageIdentity, etag: '"replacement-etag"' },
    { ...storageIdentity, version: 'replacement-version' },
  ]) {
    let removed = false
    const dependencies = createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        info: async (path) => ({ data: storedInfo(path, currentIdentity), error: null }),
        remove: async () => {
          removed = true
          return { data: [], error: null }
        },
      }),
      fetch: async () => assert.fail('removal recheck must use Storage info'),
    })

    await assert.rejects(
      dependencies.removeExactObject(
        'payment_proofs',
        'orders/exact.png',
        storageIdentity,
      ),
      { name: 'Error', message: 'No se pudo verificar el archivo.' },
    )
    assert.equal(removed, false)
  }
})

test('guards the runtime target and never leaks keys, paths or privileged errors', async () => {
  const secret = localEnvironment.SUPABASE_SERVICE_ROLE_KEY
  const privatePath = 'orders/private/object.png'
  const failures: Array<() => unknown | Promise<unknown>> = [
    () => createUploadVerificationDependencies({
      environment: {
        ...localEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: 'https://djfqozfaqkqdoqeoqbzt.supabase.co',
      },
      createAdminClient: () => makeAdminClient({}),
      fetch: async () => new Response(null, { status: 200 }),
    }),
    async () => createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        info: async () => ({ data: null, error: new Error(`${secret} ${privatePath}`) }),
      }),
      fetch: async () => new Response(null, { status: 200 }),
    }).getStoredObjectMetadata('payment_proofs', privatePath),
    async () => createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({}),
      fetch: async () => {
        throw new Error(`${secret} ${privatePath}`)
      },
    }).readObjectBytes('payment_proofs', privatePath, storageIdentity, 8),
    async () => createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        remove: async () => ({ data: null, error: new Error(`${secret} ${privatePath}`) }),
      }),
      fetch: async () => new Response(null, { status: 200 }),
    }).removeExactObject('payment_proofs', privatePath, storageIdentity),
  ]

  for (const failure of failures) {
    const caught = await Promise.resolve().then(() => failure()).then(
      () => null,
      (error: unknown) => error,
    )
    assert.ok(caught instanceof Error)
    assert.equal(caught.message, 'No se pudo verificar el archivo.')
    assert.doesNotMatch(caught.message, /service|private|orders|payment_proofs/u)
  }
})

test('is server-only and exposes verification only to the three trusted proof finalizers', async () => {
  const [serverSource, actionSource] = await Promise.all([
    readFile(new URL('./upload-server.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../app/actions/storage-uploads.ts', import.meta.url), 'utf8'),
  ])

  assert.match(serverSource, /^import 'server-only'/u)
  assert.match(serverSource, /createAdminClient/u)
  assert.match(serverSource, /conditional DELETE/u)
  assert.match(serverSource, /Task 7/u)
  assert.doesNotMatch(serverSource, /^['"]use server['"]/u)
  assert.match(actionSource, /verifyTrustedUploadedObject/u)
  assert.equal(typeof verifyTrustedUploadedObject, 'function')

  const relativeFiles = await readdir(sourceRoot, { recursive: true })
  const trustedHelperCallsites: string[] = []
  for (const relativeFile of relativeFiles) {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (!/\.(?:ts|tsx)$/u.test(normalized)) continue
    if (
      normalized === 'lib/storage/upload-server.ts' ||
      normalized === 'lib/storage/upload-server.test.ts'
    ) {
      continue
    }
    const source = await readFile(new URL(normalized, sourceRoot), 'utf8')
    if (/verifyTrustedUploadedObject/u.test(source)) trustedHelperCallsites.push(normalized)
  }
  assert.deepEqual(trustedHelperCallsites.sort(), [
    'app/actions/commissions.ts',
    'app/actions/imports.ts',
    'app/actions/storage-uploads.ts',
  ])
})
