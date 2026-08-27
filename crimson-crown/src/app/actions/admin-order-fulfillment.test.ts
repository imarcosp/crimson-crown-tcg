import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./admin-order-fulfillment.ts', import.meta.url), 'utf8')

test('las acciones de fulfillment delegan restitución y ajustes a RPCs atómicas', () => {
  assert.match(source, /cancel_order_atomic/iu)
  assert.match(source, /refund_order_atomic/iu)
  assert.match(source, /remove_order_item_atomic/iu)
})

test('las acciones no modifican stock ni estados directamente', () => {
  assert.doesNotMatch(source, /from\(['"]products['"]\)\.(update|delete)/u)
  assert.doesNotMatch(source, /from\(['"]orders['"]\)\.update/u)
})
