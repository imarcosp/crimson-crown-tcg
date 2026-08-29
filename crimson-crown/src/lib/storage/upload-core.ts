import { isAllowedFileSignature } from './file-signatures.ts'
import {
  buildStoragePath,
  validateUploadIntent,
  type UploadIntent,
  type UploadKind,
  type ValidatedUploadIntent,
} from './upload-policy.ts'

export type StorageBucket = 'products' | 'banners' | 'payment_proofs'

export type UploadTicket = {
  readonly bucket: StorageBucket
  readonly path: string
  readonly token: string
}

export type CreateUploadTicketInput = UploadIntent & {
  readonly recordId?: string
  readonly inventoryId?: string
}

export type UploadActor = {
  readonly userId: string
  readonly email: string | null
  readonly isAdmin: boolean
  readonly isCommissionAdmin: boolean
}

export type RecordAccessRequest = {
  readonly kind: Exclude<UploadKind, 'customer-product-request' | 'banner'>
  readonly recordId: string
  readonly actor: UploadActor
}

export type CreateUploadTicketDependencies = {
  readonly randomUUID: () => string
  readonly getActor: () => Promise<UploadActor | null>
  readonly assertRecordAccess: (request: RecordAccessRequest) => Promise<void>
  readonly createSignedUploadUrl: (
    bucket: StorageBucket,
    path: string,
    options: Readonly<{ upsert: false }>,
  ) => Promise<Readonly<{ token: string; path: string }>>
}

export type StoredObjectMetadata = {
  readonly bucket: string
  readonly path: string
  readonly mimeType: unknown
  readonly size: unknown
}

export type VerifyUploadedObjectInput = {
  readonly bucket: StorageBucket
  readonly path: string
  readonly expectedBucket: StorageBucket
  readonly expectedPath: string
  readonly intent: ValidatedUploadIntent
}

export type VerifyUploadedObjectDependencies = {
  readonly getStoredObjectMetadata: (
    bucket: StorageBucket,
    path: string,
  ) => Promise<StoredObjectMetadata | null>
  readonly readObjectBytes: (
    bucket: StorageBucket,
    path: string,
    maxBytes: number,
  ) => Promise<Uint8Array | null>
  readonly removeExactObject: (bucket: StorageBucket, path: string) => Promise<void>
}

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
const CREATE_ERROR_MESSAGE = 'No se pudo autorizar la carga.'
const VERIFY_ERROR_MESSAGE = 'No se pudo verificar el archivo.'
const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const MAX_CANONICAL_PATH_LENGTH = 256

function createError(): Error {
  return new Error(CREATE_ERROR_MESSAGE)
}

function verifyError(): Error {
  return new Error(VERIFY_ERROR_MESSAGE)
}

function bucketForKind(kind: UploadKind): StorageBucket {
  if (kind === 'banner') return 'banners'
  if (kind === 'customer-product-request' || kind === 'admin-product-image') return 'products'
  return 'payment_proofs'
}

function requireActor(value: UploadActor | null): UploadActor {
  if (
    !value ||
    typeof value.userId !== 'string' ||
    typeof value.isAdmin !== 'boolean' ||
    typeof value.isCommissionAdmin !== 'boolean'
  ) {
    throw createError()
  }
  return value
}

function requireRecordId(value: unknown): string {
  if (typeof value !== 'string') throw createError()
  return value
}

function pathForUpload(
  input: CreateUploadTicketInput,
  intent: ValidatedUploadIntent,
  actor: UploadActor,
  objectId: string,
): string {
  switch (intent.kind) {
    case 'customer-product-request':
      return buildStoragePath({
        kind: intent.kind,
        userId: actor.userId,
        objectId,
        extension: intent.extension as Exclude<typeof intent.extension, 'pdf'>,
      })
    case 'admin-product-image':
      return buildStoragePath({
        kind: intent.kind,
        inventoryId: requireRecordId(input.inventoryId),
        objectId,
        extension: intent.extension as Exclude<typeof intent.extension, 'pdf'>,
      })
    case 'banner':
      return buildStoragePath({
        kind: intent.kind,
        objectId,
        extension: intent.extension as Exclude<typeof intent.extension, 'pdf'>,
      })
    case 'order-proof':
    case 'import-proof':
    case 'commission-proof':
      return buildStoragePath({
        kind: intent.kind,
        userId: actor.userId,
        recordId: requireRecordId(input.recordId),
        objectId,
        extension: intent.extension,
      })
  }
}

async function authorizeUpload(
  intent: ValidatedUploadIntent,
  actor: UploadActor,
  canonicalPath: string,
  assertRecordAccess: CreateUploadTicketDependencies['assertRecordAccess'],
): Promise<void> {
  const canonicalSegments = canonicalPath.split('/')

  switch (intent.kind) {
    case 'customer-product-request':
      return
    case 'banner':
      if (!actor.isAdmin) throw createError()
      return
    case 'admin-product-image': {
      if (!actor.isAdmin) throw createError()
      const inventoryId = requireRecordId(canonicalSegments[1])
      await assertRecordAccess({ kind: intent.kind, recordId: inventoryId, actor })
      return
    }
    case 'commission-proof': {
      if (!actor.isCommissionAdmin) throw createError()
      const recordId = requireRecordId(canonicalSegments[1])
      await assertRecordAccess({ kind: intent.kind, recordId, actor })
      return
    }
    case 'order-proof':
    case 'import-proof': {
      const recordId = requireRecordId(canonicalSegments[2])
      await assertRecordAccess({ kind: intent.kind, recordId, actor })
    }
  }
}

export async function createUploadTicketCore(
  input: CreateUploadTicketInput,
  dependencies: CreateUploadTicketDependencies,
): Promise<UploadTicket> {
  try {
    const actor = requireActor(await dependencies.getActor())
    const intent = validateUploadIntent(input)
    const path = pathForUpload(input, intent, actor, dependencies.randomUUID())
    await authorizeUpload(intent, actor, path, dependencies.assertRecordAccess)

    const bucket = bucketForKind(intent.kind)
    const signed = await dependencies.createSignedUploadUrl(bucket, path, { upsert: false })

    if (
      !signed ||
      signed.path !== path ||
      typeof signed.token !== 'string' ||
      signed.token.trim().length === 0
    ) {
      throw createError()
    }

    return Object.freeze({ bucket, path, token: signed.token })
  } catch {
    throw createError()
  }
}

function canonicalNonImportPathPattern(intent: ValidatedUploadIntent): RegExp {
  const extension = intent.extension

  switch (intent.kind) {
    case 'customer-product-request':
      return new RegExp(`^requests/${UUID_SEGMENT}/${UUID_SEGMENT}\\.${extension}$`, 'u')
    case 'admin-product-image':
      return new RegExp(`^catalog/${UUID_SEGMENT}/${UUID_SEGMENT}\\.${extension}$`, 'u')
    case 'banner':
      return new RegExp(`^site/${UUID_SEGMENT}\\.${extension}$`, 'u')
    case 'order-proof':
      return new RegExp(`^orders/${UUID_SEGMENT}/${UUID_SEGMENT}/${UUID_SEGMENT}\\.${extension}$`, 'u')
    case 'import-proof':
      throw verifyError()
    case 'commission-proof':
      return new RegExp(`^commissions/${UUID_SEGMENT}/${UUID_SEGMENT}/${UUID_SEGMENT}\\.${extension}$`, 'u')
  }
}

function isCanonicalPath(path: string, intent: ValidatedUploadIntent): boolean {
  if (path.length > MAX_CANONICAL_PATH_LENGTH) return false
  if (intent.kind !== 'import-proof') return canonicalNonImportPathPattern(intent).test(path)

  const match = /^imports\/([^/]+)\/([^/]+)\/([^/.]+)\.([a-z]+)$/u.exec(path)
  if (!match || match[4] !== intent.extension) return false

  try {
    return (
      buildStoragePath({
        kind: 'import-proof',
        userId: match[1] ?? '',
        recordId: match[2] ?? '',
        objectId: match[3] ?? '',
        extension: intent.extension,
      }) === path
    )
  } catch {
    return false
  }
}

function isTrustedVerificationReference(input: VerifyUploadedObjectInput): boolean {
  let validated: ValidatedUploadIntent

  try {
    validated = validateUploadIntent({
      kind: input.intent.kind,
      name: `upload.${input.intent.extension}`,
      size: input.intent.size,
      mimeType: input.intent.mimeType,
    })
  } catch {
    return false
  }

  if (!isCanonicalPath(input.expectedPath, validated)) return false

  return (
    validated.kind === input.intent.kind &&
    validated.extension === input.intent.extension &&
    validated.mimeType === input.intent.mimeType &&
    validated.size === input.intent.size &&
    input.expectedBucket === bucketForKind(validated.kind) &&
    input.bucket === input.expectedBucket &&
    input.path === input.expectedPath
  )
}

async function rejectInvalidObject(
  dependencies: VerifyUploadedObjectDependencies,
  bucket: StorageBucket,
  path: string,
): Promise<never> {
  try {
    await dependencies.removeExactObject(bucket, path)
  } catch {
    // Cleanup must never expose privileged Storage errors or alter the rejection shape.
  }
  throw verifyError()
}

export async function verifyUploadedObjectCore(
  input: VerifyUploadedObjectInput,
  dependencies: VerifyUploadedObjectDependencies,
): Promise<void> {
  if (!isTrustedVerificationReference(input)) {
    throw verifyError()
  }

  let metadata: StoredObjectMetadata | null
  try {
    metadata = await dependencies.getStoredObjectMetadata(input.expectedBucket, input.expectedPath)
  } catch {
    throw verifyError()
  }

  if (!metadata) {
    throw verifyError()
  }

  const metadataIsValid =
    metadata.bucket === input.expectedBucket &&
    metadata.path === input.expectedPath &&
    metadata.mimeType === input.intent.mimeType &&
    Number.isSafeInteger(metadata.size) &&
    Number(metadata.size) > 0 &&
    Number(metadata.size) <= MAX_UPLOAD_SIZE &&
    metadata.size === input.intent.size

  if (!metadataIsValid) {
    return rejectInvalidObject(dependencies, input.expectedBucket, input.expectedPath)
  }

  let bytes: Uint8Array | null
  try {
    bytes = await dependencies.readObjectBytes(
      input.expectedBucket,
      input.expectedPath,
      MAX_UPLOAD_SIZE,
    )
  } catch {
    throw verifyError()
  }

  if (bytes === null) {
    throw verifyError()
  }

  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_UPLOAD_SIZE ||
    bytes.byteLength !== input.intent.size ||
    !isAllowedFileSignature(bytes, input.intent.mimeType)
  ) {
    return rejectInvalidObject(dependencies, input.expectedBucket, input.expectedPath)
  }
}
