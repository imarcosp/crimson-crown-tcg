import assert from 'node:assert/strict'
import test from 'node:test'

import { CART_PERSIST_OPTIONS, migrateCartState } from './cart-hydration.ts'

test('cart persistence is deferred until explicit client rehydration', () => {
  assert.deepEqual(CART_PERSIST_OPTIONS, { skipHydration: true })
})

test('cart migration repairs invalid persisted collections without losing valid state', () => {
  assert.deepEqual(
    migrateCartState({ items: 'invalid', savedItems: [{ id: 'saved-1' }], discount: null }),
    { items: [], savedItems: [{ id: 'saved-1' }], discount: null },
  )
})
