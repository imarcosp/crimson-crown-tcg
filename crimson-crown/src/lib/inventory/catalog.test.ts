import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHybridCatalogProducts } from './catalog.ts'

test('el catálogo suma stock activo y conserva como versión aparte el precio manual', () => {
  const products = buildHybridCatalogProducts([
    { id: 'primary-auto', inventory_id: 'primary', inventory_kind: 'primary', variant_key: 'variant', name: 'Lightning Bolt', stock: 2, price_usd: 9, is_manual_price: false, tcg: 'Magic' },
    { id: 'secondary-auto', inventory_id: 'secondary', inventory_kind: 'secondary', variant_key: 'variant', name: 'Lightning Bolt', stock: 3, price_usd: 9, is_manual_price: false, tcg: 'Magic' },
    { id: 'secondary-manual', inventory_id: 'secondary-2', inventory_kind: 'secondary', variant_key: 'variant', name: 'Lightning Bolt', stock: 1, price_usd: 12, is_manual_price: true, tcg: 'Magic' },
    { id: 'inactive', inventory_id: 'inactive', inventory_kind: 'secondary', variant_key: 'variant', name: 'Lightning Bolt', stock: 10, price_usd: 9, is_manual_price: false, tcg: 'Magic' },
  ], new Map(), { activeInventoryIds: new Set(['primary', 'secondary', 'secondary-2']) })

  assert.deepEqual(products.map((product) => [product.id, product.stock, product.price_usd, product.inventory_count]), [
    ['primary-auto', 5, 9, 2],
    ['secondary-manual', 1, 12, 1],
  ])
})

test('el catálogo excluye inventarios inactivos y puede conservar una variante agotada para wishlist', () => {
  const products = buildHybridCatalogProducts([
    { id: 'inactive-stock', inventory_id: 'inactive', inventory_kind: 'secondary', variant_key: 'inactive-variant', name: 'Counterspell', stock: 4, price_usd: 4, is_manual_price: false, tcg: 'Magic' },
    { id: 'zero', inventory_id: 'primary', inventory_kind: 'primary', variant_key: 'zero-variant', name: 'Swords to Plowshares', stock: 0, price_usd: 2, is_manual_price: false, tcg: 'Magic' },
  ], new Map(), { activeInventoryIds: new Set(['primary']), includeOutOfStock: true })

  assert.deepEqual(products.map((product) => [product.id, product.stock]), [['zero', 0]])
})

test('identifica Card Kingdom y usa TCGplayer sólo como fallback automático', () => {
  const rows = [
    { id: 'ck', inventory_id: 'primary', inventory_kind: 'primary', variant_key: 'ck-key', name: 'Card Kingdom', stock: 1, price_usd: 8, is_manual_price: false, tcg: 'Magic' },
    { id: 'tcg', inventory_id: 'secondary', inventory_kind: 'secondary', variant_key: 'tcg-key', name: 'TCG fallback', stock: 1, price_usd: 7, is_manual_price: false, tcg: 'Magic' },
  ]
  const products = buildHybridCatalogProducts(rows, new Map([
    ['ck', { cardkingdom_retail_normal: 8, tcgplayer_market_normal: 7 }],
    ['tcg', { cardkingdom_retail_normal: 0, tcgplayer_market_normal: 7 }],
  ]))

  assert.deepEqual(products.map((product) => product.pricing_source), ['cardkingdom', 'tcgplayer'])
})
