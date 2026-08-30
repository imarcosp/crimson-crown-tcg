import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const path = 'scripts/release/production-reconciliation-preflight.sql'

test('el preflight productivo es read-only, agregado y cubre las tres pruebas remotas cuestionadas', async () => {
  const source = await readFile(path, 'utf8')
  const executable = source.replace(/--[^\r\n]*/gu, '')

  assert.doesNotMatch(executable, /\b(?:insert|update|delete|truncate|alter|drop|create|grant|revoke|comment)\b/iu)
  assert.doesNotMatch(executable, /select\s+[*]/iu)
  assert.doesNotMatch(executable, /\b(?:email|address|phone|payment_proof_path|proof_path|object_name)\b/iu)
  assert.match(source, /supabase_migrations[.]schema_migrations/iu)
  assert.match(source, /pg_get_functiondef/iu)
  assert.match(source, /pg_get_constraintdef/iu)
  assert.match(source, /pg_get_indexdef/iu)
  assert.match(source, /pg_policies/iu)
  assert.match(source, /protected_aggregates/iu)
  assert.match(source, /pre_start_commission_periods/iu)
  assert.match(source, /duplicate_movement_reference_keys/iu)
  assert.match(source, /snapshot_sha256/iu)
})
