import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [formSource, csvSource, pageSource] = await Promise.all([
  readFile(new URL('../../components/admin/ProductForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../components/admin/CsvUploader.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../app/admin/inventory/page.tsx', import.meta.url), 'utf8'),
])

test('el formulario manual siempre escribe dentro del inventario seleccionado', () => {
  assert.match(formSource, /inventoryId: string/u)
  assert.match(formSource, /inventory_id:\s*inventoryId/u)
  assert.match(formSource, /eq\(['"]inventory_id['"],\s*inventoryId\)/u)
})

test('el CSV consulta, inserta y actualiza dentro del inventario seleccionado', () => {
  assert.match(csvSource, /function CsvUploader\(\{ inventoryId \}/u)
  assert.match(csvSource, /inventory_id:\s*inventoryId/u)
  assert.match(csvSource, /eq\(['"]inventory_id['"],\s*inventoryId\)/u)
  assert.doesNotMatch(csvSource, /upsert_product_variant/u)
})

test('la pantalla de operación no renderiza cargas sin inventario', () => {
  assert.match(pageSource, /selectedInventoryId && <CsvUploader inventoryId=\{selectedInventoryId\}/u)
  assert.match(pageSource, /eq\(['"]inventory_id['"],\s*selectedInventoryId\)/u)
})
