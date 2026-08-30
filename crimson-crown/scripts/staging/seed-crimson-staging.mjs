import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { assertCrimsonStagingEnvironment } from './assert-crimson-staging.mjs'

const FIXTURE_PREFIX = 'codex-staging-p0'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const IDS = Object.freeze({
  inventory: 'c0de0001-0000-4000-8000-000000000001',
  product: 'c0de0001-0000-4000-8000-000000000002',
  order: 'c0de0001-0000-4000-8000-000000000003',
  orderItem: 'c0de0001-0000-4000-8000-000000000004',
  period: 'c0de0001-0000-4000-8000-000000000005',
  payment: 'c0de0001-0000-4000-8000-000000000006',
  proofObject: 'c0de0001-0000-4000-8000-000000000007',
  importOrder: '900000000000001',
  importItem: '900000000000002',
})


const USERS = Object.freeze([
  Object.freeze({ role: 'admin', email: 'admin.crimson.staging@example.test', fixture_key: `${FIXTURE_PREFIX}:user:admin` }),
  Object.freeze({ role: 'buyer', email: 'buyer.crimson.staging@example.test', fixture_key: `${FIXTURE_PREFIX}:user:buyer` }),
  Object.freeze({ role: 'operator', email: 'operator.crimson.staging@example.test', fixture_key: `${FIXTURE_PREFIX}:user:operator` }),
])

function row(table, fixtureKey, payload) {
  return Object.freeze({ table, fixture_key: `${FIXTURE_PREFIX}:${fixtureKey}`, payload: Object.freeze(payload) })
}

export function buildSeedPlan() {
  const rows = [
    row('inventories', 'inventory', {
      id: IDS.inventory, name: 'Crimson Staging P0 Inventory', description: `${FIXTURE_PREFIX}:inventory`,
      location_label: 'Synthetic staging only', kind: 'secondary', is_active: true,
    }),
    row('products', 'product', {
      id: IDS.product, inventory_id: IDS.inventory, variant_key: `${FIXTURE_PREFIX}:variant`,
      name: 'Synthetic Staging Card', set_name: 'Synthetic Set', collector_number: 'P0', tcg: 'Magic',
      price_usd: 1, stock: 10, condition: 'NM', finish: 'Non-Foil', language: 'English',
      is_manual_price: true, metadata: { fixture_key: `${FIXTURE_PREFIX}:product` },
    }),
    row('orders', 'order', {
      id: IDS.order, user_id: '$buyer', status: 'pending_payment', total_amount: 1,
      payment_method: `${FIXTURE_PREFIX}:order`, delivery_method: 'pickup', credits_used: 0,
      contact_name: 'Synthetic', contact_lastname: 'Buyer', contact_phone: '+10000000000',
    }),
    row('order_items', 'order-item', {
      id: IDS.orderItem, order_id: IDS.order, product_id: IDS.product, quantity: 1,
      price_at_purchase: 1, inventory_id: IDS.inventory,
      variant_key: `${FIXTURE_PREFIX}:variant`, source_inventory_name: 'Crimson Staging P0 Inventory',
    }),
    row('import_orders', 'import-order', {
      id: IDS.importOrder, user_id: '$buyer', order_number: 'CC-STAGING-P0-IMPORT', status: 'Cotizada',
      user_notes: `${FIXTURE_PREFIX}:import-order`, payment_status: 'pending', credits_used: 0,
    }),
    row('import_items', 'import-item', {
      id: IDS.importItem, order_id: IDS.importOrder, product_name: 'Synthetic Import Card',
      image_url: '', quantity: 1, platform: 'Otro', unit_price: 1,
      tax_percent: 0, shipping_cost: 0, set_name: 'Synthetic Set', collector_number: 'P0',
      product_url: `${FIXTURE_PREFIX}:import-item`,
    }),
    row('commission_periods', 'commission-period', {
      id: IDS.period, period_key: '2099-12', period_start: '2099-12-01T00:00:00.000Z',
      period_end: '2100-01-01T00:00:00.000Z', fixed_fee_usd: 1, total_due_usd: 1,
      status: 'open', notes: `${FIXTURE_PREFIX}:commission-period`,
    }),
    row('commission_payments', 'commission-payment', {
      id: IDS.payment, period_id: IDS.period, reported_by_user_id: '$operator', status: 'reported',
      currency: 'USD', amount: 1, amount_usd: 1, payment_method: 'synthetic',
      reference: `${FIXTURE_PREFIX}:commission-payment`, paid_at: '2099-12-15T00:00:00.000Z',
    }),
  ]
  const storage = [
    { bucket: 'products', path: `${FIXTURE_PREFIX}/product.png`, fixture_key: `${FIXTURE_PREFIX}:storage:product` },
    { bucket: 'banners', path: `${FIXTURE_PREFIX}/banner.png`, fixture_key: `${FIXTURE_PREFIX}:storage:banner` },
    { bucket: 'payment_proofs', path: `orders/$buyer/${IDS.order}/${IDS.proofObject}.png`, fixture_key: `${FIXTURE_PREFIX}:storage:proof` },
  ].map(Object.freeze)
  return Object.freeze({ users: USERS, rows: Object.freeze(rows), storage: Object.freeze(storage) })
}

export function buildCleanupPlan(plan = buildSeedPlan()) {
  const byTable = new Map(plan.rows.map((entry) => [entry.table, entry]))
  const cleanup = [
    { resource: 'storage.objects', match: { fixture_key: `${FIXTURE_PREFIX}:storage`, objects: plan.storage.map(({ bucket, path }) => ({ bucket, path })) } },
    ...['commission_payments', 'commission_periods', 'import_items', 'import_orders', 'order_items', 'orders', 'products', 'inventories']
      .map((resource) => ({ resource, match: { fixture_key: byTable.get(resource).fixture_key, payload: byTable.get(resource).payload } })),
    { resource: 'profiles', match: { fixture_key: `${FIXTURE_PREFIX}:profiles`, emails: plan.users.map(({ email }) => email) } },
    { resource: 'auth.users', match: { fixture_key: `${FIXTURE_PREFIX}:auth`, emails: plan.users.map(({ email }) => email) } },
  ]
  return Object.freeze(cleanup.map((entry) => Object.freeze({ ...entry, match: Object.freeze(entry.match) })))
}

export function formatSeedPlan(plan = buildSeedPlan()) {
  const rows = {}
  for (const entry of plan.rows) rows[entry.table] = (rows[entry.table] ?? 0) + 1
  return JSON.stringify({
    mode: 'plan', users: plan.users.length,
    rows: Object.fromEntries(Object.entries(rows).sort(([left], [right]) => left.localeCompare(right))),
    storageObjects: plan.storage.length,
  }, null, 2)
}

export function validateFixtureUser(actual, expected) {
  if (
    !actual || actual.email !== expected.email ||
    actual.app_metadata?.fixture_key !== expected.fixture_key ||
    !actual.email.endsWith('@example.test')
  ) {
    throw new Error('El Auth user existente no pertenece al fixture sintético exacto.')
  }
}

export function validateExistingFixtureRow(entry, actual) {
  const payload = entry.payload
  const owned = entry.table === 'inventories'
    ? actual.description === payload.description
    : entry.table === 'products'
      ? actual.metadata?.fixture_key === entry.fixture_key
      : entry.table === 'orders'
        ? actual.payment_method === payload.payment_method
        : entry.table === 'order_items'
          ? actual.order_id === payload.order_id && actual.product_id === payload.product_id && actual.variant_key === payload.variant_key
          : entry.table === 'import_orders'
            ? actual.user_notes === payload.user_notes
            : entry.table === 'import_items'
            ? String(actual.order_id) === String(payload.order_id) && actual.product_url === payload.product_url
            : entry.table === 'commission_periods'
              ? actual.notes === payload.notes
              : entry.table === 'commission_payments'
                ? actual.reference === payload.reference
                : false
  if (!owned) throw new Error('La fila existente no pertenece al fixture sintético exacto.')
}

export function assertCompleteFixtureUserIds(userIds) {
  if (!userIds?.admin || !userIds?.buyer || !userIds?.operator) {
    throw new Error('Falta una identidad sintética exacta; cleanup abortado.')
  }
}

async function listAllUsers(service) {
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error('No se pudieron verificar los Auth users sintéticos.')
    users.push(...data.users)
    if (!data.nextPage) break
  }
  return users
}

async function ensureUsers(service, plan, password) {
  const existing = await listAllUsers(service)
  const ids = {}
  for (const expected of plan.users) {
    let user = existing.find((candidate) => candidate.email === expected.email)
    if (user) {
      validateFixtureUser(user, expected)
      const updated = await service.auth.admin.updateUserById(user.id, { password })
      if (updated.error || updated.data?.user?.id !== user.id) {
        throw new Error('No se pudo rotar el password del Auth user sintético.')
      }
    } else {
      const created = await service.auth.admin.createUser({
        email: expected.email, password, email_confirm: true,
        app_metadata: { fixture_key: expected.fixture_key },
        user_metadata: { fixture_key: expected.fixture_key },
      })
      if (created.error || !created.data.user) throw new Error('No se pudo crear un Auth user sintético.')
      user = created.data.user
    }
    ids[expected.role] = user.id
  }
  return Object.freeze(ids)
}

function resolvePayload(payload, userIds) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    value === '$buyer' ? userIds.buyer : value === '$operator' ? userIds.operator : value,
  ]))
}

function withOwnership(query, entry, payload) {
  if (entry.table === 'inventories') return query.eq('description', payload.description)
  if (entry.table === 'products') return query.contains('metadata', { fixture_key: entry.fixture_key })
  if (entry.table === 'orders') return query.eq('payment_method', payload.payment_method)
  if (entry.table === 'order_items') return query.eq('order_id', payload.order_id).eq('product_id', payload.product_id).eq('variant_key', payload.variant_key)
  if (entry.table === 'import_orders') return query.eq('user_notes', payload.user_notes)
  if (entry.table === 'import_items') return query.eq('order_id', payload.order_id).eq('product_url', payload.product_url)
  if (entry.table === 'commission_periods') return query.eq('notes', payload.notes)
  if (entry.table === 'commission_payments') return query.eq('reference', payload.reference)
  throw new Error('Tipo de fixture sintético no soportado.')
}

async function upsertExact(service, entry, payload, conflict = 'id') {
  const inserted = await service.from(entry.table).insert(payload).select('id').single()
  if (!inserted.error && inserted.data) return inserted.data.id
  if (inserted.error?.code !== '23505') throw new Error(`No se pudo crear el fixture sintético ${entry.table}.`)

  let update = service.from(entry.table).update(payload).eq(conflict, payload[conflict])
  update = withOwnership(update, entry, payload)
  const updated = await update.select('id')
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    throw new Error('La fila existente no pertenece al fixture sintético exacto.')
  }
  return updated.data[0].id
}

async function ensureProfile(service, payload) {
  const inserted = await service.from('profiles').insert(payload).select('id').single()
  if (!inserted.error && inserted.data) return
  if (inserted.error?.code !== '23505') throw new Error('No se pudo crear un perfil sintético.')
  const updated = await service.from('profiles').update(payload)
    .eq('id', payload.id).eq('email', payload.email).select('id')
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    throw new Error('La fila existente no pertenece al perfil sintético exacto.')
  }
}

async function ensureStorageObjects(service, plan, userIds) {
  for (const object of plan.storage) {
    const path = object.path.replace('$buyer', userIds.buyer)
    const info = await service.storage.from(object.bucket).info(path)
    if (info.data && !info.error) {
      const downloaded = await service.storage.from(object.bucket).download(path)
      if (downloaded.error || !downloaded.data) throw new Error('No se pudo verificar un objeto sintético de staging.')
      const actual = new Uint8Array(await downloaded.data.arrayBuffer())
      if (actual.length !== PNG_BYTES.length || actual.some((value, index) => value !== PNG_BYTES[index])) {
        throw new Error('El objeto existente no pertenece al fixture sintético exacto.')
      }
      continue
    }
    const isMissing = info.error?.name === 'StorageApiError' &&
      [400, 404].includes(info.error.status) && String(info.error.statusCode) === '404'
    if (!isMissing) throw new Error('Storage staging no devolvió un estado verificable.')
    const uploaded = await service.storage.from(object.bucket).upload(
      path, new Blob([PNG_BYTES], { type: 'image/png' }), { contentType: 'image/png', upsert: false },
    )
    if (uploaded.error) throw new Error('No se pudo crear un objeto sintético de staging.')
  }
}

export async function seedCrimsonStaging(service, password, plan = buildSeedPlan()) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Falta password sintético seguro.')
  const userIds = await ensureUsers(service, plan, password)
  for (const user of plan.users) {
    await ensureProfile(service, {
      id: userIds[user.role], email: user.email, role: user.role === 'admin' ? 'admin' : 'user',
      first_name: 'Synthetic', last_name: user.role, full_name: `Synthetic ${user.role}`,
    })
  }
  const orderedTables = ['inventories', 'products', 'orders', 'order_items', 'import_orders', 'import_items', 'commission_periods', 'commission_payments']
  let importId = null
  for (const table of orderedTables) {
    const entry = plan.rows.find((candidate) => candidate.table === table)
    const id = await upsertExact(service, entry, resolvePayload(entry.payload, userIds))
    if (table === 'import_orders') importId = String(id)
  }
  await ensureStorageObjects(service, plan, userIds)
  await mkdir('local-artifacts/release-evidence', { recursive: true })
  await writeFile('local-artifacts/release-evidence/crimson-staging-import-id.json', JSON.stringify({ importId }), { encoding: 'utf8' })
  return Object.freeze({ users: plan.users.length, rows: plan.rows.length, storageObjects: plan.storage.length })
}

async function deleteExact(service, table, payload) {
  let query = service.from(table).delete()
  query = query.eq('id', payload.id)
  if (table === 'import_orders') query = query.eq('user_notes', payload.user_notes)
  if (table === 'import_items') query = query.eq('order_id', payload.order_id).eq('product_url', payload.product_url)
  if (table === 'orders') query = query.eq('payment_method', payload.payment_method)
  if (table === 'commission_periods') query = query.eq('notes', payload.notes)
  if (table === 'commission_payments') query = query.eq('reference', payload.reference)
  if (table === 'products') query = query.contains('metadata', { fixture_key: payload.metadata.fixture_key })
  if (table === 'inventories') query = query.eq('description', payload.description)
  if (table === 'order_items') query = query.eq('order_id', payload.order_id).eq('product_id', payload.product_id)
  const result = await query.select('id')
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new Error(`No se pudo limpiar exactamente un fixture sintético ${table}.`)
  }
}

async function assertExactStorageObject(service, bucket, path) {
  const info = await service.storage.from(bucket).info(path)
  if (info.error || !info.data) throw new Error('Falta un objeto del fixture sintético exacto.')
  const downloaded = await service.storage.from(bucket).download(path)
  if (downloaded.error || !downloaded.data) throw new Error('No se pudo verificar un objeto sintético exacto.')
  const actual = new Uint8Array(await downloaded.data.arrayBuffer())
  if (actual.length !== PNG_BYTES.length || actual.some((value, index) => value !== PNG_BYTES[index])) {
    throw new Error('El objeto existente no pertenece al fixture sintético exacto.')
  }
}

export async function cleanupCrimsonStaging(service, plan = buildSeedPlan()) {
  const users = await listAllUsers(service)
  const userIds = {}
  for (const expected of plan.users) {
    const actual = users.find((candidate) => candidate.email === expected.email)
    if (!actual) continue
    validateFixtureUser(actual, expected)
    userIds[expected.role] = actual.id
  }
  assertCompleteFixtureUserIds(userIds)

  for (const expected of plan.users) {
    const profile = await service.from('profiles').select('id,email').eq('id', userIds[expected.role]).eq('email', expected.email).maybeSingle()
    if (profile.error || !profile.data) throw new Error('Falta un perfil del fixture sintético exacto.')
  }
  for (const entry of plan.rows) {
    const payload = resolvePayload(entry.payload, userIds)
    const existing = await service.from(entry.table).select('*').eq('id', payload.id).maybeSingle()
    if (existing.error || !existing.data) throw new Error('Falta una fila del fixture sintético exacto.')
    validateExistingFixtureRow(entry, existing.data)
  }
  for (const object of plan.storage) {
    await assertExactStorageObject(service, object.bucket, object.path.replace('$buyer', userIds.buyer))
  }

  const objectsByBucket = new Map()
  for (const object of plan.storage) {
    const path = object.path.replace('$buyer', userIds.buyer)
    if (!objectsByBucket.has(object.bucket)) objectsByBucket.set(object.bucket, [])
    objectsByBucket.get(object.bucket).push(path)
  }
  for (const [bucket, paths] of objectsByBucket) {
    const result = await service.storage.from(bucket).remove(paths)
    if (result.error || !Array.isArray(result.data) || result.data.length !== paths.length) {
      throw new Error('No se limpiaron exactamente los objetos sintéticos de staging.')
    }
  }
  for (const table of ['commission_payments', 'commission_periods', 'import_items', 'import_orders', 'order_items', 'orders', 'products', 'inventories']) {
    const entry = plan.rows.find((candidate) => candidate.table === table)
    await deleteExact(service, table, resolvePayload(entry.payload, userIds))
  }
  for (const expected of plan.users) {
    const id = userIds[expected.role]
    if (!id) continue
    const profile = await service.from('profiles').delete().eq('id', id).eq('email', expected.email).select('id')
    if (profile.error || !Array.isArray(profile.data) || profile.data.length !== 1) throw new Error('No se pudo limpiar exactamente un perfil sintético.')
    const removed = await service.auth.admin.deleteUser(id)
    if (removed.error) throw new Error('No se pudo limpiar exactamente un Auth user sintético.')
  }
}

async function main() {
  const mode = process.argv[2]
  const plan = buildSeedPlan()
  if (mode === '--plan') {
    console.log(formatSeedPlan(plan))
    return
  }
  if (!['--apply', '--cleanup'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Uso: seed-crimson-staging.mjs --plan|--apply|--cleanup')
  }
  assertCrimsonStagingEnvironment(process.env)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) throw new Error('Crimson staging no autorizado.')
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  if (mode === '--cleanup') {
    await cleanupCrimsonStaging(service, plan)
    console.log(JSON.stringify({ mode: 'cleanup', ok: true }))
    return
  }
  const result = await seedCrimsonStaging(service, process.env.CRIMSON_STAGING_FIXTURE_PASSWORD, plan)
  console.log(JSON.stringify({ mode: 'apply', ...result }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error('Crimson staging seed no autorizado o incompleto.')
    process.exitCode = 1
  })
}
