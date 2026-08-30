import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSeedPlan,
  buildCleanupPlan,
  formatSeedPlan,
  assertCompleteFixtureUserIds,
  cleanupCrimsonStaging,
  seedCrimsonStaging,
  validateExistingFixtureRow,
  validateFixtureUser,
} from './seed-crimson-staging.mjs'

test('construye usuarios sintéticos e IDs deterministas sin correo productivo', () => {
  const plan = buildSeedPlan()
  const importOrder = plan.rows.find((row) => row.table === 'import_orders')
  const importItem = plan.rows.find((row) => row.table === 'import_items')
  const commissionPeriod = plan.rows.find((row) => row.table === 'commission_periods')
  assert.deepEqual(plan.users.map((user) => user.email), [
    'admin.crimson.staging@example.test',
    'buyer.crimson.staging@example.test',
    'operator.crimson.staging@example.test',
  ])
  assert.ok(plan.users.every((user) => user.email.endsWith('@example.test')))
  assert.ok(plan.rows.every((row) => row.fixture_key.startsWith('codex-staging-p0:')))
  assert.match(importOrder.payload.id, /^[1-9][0-9]{0,18}$/u)
  assert.equal(importOrder.payload.id, '900000000000001')
  assert.ok(BigInt(importOrder.payload.id) <= BigInt(Number.MAX_SAFE_INTEGER))
  assert.equal(importOrder.payload.status, 'Cotizada')
  assert.equal(importItem.payload.order_id, importOrder.payload.id)
  assert.equal(importItem.payload.platform, 'Otro')
  assert.equal(importItem.payload.unit_price, 1)
  assert.doesNotThrow(() => validateExistingFixtureRow(importItem, {
    ...importItem.payload,
    order_id: Number(importItem.payload.order_id),
  }))
  assert.equal(commissionPeriod.payload.period_key, '2099-12')
  assert.deepEqual(buildSeedPlan(), plan)
  assert.equal(JSON.stringify(plan).includes('mjperchezabala@gmail.com'), false)
})

function createFakeService({ foreignProduct = false, missingProof = false, deleteUserWithoutEcho = false } = {}) {
  const plan = buildSeedPlan()
  const tables = new Map(plan.rows.map(({ table }) => [table, new Map()]))
  tables.set('profiles', new Map())
  const users = new Map()
  const objects = new Map()
  const passwordUpdates = []

  const tableKey = (_table, row) => row.id
  const queryFor = (table) => {
    const state = { operation: 'select', payload: null, filters: [], contains: [], conflict: 'id' }
    const query = {
      select() { return query },
      insert(payload) { state.operation = 'insert'; state.payload = payload; return query },
      update(payload) { state.operation = 'update'; state.payload = payload; return query },
      upsert(payload, options = {}) { state.operation = 'upsert'; state.payload = payload; state.conflict = options.onConflict ?? 'id'; return query },
      delete() { state.operation = 'delete'; return query },
      eq(name, value) { state.filters.push([name, value]); return query },
      contains(name, value) { state.contains.push([name, value]); return query },
      maybeSingle() { return execute(true) },
      single() { return execute(false) },
      then(resolve, reject) { return execute(false).then(resolve, reject) },
    }
    const matches = (row) => state.filters.every(([name, value]) => row[name] === value) &&
      state.contains.every(([name, value]) => Object.entries(value).every(([key, expected]) => row[name]?.[key] === expected))
    async function execute(maybe) {
      const rows = tables.get(table)
      const found = [...rows.values()].filter(matches)
      if (state.operation === 'select') {
        if (maybe) return { data: found[0] ?? null, error: null }
        return { data: found, error: null }
      }
      if (state.operation === 'insert') {
        const key = tableKey(table, state.payload)
        if (rows.has(key)) return { data: null, error: { code: '23505' } }
        rows.set(key, structuredClone(state.payload))
        return { data: { id: state.payload.id ?? 9001 }, error: null }
      }
      if (state.operation === 'upsert') {
        const key = state.payload[state.conflict]
        rows.set(key, structuredClone(state.payload))
        return { data: { id: state.payload.id }, error: null }
      }
      if (state.operation === 'update') {
        for (const row of found) Object.assign(row, structuredClone(state.payload))
        return { data: found.map(({ id }) => ({ id: id ?? 9001 })), error: null }
      }
      if (state.operation === 'delete') {
        for (const [key, row] of rows) if (matches(row)) rows.delete(key)
        return { data: found.map(({ id }) => ({ id: id ?? 9001 })), error: null }
      }
      throw new Error('unsupported fake operation')
    }
    return query
  }

  const storageBucket = (bucket) => ({
    async info(path) {
      const value = objects.get(`${bucket}/${path}`)
      return value
        ? { data: { id: path }, error: null }
        : { data: null, error: { name: 'StorageApiError', status: 400, statusCode: '404' } }
    },
    async download(path) {
      const value = objects.get(`${bucket}/${path}`)
      return value ? { data: new Blob([value]), error: null } : { data: null, error: { statusCode: '404' } }
    },
    async upload(path, blob) {
      const key = `${bucket}/${path}`
      if (objects.has(key)) return { data: null, error: { code: 'Duplicate' } }
      objects.set(key, new Uint8Array(await blob.arrayBuffer()))
      return { data: { path }, error: null }
    },
    async remove(paths) {
      const data = []
      for (const path of paths) {
        const key = `${bucket}/${path}`
        if (objects.delete(key)) data.push({ name: path })
      }
      return { data, error: null }
    },
  })

  const service = {
    from: queryFor,
    storage: { from: storageBucket },
    auth: { admin: {
      async listUsers() { return { data: { users: [...users.values()], nextPage: null }, error: null } },
      async createUser(attributes) {
        const id = `00000000-0000-4000-8000-00000000000${users.size + 1}`
        const user = { id, email: attributes.email, app_metadata: attributes.app_metadata }
        users.set(id, user)
        return { data: { user }, error: null }
      },
      async updateUserById(id, attributes) { passwordUpdates.push({ id, password: attributes.password }); return { data: { user: users.get(id) }, error: null } },
      async deleteUser(id) {
        const user = users.get(id)
        users.delete(id)
        return deleteUserWithoutEcho ? { data: {}, error: null } : { data: { user }, error: null }
      },
    } },
  }
  if (foreignProduct) {
    const product = plan.rows.find((entry) => entry.table === 'products').payload
    tables.get('products').set(product.id, { ...structuredClone(product), metadata: { fixture_key: 'foreign' } })
  }
  if (missingProof) objects.set('products/unrelated.png', new Uint8Array([1]))
  return { service, tables, users, objects, passwordUpdates }
}

test('seed se puede repetir sin crecimiento y rota password sólo después de validar ownership', async () => {
  const fake = createFakeService()
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  const firstCounts = Object.fromEntries([...fake.tables].map(([table, rows]) => [table, rows.size]))
  await seedCrimsonStaging(fake.service, 'second-safe-password')
  assert.deepEqual(Object.fromEntries([...fake.tables].map(([table, rows]) => [table, rows.size])), firstCounts)
  assert.equal(fake.users.size, 3)
  assert.deepEqual(fake.passwordUpdates.map(({ password }) => password), [
    'second-safe-password', 'second-safe-password', 'second-safe-password',
  ])
})

test('import idempotente usa bigint id y no supone unicidad de order_number', async () => {
  const fake = createFakeService()
  fake.tables.get('import_orders').set('42', {
    id: '42', user_id: 'foreign', order_number: 'CC-STAGING-P0-IMPORT', user_notes: 'foreign',
  })
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  await seedCrimsonStaging(fake.service, 'second-safe-password')
  assert.equal(fake.tables.get('import_orders').size, 2)
  assert.ok(fake.tables.get('import_orders').has('900000000000001'))
  assert.equal(fake.tables.get('import_orders').get('42').user_notes, 'foreign')
})

test('seed no sobreescribe una colisión determinista extranjera', async () => {
  const fake = createFakeService({ foreignProduct: true })
  const before = structuredClone([...fake.tables.get('products').values()][0])
  await assert.rejects(seedCrimsonStaging(fake.service, 'first-safe-password'), /fixture sintético/u)
  assert.deepEqual([...fake.tables.get('products').values()][0], before)
})

test('seed no sobreescribe un profile discordante aunque el Auth user sea owned', async () => {
  const fake = createFakeService()
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  const profile = [...fake.tables.get('profiles').values()][0]
  profile.email = 'foreign@example.test'
  const before = structuredClone(profile)
  await assert.rejects(seedCrimsonStaging(fake.service, 'second-safe-password'), /perfil sintético/u)
  assert.deepEqual(profile, before)
})

test('cleanup hace preflight completo, borra exactamente y no deja crecimiento', async () => {
  const fake = createFakeService()
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  await cleanupCrimsonStaging(fake.service)
  assert.equal([...fake.tables.values()].reduce((sum, rows) => sum + rows.size, 0), 0)
  assert.equal(fake.users.size, 0)
  assert.equal(fake.objects.size, 0)
})

test('cleanup acepta deleteUser exitoso sin eco del usuario y sigue borrando identidades exactas', async () => {
  const fake = createFakeService({ deleteUserWithoutEcho: true })
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  await cleanupCrimsonStaging(fake.service)
  assert.equal(fake.users.size, 0)
  assert.equal([...fake.tables.values()].reduce((sum, rows) => sum + rows.size, 0), 0)
  assert.equal(fake.objects.size, 0)
})

test('cleanup no muta nada si una fila falla el preflight exacto', async () => {
  const fake = createFakeService()
  await seedCrimsonStaging(fake.service, 'first-safe-password')
  const product = [...fake.tables.get('products').values()][0]
  product.metadata.fixture_key = 'foreign'
  const before = {
    rows: [...fake.tables.values()].reduce((sum, rows) => sum + rows.size, 0),
    users: fake.users.size,
    objects: fake.objects.size,
  }
  await assert.rejects(cleanupCrimsonStaging(fake.service), /fixture sintético/u)
  assert.deepEqual({
    rows: [...fake.tables.values()].reduce((sum, rows) => sum + rows.size, 0),
    users: fake.users.size,
    objects: fake.objects.size,
  }, before)
})

test('el plan público imprime sólo tipos y conteos, nunca emails, payloads o claves', () => {
  const output = formatSeedPlan(buildSeedPlan())
  assert.deepEqual(JSON.parse(output), {
    mode: 'plan',
    users: 3,
    rows: {
      commission_payments: 1,
      commission_periods: 1,
      import_items: 1,
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
    'import_items',
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
