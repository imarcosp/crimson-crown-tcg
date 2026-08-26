import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const migrationsDir = resolve(process.cwd(), 'supabase', 'migrations')

function loadCompatibilityMigration() {
  const matches = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('_production_compatibility_baseline.sql'))

  assert.equal(
    matches.length,
    1,
    'debe existir exactamente una migración de compatibilidad productiva',
  )

  const filename = matches[0]
  return {
    filename,
    sql: readFileSync(resolve(migrationsDir, filename), 'utf8').toLowerCase(),
  }
}

test('la compatibilidad precede a las RPCs atómicas', () => {
  const { filename } = loadCompatibilityMigration()
  assert.ok(
    filename < '20260823173257_create_place_order_atomic.sql',
    'la compatibilidad debe ejecutarse antes de place_order_atomic',
  )
  assert.ok(
    filename < '20260823183638_create_release_expired_orders_atomic.sql',
    'la compatibilidad debe ejecutarse antes de release_expired_orders_atomic',
  )
})

test('la compatibilidad cierra los grants administrativos heredados', () => {
  const { sql } = loadCompatibilityMigration()
  for (const fragment of [
    'create or replace function public.is_admin',
    'drop function if exists public.decrement_stock(integer, uuid)',
    'revoke all on function public.is_admin() from public',
    'grant execute on function public.is_admin() to authenticated, service_role',
    'revoke all on function public.decrement_stock(integer, uuid) from public, anon, authenticated',
    'grant execute on function public.decrement_stock(integer, uuid) to authenticated, service_role',
    'revoke all on function public.restore_stock(uuid) from public, anon, authenticated',
    'grant execute on function public.restore_stock(uuid) to authenticated, service_role',
  ]) {
    assert.ok(sql.includes(fragment), `falta el contrato SQL: ${fragment}`)
  }
})
