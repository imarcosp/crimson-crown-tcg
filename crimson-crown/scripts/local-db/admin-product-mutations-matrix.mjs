import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

if (!url || !anonKey || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
if (!loopbackHosts.has(new URL(url).hostname)) {
  throw new Error('La matriz de productos administrativos sólo puede usar Supabase local.')
}

const identities = {
  admin: { email: 'admin.local@example.test', password: 'CrimsonLocalAdmin!2026' },
  standard: { email: 'tester.local@example.test', password: 'CrimsonLocalTester!2026' },
}

function client(key = anonKey) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(identity) {
  const supabase = client()
  const result = await supabase.auth.signInWithPassword(identities[identity])
  if (result.error || !result.data.user) {
    throw new Error(`No se pudo iniciar sesión como ${identity}: ${result.error?.message || 'sin usuario'}`)
  }
  return { supabase, user: result.data.user }
}

function rpcRow(result, label) {
  assert.ifError(result.error)
  assert.equal(result.data?.length, 1, `${label} debe devolver exactamente una fila`)
  return result.data[0]
}

async function main() {
  const service = client(serviceKey)
  const { supabase: admin } = await signedIn('admin')
  const { supabase: standard, user: standardUser } = await signedIn('standard')
  const runId = randomUUID()
  const inventoryIds = []
  const productIds = new Set()
  const orderIds = []
  const operationKey = (suffix) => `admin-product:${runId}:${suffix}`
  const baseProduct = {
    name: `Local Atomic Product ${runId}`,
    set_name: 'Local Test Set',
    collector_number: runId,
    tcg: 'Magic',
    price_usd: 12.5,
    stock: 2,
    condition: 'NM',
    finish: 'Non-Foil',
    rarity: 'Rare',
    image_url: 'https://example.test/local-product.jpg',
    scryfall_id: null,
    is_manual_price: true,
    language: 'English',
    metadata: { localFixture: runId },
  }

  try {
    const inventories = await service
      .from('inventories')
      .insert([
        { name: `Admin Product Matrix A ${runId}`, description: 'Fixture local autolimpiable', kind: 'secondary', is_active: true },
        { name: `Admin Product Matrix B ${runId}`, description: 'Fixture local autolimpiable', kind: 'secondary', is_active: true },
      ])
      .select('id')
    assert.ifError(inventories.error)
    assert.equal(inventories.data?.length, 2)
    inventoryIds.push(...inventories.data.map((row) => row.id))

    const standardCalls = await Promise.all([
      standard.rpc('admin_create_or_restock_product', {
        inventory_id_input: inventoryIds[0],
        product_input: baseProduct,
        operation_key_input: operationKey('standard-create'),
      }),
      standard.rpc('admin_update_product', {
        product_id_input: randomUUID(),
        inventory_id_input: inventoryIds[0],
        product_input: baseProduct,
        operation_key_input: operationKey('standard-update'),
      }),
      standard.rpc('admin_delete_products', {
        inventory_id_input: inventoryIds[0],
        product_ids_input: [randomUUID()],
        operation_key_input: operationKey('standard-delete'),
      }),
    ])
    for (const result of standardCalls) assert.ok(result.error, 'el usuario estándar no debe invocar RPCs administrativas')

    const create = rpcRow(await admin.rpc('admin_create_or_restock_product', {
      inventory_id_input: inventoryIds[0],
      product_input: baseProduct,
      operation_key_input: operationKey('create-a'),
    }), 'la creación')
    productIds.add(create.product_id)
    assert.equal(create.mutation_kind, 'inserted')
    assert.equal(Number(create.previous_stock), 0)
    assert.equal(Number(create.current_stock), 2)

    const initialMovements = await service
      .from('inventory_stock_movements')
      .select('id,quantity_delta,movement_type')
      .eq('reference_key', `admin-product:${operationKey('create-a')}`)
    assert.ifError(initialMovements.error)
    assert.equal(initialMovements.data?.length, 1)
    assert.equal(Number(initialMovements.data[0].quantity_delta), 2)
    assert.equal(initialMovements.data[0].movement_type, 'inbound')

    const repeated = rpcRow(await admin.rpc('admin_create_or_restock_product', {
      inventory_id_input: inventoryIds[0],
      product_input: baseProduct,
      operation_key_input: operationKey('create-a'),
    }), 'la repetición idempotente')
    assert.equal(repeated.product_id, create.product_id)
    assert.equal(Number(repeated.current_stock), 2)

    const repeatedMovements = await service
      .from('inventory_stock_movements')
      .select('id')
      .eq('reference_key', `admin-product:${operationKey('create-a')}`)
    assert.ifError(repeatedMovements.error)
    assert.equal(repeatedMovements.data?.length, 1)

    const [restockBResult, restockCResult] = await Promise.all([
      admin.rpc('admin_create_or_restock_product', {
        inventory_id_input: inventoryIds[0],
        product_input: { ...baseProduct, stock: 3 },
        operation_key_input: operationKey('restock-b'),
      }),
      admin.rpc('admin_create_or_restock_product', {
        inventory_id_input: inventoryIds[0],
        product_input: { ...baseProduct, stock: 4 },
        operation_key_input: operationKey('restock-c'),
      }),
    ])
    rpcRow(restockBResult, 'la reposición B')
    rpcRow(restockCResult, 'la reposición C')

    const afterConcurrent = await service.from('products').select('stock').eq('id', create.product_id).single()
    assert.ifError(afterConcurrent.error)
    assert.equal(Number(afterConcurrent.data.stock), 9, 'dos reposiciones concurrentes deben conservar la suma exacta')

    const otherInventory = rpcRow(await admin.rpc('admin_create_or_restock_product', {
      inventory_id_input: inventoryIds[1],
      product_input: { ...baseProduct, stock: 0 },
      operation_key_input: operationKey('other-inventory'),
    }), 'la creación en otro inventario')
    productIds.add(otherInventory.product_id)
    assert.notEqual(otherInventory.product_id, create.product_id)

    const physicalRows = await service
      .from('products')
      .select('id,inventory_id')
      .in('id', [create.product_id, otherInventory.product_id])
    assert.ifError(physicalRows.error)
    assert.equal(physicalRows.data?.length, 2)
    assert.deepEqual(new Set(physicalRows.data.map((row) => row.inventory_id)), new Set(inventoryIds))

    const update = rpcRow(await admin.rpc('admin_update_product', {
      product_id_input: create.product_id,
      inventory_id_input: inventoryIds[0],
      product_input: { ...baseProduct, stock: 5 },
      operation_key_input: operationKey('update-d'),
    }), 'la edición')
    assert.equal(update.mutation_kind, 'updated')
    assert.equal(Number(update.previous_stock), 9)
    assert.equal(Number(update.current_stock), 5)

    const adjustment = await service
      .from('inventory_stock_movements')
      .select('quantity_delta,movement_type')
      .eq('reference_key', `admin-product:${operationKey('update-d')}`)
      .single()
    assert.ifError(adjustment.error)
    assert.equal(Number(adjustment.data.quantity_delta), -4)
    assert.equal(adjustment.data.movement_type, 'adjustment')

    const productIdentity = await service
      .from('products')
      .select('variant_key')
      .eq('id', create.product_id)
      .single()
    assert.ifError(productIdentity.error)

    const order = await service.from('orders').insert({
      user_id: standardUser.id,
      status: 'paid',
      total_amount: 12.5,
      payment_method: 'local-admin-product-matrix',
    }).select('id').single()
    assert.ifError(order.error)
    orderIds.push(order.data.id)

    const orderItem = await service.from('order_items').insert({
      order_id: order.data.id,
      product_id: create.product_id,
      quantity: 1,
      price_at_purchase: 12.5,
      inventory_id: inventoryIds[0],
      variant_key: productIdentity.data.variant_key,
      source_inventory_name: `Admin Product Matrix A ${runId}`,
    })
    assert.ifError(orderItem.error)

    const rejectedDelete = rpcRow(await admin.rpc('admin_delete_products', {
      inventory_id_input: inventoryIds[0],
      product_ids_input: [create.product_id],
      operation_key_input: operationKey('delete-referenced'),
    }), 'el borrado con historial')
    assert.deepEqual(rejectedDelete.deleted_ids, [])
    assert.deepEqual(rejectedDelete.rejected_ids, [create.product_id])

    const zeroStock = rpcRow(await admin.rpc('admin_create_or_restock_product', {
      inventory_id_input: inventoryIds[0],
      product_input: {
        ...baseProduct,
        name: `Local Deletable Product ${runId}`,
        collector_number: `delete-${runId}`,
        stock: 0,
      },
      operation_key_input: operationKey('create-zero'),
    }), 'la fixture sin historial')
    productIds.add(zeroStock.product_id)

    const deleted = rpcRow(await admin.rpc('admin_delete_products', {
      inventory_id_input: inventoryIds[0],
      product_ids_input: [zeroStock.product_id],
      operation_key_input: operationKey('delete-zero'),
    }), 'el borrado sin historial')
    assert.deepEqual(deleted.deleted_ids, [zeroStock.product_id])
    assert.deepEqual(deleted.rejected_ids, [])
    productIds.delete(zeroStock.product_id)

    console.log(JSON.stringify({
      ok: true,
      standardBlocked: true,
      createIdempotent: true,
      concurrentRestockExact: true,
      inventoryIsolation: true,
      updateAudited: true,
      historicalDeleteRejected: true,
      cleanDeleteAllowed: true,
    }, null, 2))
  } finally {
    if (orderIds.length) {
      await service.from('orders').delete().in('id', orderIds)
    }
    if (inventoryIds.length) {
      await service.from('inventory_stock_movements').delete().in('inventory_id', inventoryIds)
    }
    if (productIds.size) {
      await service.from('products').delete().in('id', [...productIds])
    }
    if (inventoryIds.length) {
      await service.from('inventories').delete().in('id', inventoryIds)
    }
    await Promise.all([admin.auth.signOut(), standard.auth.signOut()])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
