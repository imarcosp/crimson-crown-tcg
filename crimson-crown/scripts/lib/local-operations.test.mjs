import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCountSql,
  buildSnapshotEnvelope,
  buildTimestampedName,
  classifyDataObject,
  sha256,
} from './local-operations.mjs'

test('clasifica superficies sensibles y públicas sin exponer valores', () => {
  assert.equal(classifyDataObject('auth.users'), 'restricted_identity')
  assert.equal(classifyDataObject('public.orders'), 'restricted_commerce')
  assert.equal(classifyDataObject('public.products'), 'public_catalog')
  assert.throws(() => classifyDataObject('public.future_table'), /sin clasificación explícita/u)
})

test('construye conteos sólo para identificadores allowlisted', () => {
  const sql = buildCountSql(['public.products', 'auth.users', 'public.products'])
  assert.match(sql, /from "auth"[.]"users"/u)
  assert.match(sql, /from "public"[.]"products"/u)
  assert.equal((sql.match(/public[.]products/gu) || []).length, 1)
  assert.throws(() => buildCountSql(['public.products; drop table public.orders']), /no permitido/u)
})

test('el snapshot sólo contiene metadatos, conteos y clasificación', () => {
  const snapshot = buildSnapshotEnvelope({
    generatedAt: '2026-08-30T22:30:00.000Z',
    schemaSnapshot: { migrations: [], relation_signatures: [] },
    rowCounts: [
      { object_name: 'auth.users', row_count: 77 },
      { object_name: 'public.products', row_count: 1840 },
    ],
  })

  assert.equal(snapshot.source.container, 'supabase_db_crimson-crown')
  assert.equal(snapshot.source.contains_row_values, false)
  assert.deepEqual(snapshot.classifications, [
    { object_name: 'auth.users', classification: 'restricted_identity' },
    { object_name: 'public.products', classification: 'public_catalog' },
  ])
  assert.throws(() => buildSnapshotEnvelope({
    generatedAt: '2026-08-30T22:30:00.000Z',
    schemaSnapshot: {},
    rowCounts: [{ object_name: 'public.products', row_count: -1 }],
  }), /Conteo inválido/u)
})

test('genera nombres deterministas y hashes SHA-256', () => {
  assert.equal(buildTimestampedName('local-state', '2026-08-30T22:30:00.000Z', 'json'), 'local-state-20260830-223000Z.json')
  assert.equal(sha256('crimson'), 'fd8ed7f18b1dd519356074c82b0628c97ad8c0a5a293fd634fa69dcc79a3381b')
})
