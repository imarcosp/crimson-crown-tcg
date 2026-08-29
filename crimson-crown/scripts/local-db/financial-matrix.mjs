import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan las credenciales de Supabase local.')
}
if (!loopbackHosts.has(new URL(supabaseUrl).hostname)) {
  throw new Error('La matriz financiera sólo puede ejecutarse contra Supabase local.')
}
if (!loopbackHosts.has(new URL(baseUrl).hostname)) {
  throw new Error('La matriz financiera sólo puede invocar un servidor local.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: product, error: productError } = await admin
    .from('products')
    .select('id,name,stock,inventory_id,variant_key')
    .gt('stock', 1)
    .order('stock', { ascending: false })
    .limit(1)
    .single()
  if (productError || !product) throw new Error(`No se encontró producto con stock: ${productError?.message || 'sin datos'}`)

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', 'tester.local@example.test')
    .single()
  if (profileError || !profile) throw new Error(`No se encontró perfil estándar local: ${profileError?.message || 'sin datos'}`)

  const { data: inventory, error: inventoryError } = await admin
    .from('inventories')
    .select('name')
    .eq('id', product.inventory_id)
    .single()
  if (inventoryError || !inventory) throw new Error(`No se encontró inventario del producto: ${inventoryError?.message || 'sin datos'}`)

  const originalStock = Number(product.stock || 0)
  const marker = `LOCAL-FINANCIAL-${Date.now()}`
  let orderId = null

  try {
    const reserve = await admin.rpc('decrement_stock', { qty: 1, row_id: product.id })
    assert.ifError(reserve.error)
    assert.equal(reserve.data, true, 'la reserva local debe descontar stock')

    const afterReserve = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterReserve.error)
    assert.equal(Number(afterReserve.data.stock), originalStock - 1, 'la reserva debe descontar exactamente una unidad')

    const overReserve = await admin.rpc('decrement_stock', { qty: originalStock, row_id: product.id })
    assert.ifError(overReserve.error)
    assert.equal(overReserve.data, false, 'una reserva superior al stock debe ser rechazada sin error de carrera')

    const afterRejectedReserve = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterRejectedReserve.error)
    assert.equal(Number(afterRejectedReserve.data.stock), originalStock - 1, 'una reserva rechazada no debe modificar stock')

    const { data: order, error: orderError } = await admin
      .from('orders')
      .insert({
        user_id: profile.id,
        status: 'pending_payment',
        total_amount: 0,
        payment_method: marker,
        delivery_method: 'pickup [Pago: Mercado Pago]',
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (orderError || !order) throw new Error(`No se pudo crear orden financiera sintética: ${orderError?.message || 'sin id'}`)
    orderId = order.id

    const { error: itemError } = await admin.from('order_items').insert({
      order_id: order.id,
      product_id: product.id,
      quantity: 1,
      price_at_purchase: 0,
      inventory_id: product.inventory_id,
      variant_key: product.variant_key,
      source_inventory_name: inventory.name,
    })
    if (itemError) throw new Error(`No se pudo crear item financiero sintético: ${itemError.message}`)

    const cronResponse = await fetch(`${baseUrl}/api/cron/release-stock`)
    const cronPayload = await cronResponse.json()
    assert.equal(cronResponse.status, 200, `cron local debe responder 200: ${JSON.stringify(cronPayload)}`)

    const { data: cancelled, error: cancelledError } = await admin
      .from('orders')
      .select('status,delivery_notes')
      .eq('id', order.id)
      .single()
    assert.ifError(cancelledError)
    assert.equal(cancelled.status, 'cancelled', 'cron debe cancelar la orden vencida sintética')
    assert.match(cancelled.delivery_notes || '', /Mercado Pago/)

    const afterCron = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterCron.error)
    assert.equal(Number(afterCron.data.stock), originalStock, 'cron debe devolver el stock reservado')

    console.log(JSON.stringify({
      ok: true,
      product: product.name,
      reserved: 1,
      overReserve: 'blocked',
      cronStatus: cronResponse.status,
      cronPayload,
    }, null, 2))
  } finally {
    if (orderId) {
      const itemCleanup = await admin.from('order_items').delete().eq('order_id', orderId)
      if (itemCleanup.error) throw new Error(`No se pudo limpiar item financiero: ${itemCleanup.error.message}`)
      const orderCleanup = await admin.from('orders').delete().eq('id', orderId)
      if (orderCleanup.error) throw new Error(`No se pudo limpiar orden financiera: ${orderCleanup.error.message}`)
    }
    const stockCleanup = await admin.from('products').update({ stock: originalStock }).eq('id', product.id)
    if (stockCleanup.error) throw new Error(`No se pudo restaurar stock del fixture: ${stockCleanup.error.message}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
