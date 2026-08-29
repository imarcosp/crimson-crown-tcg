export type UploadKind =
  | 'customer-product-request'
  | 'admin-product-image'
  | 'banner'
  | 'order-proof'
  | 'import-proof'
  | 'commission-proof'

export type UploadIntent = {
  readonly kind: UploadKind
  readonly name: string
  readonly size: number
  readonly mimeType: string
}

export type AllowedUploadExtension = 'jpg' | 'jpeg' | 'png' | 'webp' | 'pdf'

export type SupportedUploadMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf'

export type ValidatedUploadIntent = {
  readonly kind: UploadKind
  readonly extension: AllowedUploadExtension
  readonly size: number
  readonly mimeType: SupportedUploadMimeType
}

type ProofUploadKind = 'order-proof' | 'import-proof' | 'commission-proof'

export type StoragePathInput =
  | {
      readonly kind: 'customer-product-request'
      readonly userId: string
      readonly objectId: string
      readonly extension: Exclude<AllowedUploadExtension, 'pdf'>
    }
  | {
      readonly kind: 'admin-product-image'
      readonly inventoryId: string
      readonly objectId: string
      readonly extension: Exclude<AllowedUploadExtension, 'pdf'>
    }
  | {
      readonly kind: 'banner'
      readonly objectId: string
      readonly extension: Exclude<AllowedUploadExtension, 'pdf'>
    }
  | {
      readonly kind: 'order-proof' | 'commission-proof'
      readonly userId: string
      readonly recordId: string
      readonly objectId: string
      readonly extension: AllowedUploadExtension
    }
  | {
      readonly kind: 'import-proof'
      readonly userId: string
      readonly recordId: string
      readonly objectId: string
      readonly extension: AllowedUploadExtension
    }

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024

const IMAGE_UPLOAD_KINDS = new Set<UploadKind>([
  'customer-product-request',
  'admin-product-image',
  'banner',
])

const PROOF_UPLOAD_KINDS = new Set<UploadKind>([
  'order-proof',
  'import-proof',
  'commission-proof',
])

const ALL_UPLOAD_KINDS = new Set<UploadKind>([
  ...IMAGE_UPLOAD_KINDS,
  ...PROOF_UPLOAD_KINDS,
])

const MIME_EXTENSIONS: Readonly<
  Record<SupportedUploadMimeType, readonly AllowedUploadExtension[]>
> = Object.freeze({
  'image/jpeg': Object.freeze(['jpg', 'jpeg'] as const),
  'image/png': Object.freeze(['png'] as const),
  'image/webp': Object.freeze(['webp'] as const),
  'application/pdf': Object.freeze(['pdf'] as const),
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]*$/u
const POSTGRES_BIGINT_MAX_DECIMAL = '9223372036854775807'

function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && ALL_UPLOAD_KINDS.has(value as UploadKind)
}

function isProofUploadKind(kind: UploadKind): kind is ProofUploadKind {
  return PROOF_UPLOAD_KINDS.has(kind)
}

function isSupportedUploadMimeType(value: unknown): value is SupportedUploadMimeType {
  return typeof value === 'string' && Object.hasOwn(MIME_EXTENSIONS, value)
}

function normalizeExtension(value: unknown): AllowedUploadExtension {
  if (typeof value !== 'string') {
    throw new Error('Extensión de archivo inválida.')
  }

  const extension = value.toLowerCase()
  if (!['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(extension)) {
    throw new Error('Extensión de archivo inválida.')
  }

  return extension as AllowedUploadExtension
}

function assertExtensionAllowedForKind(kind: UploadKind, extension: AllowedUploadExtension): void {
  if (extension === 'pdf' && !isProofUploadKind(kind)) {
    throw new Error('Tipo de archivo no permitido para esta carga.')
  }
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('Identificador de almacenamiento inválido.')
  }

  return value.toLowerCase()
}

function normalizePositivePostgresBigint(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > POSTGRES_BIGINT_MAX_DECIMAL.length ||
    !POSITIVE_BIGINT_PATTERN.test(value) ||
    (value.length === POSTGRES_BIGINT_MAX_DECIMAL.length &&
      value > POSTGRES_BIGINT_MAX_DECIMAL)
  ) {
    throw new Error('Identificador de almacenamiento inválido.')
  }

  return value
}

function extensionFromSafeName(name: unknown): AllowedUploadExtension {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 255 ||
    name !== name.trim() ||
    /[\u0000-\u001f\u007f\\/]/u.test(name)
  ) {
    throw new Error('Nombre de archivo inválido.')
  }

  const firstDot = name.indexOf('.')
  if (firstDot <= 0 || firstDot !== name.lastIndexOf('.') || firstDot === name.length - 1) {
    throw new Error('Nombre de archivo inválido.')
  }

  return normalizeExtension(name.slice(firstDot + 1))
}

export function validateUploadIntent(intent: UploadIntent): ValidatedUploadIntent {
  if (!intent || !isUploadKind(intent.kind)) {
    throw new Error('Tipo de carga inválido.')
  }

  if (!Number.isSafeInteger(intent.size) || intent.size <= 0 || intent.size > MAX_UPLOAD_SIZE) {
    throw new Error('Tamaño de archivo inválido.')
  }

  if (!isSupportedUploadMimeType(intent.mimeType)) {
    throw new Error('Tipo de archivo no permitido.')
  }
  const allowedExtensions = MIME_EXTENSIONS[intent.mimeType]

  const extension = extensionFromSafeName(intent.name)
  if (!allowedExtensions.includes(extension)) {
    throw new Error('El tipo declarado no coincide con la extensión.')
  }
  assertExtensionAllowedForKind(intent.kind, extension)

  return Object.freeze({
    kind: intent.kind,
    extension,
    size: intent.size,
    mimeType: intent.mimeType,
  })
}

export function buildStoragePath(input: StoragePathInput): string {
  if (!input || !isUploadKind(input.kind)) {
    throw new Error('Tipo de carga inválido.')
  }

  const extension = normalizeExtension(input.extension)
  assertExtensionAllowedForKind(input.kind, extension)
  const objectId = normalizeUuid(input.objectId)

  switch (input.kind) {
    case 'customer-product-request': {
      const userId = normalizeUuid(input.userId)
      return `requests/${userId}/${objectId}.${extension}`
    }
    case 'admin-product-image': {
      const inventoryId = normalizeUuid(input.inventoryId)
      return `catalog/${inventoryId}/${objectId}.${extension}`
    }
    case 'banner':
      return `site/${objectId}.${extension}`
    case 'order-proof': {
      const userId = normalizeUuid(input.userId)
      const recordId = normalizeUuid(input.recordId)
      return `orders/${userId}/${recordId}/${objectId}.${extension}`
    }
    case 'import-proof': {
      const userId = normalizeUuid(input.userId)
      const recordId = normalizePositivePostgresBigint(input.recordId)
      return `imports/${userId}/${recordId}/${objectId}.${extension}`
    }
    case 'commission-proof': {
      const userId = normalizeUuid(input.userId)
      const recordId = normalizeUuid(input.recordId)
      return `commissions/${recordId}/${userId}/${objectId}.${extension}`
    }
  }
}
