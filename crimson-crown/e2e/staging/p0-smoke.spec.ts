import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const USERS = {
  admin: 'admin.crimson.staging@example.test',
  buyer: 'buyer.crimson.staging@example.test',
  operator: 'operator.crimson.staging@example.test',
} as const
const FIXTURE = {
  inventoryId: 'c0de0001-0000-4000-8000-000000000001',
  productId: 'c0de0001-0000-4000-8000-000000000002',
  orderId: 'c0de0001-0000-4000-8000-000000000003',
  importId: 900000000000000001,
} as const
const RUN = `codex-staging-p0:playwright:${Date.now()}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing staging-only variable: ${name}`)
  return value
}

const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL')
const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
const fixturePassword = required('CRIMSON_STAGING_FIXTURE_PASSWORD')
const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

async function login(page: Page, email: string) {
  expect(email.endsWith('@example.test')).toBe(true)
  await page.goto('/login')
  await page.getByLabel(/correo|email/i).fill(email)
  await page.getByLabel(/contraseña|password/i).fill(fixturePassword)
  await page.getByRole('button', { name: /ingresar|iniciar sesión/i }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function unlockAdmin(page: Page) {
  const unlock = page.getByRole('button', { name: /desbloquear panel/i })
  if (await unlock.isVisible().catch(() => false)) {
    await page.locator('input[type=password]').fill('1234')
    await unlock.click()
  }
}

async function roleClient(email: string): Promise<SupabaseClient> {
  expect(email.endsWith('@example.test')).toBe(true)
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: fixturePassword })
  expect(error).toBeNull()
  return client
}

async function expectDirectUploadDenied(client: SupabaseClient, bucket: string, path: string) {
  const { error } = await client.storage.from(bucket).upload(path, PNG, { contentType: 'image/png' })
  expect(error, `direct ${bucket} upload must be denied`).not.toBeNull()
  await service.storage.from(bucket).remove([path])
}

function assertSignedUrl(url: string, bucket: string, expectedPath: string) {
  const parsed = new URL(url)
  expect(decodeURIComponent(parsed.pathname)).toContain(`/object/sign/${bucket}/${expectedPath}`)
  const token = parsed.searchParams.get('token')
  expect(token).toBeTruthy()
  const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8')) as { exp: number; iat: number }
  expect(payload.exp - payload.iat).toBe(300)
}

test.describe.serial('Crimson Crown P0 staging smoke', () => {
  const transientObjects = new Set<string>()

  test.afterAll(async () => {
    for (const item of transientObjects) {
      const separator = item.indexOf(':')
      const bucket = item.slice(0, separator)
      const path = item.slice(separator + 1)
      await service.storage.from(bucket).remove([path])
    }
    // Only rows bearing this run's exact marker are eligible for cleanup.
    await service.from('commission_payments').delete().eq('reference', RUN)
    await service.from('banners').delete().eq('title', RUN)
    await service.from('products').delete().eq('name', RUN)
  })

  test('anonymous catalog and banners are public while admin is denied', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Synthetic Staging Card')).toBeVisible()
    await expect(page.locator('img').first()).toBeVisible()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login|\/admin\/pin/)
  })

  test('buyer sees only own profile and seeded order', async ({ page }) => {
    await login(page, USERS.buyer)
    await page.goto('/profile?tab=stock')
    await expect(page.getByText(USERS.buyer)).toBeVisible()
    await expect(page.getByText(FIXTURE.orderId.slice(0, 8), { exact: false })).toBeVisible()
    const buyer = await roleClient(USERS.buyer)
    const own = await buyer.from('orders').select('id,user_id').eq('id', FIXTURE.orderId).single()
    expect(own.error).toBeNull()
    const strangers = await buyer.from('orders').select('id').neq('id', FIXTURE.orderId)
    expect(strangers.data ?? []).toHaveLength(0)
  })

  test('stock proof uses signed ticket, finalizes a path, and signed read lasts 300 seconds', async ({ page }) => {
    const before = await service.from('orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.orderId).single()
    expect(before.error).toBeNull()
    await login(page, USERS.buyer)
    await page.goto('/profile?tab=stock')
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}.png`, mimeType: 'image/png', buffer: PNG })
    await expect(page.getByText(/comprobante subido|revisaremos/i)).toBeVisible()
    const after = await service.from('orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.orderId).single()
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^orders/${FIXTURE.orderId}/`))
    expect(after.data?.payment_proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${after.data!.payment_proof_path}`)
    await page.getByRole('button', { name: /ver comprobante/i }).click()
    const frame = page.locator('iframe[title="Comprobante"]')
    assertSignedUrl(await frame.getAttribute('src') ?? '', 'payment_proofs', after.data!.payment_proof_path)
    await service.from('orders').update(before.data!).eq('id', FIXTURE.orderId)
  })

  test('buyer can open own import and cross-user access is denied', async ({ page }) => {
    const before = await service.from('import_orders').select('payment_proof_path,payment_proof_url,payment_status,status,credits_used,user_id').eq('id', FIXTURE.importId).single()
    expect(before.error).toBeNull()
    const profileBefore = await service.from('profiles').select('credits').eq('id', before.data!.user_id).single()
    await login(page, USERS.buyer)
    await page.goto(`/profile/imports/${FIXTURE.importId}`)
    await expect(page.getByText(String(FIXTURE.importId), { exact: false })).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}-import.png`, mimeType: 'image/png', buffer: PNG })
    await expect(page.getByText(/verificando pago/i)).toBeVisible()
    const after = await service.from('import_orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.importId).single()
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^imports/${FIXTURE.importId}/`))
    expect(after.data?.payment_proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${after.data!.payment_proof_path}`)
    await page.context().clearCookies()
    await login(page, USERS.operator)
    await page.goto(`/profile/imports/${FIXTURE.importId}`)
    await expect(page.getByText(/no encontrado|sin acceso|no autorizado/i)).toBeVisible()
    const operator = await roleClient(USERS.operator)
    const denied = await operator.from('import_orders').select('id').eq('id', FIXTURE.importId)
    expect(denied.data ?? []).toHaveLength(0)
    const { user_id: buyerId, ...importRestore } = before.data!
    await service.from('import_orders').update(importRestore).eq('id', FIXTURE.importId)
    await service.from('profiles').update(profileBefore.data!).eq('id', buyerId)
  })

  test('admin media uploads preserve inventory and direct browser-role uploads remain denied', async ({ page }) => {
    const baseline = await service.from('products').select('stock').eq('id', FIXTURE.productId).single()
    await login(page, USERS.admin)
    await page.goto(`/admin/inventory?inventory=${FIXTURE.inventoryId}`)
    await unlockAdmin(page)
    await expect(page.getByText('Synthetic Staging Card')).toBeVisible()
    await page.getByRole('button', { name: /nuevo producto/i }).click()
    await page.getByRole('button', { name: /otros tcg.*manual/i }).click()
    await page.locator('label', { hasText: /^Nombre$/ }).locator('xpath=following-sibling::input').fill(RUN)
    await page.locator('label', { hasText: /Precio \(USD\)/ }).locator('xpath=following-sibling::input').fill('1')
    await page.locator('label', { hasText: /^Stock$/ }).locator('xpath=following-sibling::input').fill('0')
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}-product.png`, mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: /guardar producto/i }).click()
    const product = await service.from('products').select('id,image_url,metadata').eq('name', RUN).single()
    expect(product.error).toBeNull()
    const productPaths = [product.data?.image_url, ...(product.data?.metadata?.gallery ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.includes('/'))
      .map(value => value.includes('/storage/v1/object/public/products/') ? value.split('/storage/v1/object/public/products/')[1] : value)
    productPaths.forEach(path => transientObjects.add(`products:${path}`))

    await page.goto('/admin/banners')
    await page.getByRole('button', { name: /nuevo banner/i }).click()
    await page.locator('label', { hasText: /título principal/i }).locator('xpath=following-sibling::input').fill(RUN)
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}-banner.png`, mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: /guardar cambios/i }).click()
    const banner = await service.from('banners').select('image_url').eq('title', RUN).single()
    expect(banner.error).toBeNull()
    const bannerPath = String(banner.data?.image_url ?? '').split('/storage/v1/object/public/banners/')[1]
    expect(bannerPath).toBeTruthy()
    transientObjects.add(`banners:${bannerPath}`)

    const current = await service.from('products').select('stock').eq('id', FIXTURE.productId).single()
    expect(current.data?.stock).toBe(baseline.data?.stock)
    const admin = await roleClient(USERS.admin)
    await expectDirectUploadDenied(admin, 'products', `products/${RUN}.png`)
    await expectDirectUploadDenied(admin, 'banners', `banners/${RUN}.png`)
  })

  test('operator reports commission proof and store owner/admin obtains signed read', async ({ page }) => {
    await login(page, USERS.operator)
    await page.goto('/admin/commissions')
    await expect(page.getByRole('heading', { name: /registrar pago/i })).toBeVisible()
    await page.getByLabel(/referencia/i).fill(RUN)
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}.png`, mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: /^registrar pago$/i }).click()
    const payment = await service.from('commission_payments').select('proof_path,proof_url').eq('reference', RUN).single()
    expect(payment.error).toBeNull()
    expect(payment.data?.proof_path).toMatch(/^commissions\//)
    expect(payment.data?.proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${payment.data!.proof_path}`)
    await page.context().clearCookies()
    await login(page, USERS.admin)
    await page.goto('/admin/commissions')
    const responsePromise = page.waitForResponse(response => response.url().includes('/storage/v1/object/sign/'))
    await page.getByRole('button', { name: /ver comprobante/i }).last().click()
    const signed = await responsePromise
    assertSignedUrl(signed.url(), 'payment_proofs', payment.data!.proof_path)
  })

  test('anon, buyer, operator and admin cannot bypass signed uploads', async () => {
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    await expectDirectUploadDenied(anon, 'payment_proofs', `orders/${FIXTURE.orderId}/${RUN}-anon.png`)
    for (const email of Object.values(USERS)) {
      const client = await roleClient(email)
      await expectDirectUploadDenied(client, 'payment_proofs', `orders/${FIXTURE.orderId}/${RUN}-${email}.png`)
    }
  })
})
