import assert from 'node:assert/strict'
import test from 'node:test'

import { matchDeckCardsToCatalog } from './catalog.ts'

test('agrega stock activo por variante y conserva el producto primario para checkout', () => {
  const cards = [{ id: 'card-1', name: 'Sol Ring', scryfall_id: '11111111-1111-4111-8111-111111111111', quantity: 1, role: 'main' }]
  const products = [
    { id: 'primary-product', inventory_id: 'primary', inventory_kind: 'primary', variant_key: 'same', name: 'Sol Ring', scryfall_id: cards[0].scryfall_id, tcg: 'Magic', stock: 1, price_usd: 2, finish: 'Non-Foil' },
    { id: 'secondary-product', inventory_id: 'secondary', inventory_kind: 'secondary', variant_key: 'same', name: 'Sol Ring', scryfall_id: cards[0].scryfall_id, tcg: 'Magic', stock: 2, price_usd: 2, finish: 'Non-Foil' },
  ]
  const [matched] = matchDeckCardsToCatalog(cards, products, [])
  assert.equal(matched.availableLocalQuantity, 3)
  assert.equal(matched.localProduct?.id, 'primary-product')
  assert.equal(matched.localProduct?.stock, 3)
})

test('usa la biblioteca externa para una carta sin stock y no inventa disponibilidad', () => {
  const external = [{
    scryfall_id: '22222222-2222-4222-8222-222222222222', name: 'Rhystic Study',
    set_name: 'Wilds of Eldraine', collector_number: '71', image_url: '/rhystic.jpg',
    cardkingdom_retail_normal: 31,
  }]
  const [matched] = matchDeckCardsToCatalog([
    { id: 'card-2', name: 'Rhystic Study', scryfall_id: external[0].scryfall_id, quantity: 1, role: 'main' },
  ], [], external)
  assert.equal(matched.availableLocalQuantity, 0)
  assert.equal(matched.localProduct, null)
  assert.equal(matched.importSuggestion?.price, 31)
})
