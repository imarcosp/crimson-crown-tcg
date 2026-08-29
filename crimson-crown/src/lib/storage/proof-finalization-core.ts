import type { VerifyUploadedObjectInput } from './upload-core.ts'
import {
  buildStoragePath,
  normalizeProofRecordId,
  validateUploadIntent,
  type ProofUploadKind,
} from './upload-policy.ts'

export type ProofUploadReference = Readonly<{
  bucket: string
  path: string
  name: string
  size: number
  mimeType: string
}>

export type ProofFinalizationInput = Readonly<{
  kind: ProofUploadKind
  recordId: string
  proof: ProofUploadReference | null
}>

export type ProofAuthorization<Context> = Readonly<{
  actorUserId: string
  proofRequired: boolean
  context: Context
}>

export type ProofFinalizationDependencies<Context> = Readonly<{
  authorize: (
    kind: ProofUploadKind,
    recordId: string,
  ) => Promise<ProofAuthorization<Context>>
  verify: (input: VerifyUploadedObjectInput) => Promise<void>
  persist: (context: Context, proofPath: string | null) => Promise<void>
}>

export type ProofFinalizationResult = Readonly<{ proofPath: string | null }>

const FINALIZE_ERROR_MESSAGE = 'No se pudo finalizar el comprobante.'
const UUID_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([a-z]+)$/iu

function finalizeError(): Error {
  return new Error(FINALIZE_ERROR_MESSAGE)
}

export function parseProofUploadReference(input: unknown): ProofUploadReference {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw finalizeError()
  const proof = input as Record<string, unknown>
  if (
    typeof proof.bucket !== 'string' ||
    typeof proof.path !== 'string' ||
    typeof proof.name !== 'string' ||
    typeof proof.size !== 'number' ||
    typeof proof.mimeType !== 'string'
  ) {
    throw finalizeError()
  }

  return Object.freeze({
    bucket: proof.bucket,
    path: proof.path,
    name: proof.name,
    size: proof.size,
    mimeType: proof.mimeType,
  })
}

function canonicalProofPath(
  input: ProofFinalizationInput,
  normalizedRecordId: string,
): Readonly<{
  path: string
  claimedUserId: string
  objectId: string
  intent: ReturnType<typeof validateUploadIntent>
}> {
  const proof = input.proof
  if (
    !proof ||
    proof.bucket !== 'payment_proofs' ||
    typeof proof.path !== 'string' ||
    proof.path.length > 256
  ) {
    throw finalizeError()
  }

  const intent = validateUploadIntent({
    kind: input.kind,
    name: proof.name,
    size: proof.size,
    mimeType: proof.mimeType,
  })
  const segments = proof.path.split('/')
  if (segments.length !== 4) throw finalizeError()
  const [prefix, firstLocator, secondLocator, fileName = ''] = segments
  const match = UUID_FILE_PATTERN.exec(fileName)
  if (!match || match[2]?.toLowerCase() !== intent.extension) throw finalizeError()

  const isCommission = input.kind === 'commission-proof'
  const claimedUserId = isCommission ? secondLocator : firstLocator
  const pathRecordId = isCommission ? firstLocator : secondLocator
  const expectedPrefix = input.kind === 'order-proof'
    ? 'orders'
    : input.kind === 'import-proof'
      ? 'imports'
      : 'commissions'
  if (prefix !== expectedPrefix || pathRecordId !== normalizedRecordId) throw finalizeError()

  const common = {
    kind: input.kind,
    userId: claimedUserId,
    recordId: normalizedRecordId,
    objectId: match[1],
    extension: intent.extension,
  } as const
  const expectedPath = buildStoragePath(common)
  if (proof.path !== expectedPath) throw finalizeError()

  return Object.freeze({
    path: expectedPath,
    claimedUserId,
    objectId: match[1].toLowerCase(),
    intent,
  })
}

export async function finalizePaymentProofCore<Context>(
  input: ProofFinalizationInput,
  dependencies: ProofFinalizationDependencies<Context>,
): Promise<ProofFinalizationResult> {
  try {
    if (
      !input ||
      !['order-proof', 'import-proof', 'commission-proof'].includes(input.kind)
    ) {
      throw finalizeError()
    }

    const normalizedRecordId = normalizeProofRecordId(input.kind, input.recordId)
    const canonical = input.proof === null
      ? null
      : canonicalProofPath(input, normalizedRecordId)
    const authorization = await dependencies.authorize(input.kind, normalizedRecordId)

    if (input.proof === null) {
      if (authorization.proofRequired) throw finalizeError()
      await dependencies.persist(authorization.context, null)
      return Object.freeze({ proofPath: null })
    }

    if (!canonical) throw finalizeError()
    const actorPath = buildStoragePath({
      kind: input.kind,
      userId: authorization.actorUserId,
      recordId: normalizedRecordId,
      objectId: canonical.objectId,
      extension: canonical.intent.extension,
    })
    if (actorPath !== canonical.path) throw finalizeError()
    await dependencies.verify({
      bucket: 'payment_proofs',
      path: canonical.path,
      expectedBucket: 'payment_proofs',
      expectedPath: canonical.path,
      intent: canonical.intent,
    })
    await dependencies.persist(authorization.context, canonical.path)
    return Object.freeze({ proofPath: canonical.path })
  } catch {
    // A verified object is deliberately retained if business persistence fails.
    // A bounded orphan-cleanup task can reconcile it without racing this request.
    throw finalizeError()
  }
}
