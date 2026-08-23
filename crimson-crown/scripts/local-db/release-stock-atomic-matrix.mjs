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

function client(key) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function main() {
  const admin = client(serviceKey)
  const anonymous = client(anonKey)
  const { data: product, error: productError } = await admin
    .from('products')
    .select('id,name,stock')
    .gt('stock', 1)
    .order('stock', { ascending: false })
    .limit(1)
    .single()
  if (productError || !product) throw new Error(`No se encontró producto para la matriz: ${productError?.message || 'sin datos'}`)

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', 'tester.local@example.test')
    .single()
  if (profileError || !profile) throw new Error(`No se encontró perfil estándar: ${profileError?.message || 'sin datos'}`)

  const originalStock = Number(product.stock || 0)
  const marker = `LOCAL-RELEASE-${Date.now()}`
  let orderId = null

  try {
    const reserve = await admin.from('products').update({ stock: originalStock - 1 }).eq('id', product.id)
    if (reserve.error) throw new Error(`No se pudo preparar stock: ${reserve.error.message}`)

    const { data: order, error: orderError } = await admin
      .from('orders')
      .insert({
        user_id: profile.id,
        status: 'pending_payment',
        total_amount: 0,
        payment_method: marker,
        delivery_method: 'pickup [Pago: Mercado Pago]',
        delivery_notes: marker,
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (orderError || !order) throw new Error(`No se pudo crear orden sintética: ${orderError?.message || 'sin id'}`)
    orderId = order.id

    const item = await admin.from('order_items').insert({
      order_id: order.id,
      product_id: product.id,
      quantity: 1,
      price_at_purchase: 0,
    })
    if (item.error) throw new Error(`No se pudo crear item sintético: ${item.error.message}`)

    const first = await admin.rpc('release_expired_orders_atomic', {
      p_age_minutes: 15,
      p_payment_marker: 'Mercado Pago',
    })
    assert.ifError(first.error)
    assert.equal(first.data, 1, 'la primera ejecución debe cancelar una orden')

    const cancelled = await admin.from('orders').select('status,delivery_notes').eq('id', order.id).single()
    assert.ifError(cancelled.error)
    assert.equal(cancelled.data.status, 'cancelled')
    assert.match(cancelled.data.delivery_notes || '', /Cancelada automáticamente.*Mercado Pago/i)

    const restored = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(restored.error)
    assert.equal(Number(restored.data.stock), originalStock, 'la primera ejecución debe devolver una unidad')

    const second = await admin.rpc('release_expired_orders_atomic', {
      p_age_minutes: 15,
      p_payment_marker: 'Mercado Pago',
    })
    assert.ifError(second.error)
    assert.equal(second.data, 0, 'la segunda ejecución no debe volver a cancelar la orden')

    const afterSecond = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterSecond.error)
    assert.equal(Number(afterSecond.data.stock), originalStock, 'la segunda ejecución no debe duplicar el stock')

    const anonymousCall = await anonymous.rpc('release_expired_orders_atomic', {
      p_age_minutes: 15,
      p_payment_marker: 'Mercado Pago',
    })
    assert.ok(anonymousCall.error, 'anon no debe invocar la RPC de liberación')

    console.log(JSON.stringify({
      ok: true,
      product: product.name,
      firstRunCancelled: first.data,
      secondRunCancelled: second.data,
      stockRestored: true,
      anonBlocked: true,
    }, null, 2))
  } finally {
    if (orderId) {
      const itemCleanup = await admin.from('order_items').delete().eq('order_id', orderId)
      if (itemCleanup.error) throw new Error(`No se pudo limpiar item sintético: ${itemCleanup.error.message}`)
      const orderCleanup = await admin.from('orders').delete().eq('id', orderId)
      if (orderCleanup.error) throw new Error(`No se pudo limpiar orden sintética: ${orderCleanup.error.message}`)
    }
    const restore = await admin.from('products').update({ stock: originalStock }).eq('id', product.id)
    if (restore.error) throw new Error(`No se pudo restaurar stock: ${restore.error.message}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
