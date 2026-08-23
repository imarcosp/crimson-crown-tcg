import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const checkoutSource = await readFile(new URL('../../src/app/actions/checkout.ts', import.meta.url), 'utf8')

test('checkout delega todas las escrituras financieras al RPC atómico', () => {
  assert.match(checkoutSource, /\.rpc\(['"]place_order_atomic['"]\s*,/)
  assert.doesNotMatch(checkoutSource, /\.rpc\(['"]decrement_stock['"]\s*,/)
  assert.doesNotMatch(checkoutSource, /\.rpc\(['"]manage_credits['"]\s*,/)
})
