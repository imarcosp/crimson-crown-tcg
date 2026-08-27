import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [foundation, runtime] = await Promise.all([
  readFile(new URL('../../supabase/migrations/20260827020755_create_multi_inventory_system.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../supabase/migrations/20260827020830_multi_inventory_runtime_functions.sql', import.meta.url), 'utf8'),
])
const migration = `${foundation}\n${runtime}`

test('checkout híbrido resuelve por variant_key y prioriza el principal', () => {
  assert.match(migration, /place_order_atomic[\s\S]+variant_key/iu)
  assert.match(migration, /is_active\s*=\s*true[\s\S]+archived_at\s+is\s+null/iu)
  assert.match(migration, /order\s+by\s+case\s+when\s+i\.kind\s*=\s*'primary'\s+then\s+0\s+else\s+1/iu)
})

test('cada línea de orden conserva inventario, variante y nombre snapshot', () => {
  assert.match(migration, /insert\s+into\s+public\.order_items\s*\([^)]+inventory_id[^)]+variant_key[^)]+source_inventory_name/isu)
  assert.match(migration, /inventory_stock_movements/iu)
})

test('cancelaciones, expiraciones y reembolsos restauran por línea de origen', () => {
  assert.match(migration, /restore_stock[\s\S]+order_items[\s\S]+inventory_id/iu)
  assert.match(migration, /release_expired_orders_atomic[\s\S]+restore_order_inventory_atomic/iu)
  assert.match(migration, /on\s+conflict\s*\(reference_key\)\s+do\s+nothing/iu)
})

test('la eliminación parcial de una línea no permite mezclar inventarios', () => {
  assert.match(migration, /remove_order_item_atomic[\s\S]+order_items[\s\S]+inventory_id/iu)
  assert.match(migration, /update\s+public\.products[\s\S]+where\s+p\.id\s*=\s*item\.product_id[\s\S]+p\.inventory_id\s*=\s*item\.inventory_id/isu)
})

test('las métricas se calculan por inventario y separan stock reservado, vendido y cancelado', () => {
  assert.match(migration, /get_inventory_metrics/iu)
  assert.match(migration, /reserved_units/iu)
  assert.match(migration, /sold_revenue/iu)
  assert.match(migration, /cancelled_units/iu)
  assert.match(migration, /pending_payment/iu)
  assert.match(migration, /cancelled/iu)
})
