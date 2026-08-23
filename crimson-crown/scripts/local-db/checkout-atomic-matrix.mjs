import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const invalidProductId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

if (!url || !anonKey || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
if (!loopbackHosts.has(new URL(url).hostname)) throw new Error('La matriz atómica sólo puede usar Supabase local.')

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

function serviceClient() {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function main() {
  const admin = serviceClient()
  const anonymous = client()
  const standard = client()
  const anonymousRpc = await anonymous.rpc('place_order_atomic', {
    p_items: [],
    p_coupon_code: null,
    p_delivery_method: 'pickup [Pago: Efectivo]',
    p_shipping_address: null,
    p_use_credits: false,
    p_contact_name: 'Anon',
    p_contact_lastname: 'Blocked',
    p_contact_phone: '0',
  })
  assert.ok(anonymousRpc.error, 'anon no debe invocar el RPC financiero')

  const signIn = await standard.auth.signInWithPassword({
    email: 'tester.local@example.test',
    password: 'CrimsonLocalTester!2026',
  })
  if (signIn.error) throw new Error(`No se pudo iniciar sesión local: ${signIn.error.message}`)

  const profileResult = await admin.from('profiles').select('id,credits').eq('email', 'tester.local@example.test').single()
  if (profileResult.error || !profileResult.data) throw new Error(`No se encontró perfil estándar: ${profileResult.error?.message || 'sin perfil'}`)

  const productResult = await admin
    .from('products')
    .select('id,name,stock,price_usd')
    .gt('stock', 1)
    .order('stock', { ascending: false })
    .limit(1)
    .single()
  if (productResult.error || !productResult.data) throw new Error(`No se encontró producto: ${productResult.error?.message || 'sin producto'}`)

  const profileId = profileResult.data.id
  const product = productResult.data
  const originalStock = Number(product.stock || 0)
  const originalCredits = Number(profileResult.data.credits || 0)
  const temporaryCredits = originalCredits + Number(product.price_usd || 0) + 1

  const transactionsBefore = await admin
    .from('credit_transactions')
    .select('id')
    .eq('user_id', profileId)
  if (transactionsBefore.error) throw new Error(`No se pudo leer transacciones iniciales: ${transactionsBefore.error.message}`)
  const knownTransactionIds = new Set((transactionsBefore.data || []).map((row) => row.id))

  let orderIds = []
  try {
    const setCredits = await admin.from('profiles').update({ credits: temporaryCredits }).eq('id', profileId)
    if (setCredits.error) throw new Error(`No se pudo preparar créditos locales: ${setCredits.error.message}`)

    const rpc = await standard.rpc('place_order_atomic', {
      p_items: [
        { id: product.id, quantity: 1 },
        { id: invalidProductId, quantity: 1 },
      ],
      p_coupon_code: null,
      p_delivery_method: 'pickup [Pago: Efectivo]',
      p_shipping_address: null,
      p_use_credits: true,
      p_contact_name: 'Atomic',
      p_contact_lastname: 'Rollback',
      p_contact_phone: '+5491100000001',
    })
    assert.ok(rpc.error, 'una orden inválida debe fallar')
    assert.match(rpc.error.message, /Producto inválido|producto inválido|no encontrado/i)

    const afterProduct = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterProduct.error)
    assert.equal(Number(afterProduct.data.stock), originalStock, 'el stock debe volver al valor original tras el rollback')

    const afterProfile = await admin.from('profiles').select('credits').eq('id', profileId).single()
    assert.ifError(afterProfile.error)
    assert.equal(Number(afterProfile.data.credits), temporaryCredits, 'los créditos no deben modificarse si falla el checkout')

    const afterTransactions = await admin.from('credit_transactions').select('id').eq('user_id', profileId)
    assert.ifError(afterTransactions.error)
    assert.deepEqual(
      new Set((afterTransactions.data || []).map((row) => row.id)),
      knownTransactionIds,
      'el rollback no debe dejar transacciones de crédito',
    )

    const markerOrders = await admin
      .from('orders')
      .select('id')
      .eq('user_id', profileId)
      .eq('contact_name', 'Atomic')
      .eq('contact_lastname', 'Rollback')
    assert.ifError(markerOrders.error)
    orderIds = (markerOrders.data || []).map((row) => row.id)
    assert.equal(orderIds.length, 0, 'el rollback no debe dejar órdenes')

    const success = await standard.rpc('place_order_atomic', {
      p_items: [{ id: product.id, quantity: 1 }],
      p_coupon_code: null,
      p_delivery_method: 'pickup [Pago: Efectivo]',
      p_shipping_address: null,
      p_use_credits: true,
      p_contact_name: 'Atomic',
      p_contact_lastname: 'Success',
      p_contact_phone: '+5491100000001',
    })
    assert.ifError(success.error)
    assert.ok(success.data, 'el checkout válido debe devolver el id de la orden')
    orderIds.push(success.data)

    const successfulOrder = await admin
      .from('orders')
      .select('status,total_amount,credits_used,delivery_notes')
      .eq('id', success.data)
      .single()
    assert.ifError(successfulOrder.error)
    assert.equal(successfulOrder.data.status, 'paid', 'el pago cubierto con créditos debe quedar pagado')
    assert.equal(Number(successfulOrder.data.total_amount), 0, 'el total pendiente debe ser cero con créditos suficientes')
    assert.equal(Number(successfulOrder.data.credits_used), Number(product.price_usd), 'debe registrar los créditos usados')

    const successfulItem = await admin
      .from('order_items')
      .select('product_id,quantity,price_at_purchase')
      .eq('order_id', success.data)
      .single()
    assert.ifError(successfulItem.error)
    assert.equal(successfulItem.data.product_id, product.id)
    assert.equal(successfulItem.data.quantity, 1)
    assert.equal(Number(successfulItem.data.price_at_purchase), Number(product.price_usd))

    const afterSuccessfulProduct = await admin.from('products').select('stock').eq('id', product.id).single()
    assert.ifError(afterSuccessfulProduct.error)
    assert.equal(Number(afterSuccessfulProduct.data.stock), originalStock - 1, 'el checkout válido debe reservar una unidad')

    const afterSuccessfulProfile = await admin.from('profiles').select('credits').eq('id', profileId).single()
    assert.ifError(afterSuccessfulProfile.error)
    assert.equal(Number(afterSuccessfulProfile.data.credits), temporaryCredits - Number(product.price_usd))

    console.log(JSON.stringify({
      ok: true,
      product: product.name,
      failure: 'invalid-second-product',
      stockRestored: true,
      creditsRestored: true,
      successfulCreditCheckout: true,
      anonBlocked: true,
      ordersCreated: 1,
    }, null, 2))
  } finally {
    if (orderIds.length) {
      await admin.from('order_items').delete().in('order_id', orderIds)
      await admin.from('orders').delete().in('id', orderIds)
    }
    const currentTransactions = await admin.from('credit_transactions').select('id').eq('user_id', profileId)
    for (const row of currentTransactions.data || []) {
      if (!knownTransactionIds.has(row.id)) await admin.from('credit_transactions').delete().eq('id', row.id)
    }
    const restoreProduct = await admin.from('products').update({ stock: originalStock }).eq('id', product.id)
    if (restoreProduct.error) throw new Error(`No se pudo restaurar stock: ${restoreProduct.error.message}`)
    const restoreProfile = await admin.from('profiles').update({ credits: originalCredits }).eq('id', profileId)
    if (restoreProfile.error) throw new Error(`No se pudieron restaurar créditos: ${restoreProfile.error.message}`)
    await standard.auth.signOut()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
