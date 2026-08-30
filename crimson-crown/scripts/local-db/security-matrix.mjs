import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'
import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const privilegedVerifier = path.join(appRoot, 'scripts', 'local-db', 'verify-privileged-surfaces.ps1')
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

if (!url || !anonKey || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
if (!loopbackHosts.has(new URL(url).hostname)) {
  throw new Error('La matriz de seguridad sólo puede ejecutarse contra Supabase local.')
}

const identities = {
  standard: { email: 'tester.local@example.test', password: 'CrimsonLocalTester!2026' },
  admin: { email: 'admin.local@example.test', password: 'CrimsonLocalAdmin!2026' },
}

const privilegedRpcDenialProbes = [
  { name: 'assign_import_order_number' },
  { name: 'calculate_import_order_total', args: { p_order_id: -1 } },
  { name: 'find_orders_by_id_part', args: { q: 'privileged-denial-probe' } },
  { name: 'generate_import_order_number' },
  { name: 'generate_next_import_order_number' },
  { name: 'get_inventory_valuation' },
  { name: 'get_trash_products', args: { batch_size: 1 } },
  { name: 'handle_new_user' },
  { name: 'notify_buylist_manager' },
  { name: 'notify_credit_change' },
  { name: 'notify_import_manager' },
  { name: 'notify_order_manager' },
  { name: 'notify_stock_alert' },
  { name: 'on_commission_adjustments_change' },
  { name: 'on_commission_allocations_change' },
  { name: 'set_import_order_commission_eligible' },
  { name: 'set_order_commission_eligible' },
  { name: 'sync_product_prices' },
]

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

export function expectPermissionDenied(label, result, expected) {
  const expectedKind = expected?.kind
  const expectedName = expected?.name
  assert.ok(expectedKind === 'function' || expectedKind === 'view', `${label} requiere un tipo de objeto esperado`)
  assert.match(expectedName ?? '', /^[a-z_][a-z0-9_]*$/, `${label} requiere un nombre de objeto exacto`)

  if (result.error?.code === '42501') {
    assert.equal(
      result.error.message,
      `permission denied for ${expectedKind} ${expectedName}`,
      `${label} debe asociar 42501 al objeto exacto`,
    )
    return
  }

  if (result.error?.code === 'PGRST202') {
    assert.equal(expectedKind, 'function', `${label} sólo permite PGRST202 para funciones`)
    assert.equal(expected.catalogVerified, true, `${label} requiere catálogo local verificado antes de aceptar PGRST202`)
    assert.equal(
      result.error.message,
      `Could not find the function public.${expectedName} without parameters in the schema cache`,
      `${label} debe identificar exactamente la RPC oculta`,
    )
    assert.equal(
      result.error.details,
      `Searched for the function public.${expectedName} without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`,
      `${label} debe contener el detalle predecible del schema cache`,
    )
    return
  }

  assert.fail(`${label} debe fallar por privilegio antes de ejecutar; código recibido: ${result.error?.code ?? 'sin error'}`)
}

function verifyLocalPrivilegedCatalog() {
  const result = spawnSync(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    privilegedVerifier,
  ], {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })

  if (result.status !== 0 || !/PRIVILEGED_SURFACES_OK/.test(result.stdout ?? '')) {
    throw new Error('La matriz Data API requiere un catálogo privilegiado local verificado.')
  }
  return true
}

async function main() {
  // PostgREST oculta algunas RPC sin grant. Sólo aceptamos PGRST202 después
  // de que el gate de catálogo pruebe que la firma existe y su ACL es exacta.
  const privilegedCatalogVerified = verifyLocalPrivilegedCatalog()
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
  expectPermissionDenied('anon no debe leer admin_users', viewProbe, {
    kind: 'view', name: 'admin_users', catalogVerified: privilegedCatalogVerified,
  })

  const standardViewProbe = await standard.from('admin_users').select('id').limit(1)
  expectPermissionDenied('authenticated no debe leer admin_users', standardViewProbe, {
    kind: 'view', name: 'admin_users', catalogVerified: privilegedCatalogVerified,
  })

  for (const probe of privilegedRpcDenialProbes) {
    expectPermissionDenied(
      `anon no debe invocar ${probe.name}`,
      await anon.rpc(probe.name, probe.args),
      { kind: 'function', name: probe.name, catalogVerified: privilegedCatalogVerified },
    )
    expectPermissionDenied(
      `authenticated no debe invocar ${probe.name}`,
      await standard.rpc(probe.name, probe.args),
      { kind: 'function', name: probe.name, catalogVerified: privilegedCatalogVerified },
    )
  }

  const anonCommissionAdmin = await anon.rpc('is_commission_admin')
  expectPermissionDenied('anon no debe invocar is_commission_admin', anonCommissionAdmin, {
    kind: 'function', name: 'is_commission_admin', catalogVerified: privilegedCatalogVerified,
  })

  const standardCommissionAdmin = await standard.rpc('is_commission_admin')
  assert.ifError(standardCommissionAdmin.error)
  assert.equal(standardCommissionAdmin.data, false, 'el usuario estándar no debe ser admin de comisiones')

  const adminCommissionAdmin = await admin.rpc('is_commission_admin')
  assert.ifError(adminCommissionAdmin.error)
  assert.equal(adminCommissionAdmin.data, true, 'el admin local debe ser admin de comisiones')

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

  const quickLinkMarker = `local-security-quick-link-${Date.now()}`
  const { data: quickLinkProbes, error: quickLinkProbeError } = await admin
    .from('home_quick_links')
    .insert([
      { label: `${quickLinkMarker}-active`, url: '/catalog', icon_key: 'search', display_order: 9980, active: true },
      { label: `${quickLinkMarker}-inactive`, url: '/catalog', icon_key: 'search', display_order: 9981, active: false },
    ])
    .select('id,label,active')
  if (quickLinkProbeError || quickLinkProbes?.length !== 2) {
    throw quickLinkProbeError || new Error('el admin local debe poder crear accesos rápidos')
  }
  try {
    const { data: anonQuickLinks, error: anonQuickLinksError } = await anon
      .from('home_quick_links')
      .select('id,label,active')
      .like('label', `${quickLinkMarker}%`)
    assert.ifError(anonQuickLinksError)
    assert.equal(anonQuickLinks?.length, 1, 'anon debe ver sólo el acceso rápido activo')
    assert.equal(anonQuickLinks?.[0]?.active, true, 'anon no debe ver accesos rápidos inactivos')

    const { data: standardQuickLinks, error: standardQuickLinksError } = await standard
      .from('home_quick_links')
      .select('id,label,active')
      .like('label', `${quickLinkMarker}%`)
    assert.ifError(standardQuickLinksError)
    assert.equal(standardQuickLinks?.length, 1, 'standard debe ver sólo el acceso rápido activo')

    await expectBlocked('standard no debe crear accesos rápidos', () => standard.from('home_quick_links').insert({
      label: `${quickLinkMarker}-blocked`,
      url: '/catalog',
      icon_key: 'search',
      display_order: 9982,
      active: true,
    }).select('id'))
    await expectBlocked('standard no debe editar accesos rápidos', () => standard
      .from('home_quick_links')
      .update({ label: `${quickLinkMarker}-modified` })
      .eq('id', quickLinkProbes[0].id)
      .select('id'))
    await expectBlocked('standard no debe borrar accesos rápidos', () => standard
      .from('home_quick_links')
      .delete()
      .eq('id', quickLinkProbes[0].id)
      .select('id'))
  } finally {
    const { error: quickLinkCleanupError } = await service
      .from('home_quick_links')
      .delete()
      .like('label', `${quickLinkMarker}%`)
    if (quickLinkCleanupError) throw new Error(`no se pudieron limpiar accesos rápidos de prueba: ${quickLinkCleanupError.message}`)
  }

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
    privilegedCatalogVerified,
    anonPrivate,
    publicProducts,
    standardProfile,
    adminProfiles,
    standardOrders,
    adminOrders,
    externalCount,
    privilegedRpcDenials: {
      functions: privilegedRpcDenialProbes.length,
      probes: privilegedRpcDenialProbes.length * 2,
    },
    commissionAdmin: {
      anon: 'denied',
      standard: standardCommissionAdmin.data,
      admin: adminCommissionAdmin.data,
    },
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
