import 'server-only'

import { assertSafeRuntimeSupabaseUrl } from '@/lib/environment/production-guards'
import { createAdminClient } from '@/lib/supabase/admin'

import {
  normalizeStoredObjectIdentity,
  verifyUploadedObjectCore,
  type StorageBucket,
  type StoredObjectIdentity,
  type StoredObjectMetadata,
  type VerifyUploadedObjectDependencies,
  type VerifyUploadedObjectInput,
} from './upload-core.ts'

type Environment = Record<string, string | undefined>
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type StorageOperationResult = Readonly<{ data: unknown; error: unknown }>
type AdminClientLike = {
  readonly storage: {
    from(bucket: string): {
      info(path: string): Promise<StorageOperationResult>
      remove(paths: string[]): Promise<StorageOperationResult>
    }
  }
}

export type UploadVerificationRuntime = {
  readonly environment?: Environment
  readonly fetch?: FetchLike
  readonly createAdminClient?: () => AdminClientLike
}

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
const VERIFY_ERROR_MESSAGE = 'No se pudo verificar el archivo.'
const STORAGE_BUCKETS = new Set<StorageBucket>(['products', 'banners', 'payment_proofs'])

function verifyError(): Error {
  return new Error(VERIFY_ERROR_MESSAGE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.status === 404 || error.statusCode === '404'
}

function validIdentity(identity: StoredObjectIdentity): StoredObjectIdentity | null {
  return normalizeStoredObjectIdentity(identity?.etag, identity?.version)
}

function safeObjectUrl(baseUrl: URL, bucket: StorageBucket, path: string): URL {
  if (!STORAGE_BUCKETS.has(bucket) || typeof path !== 'string' || path.length > 512) {
    throw verifyError()
  }

  const segments = path.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      /[\u0000-\u001f\u007f\\]/u.test(segment)
    )
  ) {
    throw verifyError()
  }

  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/')
  const storageBase = new URL('storage/v1/object/', baseUrl)
  const objectUrl = new URL(`${bucket}/${encodedPath}`, storageBase)

  if (
    objectUrl.origin !== baseUrl.origin ||
    !objectUrl.pathname.startsWith(`/storage/v1/object/${bucket}/`)
  ) {
    throw verifyError()
  }

  return objectUrl
}

function metadataFromInfo(data: unknown): StoredObjectMetadata {
  if (!isRecord(data)) {
    return {
      bucket: '',
      path: '',
      mimeType: undefined,
      size: undefined,
      etag: undefined,
      version: undefined,
    }
  }

  const metadata = isRecord(data.metadata) ? data.metadata : null
  const identity = normalizeStoredObjectIdentity(data.etag, data.version)
  return {
    bucket: typeof data.bucketId === 'string' ? data.bucketId : '',
    path: typeof data.name === 'string' ? data.name : '',
    mimeType: data.contentType ?? metadata?.mimetype,
    size: data.size ?? metadata?.size,
    etag: identity?.etag,
    version: identity?.version,
  }
}

function contentLength(response: Response): number | null {
  const rawValue = response.headers.get('content-length')
  if (rawValue === null) return null
  if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(rawValue)) throw verifyError()

  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < 0) throw verifyError()
  return value
}

function expectedPartialLength(response: Response, maxBytes: number): number {
  const rawValue = response.headers.get('content-range')
  if (rawValue === null || rawValue.length > 100) throw verifyError()

  const match = /^bytes 0-([0-9]+)\/([0-9]+)$/u.exec(rawValue)
  if (!match || (match[1]?.length ?? 0) > 16 || (match[2]?.length ?? 0) > 16) {
    throw verifyError()
  }

  const end = Number(match[1])
  const total = Number(match[2])
  if (
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    end > maxBytes ||
    total <= end ||
    end !== Math.min(maxBytes, total - 1)
  ) {
    throw verifyError()
  }

  return end + 1
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // Cancellation is best-effort; callers still receive a bounded generic result.
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Status/header failures remain generic even if best-effort cancellation fails.
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw verifyError()

  const reader = response.body.getReader()
  const bytes = new Uint8Array(maxBytes + 1)
  let offset = 0

  try {
    const expectedLength = response.status === 206
      ? expectedPartialLength(response, maxBytes)
      : null
    const declaredLength = contentLength(response)

    if (declaredLength !== null && declaredLength > maxBytes) {
      if (expectedLength !== null && expectedLength !== bytes.byteLength) throw verifyError()
      await cancelReader(reader)
      return bytes
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw verifyError()
      if (value.byteLength === 0) continue

      const writableBytes = Math.min(value.byteLength, bytes.byteLength - offset)
      bytes.set(value.subarray(0, writableBytes), offset)
      offset += writableBytes

      if (offset === bytes.byteLength) {
        if (expectedLength !== null && expectedLength !== bytes.byteLength) throw verifyError()
        await cancelReader(reader)
        return bytes
      }
    }

    if (declaredLength !== null && declaredLength !== offset) throw verifyError()
    if (expectedLength !== null && expectedLength !== offset) throw verifyError()
    return bytes.subarray(0, offset)
  } catch {
    await cancelReader(reader)
    throw verifyError()
  }
}

export function createUploadVerificationDependencies(
  runtime: UploadVerificationRuntime = {},
): VerifyUploadedObjectDependencies {
  try {
    const environment = runtime.environment ?? process.env
    const safeBaseUrl = assertSafeRuntimeSupabaseUrl(
      environment.NEXT_PUBLIC_SUPABASE_URL ?? '',
      environment,
    )
    const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''

    if (
      !serviceRoleKey ||
      safeBaseUrl.username ||
      safeBaseUrl.password ||
      safeBaseUrl.pathname !== '/' ||
      safeBaseUrl.search ||
      safeBaseUrl.hash
    ) {
      throw verifyError()
    }

    const admin = (runtime.createAdminClient ?? createAdminClient)()
    const fetchRequest = runtime.fetch ?? globalThis.fetch

    return Object.freeze({
      async getStoredObjectMetadata(bucket, path) {
        try {
          safeObjectUrl(safeBaseUrl, bucket, path)
          const { data, error } = await admin.storage.from(bucket).info(path)
          if (error) {
            if (isMissingError(error)) return null
            throw verifyError()
          }
          if (data === null) return null
          return metadataFromInfo(data)
        } catch {
          throw verifyError()
        }
      },

      async readObjectBytes(bucket, path, identity, maxBytes) {
        try {
          if (
            !Number.isSafeInteger(maxBytes) ||
            maxBytes <= 0 ||
            maxBytes > MAX_UPLOAD_SIZE
          ) {
            throw verifyError()
          }
          const normalizedIdentity = validIdentity(identity)
          if (!normalizedIdentity) throw verifyError()

          const objectUrl = safeObjectUrl(safeBaseUrl, bucket, path)
          const response = await fetchRequest(objectUrl, {
            cache: 'no-store',
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              'If-Match': normalizedIdentity.etag,
              Range: `bytes=0-${maxBytes}`,
            },
            method: 'GET',
            redirect: 'error',
          })

          if (response.status === 404) {
            await cancelResponseBody(response)
            return null
          }
          if (response.status !== 200 && response.status !== 206) {
            await cancelResponseBody(response)
            throw verifyError()
          }

          return await readBoundedResponse(response, maxBytes)
        } catch {
          throw verifyError()
        }
      },

      async removeExactObject(bucket, path, identity) {
        try {
          safeObjectUrl(safeBaseUrl, bucket, path)
          const normalizedIdentity = validIdentity(identity)
          if (!normalizedIdentity) throw verifyError()

          const bucketClient = admin.storage.from(bucket)
          const current = await bucketClient.info(path)
          if (current.error || current.data === null) throw verifyError()

          const currentMetadata = metadataFromInfo(current.data)
          if (
            currentMetadata.bucket !== bucket ||
            currentMetadata.path !== path ||
            currentMetadata.etag !== normalizedIdentity.etag ||
            currentMetadata.version !== normalizedIdentity.version
          ) {
            throw verifyError()
          }

          // Supabase Storage has no conditional DELETE. This recheck narrows, but cannot
          // eliminate, the interval between info and remove; the operational gate below
          // keeps the helper unused until direct UPDATE/DELETE is revoked in Task 7.
          const { error } = await bucketClient.remove([path])
          if (error) throw verifyError()
        } catch {
          throw verifyError()
        }
      },
    })
  } catch {
    throw verifyError()
  }
}

/**
 * Operational gate: do not add callsites before Task 7 revokes direct object
 * UPDATE/DELETE. Storage exposes no conditional DELETE, so the identity recheck
 * immediately before removal still leaves a residual replacement interval.
 */
export async function verifyTrustedUploadedObject(
  input: VerifyUploadedObjectInput,
): Promise<void> {
  try {
    await verifyUploadedObjectCore(input, createUploadVerificationDependencies())
  } catch {
    throw verifyError()
  }
}
