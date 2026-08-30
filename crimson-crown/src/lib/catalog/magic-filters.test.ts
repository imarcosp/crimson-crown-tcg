import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAGIC_FORMAT_OPTIONS,
  matchesMagicFormat,
  matchesPriceRange,
  normalizeMagicFormat,
  parsePriceRange,
} from './magic-filters.ts'

test('normaliza sólo formatos Magic soportados', () => {
  assert.equal(normalizeMagicFormat(' MODERN '), 'modern')
  assert.equal(normalizeMagicFormat('commander'), 'commander')
  assert.equal(normalizeMagicFormat('future'), null)
  assert.equal(normalizeMagicFormat(undefined), null)
  assert.equal(new Set(MAGIC_FORMAT_OPTIONS.map((option) => option.value)).size, MAGIC_FORMAT_OPTIONS.length)
})

test('interpreta un rango de precio no negativo y descarta valores inválidos', () => {
  assert.deepEqual(parsePriceRange('1.25', '20'), { min: 1.25, max: 20, isValid: true, isActive: true })
  assert.deepEqual(parsePriceRange('', undefined), { min: null, max: null, isValid: true, isActive: false })
  assert.deepEqual(parsePriceRange('-1', 'abc'), { min: null, max: null, isValid: false, isActive: false })
  assert.deepEqual(parsePriceRange('10', '5'), { min: 10, max: 5, isValid: false, isActive: true })
})

test('filtra por el precio final del listing e incluye los límites', () => {
  const range = parsePriceRange('5', '10')

  assert.equal(matchesPriceRange(5, range), true)
  assert.equal(matchesPriceRange('7.5', range), true)
  assert.equal(matchesPriceRange(10, range), true)
  assert.equal(matchesPriceRange(4.99, range), false)
  assert.equal(matchesPriceRange(10.01, range), false)
  assert.equal(matchesPriceRange(null, range), false)
  assert.equal(matchesPriceRange(7, parsePriceRange('10', '5')), false)
})

test('acepta legal y restricted para el formato elegido, y falla cerrado sin metadata', () => {
  const legalities = {
    standard: 'not_legal',
    modern: 'legal',
    commander: 'restricted',
  }

  assert.equal(matchesMagicFormat(legalities, null), true)
  assert.equal(matchesMagicFormat(legalities, 'modern'), true)
  assert.equal(matchesMagicFormat(legalities, 'commander'), true)
  assert.equal(matchesMagicFormat(legalities, 'standard'), false)
  assert.equal(matchesMagicFormat({}, 'modern'), false)
  assert.equal(matchesMagicFormat(null, 'modern'), false)
})
