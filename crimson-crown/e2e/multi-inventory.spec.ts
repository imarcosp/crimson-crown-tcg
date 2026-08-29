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
  productName: string
  orderId: string
} | null = null

const manualProductMarker = `Playwright Producto Seguro ${Date.now()}`

let externalLibraryCard: {
  scryfall_id: string
  name: string
  set_name: string
  collector_number: string
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

  const { data: libraryCandidates, error: libraryError } = await localAdmin
    .from('external_prices')
    .select('scryfall_id, name, set_name, collector_number')
    .eq('name', 'The Rack')
    .order('scryfall_id', { ascending: true })
    .limit(20)
  if (libraryError || !libraryCandidates?.length) throw libraryError || new Error('No existe una carta de biblioteca para el fixture.')
  const selectedLibraryCard = libraryCandidates.find((card) => card.scryfall_id !== sourceProduct.scryfall_id)
  if (!selectedLibraryCard) throw new Error('La carta de biblioteca elegida ya existe en el producto de origen.')
  externalLibraryCard = selectedLibraryCard

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

  fixture = {
    inventoryId: inventory.id,
    inventoryName: inventory.name,
    productId: clonedProduct.id,
    productName: String(sourceProduct.name),
    orderId: order.id,
  }
})

test.afterAll(async () => {
  if (!fixture) return
  const { data: manualProducts } = await localAdmin
    .from('products')
    .select('id')
    .eq('inventory_id', fixture.inventoryId)
    .like('name', `${manualProductMarker}%`)
  const manualProductIds = (manualProducts || []).map((product) => product.id)
  if (manualProductIds.length > 0) {
    await localAdmin.from('inventory_stock_movements').delete().in('product_id', manualProductIds)
    await localAdmin.from('products').delete().in('id', manualProductIds)
  }
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

test('el buscador administrativo sugiere cartas de external_prices aunque no existan en products', async ({ page }) => {
  if (!fixture || !externalLibraryCard) throw new Error('Fixture E2E no inicializado.')
  await loginAsAdmin(page)
  await unlockAdminPanel(page)
  await page.goto(`/admin/inventory?inventory=${fixture.inventoryId}`)

  await page.getByRole('button', { name: 'Nuevo Producto' }).click()
  const search = page.getByPlaceholder('Ej: Sheoldred, The Apocalypse...')
  await search.fill(externalLibraryCard.name)

  const librarySuggestion = page
    .getByRole('button')
    .filter({ hasText: externalLibraryCard.name })
    .filter({ hasText: 'Biblioteca Magic' })
  await expect(librarySuggestion.first()).toBeVisible()
  await librarySuggestion.first().click()
  const productModal = page.locator('div.fixed.inset-0')
  await expect(productModal.locator('input').nth(1)).toHaveValue(externalLibraryCard.name)
  await productModal.locator('input[type="number"]').first().fill('10.50')
  await expect(page.getByText('MANUAL', { exact: true })).toBeVisible()
})

test('las mutaciones manuales conservan auditoría y reportan productos con historial', async ({ page }) => {
  if (!fixture) throw new Error('Fixture E2E no inicializado.')
  const editableName = `${manualProductMarker} Editable`
  const deletableName = `${manualProductMarker} Sin Historial`

  await loginAsAdmin(page)
  await unlockAdminPanel(page)
  await page.goto(`/admin/inventory?inventory=${fixture.inventoryId}`)

  const createManualProduct = async (name: string, stock: number) => {
    await page.getByRole('button', { name: 'Nuevo Producto' }).click()
    const modal = page.locator('div.fixed.inset-0').filter({ hasText: 'Cargar Producto' })
    await modal.getByRole('button', { name: /Otros TCG|Accesorios/ }).click()
    await modal.locator('label').filter({ hasText: /^Nombre$/ }).locator('..').locator('input').fill(name)
    await modal.locator('label').filter({ hasText: /^Set \/ Expansión$/ }).locator('..').locator('input').fill('Playwright Set')
    await modal.getByPlaceholder('Ej: Magic, Pokémon, Accesorios...').fill('Accesorios')
    const numericInputs = modal.locator('input[type="number"]')
    await numericInputs.nth(0).fill('10.50')
    await numericInputs.nth(1).fill(String(stock))
    await modal.getByRole('button', { name: 'Guardar Producto' }).click()
    await expect(modal).toBeHidden()
  }

  await createManualProduct(editableName, 2)
  await page.getByPlaceholder('Buscar...').fill(editableName)
  const editableRow = page.locator('tbody tr').filter({ hasText: editableName })
  await expect(editableRow).toBeVisible()

  const { data: editableProduct, error: editableError } = await localAdmin
    .from('products')
    .select('id,stock,inventory_id')
    .eq('inventory_id', fixture.inventoryId)
    .eq('name', editableName)
    .single()
  if (editableError || !editableProduct) throw editableError || new Error('No se creó el producto manual.')
  expect(Number(editableProduct.stock)).toBe(2)

  await editableRow.getByTitle('Editar').click()
  const editModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Editar Producto' })
  await editModal.locator('input[type="number"]').nth(1).fill('5')
  await editModal.getByRole('button', { name: 'Guardar Producto' }).click()
  await expect(editModal).toBeHidden()

  const { data: adjustmentMovements, error: adjustmentError } = await localAdmin
    .from('inventory_stock_movements')
    .select('quantity_delta,movement_type')
    .eq('product_id', editableProduct.id)
    .eq('movement_type', 'adjustment')
  if (adjustmentError) throw adjustmentError
  expect(adjustmentMovements).toEqual([{ quantity_delta: 3, movement_type: 'adjustment' }])

  await page.getByPlaceholder('Buscar...').fill(fixture.productName)
  const referencedRow = page.locator('tbody tr').filter({ hasText: fixture.productName }).first()
  await expect(referencedRow).toBeVisible()
  await referencedRow.getByTitle('Eliminar').click()
  await page.getByRole('button', { name: 'Sí, eliminar' }).click()
  await expect(page.getByText('No se eliminaron productos con historial.')).toBeVisible()
  await expect(referencedRow).toBeVisible()

  await page.getByPlaceholder('Buscar...').fill('')
  await createManualProduct(deletableName, 0)
  await page.getByText('Ver Sin Stock', { exact: true }).click()
  await page.getByPlaceholder('Buscar...').fill(deletableName)
  const deletableRow = page.locator('tbody tr').filter({ hasText: deletableName })
  await expect(deletableRow).toBeVisible()
  await deletableRow.getByTitle('Eliminar').click()
  await page.getByRole('button', { name: 'Sí, eliminar' }).click()
  await expect(deletableRow).toHaveCount(0)
})
