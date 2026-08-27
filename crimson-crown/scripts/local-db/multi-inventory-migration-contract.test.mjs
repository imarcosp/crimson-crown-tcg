import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL('../../supabase/migrations/20260827020755_create_multi_inventory_system.sql', import.meta.url), 'utf8')

test('crea inventarios y protege el inventario principal', () => {
  assert.match(migration, /create table(?: if not exists)? public\.inventories/iu)
  assert.match(migration, /kind\s+text[^\n]*check[^\n]*primary/iu)
  assert.match(migration, /create unique index[^\n]*inventories[^\n]*primary/iu)
  assert.match(migration, /inventory_id\s+uuid/iu)
  assert.match(migration, /variant_key\s+text/iu)
})

test('registra origen de líneas y movimientos idempotentes', () => {
  assert.match(migration, /alter table public\.order_items[^;]*inventory_id/isu)
  assert.match(migration, /source_inventory_name/iu)
  assert.match(migration, /create table(?: if not exists)? public\.inventory_stock_movements/iu)
  assert.match(migration, /idempotency_unique/iu)
})

test('expone solo funciones administrativas protegidas', () => {
  for (const fn of ['create_inventory', 'set_inventory_active', 'archive_inventory', 'delete_inventory_safely']) {
    assert.match(migration, new RegExp(`create(?: or replace)? function public\\.${fn}`, 'iu'))
    assert.match(migration, new RegExp(`${fn}[\\s\\S]{0,2200}is_admin`, 'iu'))
  }
  assert.match(migration, /revoke all on function public\.create_inventory/iu)
  assert.match(migration, /grant execute on function public\.create_inventory[^;]*authenticated/isu)
})

test('genera variant_key en servidor y agrega índices operativos', () => {
  assert.match(migration, /create(?: or replace)? function public\.build_product_variant_key/iu)
  assert.match(migration, /create unique index[^\n]*products[^\n]*inventory_id[^\n]*variant_key/iu)
  assert.match(migration, /create index[^\n]*order_items[^\n]*inventory_id/iu)
})
