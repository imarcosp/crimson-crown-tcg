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
  throw new Error('La matriz de seguridad sólo puede ejecutarse contra Supabase local.')
}

const identities = {
  standard: { email: 'tester.local@example.test', password: 'CrimsonLocalTester!2026' },
  admin: { email: 'admin.local@example.test', password: 'CrimsonLocalAdmin!2026' },
}

function client() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

function serviceClient() {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(identity) {
  const supabase = client()
  const { error } = await supabase.auth.signInWithPassword(identities[identity])
  if (error) throw new Error(`No se pudo iniciar sesión como ${identity}: ${error.message}`)
  return supabase
}

async function countRows(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

async function expectBlocked(label, operation) {
  const { data, error } = await operation()
  assert.ok(error || (data?.length ?? 0) === 0, `${label} debe estar bloqueado`)
}

async function main() {
  const anon = client()
  const standard = await signedIn('standard')
  const admin = await signedIn('admin')
  const service = serviceClient()

  const privateTables = ['profiles', 'orders', 'buylist_orders', 'wishlists', 'credit_transactions']
  const anonPrivate = Object.fromEntries(await Promise.all(privateTables.map(async (table) => [table, await countRows(anon, table)])))
  for (const [table, count] of Object.entries(anonPrivate)) assert.equal(count, 0, `anon no debe leer ${table}`)

  const publicProducts = await countRows(anon, 'products')
  assert.ok(publicProducts > 0, 'el catálogo público debe seguir disponible')

  const { data: profile } = await standard.from('profiles').select('id,credits,first_name,last_name,phone').single()
  assert.ok(profile?.id, 'debe existir el perfil sintético')

  const standardProfile = await countRows(standard, 'profiles')
  const adminProfiles = await countRows(admin, 'profiles')
  assert.equal(standardProfile, 1, 'el usuario estándar debe ver sólo su perfil')
  assert.ok(adminProfiles > standardProfile, 'admin debe ver todos los perfiles')

  const standardOrders = await countRows(standard, 'orders')
  const adminOrders = await countRows(admin, 'orders')
  assert.ok(standardOrders < adminOrders, 'el usuario estándar no debe ver todas las órdenes')

  const noteMarker = `local-security-${Date.now()}`
  const { data: importOrder, error: importOrderError } = await standard
    .from('import_orders')
    .insert({ user_id: profile?.id, status: 'Iniciada', user_notes: null })
    .select('id')
    .single()
  if (importOrderError) throw new Error(`no se pudo crear orden de prueba: ${importOrderError.message}`)
  try {
    const directImportUpdate = await standard
      .from('import_orders')
      .update({ user_notes: noteMarker })
      .eq('id', importOrder.id)
      .select('id')
    assert.equal(directImportUpdate.data?.length ?? 0, 0, 'standard no debe actualizar import_orders directamente')

    const noteRpc = await standard.rpc('append_import_order_user_note', {
      p_order_id: importOrder.id,
      p_note: noteMarker,
    })
    assert.ifError(noteRpc.error)

    const { data: updatedImport, error: updatedImportError } = await standard
      .from('import_orders')
      .select('user_notes')
      .eq('id', importOrder.id)
      .single()
    if (updatedImportError) throw new Error(`no se pudo leer orden de prueba: ${updatedImportError.message}`)
    assert.match(updatedImport.user_notes ?? '', new RegExp(noteMarker), 'la RPC debe agregar la nota propia')
  } finally {
    const { error: cleanupError } = await admin.from('import_orders').delete().eq('id', importOrder.id)
    if (cleanupError) throw new Error(`no se pudo limpiar orden de prueba: ${cleanupError.message}`)
  }

  const viewProbe = await anon.from('admin_users').select('id').limit(1)
  assert.ok(viewProbe.error, 'la vista admin_users no debe estar expuesta')

  const adminRpc = await anon.rpc('is_admin')
  assert.ok(adminRpc.error, 'is_admin no debe ser invocable por anon')

  const { data: product } = await anon.from('products').select('id,stock,inventory_id,variant_key').limit(1).single()
  assert.ok(product?.id, 'debe existir un producto de prueba')
  const { data: productInventory } = await anon.from('inventories').select('name').eq('id', product.inventory_id).single()
  assert.ok(productInventory?.name, 'el producto de prueba debe conservar su inventario')
  const productWrite = await standard.from('products').update({ stock: product.stock }).eq('id', product.id).select('id')
  assert.equal(productWrite.data?.length ?? 0, 0, 'standard no debe editar productos')

  const profileWrite = await standard.from('profiles').update({ credits: profile.credits }).eq('id', profile.id).select('id')
  assert.equal(profileWrite.data?.length ?? 0, 0, 'standard no debe editar créditos directamente')

  const missingProductId = randomUUID()
  const productInsert = await standard.from('products').insert({
    id: missingProductId,
    name: 'local security probe',
    stock: 0,
  }).select('id')
  assert.ok(productInsert.error || (productInsert.data?.length ?? 0) === 0, 'standard no debe crear productos')

  await expectBlocked('standard no debe crear banners', () => standard.from('banners').insert({
    image_url: 'https://example.test/local-security.png',
    title: 'local security probe',
  }).select('id'))
  await expectBlocked('standard no debe crear FAQs', () => standard.from('faqs').insert({
    question: 'local security probe',
    answer: 'local security probe',
  }).select('id'))
  await expectBlocked('standard no debe crear cupones', () => standard.from('coupons').insert({
    code: `LOCAL-SECURITY-${Date.now()}`,
    discount_type: 'percentage',
    value: 1,
  }).select('id'))
  await expectBlocked('standard no debe crear notificaciones', () => standard.from('notifications').insert({
    user_id: profile.id,
    type: 'security_probe',
    title: 'local security probe',
  }).select('id'))
  await expectBlocked('standard no debe crear oportunidades', () => standard.from('price_opportunities').insert({
    card_name: 'local security probe',
  }).select('id'))
  await expectBlocked('standard no debe crear movimientos de crédito', () => standard.from('credit_transactions').insert({
    user_id: profile.id,
    amount: 1,
    type: 'security_probe',
  }).select('id'))
  await expectBlocked('standard no debe crear historial de precios', () => standard.from('price_history').insert({
    product_id: product.id,
    price: 1,
  }).select('id'))

  const { data: wishlistProbe, error: wishlistProbeError } = await standard.from('wishlists').insert({
    user_id: profile.id,
    card_name: `Local security probe ${Date.now()}`,
    product_id: null,
    is_specific: false,
    notified: false,
  }).select('id').single()
  if (wishlistProbeError) throw new Error(`standard debe poder crear wishlist por nombre: ${wishlistProbeError.message}`)
  const { error: wishlistCleanupError } = await standard.from('wishlists').delete().eq('id', wishlistProbe.id)
  if (wishlistCleanupError) throw new Error(`no se pudo limpiar wishlist de prueba: ${wishlistCleanupError.message}`)

  const { data: savedProbe, error: savedProbeError } = await standard.from('saved_items').insert({
    user_id: profile.id,
    product_id: product.id,
  }).select('id').single()
  if (savedProbeError) throw new Error(`standard debe poder guardar un producto propio: ${savedProbeError.message}`)
  const { error: savedCleanupError } = await standard.from('saved_items').delete().eq('id', savedProbe.id)
  if (savedCleanupError) throw new Error(`no se pudo limpiar saved_items de prueba: ${savedCleanupError.message}`)

  const { data: cartProbe, error: cartProbeError } = await standard.from('cart_items').insert({
    user_id: profile.id,
    product_id: String(product.id),
    quantity: 1,
  }).select('id').single()
  if (cartProbeError) throw new Error(`standard debe poder crear su item de carrito: ${cartProbeError.message}`)
  const { error: cartCleanupError } = await standard.from('cart_items').delete().eq('id', cartProbe.id)
  if (cartCleanupError) throw new Error(`no se pudo limpiar cart_items de prueba: ${cartCleanupError.message}`)

  const { data: orderProbe, error: orderProbeError } = await standard.from('orders').insert({
    user_id: profile.id,
    status: 'pending_payment',
    total_amount: 1,
    payment_method: 'local-security-probe',
  }).select('id').single()
  if (orderProbeError) throw new Error(`standard debe poder crear su propia orden: ${orderProbeError.message}`)
  try {
    const { data: orderItemProbe, error: orderItemProbeError } = await standard.from('order_items').insert({
      order_id: orderProbe.id,
      product_id: product.id,
      quantity: 1,
      price_at_purchase: 1,
      inventory_id: product.inventory_id,
      variant_key: product.variant_key,
      source_inventory_name: productInventory.name,
    }).select('id').single()
    if (orderItemProbeError) throw new Error(`standard debe poder crear items de su orden: ${orderItemProbeError.message}`)

    await expectBlocked('standard no debe editar su orden directamente', () => standard
      .from('orders')
      .update({ delivery_notes: 'blocked' })
      .eq('id', orderProbe.id)
      .select('id'))
    await expectBlocked('standard no debe borrar su orden directamente', () => standard
      .from('orders')
      .delete()
      .eq('id', orderProbe.id)
      .select('id'))

    const { error: itemCleanupError } = await admin.from('order_items').delete().eq('id', orderItemProbe.id)
    if (itemCleanupError) throw new Error(`no se pudo limpiar order_items de prueba: ${itemCleanupError.message}`)
  } finally {
    const { error: orderCleanupError } = await admin.from('orders').delete().eq('id', orderProbe.id)
    if (orderCleanupError) throw new Error(`no se pudo limpiar orden de prueba: ${orderCleanupError.message}`)
  }

  const { data: buylistProbe, error: buylistProbeError } = await standard.from('buylist_orders').insert({
    user_id: profile.id,
    status: 'pending_review',
    total_offered: 1,
  }).select('id').single()
  if (buylistProbeError) throw new Error(`standard debe poder crear su propio buylist: ${buylistProbeError.message}`)
  try {
    const { data: buylistItemProbe, error: buylistItemProbeError } = await standard.from('buylist_items').insert({
      buylist_id: buylistProbe.id,
      product_id: product.id,
      quantity: 1,
      offered_price_unit: 1,
    }).select('id').single()
    if (buylistItemProbeError) throw new Error(`standard debe poder crear items de su buylist: ${buylistItemProbeError.message}`)
    await expectBlocked('standard no debe editar buylist_items', () => standard
      .from('buylist_items')
      .update({ offered_price_unit: 2 })
      .eq('id', buylistItemProbe.id)
      .select('id'))
    const { error: buylistItemCleanupError } = await admin.from('buylist_items').delete().eq('id', buylistItemProbe.id)
    if (buylistItemCleanupError) throw new Error(`no se pudo limpiar buylist_items de prueba: ${buylistItemCleanupError.message}`)
  } finally {
    const { error: buylistCleanupError } = await admin.from('buylist_orders').delete().eq('id', buylistProbe.id)
    if (buylistCleanupError) throw new Error(`no se pudo limpiar buylist de prueba: ${buylistCleanupError.message}`)
  }

  const settingsWrite = await standard.from('system_settings').upsert({
    key: `local-security-probe-${Date.now()}`,
    value: true,
  }).select('key')
  assert.ok(settingsWrite.error || (settingsWrite.data?.length ?? 0) === 0, 'standard no debe escribir system_settings')

  const analyticsMarker = `local-security-analytics-${Date.now()}`
  try {
    const analyticsProbe = await anon.from('analytics_visits').insert({ source: analyticsMarker })
    assert.ifError(analyticsProbe.error)
  } finally {
    const { error } = await service.from('analytics_visits').delete().eq('source', analyticsMarker)
    if (error) throw new Error(`no se pudo limpiar analytics_visits de prueba: ${error.message}`)
  }

  const searchMarker = `local-security-search-${Date.now()}`
  try {
    const searchProbe = await anon.from('search_logs').insert({ query: searchMarker })
    assert.ifError(searchProbe.error)
  } finally {
    const { error } = await service.from('search_logs').delete().eq('query', searchMarker)
    if (error) throw new Error(`no se pudo limpiar search_logs de prueba: ${error.message}`)
  }

  const feedbackMarker = `local-security-feedback-${Date.now()}`
  try {
    const feedbackProbe = await anon.from('feedback').insert({ comment: feedbackMarker })
    assert.ifError(feedbackProbe.error)
  } finally {
    const { error } = await service.from('feedback').delete().eq('comment', feedbackMarker)
    if (error) throw new Error(`no se pudo limpiar feedback de prueba: ${error.message}`)
  }

  const creditProbe = await standard.rpc('manage_credits', {
    target_user_id: profile.id,
    amount_change: 1,
    transaction_type: 'test',
    transaction_desc: 'local security probe',
    ref_id: null,
  })
  assert.ok(creditProbe.error, 'standard no debe autoacreditarse créditos')

  const stockProbe = await standard.rpc('decrement_stock', {
    qty: 0,
    row_id: product.id,
  })
  assert.ok(stockProbe.error, 'standard no debe invocar decrement_stock')

  const { count: externalCount } = await countRows(standard, 'external_prices').then((count) => ({ count }))
  assert.ok(externalCount > 0, 'external_prices debe seguir siendo legible')
  const priceWrite = await standard.from('external_prices').update({ cardkingdom_retail_normal: null }).eq('scryfall_id', 'missing-local-probe').select('scryfall_id')
  assert.equal(priceWrite.data?.length ?? 0, 0, 'standard no debe editar external_prices')

  console.log(JSON.stringify({
    ok: true,
    anonPrivate,
    publicProducts,
    standardProfile,
    adminProfiles,
    standardOrders,
    adminOrders,
    externalCount,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
