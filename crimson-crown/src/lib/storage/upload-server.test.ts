import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
          data: {
            bucketId: 'payment_proofs',
            name: 'orders/user/order/object.png',
            contentType: 'image/png',
            size: 8,
          },
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
      Range: 'bytes=0-4',
    },
    method: 'GET',
  })
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
      { status: 206 },
    ),
  })

  const bytes = await dependencies.readObjectBytes(
    'payment_proofs',
    'folder/object.png',
    5 * MiB,
  )

  assert.equal(bytes?.byteLength, 5 * MiB + 1)
  assert.equal(cancelled, true)
  assert.ok(pulls <= 3)
})

test('returns null for a download 404 and removes only the exact requested object', async () => {
  const buckets: string[] = []
  const removals: string[][] = []
  const dependencies = createUploadVerificationDependencies({
    environment: localEnvironment,
    createAdminClient: () => makeAdminClient({
      buckets,
      remove: async (paths) => {
        removals.push(paths)
        return { data: [], error: null }
      },
    }),
    fetch: async () => new Response(null, { status: 404 }),
  })

  assert.equal(
    await dependencies.readObjectBytes('payment_proofs', 'orders/missing.png', 8),
    null,
  )
  await dependencies.removeExactObject('payment_proofs', 'orders/exact.png')
  assert.deepEqual(buckets, ['payment_proofs'])
  assert.deepEqual(removals, [['orders/exact.png']])
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
    }).readObjectBytes('payment_proofs', privatePath, 8),
    async () => createUploadVerificationDependencies({
      environment: localEnvironment,
      createAdminClient: () => makeAdminClient({
        remove: async () => ({ data: null, error: new Error(`${secret} ${privatePath}`) }),
      }),
      fetch: async () => new Response(null, { status: 200 }),
    }).removeExactObject('payment_proofs', privatePath),
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

test('is server-only and exposes a trusted helper rather than a public verification action', async () => {
  const [serverSource, actionSource] = await Promise.all([
    readFile(new URL('./upload-server.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../app/actions/storage-uploads.ts', import.meta.url), 'utf8'),
  ])

  assert.match(serverSource, /^import 'server-only'/u)
  assert.match(serverSource, /createAdminClient/u)
  assert.doesNotMatch(serverSource, /^['"]use server['"]/u)
  assert.doesNotMatch(actionSource, /verifyTrustedUploadedObject|verifyUploadedObject/u)
  assert.equal(typeof verifyTrustedUploadedObject, 'function')
})
