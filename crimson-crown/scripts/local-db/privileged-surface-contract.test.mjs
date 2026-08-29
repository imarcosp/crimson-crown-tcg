import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migrationRoot = path.join(appRoot, 'supabase', 'migrations')
const inventoryPath = path.join(
  appRoot,
  'docs',
  'security',
  'crimson-security-definer-inventory.json',
)

const requiredSearchPathSignatures = [
  'assign_import_order_number()',
  'calculate_import_order_total(bigint)',
  'delete_trash_products(integer)',
  'find_orders_by_id_part(text)',
  'generate_import_order_number()',
  'generate_next_import_order_number()',
  'get_inventory_valuation()',
  'get_trash_products(integer)',
  'handle_new_user()',
  'is_commission_admin()',
  'merge_duplicate_products(integer)',
  'notify_buylist_manager()',
  'notify_credit_change()',
  'notify_import_manager()',
  'notify_order_manager()',
  'notify_stock_alert()',
  'on_commission_adjustments_change()',
  'on_commission_allocations_change()',
  'recalculate_commission_period_status(uuid)',
  'refresh_commission_period(text)',
  'refresh_commission_period(text, numeric, numeric, boolean)',
  'set_import_order_commission_eligible()',
  'set_order_commission_eligible()',
  'sync_product_prices()',
]

const authenticatedSignature = 'is_commission_admin()'

async function loadSingleMigration(suffix) {
  const matches = (await readdir(migrationRoot))
    .filter((entry) => entry.endsWith(suffix))
    .sort()

  assert.equal(
    matches.length,
    1,
    `se esperaba exactamente una migración con sufijo ${suffix}; encontradas: ${matches.join(', ') || 'ninguna'}`,
  )

  return readFile(path.join(migrationRoot, matches[0]), 'utf8')
}

test('la migración futura endurece la vista y fija los 24 search_path', async () => {
  const sql = (await loadSingleMigration('_harden_privileged_surfaces.sql')).toLowerCase()

  assert.match(sql, /alter view public\.admin_users set \(security_invoker\s*=\s*true\)/)
  assert.match(sql, /revoke all on (table )?public\.admin_users from public, anon, authenticated/)

  for (const signature of requiredSearchPathSignatures) {
    assert.ok(
      sql.includes(`alter function public.${signature} set search_path = public, pg_temp`),
      `falta search_path fijo: ${signature}`,
    )
  }
})

test('el inventario clasifica exactamente las 24 superficies reportadas', async () => {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
  assert.ok(Array.isArray(inventory), 'el inventario debe ser un arreglo JSON')
  assert.deepEqual(
    inventory.map((entry) => entry.signature).sort(),
    [...requiredSearchPathSignatures].sort(),
    'el inventario debe cubrir exactamente las 24 firmas del lote del advisor',
  )
  assert.equal(new Set(inventory.map((entry) => entry.signature)).size, inventory.length)

  for (const entry of inventory) {
    assert.ok(['invoker', 'definer'].includes(entry.security), `security inválido: ${entry.signature}`)
    assert.ok(Array.isArray(entry.allowedRoles) && entry.allowedRoles.length > 0)
    assert.ok(entry.consumer.length > 0)
    assert.ok(entry.authorization.length > 0)
    assert.equal(entry.catalog.production.target, 'djfqozfaqkqdoqeoqbzt')
    assert.equal(entry.catalog.local.target, 'supabase_db_crimson-crown')
    assert.equal(entry.security, entry.catalog.production.security)
    assert.ok(Array.isArray(entry.catalog.production.executeRoles))
    assert.ok(Array.isArray(entry.catalog.local.executeRoles))
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0)
    for (const evidence of entry.evidence) {
      assert.ok(evidence.location.length > 0)
      assert.ok(Number.isInteger(evidence.line) && evidence.line > 0)
    }

    const expectedRoles = entry.signature === authenticatedSignature
      ? ['authenticated', 'service_role']
      : ['service_role']
    assert.deepEqual(entry.allowedRoles, expectedRoles, `roles inesperados: ${entry.signature}`)
    assert.ok(!entry.allowedRoles.includes('PUBLIC'))
    assert.ok(!entry.allowedRoles.includes('anon'))
  }
})
