import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAdminProductActionCore,
  type AdminProductGateway,
  type ProductMutationRpcRow,
} from './product-action-core.ts'

const INVENTORY_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'

const validProduct = {
  name: 'Black Lotus',
  set_name: 'Limited Edition Alpha',
  collector_number: '232',
  tcg: 'Magic',
  price_usd: 12.5,
  stock: 3,
  condition: 'NM',
  finish: 'Non-Foil',
  rarity: 'Rare',
  image_url: 'https://example.test/lotus.jpg',
  scryfall_id: null,
  is_manual_price: true,
  language: 'English',
  metadata: {},
}

const validRequest = {
  inventoryId: INVENTORY_ID,
  operationKey: 'save:11111111-1111-4111-8111-111111111111',
  product: validProduct,
}

function gateway(overrides: Partial<AdminProductGateway> = {}): AdminProductGateway {
  const rpcRow: ProductMutationRpcRow = {
    product_id: PRODUCT_ID,
    mutation_kind: 'restocked',
    previous_stock: 2,
    current_stock: 5,
  }

  return {
    async requireAdmin() {
      return { userId: '33333333-3333-4333-8333-333333333333' }
    },
    async createOrRestock() {
      return rpcRow
    },
    async update() {
      return { ...rpcRow, mutation_kind: 'updated' }
    },
    async findProduct() {
      return { id: PRODUCT_ID, name: 'Black Lotus', stock: 5 }
    },
    async deleteMany() {
      return { deletedIds: [PRODUCT_ID], rejectedIds: [] }
    },
    async notifyStockArrivals() {},
    ...overrides,
  }
}

test('save rechaza a un usuario no administrador antes de invocar la RPC', async () => {
  let rpcCalls = 0
  const core = createAdminProductActionCore(gateway({
    async requireAdmin() {
      throw new Error('Acceso denegado.')
    },
    async createOrRestock() {
      rpcCalls += 1
      throw new Error('no debe ejecutarse')
    },
  }))

  const result = await core.save(validRequest)

  assert.deepEqual(result, { success: false, error: 'Acceso denegado.' })
  assert.equal(rpcCalls, 0)
})

test('save devuelve la transición de stock confirmada por la base', async () => {
  const notifications: Array<Array<{ id: string; name: string }>> = []
  const core = createAdminProductActionCore(gateway({
    async notifyStockArrivals(items) {
      notifications.push(items)
    },
  }))

  const result = await core.save(validRequest)

  assert.deepEqual(result, {
    success: true,
    data: {
      product: { id: PRODUCT_ID, name: 'Black Lotus', stock: 5 },
      mutationKind: 'restocked',
      previousStock: 2,
      currentStock: 5,
    },
  })
  assert.deepEqual(notifications, [[{ id: PRODUCT_ID, name: 'Black Lotus' }]])
})

test('save valida el producto antes de invocar la RPC', async () => {
  let rpcCalls = 0
  const core = createAdminProductActionCore(gateway({
    async createOrRestock() {
      rpcCalls += 1
      throw new Error('no debe ejecutarse')
    },
  }))

  const result = await core.save({
    ...validRequest,
    product: { ...validProduct, stock: -1 },
  })

  assert.deepEqual(result, { success: false, error: 'El stock debe ser un entero no negativo.' })
  assert.equal(rpcCalls, 0)
})

test('importRows limita la concurrencia a cinco, conserva errores por fila y notifica una vez', async () => {
  let active = 0
  let maxActive = 0
  let sequence = 0
  const notifications: Array<Array<{ id: string; name: string }>> = []
  const core = createAdminProductActionCore(gateway({
    async createOrRestock({ product }) {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      sequence += 1
      return {
        product_id: `55555555-5555-4555-8555-${String(sequence).padStart(12, '0')}`,
        mutation_kind: sequence === 1 ? 'inserted' : 'restocked',
        previous_stock: sequence === 6 ? 4 : 0,
        current_stock: sequence === 6 ? 4 : product.stock,
      }
    },
    async findProduct(productId) {
      return { id: productId, name: `Product ${productId.slice(-1)}`, stock: 1 }
    },
    async notifyStockArrivals(items) {
      notifications.push(items)
    },
  }))
  const rows = Array.from({ length: 6 }, (_, index) => ({
    operationKey: `csv:${index}:11111111-1111-4111-8111-111111111111`,
    product: { ...validProduct, name: `Product ${index}` },
  }))
  rows.push({
    operationKey: 'csv:invalid:11111111-1111-4111-8111-111111111111',
    product: { ...validProduct, stock: -1 },
  })

  const result = await core.importRows({ inventoryId: INVENTORY_ID, rows })

  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(maxActive, 5)
  assert.equal(result.data.inserted, 1)
  assert.equal(result.data.updated, 5)
  assert.deepEqual(result.data.errors, [{ index: 6, error: 'El stock debe ser un entero no negativo.' }])
  assert.equal(result.data.stockArrivals.length, 5)
  assert.equal(notifications.length, 1)
  assert.deepEqual(notifications[0], result.data.stockArrivals)
})

test('deleteMany valida IDs y devuelve por separado eliminados y rechazados', async () => {
  const rejectedId = '44444444-4444-4444-8444-444444444444'
  const core = createAdminProductActionCore(gateway({
    async deleteMany() {
      return { deletedIds: [PRODUCT_ID], rejectedIds: [rejectedId] }
    },
  }))

  const result = await core.deleteMany({
    inventoryId: INVENTORY_ID,
    productIds: [PRODUCT_ID, rejectedId],
    operationKey: 'delete:11111111-1111-4111-8111-111111111111',
  })

  assert.deepEqual(result, {
    success: true,
    data: { deletedIds: [PRODUCT_ID], rejectedIds: [rejectedId] },
  })
})

test('mapea errores de PostgreSQL a mensajes estables sin exponer detalles', async () => {
  const core = createAdminProductActionCore(gateway({
    async createOrRestock() {
      throw { code: '23505', message: 'duplicate key value contains secret payload' }
    },
  }))

  const result = await core.save(validRequest)

  assert.deepEqual(result, {
    success: false,
    error: 'Ya existe una variante incompatible en este inventario.',
  })
})
