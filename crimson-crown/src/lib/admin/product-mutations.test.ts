import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAdminProductInput } from './product-mutations.ts'

const validInput = {
  name: 'Black Lotus',
  set_name: 'Limited Edition Alpha',
  collector_number: '232',
  tcg: 'Magic',
  price_usd: 12.5,
  stock: 3,
  condition: 'NM',
  finish: 'Non-Foil',
  rarity: 'Rare',
  image_url: 'https://example.test/lotus.jpg',
  scryfall_id: 'abc',
  is_manual_price: true,
  language: 'English',
  metadata: { gallery: [] },
}

test('normaliza un producto válido sin aceptar campos controlados por la base', () => {
  const result = parseAdminProductInput({
    ...validInput,
    id: 'forbidden',
    inventory_id: 'forbidden',
    variant_key: 'forbidden',
    name: '  Black   Lotus ',
    set_name: ' Limited Edition Alpha ',
    collector_number: ' 232 ',
    tcg: ' Magic ',
    condition: ' NM ',
    finish: ' Non-Foil ',
    rarity: ' Rare ',
    image_url: ' https://example.test/lotus.jpg ',
    scryfall_id: ' abc ',
    language: ' English ',
  })

  assert.deepEqual(result, {
    success: true,
    data: validInput,
  })
})

test('normaliza campos opcionales ausentes', () => {
  const result = parseAdminProductInput({
    ...validInput,
    collector_number: undefined,
    scryfall_id: null,
    metadata: undefined,
  })

  assert.deepEqual(result, {
    success: true,
    data: {
      ...validInput,
      collector_number: null,
      scryfall_id: null,
      metadata: {},
    },
  })
})

test('rechaza campos de texto obligatorios vacíos', () => {
  assert.deepEqual(parseAdminProductInput({ ...validInput, name: '   ' }), {
    success: false,
    error: 'El nombre del producto es obligatorio.',
  })
  assert.deepEqual(parseAdminProductInput({ ...validInput, language: null }), {
    success: false,
    error: 'El idioma del producto es obligatorio.',
  })
})

test('rechaza stock negativo o fraccionario y precios no finitos', () => {
  assert.deepEqual(parseAdminProductInput({ ...validInput, stock: -1 }), {
    success: false,
    error: 'El stock debe ser un entero no negativo.',
  })
  assert.deepEqual(parseAdminProductInput({ ...validInput, stock: 1.5 }), {
    success: false,
    error: 'El stock debe ser un entero no negativo.',
  })
  assert.deepEqual(parseAdminProductInput({ ...validInput, price_usd: Number.NaN }), {
    success: false,
    error: 'El precio debe ser un número no negativo.',
  })
})

test('rechaza objetos metadata no planos y prototipos peligrosos', () => {
  const polluted = Object.create({ inherited: true }) as Record<string, unknown>
  polluted.gallery = []

  assert.deepEqual(parseAdminProductInput({ ...validInput, metadata: polluted }), {
    success: false,
    error: 'Los metadatos del producto son inválidos.',
  })
  assert.deepEqual(parseAdminProductInput({ ...validInput, metadata: [] }), {
    success: false,
    error: 'Los metadatos del producto son inválidos.',
  })
})
