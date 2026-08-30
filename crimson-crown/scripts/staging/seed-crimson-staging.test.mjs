import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSeedPlan,
  buildCleanupPlan,
  formatSeedPlan,
  assertCompleteFixtureUserIds,
  validateExistingFixtureRow,
  validateFixtureUser,
} from './seed-crimson-staging.mjs'

test('construye usuarios sintéticos e IDs deterministas sin correo productivo', () => {
  const plan = buildSeedPlan()
  assert.deepEqual(plan.users.map((user) => user.email), [
    'admin.crimson.staging@example.test',
    'buyer.crimson.staging@example.test',
    'operator.crimson.staging@example.test',
  ])
  assert.ok(plan.users.every((user) => user.email.endsWith('@example.test')))
  assert.ok(plan.rows.every((row) => row.fixture_key.startsWith('codex-staging-p0:')))
  assert.deepEqual(buildSeedPlan(), plan)
  assert.equal(JSON.stringify(plan).includes('mjperchezabala@gmail.com'), false)
})

test('el plan público imprime sólo tipos y conteos, nunca emails, payloads o claves', () => {
  const output = formatSeedPlan(buildSeedPlan())
  assert.deepEqual(JSON.parse(output), {
    mode: 'plan',
    users: 3,
    rows: {
      commission_payments: 1,
      commission_periods: 1,
      import_orders: 1,
      inventories: 1,
      order_items: 1,
      orders: 1,
      products: 1,
    },
    storageObjects: 3,
  })
  assert.doesNotMatch(output, /@|password|service|token|codex-staging-p0:/iu)
})

test('cleanup usa sólo identidades exactas y respeta el orden inverso de FKs', () => {
  const plan = buildSeedPlan()
  const cleanup = buildCleanupPlan(plan)
  assert.deepEqual(cleanup.map((entry) => entry.resource), [
    'storage.objects',
    'commission_payments',
    'commission_periods',
    'import_orders',
    'order_items',
    'orders',
    'products',
    'inventories',
    'profiles',
    'auth.users',
  ])
  assert.ok(cleanup.every((entry) => entry.match.fixture_key?.startsWith('codex-staging-p0:')))
  assert.ok(cleanup.at(-1).match.emails.every((email) => email.endsWith('@example.test')))
})

test('sólo reutiliza un Auth user si email y app_metadata pertenecen al fixture exacto', () => {
  const expected = buildSeedPlan().users[0]
  assert.doesNotThrow(() => validateFixtureUser({
    id: '11111111-1111-4111-8111-111111111111',
    email: expected.email,
    app_metadata: { fixture_key: expected.fixture_key },
  }, expected))
  for (const user of [
    { id: '1', email: expected.email, app_metadata: {} },
    { id: '1', email: 'real@example.test', app_metadata: { fixture_key: expected.fixture_key } },
    { id: '1', email: expected.email, app_metadata: { fixture_key: 'codex-staging-p0:other' } },
  ]) {
    assert.throws(() => validateFixtureUser(user, expected), /fixture sintético/u)
  }
})

test('rechaza una colisión de ID determinista que no tenga el marcador exacto', () => {
  const product = buildSeedPlan().rows.find((row) => row.table === 'products')
  assert.doesNotThrow(() => validateExistingFixtureRow(product, {
    id: product.payload.id,
    metadata: { fixture_key: product.fixture_key },
  }))
  assert.throws(() => validateExistingFixtureRow(product, {
    id: product.payload.id,
    metadata: { fixture_key: 'foreign' },
  }), /fixture sintético/u)
})

test('cleanup falla cerrado si falta una identidad necesaria para una ruta exacta', () => {
  assert.doesNotThrow(() => assertCompleteFixtureUserIds({ admin: 'a', buyer: 'b', operator: 'o' }))
  assert.throws(() => assertCompleteFixtureUserIds({ admin: 'a', operator: 'o' }), /identidad sintética/u)
})
