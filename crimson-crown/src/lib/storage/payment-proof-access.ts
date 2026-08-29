export type PaymentProofDomain = 'order' | 'import' | 'commission'

export type PaymentProofAccessInput = Readonly<{
  domain: PaymentProofDomain
  recordId: string
}>

export type PaymentProofActor = Readonly<{
  userId: string
  isAdmin: boolean
}>

export type PaymentProofRecord = Readonly<{
  ownerUserId: string
  path: string | null
  legacyUrl: string | null
  scopeId: string | null
  legacyScopeKey: string | null
}>

export type PaymentProofAccessResult = Readonly<{
  url: string
  expiresAt: number
}>

export type PaymentProofAccessDependencies = {
  getActor: () => Promise<PaymentProofActor | null>
  fetchRecord: (
    domain: PaymentProofDomain,
    recordId: string,
  ) => Promise<PaymentProofRecord | null>
  createSignedUrl: (path: string, expiresIn: number) => Promise<string>
  allowedOrigin: string
  now?: () => number
}

const ACCESS_ERROR_MESSAGE = 'No se pudo abrir el comprobante.'
const SIGNED_URL_TTL_SECONDS = 300
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const BIGINT_PATTERN = /^(?:[1-9]|[1-9][0-9]{1,18})$/u
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9._/-]+\.(?:jpg|jpeg|png|webp|pdf)$/iu
const LEGACY_PREFIX = '/storage/v1/object/public/payment_proofs/'

function accessError(): Error {
  return new Error(ACCESS_ERROR_MESSAGE)
}

function isValidRecordId(domain: PaymentProofDomain, recordId: string): boolean {
  if (domain === 'import') {
    if (!BIGINT_PATTERN.test(recordId)) return false
    return recordId.length < 19 || recordId <= '9223372036854775807'
  }
  return UUID_PATTERN.test(recordId)
}

function isSafeStoragePath(path: string): boolean {
  if (!path || path.length > 256 || !SAFE_PATH_PATTERN.test(path)) return false
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\') ||
    path.includes('%') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    return false
  }
  return path.split('/').every((segment) => segment !== '.' && segment !== '..' && segment.length > 0)
}

function isCanonicalPath(
  domain: PaymentProofDomain,
  recordId: string,
  ownerUserId: string,
  scopeId: string | null,
  path: string,
): boolean {
  if (!isSafeStoragePath(path) || !UUID_PATTERN.test(ownerUserId)) return false

  const extension = '(?:jpg|jpeg|png|webp|pdf)'
  const objectId = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
  if (domain === 'order') {
    return new RegExp(`^orders/${ownerUserId}/${recordId}/${objectId}\\.${extension}$`, 'u').test(path)
  }
  if (domain === 'import') {
    return new RegExp(`^imports/${ownerUserId}/${recordId}/${objectId}\\.${extension}$`, 'u').test(path)
  }
  if (!scopeId || !UUID_PATTERN.test(scopeId) || scopeId !== scopeId.toLowerCase()) return false
  return new RegExp(
    `^commissions/${scopeId}/${ownerUserId}/${objectId}\\.${extension}$`,
    'u',
  ).test(path)
}

function isLegacyPathForRecord(
  domain: PaymentProofDomain,
  recordId: string,
  legacyScopeKey: string | null,
  path: string,
): boolean {
  const extension = '(?:[jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[wW][eE][bB][pP]|[pP][dD][fF])'
  if (domain === 'order') {
    return new RegExp(`^stock_${recordId}_[0-9]{13}\\.${extension}$`, 'u').test(path)
  }
  if (domain === 'import') {
    return new RegExp(`^import_${recordId}_[0-9]{13}\\.${extension}$`, 'u').test(path)
  }
  if (!legacyScopeKey || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(legacyScopeKey)) return false
  return new RegExp(
    `^commission-payments/${legacyScopeKey}/[0-9]{13}-[a-zA-Z0-9._-]+\\.${extension}$`,
    'u',
  ).test(path)
}

export function parseLegacyProofPath(rawUrl: unknown, allowedOrigin: string): string | null {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl !== rawUrl.trim() ||
    rawUrl.includes('\\') ||
    rawUrl.includes('%') ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(rawUrl)
  ) {
    return null
  }

  try {
    const allowed = new URL(allowedOrigin)
    const candidate = new URL(rawUrl)
    if (
      allowed.pathname !== '/' ||
      allowed.search ||
      allowed.hash ||
      allowed.username ||
      allowed.password ||
      candidate.origin !== allowed.origin ||
      candidate.username ||
      candidate.password ||
      candidate.search ||
      candidate.hash ||
      !candidate.pathname.startsWith(LEGACY_PREFIX)
    ) {
      return null
    }

    const path = candidate.pathname.slice(LEGACY_PREFIX.length)
    return isSafeStoragePath(path) ? path : null
  } catch {
    return null
  }
}

export async function getPaymentProofAccessCore(
  input: PaymentProofAccessInput,
  dependencies: PaymentProofAccessDependencies,
): Promise<PaymentProofAccessResult> {
  try {
    if (
      !input ||
      !['order', 'import', 'commission'].includes(input.domain) ||
      typeof input.recordId !== 'string' ||
      !isValidRecordId(input.domain, input.recordId)
    ) {
      throw accessError()
    }

    const normalizedRecordId = input.domain === 'import'
      ? input.recordId
      : input.recordId.toLowerCase()
    const actor = await dependencies.getActor()
    if (!actor || !UUID_PATTERN.test(actor.userId)) throw accessError()

    const record = await dependencies.fetchRecord(input.domain, normalizedRecordId)
    if (!record || !UUID_PATTERN.test(record.ownerUserId)) throw accessError()
    const actorUserId = actor.userId.toLowerCase()
    const ownerUserId = record.ownerUserId.toLowerCase()
    if (input.domain === 'commission') {
      if (!actor.isAdmin) throw accessError()
    } else if (!actor.isAdmin && actorUserId !== ownerUserId) {
      throw accessError()
    }

    let proofPath: string | null = null
    if (record.path !== null) {
      proofPath = isCanonicalPath(
        input.domain,
        normalizedRecordId,
        ownerUserId,
        record.scopeId,
        record.path,
      )
        ? record.path
        : null
      if (!proofPath) throw accessError()
    } else {
      const legacyPath = parseLegacyProofPath(record.legacyUrl, dependencies.allowedOrigin)
      proofPath = legacyPath && isLegacyPathForRecord(
        input.domain,
        normalizedRecordId,
        record.legacyScopeKey,
        legacyPath,
      )
        ? legacyPath
        : null
    }
    if (!proofPath) throw accessError()

    const now = dependencies.now?.() ?? Date.now()
    if (!Number.isFinite(now)) throw accessError()
    const url = await dependencies.createSignedUrl(proofPath, SIGNED_URL_TTL_SECONDS)
    if (typeof url !== 'string' || !url) throw accessError()
    return Object.freeze({
      url,
      expiresAt: now + SIGNED_URL_TTL_SECONDS * 1_000,
    })
  } catch {
    throw accessError()
  }
}
