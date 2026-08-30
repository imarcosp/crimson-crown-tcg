import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const standardEmail = 'tester.local@example.test'
const standardPassword = 'CrimsonLocalTester!2026'

if (!localUrl || !serviceRoleKey) {
  throw new Error('Las pruebas de cuenta requieren las credenciales de Supabase local.')
}

const localHost = new URL(localUrl).hostname
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(localHost)) {
  throw new Error('Las pruebas de cuenta sólo pueden ejecutarse contra Supabase local.')
}

type Fixture = {
  product: {
    id: string
    name: string
    set_name: string | null
    collector_number: string | null
    image_url: string | null
    inventory_id: string
    variant_key: string
  }
  orderId: string
  orderItemId: string
  importOrderId: string
  importOrderNumber: string
  importCardName: string
  importItemId: number
  buylistId: string
  buylistItemId: string
  buylistCardName: string
}

function serviceClient(): SupabaseClient {
  return createClient(localUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function cleanupOrphanedFixtures() {
  const admin = serviceClient()

  const { data: orders } = await admin
    .from('orders')
    .select('id')
    .like('payment_method', 'LOCAL-E2E-%')
  const orderIds = (orders || []).map((row) => row.id)
  if (orderIds.length) {
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('orders').delete().in('id', orderIds)
  }

  const { data: imports } = await admin
    .from('import_orders')
    .select('id')
    .like('user_notes', 'LOCAL-E2E-%')
  const importIds = (imports || []).map((row) => row.id)
  if (importIds.length) {
    await admin.from('import_items').delete().in('order_id', importIds)
    await admin.from('import_orders').delete().in('id', importIds)
  }
}

async function createFixture(): Promise<Fixture> {
  const admin = serviceClient()
  await cleanupOrphanedFixtures()
  const marker = `LOCAL-E2E-${Date.now()}`

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', standardEmail)
    .single()
  if (profileError || !profile?.id) throw new Error(`No se encontró el perfil estándar local: ${profileError?.message || 'sin perfil'}`)

  const { data: product, error: productError } = await admin
    .from('products')
    .select('id, name, set_name, collector_number, image_url, inventory_id, variant_key')
    .limit(1)
    .single()
  if (productError || !product?.id) throw new Error(`No se encontró un producto local para el fixture: ${productError?.message || 'sin producto'}`)

  const { data: inventory, error: inventoryError } = await admin
    .from('inventories')
    .select('name')
    .eq('id', product.inventory_id)
    .single()
  if (inventoryError || !inventory?.name) throw new Error(`No se encontró el inventario del fixture: ${inventoryError?.message || 'sin inventario'}`)

  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      user_id: profile.id,
      status: 'pending_payment',
      total_amount: 42,
      payment_method: `${marker}-order`,
    })
    .select('id')
    .single()
  if (orderError || !order?.id) throw new Error(`No se pudo crear fixture de orden: ${orderError?.message || 'sin id'}`)

  const { data: orderItem, error: orderItemError } = await admin
    .from('order_items')
    .insert({
      order_id: order.id,
      product_id: product.id,
      quantity: 1,
      price_at_purchase: 42,
      inventory_id: product.inventory_id,
      variant_key: product.variant_key,
      source_inventory_name: inventory.name,
    })
    .select('id')
    .single()
  if (orderItemError || !orderItem?.id) throw new Error(`No se pudo crear item de orden: ${orderItemError?.message || 'sin id'}`)

  const { data: importOrder, error: importOrderError } = await admin
    .from('import_orders')
    .insert({ user_id: profile.id, status: 'Iniciada', user_notes: marker })
    .select('id, order_number')
    .single()
  if (importOrderError || !importOrder?.id) throw new Error(`No se pudo crear fixture de importación: ${importOrderError?.message || 'sin id'}`)

  const { data: importItem, error: importItemError } = await admin
    .from('import_items')
    .insert({
      order_id: importOrder.id,
      product_name: `${marker} Import Card`,
      set_name: product.set_name,
      product_url: null,
      collector_number: product.collector_number,
      image_url: product.image_url,
      quantity: 1,
      platform: 'Manapool',
      unit_price: 0,
      tax_percent: 0,
      shipping_cost: 0,
      suggested_price: 12.34,
      is_available: false,
      is_delivered: false,
    })
    .select('id')
    .single()
  if (importItemError || !importItem?.id) throw new Error(`No se pudo crear item de importación: ${importItemError?.message || 'sin id'}`)

  const buylistCardName = `${marker} Buylist Card`
  const { data: buylist, error: buylistError } = await admin
    .from('buylist_orders')
    .insert({ user_id: profile.id, status: 'pending_review', total_offered: 8.5 })
    .select('id')
    .single()
  if (buylistError || !buylist?.id) throw new Error(`No se pudo crear fixture de buylist: ${buylistError?.message || 'sin id'}`)

  const { data: buylistItem, error: buylistItemError } = await admin
    .from('buylist_items')
    .insert({
      buylist_id: buylist.id,
      product_id: product.id,
      quantity: 1,
      offered_price_unit: 8.5,
      condition: 'NM',
      is_foil: false,
      card_name: buylistCardName,
      set_name: product.set_name,
      image_url: product.image_url,
      collector_number: product.collector_number,
    })
    .select('id')
    .single()
  if (buylistItemError || !buylistItem?.id) throw new Error(`No se pudo crear item de buylist: ${buylistItemError?.message || 'sin id'}`)

  return {
    product,
    orderId: order.id,
    orderItemId: orderItem.id,
    importOrderId: importOrder.id,
    importOrderNumber: String(importOrder.order_number),
    importCardName: `${marker} Import Card`,
    importItemId: importItem.id,
    buylistId: buylist.id,
    buylistItemId: buylistItem.id,
    buylistCardName,
  }
}

async function cleanupFixture(fixture: Fixture) {
  const admin = serviceClient()
  // Child rows must be removed before their parent. Running these in parallel can
  // race the import-item guard while the parent order is being deleted.
  const operations = [
    ['buylist item', () => admin.from('buylist_items').delete().eq('id', fixture.buylistItemId)] as const,
    ['buylist', () => admin.from('buylist_orders').delete().eq('id', fixture.buylistId)] as const,
    ['import item', () => admin.from('import_items').delete().eq('id', fixture.importItemId)] as const,
    ['import order', () => admin.from('import_orders').delete().eq('id', fixture.importOrderId)] as const,
    ['order item', () => admin.from('order_items').delete().eq('id', fixture.orderItemId)] as const,
    ['order', () => admin.from('orders').delete().eq('id', fixture.orderId)] as const,
  ]
  for (const [label, operation] of operations) {
    const { error } = await operation()
    if (error) throw new Error(`No se pudo limpiar fixture E2E (${label}): ${error.message}`)
  }
}

async function loginAsStandard(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(standardEmail)
  await page.locator('input[type="password"]').fill(standardPassword)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/$/)
}

test.describe('flujos autenticados de cuenta', () => {
  test.describe.configure({ mode: 'serial' })

  let fixture: Fixture

  test.beforeAll(async () => {
    fixture = await createFixture()
  })

  test.afterAll(async () => {
    if (fixture) await cleanupFixture(fixture)
    await cleanupOrphanedFixtures()
  })

  test('usuario ve su orden de compra con el detalle del producto', async ({ page }) => {
    await loginAsStandard(page)
    await page.goto('/profile?tab=stock')

    await expect(page.getByRole('heading', { name: 'Mi Cuenta' })).toBeVisible()
    const orderCard = page
      .getByText(fixture.orderId.slice(0, 8), { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
    await expect(orderCard).toBeVisible()
    await expect(orderCard.getByText('USD $42.00', { exact: true })).toBeVisible()
    await expect(orderCard.getByText(fixture.product.name, { exact: true })).toBeVisible()
    await expect(orderCard.getByRole('heading', { name: 'Datos para el Pago' })).toBeVisible()
  })

  test('usuario abre el detalle de su pedido de importación', async ({ page }) => {
    await loginAsStandard(page)
    await page.goto('/profile?tab=imports')

    await expect(page.getByRole('button', { name: 'Pedidos Exterior' })).toHaveClass(/border-b-2/)
    await expect(page.getByText(fixture.importOrderNumber, { exact: true })).toBeVisible()
    await expect(page.getByText('Iniciada', { exact: true })).toBeVisible()

    const importLink = page.getByRole('link', { name: new RegExp(fixture.importOrderNumber) })
    await expect(importLink).toHaveAttribute('href', `/profile/imports/${fixture.importOrderId}`)
    await importLink.click()
    await expect(page).toHaveURL(new RegExp(`/profile/imports/${fixture.importOrderId}$`))
    await expect(page.getByRole('heading', { name: `Orden #${fixture.importOrderNumber}` })).toBeVisible()
    await expect(page.getByText('Orden en preparación')).toBeVisible()
    await expect(page.getByText(fixture.importCardName, { exact: true })).toBeVisible()
  })

  test('usuario ve el detalle de su solicitud de buylist', async ({ page }) => {
    await loginAsStandard(page)
    await page.goto('/profile?tab=quotes')

    const orderCard = page
      .getByText(fixture.buylistId.slice(0, 8), { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
    await expect(orderCard).toBeVisible()
    await expect(orderCard.getByText('$8.50', { exact: true })).toBeVisible()
    await orderCard.getByRole('button', { name: /Cartas enviadas/ }).click()
    await expect(orderCard.getByText(fixture.buylistCardName, { exact: true })).toBeVisible()
    await expect(orderCard.getByText('Compra:', { exact: false })).toBeVisible()
  })
})
