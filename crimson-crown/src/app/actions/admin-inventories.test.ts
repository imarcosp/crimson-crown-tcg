import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./admin-inventories.ts', import.meta.url), 'utf8')

test('las acciones de inventarios requieren una sesión admin', () => {
  assert.match(source, /getUser\(\)/u)
  assert.match(source, /isAdminEmail/u)
  assert.match(source, /Acceso denegado|Sin permiso/u)
})

test('las acciones delegan cambios de estado a RPCs protegidas', () => {
  assert.match(source, /rpc\(['"]create_inventory['"]/u)
  assert.match(source, /rpc\(['"]set_inventory_active['"]/u)
  assert.match(source, /rpc\(['"]archive_inventory['"]/u)
  assert.match(source, /rpc\(['"]delete_inventory_safely['"]/u)
  assert.doesNotMatch(source, /from\(['"]inventories['"]\)\.(insert|update|delete)/u)
})

test('las acciones validan nombres y no exponen service role en clientes', () => {
  assert.match(source, /name.*trim|trim.*name/iu)
  assert.match(source, /use server/u)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/u)
})
