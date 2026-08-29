import assert from 'node:assert/strict'
import test from 'node:test'

import { isAllowedFileSignature } from './file-signatures.ts'

const encoder = new TextEncoder()
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff])
const webp = encoder.encode('RIFF1234WEBP')
const pdf = encoder.encode('%PDF-1.7')

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

test('accepts the exact PNG, JPEG, WebP and PDF leading signatures', () => {
  assert.equal(isAllowedFileSignature(png, 'image/png'), true)
  assert.equal(isAllowedFileSignature(jpeg, 'image/jpeg'), true)
  assert.equal(isAllowedFileSignature(webp, 'image/webp'), true)
  assert.equal(isAllowedFileSignature(pdf, 'application/pdf'), true)
  assert.equal(isAllowedFileSignature(encoder.encode('%PDF-2.0'), 'application/pdf'), true)
})

test('rejects payloads whose leading signature does not match the declared MIME type', () => {
  assert.equal(isAllowedFileSignature(encoder.encode('<script>'), 'image/png'), false)
  assert.equal(isAllowedFileSignature(jpeg, 'image/png'), false)
  assert.equal(isAllowedFileSignature(png, 'image/jpeg'), false)
  assert.equal(isAllowedFileSignature(pdf, 'image/webp'), false)
  assert.equal(isAllowedFileSignature(webp, 'application/pdf'), false)
})

test('rejects truncated signatures for every supported format', () => {
  assert.equal(isAllowedFileSignature(png.subarray(0, 7), 'image/png'), false)
  assert.equal(isAllowedFileSignature(jpeg.subarray(0, 2), 'image/jpeg'), false)
  assert.equal(isAllowedFileSignature(webp.subarray(0, 11), 'image/webp'), false)
  assert.equal(isAllowedFileSignature(encoder.encode('%PDF-1.'), 'application/pdf'), false)
})

test('rejects malformed format markers', () => {
  assert.equal(isAllowedFileSignature(Uint8Array.from([0xff, 0xd8, 0x00]), 'image/jpeg'), false)
  assert.equal(isAllowedFileSignature(encoder.encode('RIFF1234FAIL'), 'image/webp'), false)
  assert.equal(isAllowedFileSignature(encoder.encode('%PDF-3.0'), 'application/pdf'), false)
  assert.equal(isAllowedFileSignature(encoder.encode('%PDF-1.x'), 'application/pdf'), false)
})

test('rejects polyglot-like prefixes containing a second recognized file signature', () => {
  const newline = encoder.encode('\n')
  assert.equal(isAllowedFileSignature(concatBytes(png, pdf), 'image/png'), false)
  assert.equal(isAllowedFileSignature(concatBytes(jpeg, pdf), 'image/jpeg'), false)
  assert.equal(isAllowedFileSignature(concatBytes(webp, pdf), 'image/webp'), false)
  assert.equal(isAllowedFileSignature(concatBytes(pdf, newline, png), 'application/pdf'), false)
})

test('rejects unknown MIME types even when bytes match a supported format', () => {
  assert.equal(isAllowedFileSignature(png, 'image/svg+xml'), false)
  assert.equal(isAllowedFileSignature(pdf, 'application/octet-stream'), false)
})
