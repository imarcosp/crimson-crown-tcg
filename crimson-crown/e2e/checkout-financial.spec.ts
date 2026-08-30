import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const standardEmail = 'tester.local@example.test'
const standardPassword = 'CrimsonLocalTester!2026'

if (!localUrl || !serviceRoleKey) throw new Error('El checkout E2E requiere Supabase local.')
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(new URL(localUrl).hostname)) {
  throw new Error('El checkout E2E sólo puede ejecutarse contra Supabase local.')
}

function serviceClient(): SupabaseClient {
  return createClient(localUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loginAsStandard(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(standardEmail)
  await page.locator('input[type="password"]').fill(standardPassword)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/$/)
}

test.describe('checkout financiero local', () => {
  test.describe.configure({ mode: 'serial' })

  let admin: SupabaseClient
  let profileId: string
  let productId: string
  let productName: string
  let originalStock: number
  let orderId: string | null = null

  test.beforeAll(async () => {
    admin = serviceClient()

    const profile = await admin.from('profiles').select('id').eq('email', standardEmail).single()
    if (profile.error || !profile.data) throw new Error(`No se encontró perfil estándar local: ${profile.error?.message || 'sin perfil'}`)
    profileId = profile.data.id

    const product = await admin
      .from('products')
      .select('id,name,stock')
      .gt('stock', 1)
      .order('stock', { ascending: false })
      .limit(1)
      .single()
    if (product.error || !product.data) throw new Error(`No se encontró producto para checkout: ${product.error?.message || 'sin producto'}`)
    productId = product.data.id
    productName = product.data.name
    originalStock = Number(product.data.stock || 0)

    await admin.from('cart_items').delete().eq('user_id', profileId)
    const cart = await admin.from('cart_items').insert({ user_id: profileId, product_id: productId, quantity: 1 })
    if (cart.error) throw new Error(`No se pudo preparar carrito local: ${cart.error.message}`)
  })

  test.afterAll(async () => {
    if (orderId) {
      const movementCleanup = await admin.from('inventory_stock_movements').delete().eq('order_id', orderId)
      if (movementCleanup.error) throw new Error(`No se pudo limpiar el movimiento del checkout E2E: ${movementCleanup.error.message}`)
      await admin.from('order_items').delete().eq('order_id', orderId)
      await admin.from('orders').delete().eq('id', orderId)
    }
    await admin.from('cart_items').delete().eq('user_id', profileId)
    const restore = await admin.from('products').update({ stock: originalStock }).eq('id', productId)
    if (restore.error) throw new Error(`No se pudo restaurar stock del checkout E2E: ${restore.error.message}`)
  })

  test('crea una orden local, descuenta stock una vez y conserva la nota de entrega', async ({ page }) => {
    await loginAsStandard(page)
    await page.goto('/')

    const cartButton = page.locator('button:has(svg.lucide-shopping-cart):visible').first()
    await expect(cartButton).toBeVisible()
    await cartButton.click()

    await expect(page.getByRole('heading', { name: 'Tu Compra' })).toBeVisible()
    await expect(page.getByText(productName, { exact: true })).toBeVisible()

    await page.getByPlaceholder('Nombre').fill('Local')
    await page.getByPlaceholder('Apellido').fill('Checkout')
    await page.getByPlaceholder('Teléfono / WhatsApp').fill('+5491100000001')
    await page.getByText('Retiro', { exact: true }).click()
    await page.getByRole('button', { name: 'CONTINUAR' }).click()

    await page.getByText('Efectivo', { exact: true }).click()
    await page.getByRole('button', { name: 'CONFIRMAR COMPRA' }).click()
    await page.waitForURL(/\/checkout\/success\/[0-9a-f-]+$/)

    orderId = new URL(page.url()).pathname.split('/').pop() || null
    expect(orderId).toBeTruthy()

    const order = await admin
      .from('orders')
      .select('status,total_amount,credits_used,delivery_method,delivery_notes,contact_name,contact_lastname,contact_phone')
      .eq('id', orderId!)
      .single()
    expect(order.error).toBeNull()
    expect(order.data?.status).toBe('pending_payment')
    expect(Number(order.data?.credits_used || 0)).toBe(0)
    expect(order.data?.delivery_method).toContain('pickup [Pago: Efectivo]')
    expect(order.data?.delivery_notes).toContain('Entrega: Retiro en Tienda (Almagro)')
    expect(order.data?.delivery_notes).toContain('Contacto: Local Checkout (+5491100000001)')
    expect(order.data?.contact_name).toBe('Local')
    expect(order.data?.contact_lastname).toBe('Checkout')

    const item = await admin.from('order_items').select('product_id,quantity,price_at_purchase').eq('order_id', orderId!).single()
    expect(item.error).toBeNull()
    expect(item.data?.product_id).toBe(productId)
    expect(item.data?.quantity).toBe(1)

    const product = await admin.from('products').select('stock').eq('id', productId).single()
    expect(product.error).toBeNull()
    expect(Number(product.data?.stock)).toBe(originalStock - 1)
  })
})
