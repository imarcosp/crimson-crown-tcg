import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { win32 as windowsPath } from 'node:path'
import { spawnSync } from 'node:child_process'
import dotenv from 'dotenv'
import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'
import { getPaymentProofAccessCore } from '../../src/lib/storage/payment-proof-access.ts'
import { createUploadTicketCore } from '../../src/lib/storage/upload-core.ts'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const parsedUrl = url ? new URL(url) : null
if (
  !url ||
  !anonKey ||
  !serviceKey ||
  parsedUrl?.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname) ||
  parsedUrl.port !== '54621' ||
  parsedUrl.username ||
  parsedUrl.password ||
  parsedUrl.pathname !== '/' ||
  parsedUrl.search ||
  parsedUrl.hash
) {
  throw new Error('La matriz de Storage sólo puede ejecutarse contra el API local exacto en loopback:54621.')
}

const identities = {
  standard: { email: 'tester.local@example.test', password: 'CrimsonLocalTester!2026' },
  admin: { email: 'admin.local@example.test', password: 'CrimsonLocalAdmin!2026' },
}

const bucketConfig = Object.freeze({
  products: Object.freeze({
    public: true,
    allowed: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  }),
  banners: Object.freeze({
    public: true,
    allowed: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  }),
  payment_proofs: Object.freeze({
    public: false,
    allowed: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  }),
})

const MAX_FILE_SIZE = 5 * 1024 * 1024
const EXPECTED_STACK_WORKDIR = 'D:\\crimson-crown-tcg\\crimson-crown'
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const replacementBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6])
const png = new Blob([pngBytes], { type: 'image/png' })
const replacementPng = new Blob([replacementBytes], { type: 'image/png' })
const runId = `${Date.now()}-${randomUUID()}`

function isExactStorageNotFound(error) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    error.name === 'StorageApiError' &&
    [400, 404].includes(error.status) &&
    String(error.statusCode) === '404',
  )
}

function assertExactPublishedPort(container, containerPort, expectedHostPort) {
  const bindings = container?.HostConfig?.PortBindings?.[containerPort]
  assert.equal(Array.isArray(bindings), true, 'El binding local de Storage no es verificable.')
  assert.equal(bindings.length, 1, 'El binding local de Storage debe ser único.')
  assert.equal(bindings[0]?.HostPort, expectedHostPort, 'El puerto local de Storage no coincide.')
}

function assertExactLocalStorageStack() {
  assert.equal(
    isExactStorageNotFound({ name: 'StorageApiError', status: 404, statusCode: '404' }),
    true,
  )
  assert.equal(
    isExactStorageNotFound({ name: 'StorageApiError', status: 400, statusCode: '404' }),
    true,
  )
  for (const error of [
    null,
    { name: 'StorageApiError', status: 401, statusCode: '401' },
    { name: 'StorageApiError', status: 403, statusCode: '403' },
    { name: 'StorageApiError', status: 500, statusCode: '500' },
    { name: 'StorageApiError', status: 500, statusCode: '404' },
    { name: 'StorageUnknownError', status: 404, statusCode: '404' },
  ]) {
    assert.equal(isExactStorageNotFound(error), false)
  }

  const inspected = spawnSync(
    'docker',
    ['inspect', 'supabase_kong_crimson-crown', 'supabase_db_crimson-crown'],
    { encoding: 'utf8', shell: false, windowsHide: true },
  )
  assert.equal(inspected.error, undefined, 'No se pudo inspeccionar el stack local exacto de Crimson.')
  assert.equal(inspected.status, 0, 'No se pudo inspeccionar el stack local exacto de Crimson.')

  let containers
  try {
    containers = JSON.parse(inspected.stdout)
  } catch {
    throw new Error('Docker no devolvió una identidad local verificable.')
  }
  assert.equal(Array.isArray(containers), true, 'Docker no devolvió una identidad local verificable.')
  assert.equal(containers.length, 2, 'El stack local exacto de Crimson está incompleto.')

  const api = containers.find((container) => container.Name === '/supabase_kong_crimson-crown')
  const database = containers.find((container) => container.Name === '/supabase_db_crimson-crown')
  assert.equal(api?.State?.Running, true, 'El API local exacto de Crimson no está activo.')
  assert.equal(database?.State?.Running, true, 'La base local exacta de Crimson no está activa.')
  assertExactPublishedPort(api, '8000/tcp', '54621')
  assertExactPublishedPort(database, '5432/tcp', '54622')

  const apiLabels = api?.Config?.Labels ?? {}
  const databaseLabels = database?.Config?.Labels ?? {}
  for (const labels of [apiLabels, databaseLabels]) {
    assert.equal(labels['com.docker.compose.project'], 'crimson-crown')
    assert.equal(labels['com.supabase.cli.project'], 'crimson-crown')
  }
  const apiWorkdir = windowsPath.resolve(apiLabels['com.supabase.cli.workdir'] ?? '')
  const databaseWorkdir = windowsPath.resolve(databaseLabels['com.supabase.cli.workdir'] ?? '')
  const expectedWorkdir = windowsPath.resolve(EXPECTED_STACK_WORKDIR)
  assert.equal(apiWorkdir.toLowerCase(), expectedWorkdir.toLowerCase())
  assert.equal(databaseWorkdir.toLowerCase(), expectedWorkdir.toLowerCase())
  assert.equal(apiWorkdir.toLowerCase(), databaseWorkdir.toLowerCase())
}

function client(key = anonKey) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(identity) {
  const supabase = client()
  const { data, error } = await supabase.auth.signInWithPassword(identities[identity])
  if (error || !data.user) {
    throw new Error(`No se pudo iniciar sesión como ${identity}: ${error?.message ?? 'usuario ausente'}`)
  }
  return Object.freeze({ client: supabase, user: data.user })
}

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function trackedPath(cleanup, bucket, path) {
  if (!cleanup.has(bucket)) cleanup.set(bucket, new Set())
  cleanup.get(bucket).add(path)
  return path
}

async function serviceUpload(service, cleanup, bucket, path, body = png, contentType = 'image/png') {
  trackedPath(cleanup, bucket, path)
  const { error } = await service.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: false,
  })
  assert.ifError(error)
}

async function assertObjectMissing(service, bucket, path) {
  const { data, error } = await service.storage.from(bucket).info(path)
  assert.equal(data, null, `quedó un objeto sintético: ${bucket}/${path}`)
  const status = error && typeof error === 'object'
    ? { name: error.name, status: error.status, statusCode: error.statusCode }
    : null
  assert.ok(
    isExactStorageNotFound(error),
    `Storage no confirmó un 404 exacto para ${bucket}/${path}: ${JSON.stringify(status)}`,
  )
}

async function assertDirectWritesDenied(role, roleClient, service, cleanup) {
  for (const bucket of Object.keys(bucketConfig)) {
    const root = bucket === 'products' ? 'imports/matrix-task7' : 'matrix-task7'
    const prefix = `${root}/${runId}/${role}/${bucket}`
    const insertPath = trackedPath(cleanup, bucket, `${prefix}/insert.png`)
    const updatePath = `${prefix}/update.png`
    const deletePath = `${prefix}/delete.png`

    await serviceUpload(service, cleanup, bucket, updatePath)
    await serviceUpload(service, cleanup, bucket, deletePath)

    const inserted = await roleClient.storage.from(bucket).upload(insertPath, png, {
      contentType: 'image/png',
      upsert: false,
    })
    assert.ok(inserted.error, `${role} no debe hacer INSERT directo en ${bucket}`)
    await assertObjectMissing(service, bucket, insertPath)

    const updated = await roleClient.storage.from(bucket).update(updatePath, replacementPng, {
      contentType: 'image/png',
      upsert: true,
    })
    assert.ok(updated.error, `${role} no debe hacer UPDATE directo en ${bucket}`)
    const afterUpdate = await service.storage.from(bucket).download(updatePath)
    assert.ifError(afterUpdate.error)
    assert.deepEqual(await bytesOf(afterUpdate.data), pngBytes, `${role} alteró ${bucket}/${updatePath}`)

    const removed = await roleClient.storage.from(bucket).remove([deletePath])
    assert.ok(
      removed.error || (Array.isArray(removed.data) && removed.data.length === 0),
      `${role} no debe obtener un DELETE efectivo en ${bucket}`,
    )
    const afterDelete = await service.storage.from(bucket).info(deletePath)
    assert.ifError(afterDelete.error)
    assert.ok(afterDelete.data, `${role} eliminó ${bucket}/${deletePath}`)
  }
}

async function assertBucketConfiguration(service) {
  for (const [bucket, expected] of Object.entries(bucketConfig)) {
    const { data, error } = await service.storage.getBucket(bucket)
    assert.ifError(error)
    assert.equal(data.public, expected.public, `public incorrecto para ${bucket}`)
    assert.equal(data.file_size_limit, MAX_FILE_SIZE, `límite incorrecto para ${bucket}`)
    assert.deepEqual(
      [...(data.allowed_mime_types ?? [])].sort(),
      [...expected.allowed].sort(),
      `MIME incorrectos para ${bucket}`,
    )
  }
}

async function assertPublicAndPrivateReads(anon, service, cleanup) {
  for (const bucket of ['products', 'banners']) {
    const path = `matrix-task7/${runId}/reads/${bucket}.png`
    await serviceUpload(service, cleanup, bucket, path)
    const { data } = anon.storage.from(bucket).getPublicUrl(path)
    const response = await fetch(data.publicUrl)
    assert.equal(response.status, 200, `lectura pública denegada en ${bucket}`)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes, `lectura pública incorrecta en ${bucket}`)
  }

  const privatePath = `matrix-task7/${runId}/reads/payment-proof.png`
  await serviceUpload(service, cleanup, 'payment_proofs', privatePath)
  const anonymousProof = await anon.storage.from('payment_proofs').download(privatePath)
  assert.equal(anonymousProof.data, null, 'anon no debe descargar comprobantes privados')
  assert.ok(anonymousProof.error, 'la descarga anónima de comprobantes debe fallar')
  const { data: publicProof } = anon.storage.from('payment_proofs').getPublicUrl(privatePath)
  const publicProofResponse = await fetch(publicProof.publicUrl)
  assert.notEqual(publicProofResponse.status, 200, 'el endpoint público no debe exponer comprobantes')
}

async function createAuthorizedOrderTicket(
  service,
  actor,
  recordOwnerUserId,
  recordId,
  objectId,
) {
  let authorizationCalls = 0
  let signerCalls = 0
  const ticket = await createUploadTicketCore(
    { kind: 'order-proof', recordId, name: 'proof.png', size: png.size, mimeType: 'image/png' },
    {
      randomUUID: () => objectId,
      getActor: async () => actor,
      assertRecordAccess: async (request) => {
        authorizationCalls += 1
        assert.equal(request.kind, 'order-proof')
        assert.equal(request.recordId, recordId)
        assert.deepEqual(request.actor, actor)
        if (request.actor.userId !== recordOwnerUserId) {
          throw new Error('forbidden')
        }
      },
      createSignedUploadUrl: async (bucket, path, options) => {
        signerCalls += 1
        assert.equal(bucket, 'payment_proofs')
        assert.deepEqual(options, { upsert: false })
        const { data, error } = await service.storage
          .from(bucket)
          .createSignedUploadUrl(path, options)
        assert.ifError(error)
        assert.equal(data.path, path)
        return Object.freeze({ token: data.token, path: data.path })
      },
    },
  )
  assert.equal(authorizationCalls, 1, 'cada ticket de orden debe autorizar exactamente un registro')
  assert.equal(signerCalls, 1, 'cada ticket autorizado debe invocar una sola vez el firmante')
  return ticket
}

async function assertSignedUploads(service, uploader, cleanup, standardUser, adminUser) {
  const orderId = randomUUID()
  const standardActor = Object.freeze({
    userId: standardUser.id,
    email: standardUser.email,
    isAdmin: false,
    isCommissionAdmin: false,
  })
  const adminActor = Object.freeze({
    userId: adminUser.id,
    email: adminUser.email,
    isAdmin: true,
    isCommissionAdmin: true,
  })

  let deniedSignerCalls = 0
  await assert.rejects(
    createUploadTicketCore(
      { kind: 'order-proof', recordId: orderId, name: 'proof.png', size: png.size, mimeType: 'image/png' },
      {
        randomUUID,
        getActor: async () => adminActor,
        assertRecordAccess: async ({ actor }) => {
          if (actor.userId !== standardActor.userId) throw new Error('forbidden')
        },
        createSignedUploadUrl: async (_bucket, path) => {
          deniedSignerCalls += 1
          return { token: 'unexpected', path }
        },
      },
    ),
    { name: 'Error', message: 'No se pudo autorizar la carga.' },
  )
  assert.equal(deniedSignerCalls, 0, 'un actor ajeno no debe alcanzar el firmante')

  const exactTicket = await createAuthorizedOrderTicket(
    service,
    standardActor,
    standardActor.userId,
    orderId,
    randomUUID(),
  )
  const exactPath = trackedPath(cleanup, exactTicket.bucket, exactTicket.path)
  const driftPath = trackedPath(
    cleanup,
    'payment_proofs',
    `orders/${standardActor.userId}/${orderId}/${randomUUID()}.png`,
  )

  const drift = await uploader.storage.from('payment_proofs').uploadToSignedUrl(
    driftPath,
    exactTicket.token,
    png,
    { contentType: 'image/png', upsert: false },
  )
  assert.ok(drift.error, 'un ticket firmado no debe desviarse a otra ruta')
  await assertObjectMissing(service, 'payment_proofs', driftPath)

  const exact = await uploader.storage.from('payment_proofs').uploadToSignedUrl(
    exactPath,
    exactTicket.token,
    png,
    { contentType: 'image/png', upsert: false },
  )
  assert.ifError(exact.error)

  const invalidMimeTicket = await createAuthorizedOrderTicket(
    service,
    standardActor,
    standardActor.userId,
    orderId,
    randomUUID(),
  )
  const invalidMimePath = trackedPath(cleanup, invalidMimeTicket.bucket, invalidMimeTicket.path)
  const invalidMime = await uploader.storage.from(invalidMimeTicket.bucket).uploadToSignedUrl(
    invalidMimeTicket.path,
    invalidMimeTicket.token,
    new Blob(['not allowed'], { type: 'text/plain' }),
    { contentType: 'text/plain', upsert: false },
  )
  assert.ok(invalidMime.error, 'el bucket debe rechazar MIME no permitidos')
  await assertObjectMissing(service, 'payment_proofs', invalidMimePath)

  const oversizeTicket = await createAuthorizedOrderTicket(
    service,
    standardActor,
    standardActor.userId,
    orderId,
    randomUUID(),
  )
  const oversizePath = trackedPath(cleanup, oversizeTicket.bucket, oversizeTicket.path)
  const oversize = await uploader.storage.from(oversizeTicket.bucket).uploadToSignedUrl(
    oversizeTicket.path,
    oversizeTicket.token,
    new Blob([new Uint8Array(MAX_FILE_SIZE + 1)], { type: 'image/png' }),
    { contentType: 'image/png', upsert: false },
  )
  assert.ok(oversize.error, 'el bucket debe rechazar archivos mayores a 5 MiB')
  await assertObjectMissing(service, 'payment_proofs', oversizePath)

  return Object.freeze({ exactPath, orderId })
}

async function assertAuthorizedSignedReads(service, proof, standardUser, adminUser) {
  const record = Object.freeze({
    ownerUserId: standardUser.id,
    path: proof.exactPath,
    legacyUrl: null,
    scopeId: null,
    legacyScopeKey: null,
  })

  const dependenciesFor = (actor, now = Date.now()) => ({
    getActor: async () => actor,
    fetchRecord: async () => record,
    createSignedUrl: async (path, expiresIn) => {
      assert.equal(expiresIn, 300, 'el lector debe solicitar exactamente cinco minutos')
      const { data, error } = await service.storage.from('payment_proofs').createSignedUrl(path, expiresIn)
      assert.ifError(error)
      return data.signedUrl
    },
    allowedOrigin: url,
    now: () => now,
  })

  for (const actor of [
    { userId: standardUser.id, isAdmin: false },
    { userId: adminUser.id, isAdmin: true },
  ]) {
    const now = Date.now()
    const access = await getPaymentProofAccessCore(
      { domain: 'order', recordId: proof.orderId },
      dependenciesFor(actor, now),
    )
    assert.equal(access.expiresAt, now + 300_000, 'la expiración debe ser exactamente cinco minutos')
    const response = await fetch(access.url)
    assert.equal(response.status, 200, 'owner/admin debe leer el comprobante por URL firmada')
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes)
  }

  await assert.rejects(
    getPaymentProofAccessCore(
      { domain: 'order', recordId: proof.orderId },
      dependenciesFor({ userId: adminUser.id, isAdmin: false }),
    ),
    /No se pudo abrir el comprobante/u,
  )
  await assert.rejects(
    getPaymentProofAccessCore(
      { domain: 'order', recordId: proof.orderId },
      dependenciesFor(null),
    ),
    /No se pudo abrir el comprobante/u,
  )
}

async function cleanupObjects(service, cleanup) {
  const failures = []
  for (const [bucket, paths] of cleanup) {
    const list = [...paths]
    if (list.length === 0) continue
    const { error } = await service.storage.from(bucket).remove(list)
    if (error) failures.push(`${bucket}: ${error.message}`)
  }

  for (const [bucket, paths] of cleanup) {
    for (const path of paths) {
      try {
        await assertObjectMissing(service, bucket, path)
      } catch (error) {
        failures.push(error.message)
      }
    }
  }
  assert.deepEqual(failures, [], `falló la limpieza de Storage: ${failures.join('; ')}`)
}

async function main() {
  assertExactLocalStorageStack()
  const anon = client()
  const standard = await signedIn('standard')
  const admin = await signedIn('admin')
  const service = client(serviceKey)
  const cleanup = new Map()
  let primaryError = null

  try {
    await assertBucketConfiguration(service)
    await assertDirectWritesDenied('anon', anon, service, cleanup)
    await assertDirectWritesDenied('standard', standard.client, service, cleanup)
    await assertDirectWritesDenied('admin', admin.client, service, cleanup)
    await assertPublicAndPrivateReads(anon, service, cleanup)
    const proof = await assertSignedUploads(service, anon, cleanup, standard.user, admin.user)
    await assertAuthorizedSignedReads(service, proof, standard.user, admin.user)
  } catch (error) {
    primaryError = error
  }

  try {
    await cleanupObjects(service, cleanup)
  } catch (cleanupError) {
    if (primaryError) {
      throw new AggregateError([primaryError, cleanupError], 'Fallaron la matriz y su limpieza local.')
    }
    throw cleanupError
  }
  if (primaryError) throw primaryError

  console.log(JSON.stringify({
    ok: true,
    localApi: parsedUrl.origin,
    buckets: Object.keys(bucketConfig),
    directWriteDenials: 27,
    signedReads: 2,
    residualSyntheticObjects: 0,
  }, null, 2))
}

main().catch((error) => {
  if (error instanceof AggregateError) {
    for (const cause of error.errors) console.error(cause.message)
  } else {
    console.error(error.message)
  }
  process.exitCode = 1
})
