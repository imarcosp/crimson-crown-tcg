import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'
import { expectPermissionDenied } from './security-matrix.mjs'

dotenv.config({ path: '.env.test.local', override: true })

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const missingUuid = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const marker = `LOCAL-AUTH-DEFINER-${Date.now()}`

if (!url || !anonKey || !serviceKey) throw new Error('Faltan las credenciales de Supabase local.')
const parsedUrl = new URL(url)
if (parsedUrl.protocol !== 'http:' || !loopbackHosts.has(parsedUrl.hostname) || parsedUrl.port !== '54621') {
  throw new Error('La matriz de definers sólo puede usar Supabase local en el puerto 54621.')
}

const retainedProbes = [
  { signature: 'admin_create_or_restock_product(uuid,jsonb,text)', name: 'admin_create_or_restock_product', args: { inventory_id_input: missingUuid, product_input: {}, operation_key_input: 'advisor-probe:create' } },
  { signature: 'admin_delete_products(uuid,uuid[],text)', name: 'admin_delete_products', args: { inventory_id_input: missingUuid, product_ids_input: [missingUuid], operation_key_input: 'advisor-probe:delete' } },
  { signature: 'admin_update_product(uuid,uuid,jsonb,text)', name: 'admin_update_product', args: { product_id_input: missingUuid, inventory_id_input: missingUuid, product_input: {}, operation_key_input: 'advisor-probe:update' } },
  { signature: 'append_import_order_user_note(bigint,text)', name: 'append_import_order_user_note', args: { p_order_id: -1, p_note: marker } },
  { signature: 'approve_buylist_transaction(uuid,numeric)', name: 'approve_buylist_transaction', args: { buylist_id_input: missingUuid, amount_to_credit: 0 } },
  { signature: 'archive_inventory(uuid)', name: 'archive_inventory', args: { inventory_id_input: missingUuid } },
  { signature: 'cancel_order_atomic(uuid,boolean,boolean)', name: 'cancel_order_atomic', args: { order_id_input: missingUuid, restock_input: false, refund_credits_input: false } },
  { signature: 'create_inventory(text,text,text)', name: 'create_inventory', args: { name_input: '', description_input: null, location_label_input: null } },
  { signature: 'decrement_stock(integer,uuid)', name: 'decrement_stock', args: { qty: 0, row_id: missingUuid } },
  { signature: 'delete_inventory_safely(uuid)', name: 'delete_inventory_safely', args: { inventory_id_input: missingUuid } },
  { signature: 'get_inventory_metrics(uuid)', name: 'get_inventory_metrics', args: { inventory_id_input: missingUuid } },
  { signature: 'is_admin()', name: 'is_admin' },
  { signature: 'is_commission_admin()', name: 'is_commission_admin' },
  { signature: 'manage_credits(uuid,numeric,text,text,uuid)', name: 'manage_credits', args: { target_user_id: missingUuid, amount_change: 1, transaction_type: 'advisor_probe', transaction_desc: marker, ref_id: null } },
  { signature: 'place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)', name: 'place_order_atomic', args: { p_items: [], p_coupon_code: null, p_delivery_method: 'pickup', p_shipping_address: null, p_use_credits: false, p_contact_name: 'Advisor', p_contact_lastname: 'Probe', p_contact_phone: '0' } },
  { signature: 'refund_order_atomic(uuid,boolean,numeric)', name: 'refund_order_atomic', args: { order_id_input: missingUuid, restock_input: false, credit_amount_input: 0 } },
  { signature: 'release_expired_orders_atomic(integer,text)', name: 'release_expired_orders_atomic', args: { p_age_minutes: 15, p_payment_marker: marker } },
  { signature: 'remove_order_item_atomic(uuid,integer,boolean)', name: 'remove_order_item_atomic', args: { order_item_id_input: missingUuid, quantity_input: 1, restock_input: false } },
  { signature: 'restore_order_inventory_atomic(uuid,text)', name: 'restore_order_inventory_atomic', args: { order_id_input: missingUuid, movement_type_input: 'release' } },
  { signature: 'restore_stock(uuid)', name: 'restore_stock', args: { order_id_input: missingUuid } },
  { signature: 'set_inventory_active(uuid,boolean)', name: 'set_inventory_active', args: { inventory_id_input: missingUuid, is_active_input: false } },
  { signature: 'submit_order_payment_proof(uuid,text)', name: 'submit_order_payment_proof', args: { order_id_input: missingUuid, proof_url_input: 'https://example.test/advisor-proof' } },
  { signature: 'transfer_credits(text,numeric,text)', name: 'transfer_credits', args: { recipient_email: 'missing-advisor@example.test', amount: 1, note: marker } },
  { signature: 'update_profile_details(text,text,text)', name: 'update_profile_details', args: { first_name_input: 'Advisor', last_name_input: 'Probe', phone_input: '0' } },
  { signature: 'user_accept_buylist_offer(uuid)', name: 'user_accept_buylist_offer', args: { buylist_id_input: missingUuid } },
]

const gapSignatures = new Set([
  'append_import_order_user_note(bigint,text)',
  'approve_buylist_transaction(uuid,numeric)',
  'archive_inventory(uuid)',
  'cancel_order_atomic(uuid,boolean,boolean)',
  'create_inventory(text,text,text)',
  'delete_inventory_safely(uuid)',
  'get_inventory_metrics(uuid)',
  'manage_credits(uuid,numeric,text,text,uuid)',
  'refund_order_atomic(uuid,boolean,numeric)',
  'remove_order_item_atomic(uuid,integer,boolean)',
  'restore_order_inventory_atomic(uuid,text)',
  'restore_stock(uuid)',
  'set_inventory_active(uuid,boolean)',
  'submit_order_payment_proof(uuid,text)',
  'transfer_credits(text,numeric,text)',
  'update_profile_details(text,text,text)',
  'user_accept_buylist_offer(uuid)',
])

function client(key = anonKey) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signedIn(email, password) {
  const supabase = client()
  const result = await supabase.auth.signInWithPassword({ email, password })
  if (result.error || !result.data.user) throw new Error(`No se pudo iniciar sesión local: ${result.error?.message || 'sin usuario'}`)
  return { supabase, user: result.data.user }
}

function verifyCatalog() {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(appRoot, 'scripts', 'local-db', 'verify-privileged-surfaces.ps1'),
  ], { cwd: appRoot, encoding: 'utf8', timeout: 120_000, windowsHide: true })
  if (result.status !== 0 || !/PRIVILEGED_SURFACES_OK/.test(result.stdout ?? '')) {
    throw new Error('La matriz requiere el catálogo privilegiado local verificado.')
  }
  return true
}

function expectError(result, code, message, label) {
  assert.equal(result.error?.code, code, `${label}: código inesperado (${result.error?.message || 'sin error'})`)
  assert.equal(result.error?.message, message, `${label}: mensaje inesperado`)
}

async function main() {
  const catalogVerified = verifyCatalog()
  const anonymous = client()
  const service = client(serviceKey)
  const { supabase: standard, user: standardUser } = await signedIn('tester.local@example.test', 'CrimsonLocalTester!2026')
  const { supabase: admin, user: adminUser } = await signedIn('admin.local@example.test', 'CrimsonLocalAdmin!2026')

  const anonDeniedSignatures = []
  for (const probe of retainedProbes) {
    const result = await anonymous.rpc(probe.name, probe.args)
    expectPermissionDenied(`anon no debe invocar ${probe.name}`, result, {
      kind: 'function', name: probe.name, catalogVerified,
    })
    anonDeniedSignatures.push(probe.signature)
  }

  const profiles = await service
    .from('profiles')
    .select('id,email,credits,first_name,last_name,phone')
    .in('id', [standardUser.id, adminUser.id])
  assert.ifError(profiles.error)
  const standardProfile = profiles.data?.find((profile) => profile.id === standardUser.id)
  const adminProfile = profiles.data?.find((profile) => profile.id === adminUser.id)
  assert.ok(standardProfile?.id && adminProfile?.id, 'deben existir ambos perfiles sintéticos')

  const standardIsAdmin = await standard.rpc('is_admin')
  assert.ifError(standardIsAdmin.error)
  assert.equal(standardIsAdmin.data, false, 'el usuario estándar no debe ser admin')
  const adminIsAdmin = await admin.rpc('is_admin')
  assert.ifError(adminIsAdmin.error)
  assert.equal(adminIsAdmin.data, true, 'el admin local debe superar el guard de is_admin')

  const knownTransactions = await service
    .from('credit_transactions')
    .select('id')
    .in('user_id', [standardProfile.id, adminProfile.id])
  assert.ifError(knownTransactions.error)
  const knownTransactionIds = new Set((knownTransactions.data || []).map((row) => row.id))
  const knownNotifications = await service.from('notifications').select('id')
  assert.ifError(knownNotifications.error)
  const knownNotificationIds = new Set((knownNotifications.data || []).map((row) => row.id))

  const importOrderIds = []
  const orderIds = []
  const buylistIds = []
  const positive = []
  const internalNegative = []
  let jwtGuardProofs = null

  const adminOnlyProbes = [
    {
      signature: 'approve_buylist_transaction(uuid,numeric)', name: 'approve_buylist_transaction',
      args: { buylist_id_input: missingUuid, amount_to_credit: 0 }, positive: ['P0002', 'Solicitud de compra inexistente.'],
    },
    {
      signature: 'archive_inventory(uuid)', name: 'archive_inventory',
      args: { inventory_id_input: missingUuid }, positive: ['P0002', 'Inventario inexistente.'],
    },
    {
      signature: 'cancel_order_atomic(uuid,boolean,boolean)', name: 'cancel_order_atomic',
      args: { order_id_input: missingUuid, restock_input: false, refund_credits_input: false }, positive: ['P0002', 'Orden inexistente.'],
    },
    {
      signature: 'create_inventory(text,text,text)', name: 'create_inventory',
      args: { name_input: '', description_input: null, location_label_input: null }, positive: ['22023', 'El nombre del inventario es obligatorio.'],
    },
    {
      signature: 'delete_inventory_safely(uuid)', name: 'delete_inventory_safely',
      args: { inventory_id_input: missingUuid }, positive: ['P0002', 'Inventario inexistente.'],
    },
    {
      signature: 'get_inventory_metrics(uuid)', name: 'get_inventory_metrics',
      args: { inventory_id_input: missingUuid }, positive: null,
    },
    {
      signature: 'refund_order_atomic(uuid,boolean,numeric)', name: 'refund_order_atomic',
      args: { order_id_input: missingUuid, restock_input: false, credit_amount_input: 0 }, positive: ['P0002', 'Orden inexistente.'],
    },
    {
      signature: 'remove_order_item_atomic(uuid,integer,boolean)', name: 'remove_order_item_atomic',
      args: { order_item_id_input: missingUuid, quantity_input: 1, restock_input: false }, positive: ['P0002', 'Línea de orden inexistente.'],
    },
    {
      signature: 'restore_order_inventory_atomic(uuid,text)', name: 'restore_order_inventory_atomic',
      args: { order_id_input: missingUuid, movement_type_input: 'release' }, positive: null,
    },
    {
      signature: 'restore_stock(uuid)', name: 'restore_stock',
      args: { order_id_input: missingUuid }, positive: null,
    },
    {
      signature: 'set_inventory_active(uuid,boolean)', name: 'set_inventory_active',
      args: { inventory_id_input: missingUuid, is_active_input: false }, positive: ['P0002', 'Inventario inexistente.'],
    },
  ]

  try {
    const standardDecrement = await standard.rpc('decrement_stock', { qty: 0, row_id: missingUuid })
    expectError(standardDecrement, '42501', 'Sin permiso.', 'decrement stock standard JWT')
    const adminDecrement = await admin.rpc('decrement_stock', { qty: 0, row_id: missingUuid })
    expectError(adminDecrement, '22023', 'Cantidad inválida.', 'decrement stock admin JWT positive-auth')

    const releaseArgs = { p_age_minutes: 15, p_payment_marker: marker }
    const standardRelease = await standard.rpc('release_expired_orders_atomic', releaseArgs)
    expectError(standardRelease, '42501', 'Sin permiso.', 'release expired standard JWT')
    const adminRelease = await admin.rpc('release_expired_orders_atomic', releaseArgs)
    assert.ifError(adminRelease.error)
    assert.equal(adminRelease.data, 0, 'el admin JWT debe superar el guard sin encontrar órdenes')
    jwtGuardProofs = {
      decrementStock: {
        standard: `${standardDecrement.error.code}:${standardDecrement.error.message}`,
        admin: `${adminDecrement.error.code}:${adminDecrement.error.message}`,
      },
      releaseExpiredOrders: {
        standard: `${standardRelease.error.code}:${standardRelease.error.message}`,
        admin: adminRelease.data,
      },
    }

    for (const probe of adminOnlyProbes) {
      expectError(await standard.rpc(probe.name, probe.args), '42501', 'Sin permiso.', `${probe.name} negativo`)
      const authorized = await admin.rpc(probe.name, probe.args)
      if (probe.positive) expectError(authorized, probe.positive[0], probe.positive[1], `${probe.name} positive-auth`)
      else assert.ifError(authorized.error)
      internalNegative.push(probe.signature)
      positive.push(probe.signature)
    }

    const importFixtures = await service.from('import_orders').insert([
      { user_id: standardProfile.id, status: 'Iniciada', user_notes: marker },
      { user_id: adminProfile.id, status: 'Iniciada', user_notes: marker },
    ]).select('id,user_id')
    assert.ifError(importFixtures.error)
    importOrderIds.push(...(importFixtures.data || []).map((row) => row.id))
    const ownImport = importFixtures.data.find((row) => row.user_id === standardProfile.id)
    const crossImport = importFixtures.data.find((row) => row.user_id === adminProfile.id)
    expectError(await standard.rpc('append_import_order_user_note', { p_order_id: crossImport.id, p_note: marker }), '42501', 'order not found or not editable', 'append note cross-owner')
    assert.ifError((await standard.rpc('append_import_order_user_note', { p_order_id: ownImport.id, p_note: marker })).error)
    internalNegative.push('append_import_order_user_note(bigint,text)')
    positive.push('append_import_order_user_note(bigint,text)')

    const preparedCredits = Math.max(Number(standardProfile.credits || 0), 1)
    assert.ifError((await service.from('profiles').update({ credits: preparedCredits }).eq('id', standardProfile.id)).error)
    expectError(await standard.rpc('manage_credits', {
      target_user_id: adminProfile.id, amount_change: 1, transaction_type: 'advisor_probe', transaction_desc: marker, ref_id: null,
    }), '42501', 'Sin permiso.', 'manage credits cross-user')
    assert.ifError((await standard.rpc('manage_credits', {
      target_user_id: standardProfile.id, amount_change: -0.01, transaction_type: 'advisor_probe', transaction_desc: marker, ref_id: null,
    })).error)
    internalNegative.push('manage_credits(uuid,numeric,text,text,uuid)')
    positive.push('manage_credits(uuid,numeric,text,text,uuid)')

    const orderFixtures = await service.from('orders').insert([
      { user_id: standardProfile.id, status: 'pending_payment', total_amount: 1, payment_method: marker },
      { user_id: adminProfile.id, status: 'pending_payment', total_amount: 1, payment_method: marker },
    ]).select('id,user_id')
    assert.ifError(orderFixtures.error)
    orderIds.push(...(orderFixtures.data || []).map((row) => row.id))
    const ownOrder = orderFixtures.data.find((row) => row.user_id === standardProfile.id)
    const crossOrder = orderFixtures.data.find((row) => row.user_id === adminProfile.id)
    expectError(await standard.rpc('submit_order_payment_proof', {
      order_id_input: crossOrder.id, proof_url_input: 'https://example.test/advisor-proof',
    }), '42501', 'La orden no permite cargar comprobante.', 'payment proof cross-owner')
    assert.ifError((await standard.rpc('submit_order_payment_proof', {
      order_id_input: ownOrder.id, proof_url_input: 'https://example.test/advisor-proof',
    })).error)
    internalNegative.push('submit_order_payment_proof(uuid,text)')
    positive.push('submit_order_payment_proof(uuid,text)')

    assert.ifError((await standard.rpc('transfer_credits', {
      recipient_email: adminProfile.email, amount: 0.01, note: marker,
    })).error)
    positive.push('transfer_credits(text,numeric,text)')

    assert.ifError((await standard.rpc('update_profile_details', {
      first_name_input: standardProfile.first_name,
      last_name_input: standardProfile.last_name,
      phone_input: standardProfile.phone,
    })).error)
    positive.push('update_profile_details(text,text,text)')

    const buylistFixtures = await service.from('buylist_orders').insert([
      { user_id: standardProfile.id, status: 'pending_review', total_offered: 0 },
      { user_id: adminProfile.id, status: 'pending_review', total_offered: 0 },
    ]).select('id,user_id')
    assert.ifError(buylistFixtures.error)
    buylistIds.push(...(buylistFixtures.data || []).map((row) => row.id))
    const ownBuylist = buylistFixtures.data.find((row) => row.user_id === standardProfile.id)
    const crossBuylist = buylistFixtures.data.find((row) => row.user_id === adminProfile.id)
    expectError(await standard.rpc('user_accept_buylist_offer', { buylist_id_input: crossBuylist.id }), '42501', 'Sin permiso.', 'buylist cross-owner')
    expectError(await standard.rpc('user_accept_buylist_offer', { buylist_id_input: ownBuylist.id }), '22023', 'Estado incorrecto.', 'buylist positive-auth')
    internalNegative.push('user_accept_buylist_offer(uuid)')
    positive.push('user_accept_buylist_offer(uuid)')

  } finally {
    if (buylistIds.length) assert.ifError((await service.from('buylist_orders').delete().in('id', buylistIds)).error)
    if (orderIds.length) assert.ifError((await service.from('orders').delete().in('id', orderIds)).error)
    if (importOrderIds.length) assert.ifError((await service.from('import_orders').delete().in('id', importOrderIds)).error)

    const currentTransactions = await service
      .from('credit_transactions')
      .select('id')
      .in('user_id', [standardProfile.id, adminProfile.id])
    assert.ifError(currentTransactions.error)
    for (const transaction of currentTransactions.data || []) {
      if (!knownTransactionIds.has(transaction.id)) {
        assert.ifError((await service.from('credit_transactions').delete().eq('id', transaction.id)).error)
      }
    }
    assert.ifError((await service.from('profiles').update({ credits: standardProfile.credits }).eq('id', standardProfile.id)).error)
    assert.ifError((await service.from('profiles').update({ credits: adminProfile.credits }).eq('id', adminProfile.id)).error)
    assert.ifError((await service.from('profiles').update({
      first_name: standardProfile.first_name,
      last_name: standardProfile.last_name,
      phone: standardProfile.phone,
    }).eq('id', standardProfile.id)).error)

    const currentNotifications = await service.from('notifications').select('id')
    assert.ifError(currentNotifications.error)
    for (const notification of currentNotifications.data || []) {
      if (!knownNotificationIds.has(notification.id)) {
        assert.ifError((await service.from('notifications').delete().eq('id', notification.id)).error)
      }
    }
    const signOuts = await Promise.all([standard.auth.signOut(), admin.auth.signOut()])
    for (const signOut of signOuts) assert.ifError(signOut.error)
  }

  assert.deepEqual(new Set(positive), gapSignatures, 'cada brecha debe tener positive-auth')
  assert.equal(internalNegative.length, 15)

  const residualQueries = await Promise.all([
    service.from('buylist_orders').select('id', { count: 'exact', head: true }).in('id', buylistIds.length ? buylistIds : [missingUuid]),
    service.from('credit_transactions').select('id').in('user_id', [standardProfile.id, adminProfile.id]),
    service.from('import_orders').select('id', { count: 'exact', head: true }).like('user_notes', `%${marker}%`),
    service.from('notifications').select('id'),
    service.from('orders').select('id', { count: 'exact', head: true }).eq('payment_method', marker),
    service.from('profiles').select('id,credits,first_name,last_name,phone').in('id', [standardProfile.id, adminProfile.id]),
  ])
  for (const query of residualQueries) assert.ifError(query.error)
  const restoredStandard = residualQueries[5].data?.find((profile) => profile.id === standardProfile.id)
  const restoredAdmin = residualQueries[5].data?.find((profile) => profile.id === adminProfile.id)
  const profileDrift = Number(
    !restoredStandard
    || !restoredAdmin
    || Number(restoredStandard.credits || 0) !== Number(standardProfile.credits || 0)
    || restoredStandard.first_name !== standardProfile.first_name
    || restoredStandard.last_name !== standardProfile.last_name
    || restoredStandard.phone !== standardProfile.phone
    || Number(restoredAdmin.credits || 0) !== Number(adminProfile.credits || 0),
  )

  console.log(JSON.stringify({
    ok: true,
    catalogVerified,
    retainedSignatures: retainedProbes.map((probe) => probe.signature),
    anonDeniedSignatures,
    closedGapSignatures: [...gapSignatures],
    authorizationProofs: {
      positive: positive.length,
      internalNegative: internalNegative.length,
      internalNegativeNotApplicable: [
        'transfer_credits(text,numeric,text)',
        'update_profile_details(text,text,text)',
      ],
    },
    jwtGuardProofs,
    residuals: {
      buylistOrders: residualQueries[0].count ?? 0,
      creditTransactions: (residualQueries[1].data || []).filter((row) => !knownTransactionIds.has(row.id)).length,
      importOrders: residualQueries[2].count ?? 0,
      notifications: (residualQueries[3].data || []).filter((row) => !knownNotificationIds.has(row.id)).length,
      orders: residualQueries[4].count ?? 0,
      profileDrift,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
