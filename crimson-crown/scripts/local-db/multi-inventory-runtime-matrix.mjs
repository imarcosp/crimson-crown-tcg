import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

if (!url || !anonKey || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
if (!loopbackHosts.has(new URL(url).hostname)) throw new Error('La matriz sólo puede usar Supabase local.')

const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const serviceClient = () => createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function main() {
  const admin = serviceClient()
  const standard = client()
  const signIn = await standard.auth.signInWithPassword({
    email: 'tester.local@example.test',
    password: 'CrimsonLocalTester!2026',
  })
  if (signIn.error) throw new Error(`No se pudo iniciar sesión local: ${signIn.error.message}`)

  let inventoryId
  let clonedProductId
  const orderIds = []
  const movementInventoryIds = new Set()
  let primaryProduct
  let originalPrimaryStock
  let originalSecondaryStock = 2

  try {
    const primaryResult = await admin.from('inventories').select('id').eq('kind', 'primary').single()
    if (primaryResult.error || !primaryResult.data) throw new Error(`No existe inventario principal: ${primaryResult.error?.message}`)

    const productResult = await admin
      .from('products')
      .select('*')
      .eq('inventory_id', primaryResult.data.id)
      .gt('stock', 0)
      .order('stock', { ascending: false })
      .limit(1)
      .single()
    if (productResult.error || !productResult.data) throw new Error(`No existe producto principal con stock: ${productResult.error?.message}`)
    primaryProduct = productResult.data
    originalPrimaryStock = Number(primaryProduct.stock)

    const inventoryResult = await admin
      .from('inventories')
      .insert({ name: `Runtime Matrix ${Date.now()}`, description: 'Fixture transaccional local', kind: 'secondary', is_active: true })
      .select('id, name')
      .single()
    if (inventoryResult.error || !inventoryResult.data) throw new Error(`No se pudo crear inventario fixture: ${inventoryResult.error?.message}`)
    inventoryId = inventoryResult.data.id

    const { id: _id, created_at: _createdAt, inventory_id: _inventoryId, variant_key: _variantKey, ...copy } = primaryProduct
    const cloned = await admin.from('products').insert({
      ...copy,
      inventory_id: inventoryId,
      stock: originalSecondaryStock,
      is_manual_price: false,
    }).select('id').single()
    if (cloned.error || !cloned.data) throw new Error(`No se pudo crear producto secundario: ${cloned.error?.message}`)
    clonedProductId = cloned.data.id

    const requestedQuantity = originalPrimaryStock + 1
    const checkout = await standard.rpc('place_order_atomic', {
      p_items: [{ id: primaryProduct.id, quantity: requestedQuantity }],
      p_coupon_code: null,
      p_delivery_method: 'pickup',
      p_shipping_address: null,
      p_use_credits: false,
      p_contact_name: 'Runtime',
      p_contact_lastname: 'Hybrid',
      p_contact_phone: '+5491100000002',
    })
    assert.ifError(checkout.error)
    assert.ok(checkout.data)
    orderIds.push(checkout.data)

    const hybridItems = await admin.from('order_items').select('product_id,inventory_id,quantity,source_inventory_name').eq('order_id', checkout.data).order('inventory_id')
    assert.ifError(hybridItems.error)
    assert.equal(hybridItems.data?.length, 2, 'la compra híbrida debe conservar una línea por inventario')
    assert.deepEqual(new Set((hybridItems.data || []).map((item) => item.inventory_id)), new Set([primaryProduct.inventory_id, inventoryId]))
    assert.equal((hybridItems.data || []).reduce((sum, item) => sum + Number(item.quantity), 0), requestedQuantity)

    const primaryAfterHybrid = await admin.from('products').select('stock').eq('id', primaryProduct.id).single()
    const secondaryAfterHybrid = await admin.from('products').select('stock').eq('id', clonedProductId).single()
    assert.ifError(primaryAfterHybrid.error)
    assert.ifError(secondaryAfterHybrid.error)
    assert.equal(Number(primaryAfterHybrid.data.stock), 0, 'el principal se consume primero')
    assert.equal(Number(secondaryAfterHybrid.data.stock), originalSecondaryStock - 1, 'el secundario cubre el faltante')

    const cancel = await admin.rpc('cancel_order_atomic', {
      order_id_input: checkout.data,
      restock_input: true,
      refund_credits_input: false,
    })
    assert.ifError(cancel.error)
    const primaryRestored = await admin.from('products').select('stock').eq('id', primaryProduct.id).single()
    const secondaryRestored = await admin.from('products').select('stock').eq('id', clonedProductId).single()
    assert.ifError(primaryRestored.error)
    assert.ifError(secondaryRestored.error)
    assert.equal(Number(primaryRestored.data.stock), originalPrimaryStock, 'la cancelación restaura el principal')
    assert.equal(Number(secondaryRestored.data.stock), originalSecondaryStock, 'la cancelación restaura el secundario')

    const makeManual = await admin.from('products').update({ is_manual_price: true, price_usd: 12.34 }).eq('id', clonedProductId).select('id').single()
    assert.ifError(makeManual.error)
    const manualCheckout = await standard.rpc('place_order_atomic', {
      p_items: [{ id: clonedProductId, quantity: 1 }],
      p_coupon_code: null,
      p_delivery_method: 'pickup',
      p_shipping_address: null,
      p_use_credits: false,
      p_contact_name: 'Runtime',
      p_contact_lastname: 'Manual',
      p_contact_phone: '+5491100000003',
    })
    assert.ifError(manualCheckout.error)
    assert.ok(manualCheckout.data)
    orderIds.push(manualCheckout.data)
    const manualItem = await admin.from('order_items').select('inventory_id,price_at_purchase').eq('order_id', manualCheckout.data).single()
    assert.ifError(manualItem.error)
    assert.equal(manualItem.data.inventory_id, inventoryId, 'el precio manual debe salir del inventario seleccionado')
    assert.equal(Number(manualItem.data.price_at_purchase), 12.34)
    const cancelManual = await admin.rpc('cancel_order_atomic', { order_id_input: manualCheckout.data, restock_input: true, refund_credits_input: false })
    assert.ifError(cancelManual.error)

    const partialCheckout = await standard.rpc('place_order_atomic', {
      p_items: [{ id: primaryProduct.id, quantity: 1 }],
      p_coupon_code: null,
      p_delivery_method: 'pickup',
      p_shipping_address: null,
      p_use_credits: false,
      p_contact_name: 'Runtime',
      p_contact_lastname: 'Partial',
      p_contact_phone: '+5491100000004',
    })
    assert.ifError(partialCheckout.error)
    assert.ok(partialCheckout.data)
    orderIds.push(partialCheckout.data)
    const partialItem = await admin.from('order_items').select('id').eq('order_id', partialCheckout.data).single()
    assert.ifError(partialItem.error)
    const remove = await admin.rpc('remove_order_item_atomic', { order_item_id_input: partialItem.data.id, quantity_input: 1, restock_input: true })
    assert.ifError(remove.error)
    const removedLine = await admin.from('order_items').select('id').eq('id', partialItem.data.id).maybeSingle()
    assert.ifError(removedLine.error)
    assert.equal(removedLine.data, null, 'la eliminación total de la línea debe quitarla sin perder el origen usado')
    const primaryAfterPartial = await admin.from('products').select('stock').eq('id', primaryProduct.id).single()
    assert.ifError(primaryAfterPartial.error)
    assert.equal(Number(primaryAfterPartial.data.stock), originalPrimaryStock, 'la eliminación parcial debe reintegrar al principal')

    console.log(JSON.stringify({
      ok: true,
      hybridCheckout: true,
      primaryPriority: true,
      cancellationRestoresExactSources: true,
      manualPriceUsesSelectedInventory: true,
      partialLineRemovalRestoresSource: true,
    }, null, 2))
  } finally {
    if (orderIds.length) {
      await admin.from('inventory_stock_movements').delete().in('order_id', orderIds)
      await admin.from('order_items').delete().in('order_id', orderIds)
      await admin.from('orders').delete().in('id', orderIds)
    }
    if (inventoryId) {
      await admin.from('inventory_stock_movements').delete().eq('inventory_id', inventoryId)
      await admin.from('products').delete().eq('inventory_id', inventoryId)
      await admin.from('inventories').delete().eq('id', inventoryId)
    }
    await standard.auth.signOut()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
