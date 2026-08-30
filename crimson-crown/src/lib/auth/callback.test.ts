import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAuthCallbackPath } from './callback.ts'

test('permite únicamente los destinos internos de Auth previstos', () => {
  assert.equal(resolveAuthCallbackPath('/'), '/')
  assert.equal(resolveAuthCallbackPath('/auth/update-password'), '/auth/update-password')
})

test('rechaza redirects abiertos, destinos desconocidos y entradas malformadas', () => {
  for (const candidate of [
    null,
    undefined,
    '',
    'https://example.com',
    '//example.com',
    '/admin',
    '/auth/update-password?next=https://example.com',
    '\\example.com',
  ]) {
    assert.equal(resolveAuthCallbackPath(candidate), '/')
  }
})
