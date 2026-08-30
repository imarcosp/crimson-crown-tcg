import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../../supabase/migrations/20260830203000_create_deck_builder_foundation.sql', import.meta.url), 'utf8')

test('la migración del Deckbuilder sólo crea superficies aditivas propias', () => {
  for (const table of ['deck_builder_snapshots', 'deck_builder_decks', 'deck_builder_cards']) {
    assert.match(source, new RegExp(`create table if not exists public[.]${table}`, 'iu'))
    assert.match(source, new RegExp(`alter table public[.]${table} enable row level security`, 'iu'))
  }
  assert.match(source, /create or replace function public[.]promote_deck_builder_snapshot/iu)
  assert.doesNotMatch(source, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public[.](?:products|orders|profiles|inventories|inventory_stock_movements)\b/iu)
  assert.doesNotMatch(source, /drop\s+(?:table|column)|alter\s+table\s+public[.](?:products|orders|profiles|inventories)/iu)
})

test('público sólo lee snapshots activos y la promoción queda acotada', () => {
  assert.match(source, /Public read active deck builder snapshots/iu)
  assert.match(source, /Public read active deck builder decks/iu)
  assert.match(source, /Public read active deck builder cards/iu)
  assert.match(source, /status\s*=\s*'active'/iu)
  assert.match(source, /revoke all on function public[.]promote_deck_builder_snapshot[^;]+from public, anon, authenticated/iu)
  assert.match(source, /grant execute on function public[.]promote_deck_builder_snapshot[^;]+to service_role/iu)
  assert.doesNotMatch(source, /grant execute on function public[.]promote_deck_builder_snapshot[^;]+to authenticated/iu)
  assert.match(source, /grant all on table public[.]deck_builder_snapshots[^;]+to service_role/iu)
})
