import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateOffers, buildCatalogListings, buildVariantKey, groupOffers } from './domain.ts'

test('construye la misma clave para una impresión Magic equivalente en distintos inventarios', () => {
  const primaryKey = buildVariantKey({
    tcg: 'Magic',
    scryfallId: 'CARD-123',
    condition: 'NM',
    language: 'English',
    finish: 'Non-Foil',
  })
  const secondaryKey = buildVariantKey({
    tcg: 'magic',
    scryfallId: 'CARD-123',
    condition: ' nm ',
    language: ' ENGLISH ',
    finish: 'non-foil',
  })

  assert.equal(primaryKey, secondaryKey)
})

test('mantiene separadas las variantes que cambian acabado', () => {
  const normalKey = buildVariantKey({ tcg: 'Magic', scryfallId: 'CARD-123', condition: 'NM', language: 'English', finish: 'Non-Foil' })
  const foilKey = buildVariantKey({ tcg: 'Magic', scryfallId: 'CARD-123', condition: 'NM', language: 'English', finish: 'Foil' })

  assert.notEqual(normalKey, foilKey)
})

test('usa nombre, edición y número para productos sin scryfall id', () => {
  const first = buildVariantKey({ tcg: 'Accesorios', name: 'Deck Box', setName: 'Base', collectorNumber: ' 07 ', condition: 'NM', language: 'ES', finish: 'Normal' })
  const second = buildVariantKey({ tcg: 'accesorios', name: ' deck   box ', setName: 'base', collectorNumber: '07', condition: 'nm', language: 'es', finish: 'normal' })

  assert.equal(first, second)
})

test('consume primero el inventario principal y luego el secundario', () => {
  const offers = [
    { productId: 'secondary-product', inventoryId: 'secondary', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 4, priceUsd: 10, pricingSource: 'manual' as const },
    { productId: 'primary-product', inventoryId: 'primary', inventoryKind: 'primary' as const, variantKey: 'variant', stock: 1, priceUsd: 9, pricingSource: 'cardkingdom' as const },
  ]

  const result = allocateOffers(offers, 3)

  assert.deepEqual(result.allocations.map(({ offer, quantity }) => [offer.productId, quantity]), [
    ['primary-product', 1],
    ['secondary-product', 2],
  ])
  assert.equal(result.remaining, 0)
})

test('devuelve faltante cuando el stock agregado no alcanza', () => {
  const result = allocateOffers([
    { productId: 'primary-product', inventoryId: 'primary', inventoryKind: 'primary' as const, variantKey: 'variant', stock: 1, priceUsd: 9, pricingSource: 'cardkingdom' as const },
  ], 3)

  assert.equal(result.allocations[0]?.quantity, 1)
  assert.equal(result.remaining, 2)
})

test('agrupa ofertas automáticas iguales y conserva manuales diferentes', () => {
  const groups = groupOffers([
    { productId: 'primary-product', inventoryId: 'primary', inventoryKind: 'primary' as const, variantKey: 'variant', stock: 1, priceUsd: 9, pricingSource: 'cardkingdom' as const },
    { productId: 'secondary-auto', inventoryId: 'secondary', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 2, priceUsd: 9, pricingSource: 'cardkingdom' as const },
    { productId: 'secondary-manual', inventoryId: 'secondary-2', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 1, priceUsd: 12, pricingSource: 'manual' as const },
  ])

  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0]?.offers.map((offer) => [offer.pricingSource, offer.priceUsd, offer.stock]), [
    ['cardkingdom', 9, 3],
    ['manual', 12, 1],
  ])
})

test('genera listings visuales separados cuando el precio manual difiere', () => {
  const listings = buildCatalogListings([
    { productId: 'primary-auto', inventoryId: 'primary', inventoryKind: 'primary' as const, variantKey: 'variant', stock: 2, priceUsd: 9, pricingSource: 'cardkingdom' as const },
    { productId: 'secondary-auto', inventoryId: 'secondary', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 3, priceUsd: 9, pricingSource: 'cardkingdom' as const },
    { productId: 'secondary-manual', inventoryId: 'secondary-2', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 1, priceUsd: 12, pricingSource: 'manual' as const },
  ])

  assert.deepEqual(listings.map((listing) => [listing.productId, listing.priceUsd, listing.stock]), [
    ['primary-auto', 9, 5],
    ['secondary-manual', 12, 1],
  ])
})

test('suma automáticos CK y fallback TCG cuando el precio efectivo coincide', () => {
  const listings = buildCatalogListings([
    { productId: 'primary-ck', inventoryId: 'primary', inventoryKind: 'primary' as const, variantKey: 'variant', stock: 1, priceUsd: 9, pricingSource: 'cardkingdom' as const },
    { productId: 'secondary-tcg', inventoryId: 'secondary', inventoryKind: 'secondary' as const, variantKey: 'variant', stock: 2, priceUsd: 9, pricingSource: 'tcgplayer' as const },
  ])

  assert.deepEqual(listings.map((listing) => [listing.productId, listing.priceUsd, listing.stock, listing.pricingSource]), [
    ['primary-ck', 9, 3, 'cardkingdom'],
  ])
})
