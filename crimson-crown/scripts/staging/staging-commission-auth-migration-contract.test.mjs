import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const migration = path.join(root, 'scripts', 'staging', 'sql', 'scope-staging-commission-operator.sql')

test('commission operator exception is exact and requires the synthetic staging fixture', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create or replace function public\.is_commission_admin\(\)/iu)
  assert.match(sql, /operator\.crimson\.staging@example\.test/iu)
  assert.match(sql, /c0de0001-0000-4000-8000-000000000001/iu)
  assert.match(sql, /codex-staging-p0:inventory/iu)
  assert.match(sql, /public\.is_admin\(\)\s+or\s*\(/iu)
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate|drop table)\b/iu)
  assert.match(sql, /revoke all on function public\.is_commission_admin\(\) from public, anon/iu)
  assert.match(sql, /grant execute on function public\.is_commission_admin\(\) to authenticated, service_role/iu)
  assert.match(sql, /staging-only; never apply to production/iu)
})
