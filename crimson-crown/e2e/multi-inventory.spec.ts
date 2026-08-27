import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const adminEmail = 'admin.local@example.test'
const adminPassword = 'CrimsonLocalAdmin!2026'
const standardEmail = 'tester.local@example.test'

const localAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

let fixture: {
  inventoryId: string
  inventoryName: string
  productId: string
  orderId: string
} | null = null

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(adminEmail)
  await page.locator('input[type="password"]').fill(adminPassword)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/$/)
}

async function unlockAdminPanel(page: Page) {
  await page.goto('/admin')
  const restricted = page.getByRole('heading', { name: 'Acceso Restringido' })
  const panel = page.getByRole('heading', { name: 'Panel de Administración' })
  await expect(restricted.or(panel)).toBeVisible()
  if (await restricted.isVisible()) {
    await page.locator('input[type="password"]').fill('1234')
    await page.getByRole('button', { name: 'Desbloquear Panel' }).click()
  }
  await expect(panel).toBeVisible()
}

test.beforeAll(async () => {
  const { data: primary, error: primaryError } = await localAdmin
    .from('inventories')
    .select('id')
    .eq('kind', 'primary')
    .single()
  if (primaryError || !primary) throw primaryError || new Error('No existe el inventario principal local.')

  const { data: sourceProduct, error: productError } = await localAdmin
    .from('products')
    .select('*')
    .eq('inventory_id', primary.id)
    .limit(1)
    .single()
  if (productError || !sourceProduct) throw productError || new Error('No existe un producto local para el fixture.')

  const inventoryName = `Playwright Origen ${Date.now()}`
  const { data: inventory, error: inventoryError } = await localAdmin
    .from('inventories')
    .insert({ name: inventoryName, description: 'Fixture E2E local', kind: 'secondary', is_active: true })
    .select('id, name')
    .single()
  if (inventoryError || !inventory) throw inventoryError || new Error('No se pudo crear el inventario fixture.')

  const { id: _productId, created_at: _createdAt, inventory_id: _inventoryId, variant_key: _variantKey, ...productCopy } = sourceProduct as any
  const { data: clonedProduct, error: cloneError } = await localAdmin
    .from('products')
    .insert({
      ...productCopy,
      inventory_id: inventory.id,
      stock: 2,
      is_manual_price: false,
    })
    .select('id')
    .single()
  if (cloneError || !clonedProduct) throw cloneError || new Error('No se pudo clonar el producto fixture.')

  const { data: profile, error: profileError } = await localAdmin
    .from('profiles')
    .select('id')
    .eq('email', standardEmail)
    .single()
  if (profileError || !profile) throw profileError || new Error('No existe el usuario estándar local.')

  const unitPrice = Number(sourceProduct.price_usd || 1)
  const { data: order, error: orderError } = await localAdmin
    .from('orders')
    .insert({
      user_id: profile.id,
      status: 'pending_payment',
      total_amount: unitPrice * 2,
      credits_used: 0,
      discount_amount: 0,
      delivery_method: 'pickup',
      contact_name: 'Playwright',
      contact_lastname: 'Fixture',
      contact_phone: '0000000000',
    })
    .select('id')
    .single()
  if (orderError || !order) throw orderError || new Error('No se pudo crear la orden fixture.')

  const { error: itemError } = await localAdmin
    .from('order_items')
    .insert({
      order_id: order.id,
      product_id: clonedProduct.id,
      quantity: 2,
      price_at_purchase: unitPrice,
      inventory_id: inventory.id,
      variant_key: sourceProduct.variant_key,
      source_inventory_name: inventory.name,
    })
  if (itemError) throw itemError

  fixture = { inventoryId: inventory.id, inventoryName: inventory.name, productId: clonedProduct.id, orderId: order.id }
})

test.afterAll(async () => {
  if (!fixture) return
  await localAdmin.from('inventory_stock_movements').delete().eq('inventory_id', fixture.inventoryId)
  await localAdmin.from('order_items').delete().eq('order_id', fixture.orderId)
  await localAdmin.from('orders').delete().eq('id', fixture.orderId)
  await localAdmin.from('products').delete().eq('id', fixture.productId)
  await localAdmin.from('inventories').delete().eq('id', fixture.inventoryId)
})

test('admin puede crear, pausar, reactivar y eliminar un inventario secundario vacío', async ({ page }) => {
  const inventoryName = `Playwright Gestión ${Date.now()}`
  await loginAsAdmin(page)
  await unlockAdminPanel(page)
  await page.goto('/admin/inventories')

  await page.getByRole('button', { name: 'Nuevo inventario' }).click()
  await page.getByLabel('Nombre').fill(inventoryName)
  await page.getByLabel('Descripción').fill('Prueba de gestión del inventario')
  await page.getByLabel('Ubicación física').fill('Estante E2E')
  await page.getByRole('button', { name: 'Crear inventario' }).click()

  const row = page.locator(`[data-inventory-name="${inventoryName}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Activo')

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: 'Desactivar' }).click()
  await expect(row).toContainText('Inactivo')

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: 'Activar' }).click()
  await expect(row).toContainText('Activo')

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: `Archivar ${inventoryName}` }).click()
  await expect(row).toContainText('Archivado')

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: `Eliminar ${inventoryName}` }).click()
  await expect(page.locator(`[data-inventory-name="${inventoryName}"]`)).toHaveCount(0)
})

test('la orden muestra el inventario de origen y la eliminación parcial lo conserva', async ({ page }) => {
  if (!fixture) throw new Error('Fixture E2E no inicializado.')
  await loginAsAdmin(page)
  await unlockAdminPanel(page)
  await page.goto(`/admin/orders/${fixture.orderId}`)

  await expect(page.getByRole('heading', { name: new RegExp(`Orden #${fixture.orderId.slice(0, 8)}`) })).toBeVisible()
  await expect(page.getByText(fixture.inventoryName, { exact: true })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Quitar 1' }).click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(fixture.inventoryName, { exact: true })).toBeVisible()
  await expect(page.getByText(/^1 x US\$/)).toBeVisible()
})
