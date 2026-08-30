import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260830133000_add_magic_legalities_to_external_prices.sql', import.meta.url),
  'utf8',
)
const backfill = fs.readFileSync(
  new URL('../backfill-magic-legalities.mjs', import.meta.url),
  'utf8',
)

test('la migración sólo agrega metadata de legalidades a external_prices', () => {
  assert.match(migration, /alter table public[.]external_prices[\s\S]*add column if not exists legalities jsonb/iu)
  assert.match(migration, /check \(jsonb_typeof\(legalities\) = 'object'\)/iu)
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/iu)
  assert.doesNotMatch(migration, /public[.](?:products|orders|profiles|inventories|inventory_stock_movements)/iu)
})

test('el backfill es plan por defecto y sólo escribe legalities en external_prices', () => {
  assert.match(backfill, /if \(arguments_[.]length === 0\) return '--plan'/u)
  assert.match(backfill, /createOperationalSupabaseClient/u)
  assert.match(backfill, /from\('external_prices'\)[\s\S]*upsert\(batch, \{ onConflict: 'scryfall_id' \}\)/u)
  assert.doesNotMatch(backfill, /from\('(?:products|orders|profiles|inventories|inventory_stock_movements)'\)[\s\S]{0,120}[.](?:insert|update|upsert|delete)\(/u)
  assert.doesNotMatch(backfill, /supabase[.]co|db push|migration repair|db reset/iu)
})
