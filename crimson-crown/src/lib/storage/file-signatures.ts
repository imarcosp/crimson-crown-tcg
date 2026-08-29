import type { SupportedUploadMimeType } from './upload-policy.ts'

type SignatureDetector = (bytes: Uint8Array, offset: number) => boolean

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function matchesAt(bytes: Uint8Array, expected: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) {
    return false
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) {
      return false
    }
  }

  return true
}

const matchesPng: SignatureDetector = (bytes, offset) => matchesAt(bytes, PNG_SIGNATURE, offset)

const matchesJpeg: SignatureDetector = (bytes, offset) =>
  offset + 3 <= bytes.length &&
  bytes[offset] === 0xff &&
  bytes[offset + 1] === 0xd8 &&
  bytes[offset + 2] === 0xff

const matchesWebp: SignatureDetector = (bytes, offset) =>
  offset + 12 <= bytes.length &&
  bytes[offset] === 0x52 &&
  bytes[offset + 1] === 0x49 &&
  bytes[offset + 2] === 0x46 &&
  bytes[offset + 3] === 0x46 &&
  bytes[offset + 8] === 0x57 &&
  bytes[offset + 9] === 0x45 &&
  bytes[offset + 10] === 0x42 &&
  bytes[offset + 11] === 0x50

const matchesPdf: SignatureDetector = (bytes, offset) =>
  offset + 8 <= bytes.length &&
  bytes[offset] === 0x25 &&
  bytes[offset + 1] === 0x50 &&
  bytes[offset + 2] === 0x44 &&
  bytes[offset + 3] === 0x46 &&
  bytes[offset + 4] === 0x2d &&
  (bytes[offset + 5] === 0x31 || bytes[offset + 5] === 0x32) &&
  bytes[offset + 6] === 0x2e &&
  bytes[offset + 7] >= 0x30 &&
  bytes[offset + 7] <= 0x39

const SIGNATURES: Readonly<Record<SupportedUploadMimeType, SignatureDetector>> = {
  'image/png': matchesPng,
  'image/jpeg': matchesJpeg,
  'image/webp': matchesWebp,
  'application/pdf': matchesPdf,
}

function isSupportedMimeType(mimeType: string): mimeType is SupportedUploadMimeType {
  return Object.hasOwn(SIGNATURES, mimeType)
}

export function isAllowedFileSignature(bytes: Uint8Array, mimeType: string): boolean {
  // This verifies only the exact leading magic bytes. It is not a complete parser and does
  // not detect malware or polyglots; trailing content is deliberately outside this gate.
  if (!(bytes instanceof Uint8Array) || !isSupportedMimeType(mimeType)) {
    return false
  }

  return SIGNATURES[mimeType](bytes, 0)
}
