import 'server-only'

import { assertSafeRuntimeSupabaseUrl } from '@/lib/environment/production-guards'
import { createAdminClient } from '@/lib/supabase/admin'

import {
  verifyUploadedObjectCore,
  type StorageBucket,
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
    return { bucket: '', path: '', mimeType: undefined, size: undefined }
  }

  const metadata = isRecord(data.metadata) ? data.metadata : null
  return {
    bucket: typeof data.bucketId === 'string' ? data.bucketId : '',
    path: typeof data.name === 'string' ? data.name : '',
    mimeType: data.contentType ?? metadata?.mimetype,
    size: data.size ?? metadata?.size,
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw verifyError()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw verifyError()

      if (value.byteLength > maxBytes - totalBytes) {
        await reader.cancel()
        return new Uint8Array(maxBytes + 1)
      }

      chunks.push(value)
      totalBytes += value.byteLength
    }
  } catch {
    try {
      await reader.cancel()
    } catch {
      // Cancellation is best-effort; callers always receive one generic failure.
    }
    throw verifyError()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
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

      async readObjectBytes(bucket, path, maxBytes) {
        try {
          if (
            !Number.isSafeInteger(maxBytes) ||
            maxBytes <= 0 ||
            maxBytes > MAX_UPLOAD_SIZE
          ) {
            throw verifyError()
          }

          const objectUrl = safeObjectUrl(safeBaseUrl, bucket, path)
          const response = await fetchRequest(objectUrl, {
            cache: 'no-store',
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              Range: `bytes=0-${maxBytes}`,
            },
            method: 'GET',
          })

          if (response.status === 404) return null
          if (!response.ok) throw verifyError()
          return await readBoundedResponse(response, maxBytes)
        } catch {
          throw verifyError()
        }
      },

      async removeExactObject(bucket, path) {
        try {
          safeObjectUrl(safeBaseUrl, bucket, path)
          const { error } = await admin.storage.from(bucket).remove([path])
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

export async function verifyTrustedUploadedObject(
  input: VerifyUploadedObjectInput,
): Promise<void> {
  try {
    await verifyUploadedObjectCore(input, createUploadVerificationDependencies())
  } catch {
    throw verifyError()
  }
}
