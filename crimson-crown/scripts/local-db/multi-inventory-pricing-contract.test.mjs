import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [mainSource, batchSource, riftSource, syncSource] = await Promise.all([
  readFile(new URL('../../scripts/update-prices.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/update-prices-batch.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/update-riftbound-prices.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/sync-ck-prices.mjs', import.meta.url), 'utf8'),
])

test('el actualizador Magic protege los precios manuales también en el UPDATE', () => {
  assert.match(mainSource, /is_manual_price/iu)
  assert.match(mainSource, /\.eq\(['"]is_manual_price['"],\s*false\)/u)
  assert.match(mainSource, /return\s+ck\s*>\s*0\s*\?\s*ck\s*:\s*tcg/u)
  assert.doesNotMatch(mainSource, /tcg\s*>\s*\(ck\s*\*\s*1\.10\)/u)
})

test('los actualizadores alternativos omiten y protegen productos manuales', () => {
  for (const source of [batchSource, riftSource]) {
    assert.match(source, /is_manual_price/iu)
    assert.match(source, /\.eq\(['"]is_manual_price['"],\s*false\)/u)
  }
})

test('la propagación Card Kingdom conserva fallback TCGplayer', () => {
  assert.match(syncSource, /tcgplayer_market_normal/iu)
  assert.match(syncSource, /tcgplayer_market_foil/iu)
  assert.match(syncSource, /cardkingdom_retail_normal\s*\|\|\s*.*tcgplayer_market_normal/isu)
  assert.match(syncSource, /cardkingdom_retail_foil\s*\|\|\s*.*tcgplayer_market_foil/isu)
  assert.match(syncSource, /\.\.\.\(current\s*\|\|\s*\{\}\),\s*\.\.\.\(updates\.get\(scryId\)\s*\|\|\s*\{\}\)/isu)
})

test('las actualizaciones de precios mantienen el contexto del inventario', () => {
  assert.match(mainSource, /inventory_id/iu)
  assert.match(batchSource, /inventory_id/iu)
  assert.match(riftSource, /inventory_id/iu)
  assert.match(syncSource, /inventory_id/iu)
  assert.match(syncSource, /productUpdates\.push\(\{[\s\S]{0,180}inventory_id:\s*p\.inventory_id/iu)
})
