import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLegalityUpdates,
  chunkScryfallIdentifiers,
  normalizeScryfallLegalities,
} from './magic-legalities.mjs'

test('normaliza claves y estados conocidos de Scryfall', () => {
  assert.deepEqual(normalizeScryfallLegalities({
    Modern: 'LEGAL',
    commander: 'restricted',
    standard: 'not_legal',
    vintage: 'banned',
    malformed: 'sometimes',
    'bad key': 'legal',
  }), {
    modern: 'legal',
    commander: 'restricted',
    standard: 'not_legal',
    vintage: 'banned',
  })
})

test('crea lotes de colección de hasta 75 identificadores únicos', () => {
  const ids = Array.from({ length: 76 }, (_, index) => `id-${index}`)
  const batches = chunkScryfallIdentifiers([...ids, ids[0]])

  assert.deepEqual(batches.map((batch) => batch.length), [75, 1])
  assert.deepEqual(batches[0][0], { id: 'id-0' })
})

test('limita actualizaciones a IDs externos existentes y reporta cambios reales', () => {
  const result = buildLegalityUpdates([
    { id: 'existing-change', legalities: { modern: 'legal' } },
    { id: 'existing-same', legalities: { modern: 'not_legal' } },
    { id: 'missing', legalities: { modern: 'legal' } },
  ], new Map([
    ['existing-change', { modern: 'not_legal' }],
    ['existing-same', { modern: 'not_legal' }],
  ]))

  assert.deepEqual(result, {
    updates: [{ scryfall_id: 'existing-change', legalities: { modern: 'legal' } }],
    unchanged: 1,
    skipped: 1,
  })
})
