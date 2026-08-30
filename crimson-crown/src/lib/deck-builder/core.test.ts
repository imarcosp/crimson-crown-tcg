import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DECK_BUILDER_FORMATS,
  calculateDeckCoverage,
  getDeckBuilderFormat,
  groupDeckCards,
  normalizeDeckBuilderSearch,
} from './core.ts'

test('formatos Magic son únicos, ordenados y sólo aceptan slugs conocidos', () => {
  assert.equal(new Set(DECK_BUILDER_FORMATS.map((format) => format.slug)).size, DECK_BUILDER_FORMATS.length)
  assert.deepEqual([...DECK_BUILDER_FORMATS].map((format) => format.order), [...DECK_BUILDER_FORMATS].map((format) => format.order).sort((a, b) => a - b))
  assert.equal(getDeckBuilderFormat('commander')?.label, 'Commander')
  assert.equal(getDeckBuilderFormat('MODERN')?.slug, 'modern')
  assert.equal(getDeckBuilderFormat('../admin'), null)
})

test('normaliza búsquedas y rechaza controles o entradas excesivas', () => {
  assert.equal(normalizeDeckBuilderSearch('  Mono   Red  '), 'Mono Red')
  assert.equal(normalizeDeckBuilderSearch(undefined), '')
  assert.throws(() => normalizeDeckBuilderSearch('bad\u0000query'), /búsqueda/iu)
  assert.throws(() => normalizeDeckBuilderSearch('x'.repeat(81)), /búsqueda/iu)
})

test('calcula cobertura por cartas únicas y cantidades sin sobrecontar stock', () => {
  assert.deepEqual(calculateDeckCoverage([
    { quantity: 4, availableLocalQuantity: 2 },
    { quantity: 1, availableLocalQuantity: 8 },
    { quantity: 2, availableLocalQuantity: 0 },
  ]), {
    requiredUniqueCards: 3,
    coveredUniqueCards: 2,
    requiredQuantity: 7,
    availableLocalQuantity: 3,
    missingLocalQuantity: 4,
    coveragePercent: 67,
  })
})

test('agrupa roles conocidos y mantiene un fallback seguro', () => {
  const grouped = groupDeckCards([
    { id: '1', role: 'commander' },
    { id: '2', role: 'main' },
    { id: '3', role: 'sideboard' },
    { id: '4', role: 'desconocido' },
  ])
  assert.deepEqual(grouped.commanders.map((card) => card.id), ['1'])
  assert.deepEqual(grouped.mainboard.map((card) => card.id), ['2', '4'])
  assert.deepEqual(grouped.sideboard.map((card) => card.id), ['3'])
})
