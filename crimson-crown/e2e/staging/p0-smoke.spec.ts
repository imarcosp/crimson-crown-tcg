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
  importId: '900000000000000001',
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
  const uploadError = error as (typeof error & { status?: number; statusCode?: string | number }) | null
  expect({ name: uploadError?.name, status: uploadError?.status, statusCode: String(uploadError?.statusCode) },
    `direct ${bucket} upload must be denied with the exact Storage error`).toEqual({
    name: 'StorageApiError', status: 403, statusCode: '403',
  })
  const missing = await service.storage.from(bucket).info(path)
  expect(missing.data).toBeNull()
  const missingError = missing.error as (typeof missing.error & { status?: number; statusCode?: string | number }) | null
  expect(missingError?.name).toBe('StorageApiError')
  expect([400, 404]).toContain(missingError?.status)
  expect(String(missingError?.statusCode)).toBe('404')
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
  let buyerId = ''
  let operatorId = ''
  let baseline: {
    order: Record<string, unknown>
    importOrder: Record<string, unknown>
    profile: Record<string, unknown>
  } | null = null

  test.beforeAll(async () => {
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
    expect(users.error).toBeNull()
    const buyer = users.data.users.find(user => user.email === USERS.buyer)
    expect(buyer?.id).toBeTruthy()
    buyerId = buyer!.id
    const operator = users.data.users.find(user => user.email === USERS.operator)
    expect(operator?.id).toBeTruthy()
    operatorId = operator!.id
    const [order, importOrder, profile] = await Promise.all([
      service.from('orders').select('status,payment_proof_path,payment_proof_url').eq('id', FIXTURE.orderId).eq('user_id', buyerId).single(),
      service.from('import_orders').select('status,payment_status,payment_proof_path,payment_proof_url,credits_used').eq('id', FIXTURE.importId).eq('user_id', buyerId).single(),
      service.from('profiles').select('credits').eq('id', buyerId).eq('email', USERS.buyer).single(),
    ])
    expect(order.error).toBeNull()
    expect(importOrder.error).toBeNull()
    expect(profile.error).toBeNull()
    baseline = { order: order.data!, importOrder: importOrder.data!, profile: profile.data! }
  })

  test.afterAll(async () => {
    const [currentOrder, currentImport, paymentRows, bannerRows, productRows] = await Promise.all([
      service.from('orders').select('payment_proof_path').eq('id', FIXTURE.orderId).eq('user_id', buyerId).single(),
      service.from('import_orders').select('payment_proof_path').eq('id', FIXTURE.importId).eq('user_id', buyerId).single(),
      service.from('commission_payments').select('id,proof_path,reported_by_user_id').eq('reference', RUN),
      service.from('banners').select('id,image_url').eq('title', RUN),
      service.from('products').select('id,image_url,metadata').eq('name', RUN).eq('inventory_id', FIXTURE.inventoryId),
    ])
    for (const result of [currentOrder, currentImport, paymentRows, bannerRows, productRows]) expect(result.error).toBeNull()
    expect((paymentRows.data ?? []).length).toBeLessThanOrEqual(1)
    expect((bannerRows.data ?? []).length).toBeLessThanOrEqual(1)
    expect((productRows.data ?? []).length).toBeLessThanOrEqual(1)
    const addChangedProof = (path: unknown, original: unknown, pattern: RegExp) => {
      if (!path || path === original) return
      expect(String(path)).toMatch(pattern)
      transientObjects.add(`payment_proofs:${String(path)}`)
    }
    addChangedProof(currentOrder.data?.payment_proof_path, baseline?.order.payment_proof_path,
      new RegExp(`^orders/${buyerId}/${FIXTURE.orderId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp)$`))
    addChangedProof(currentImport.data?.payment_proof_path, baseline?.importOrder.payment_proof_path,
      new RegExp(`^imports/${buyerId}/${FIXTURE.importId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    for (const payment of paymentRows.data ?? []) {
      expect(payment.reported_by_user_id).toBe(operatorId)
      addChangedProof(payment.proof_path, null,
        new RegExp(`^commissions/[0-9a-f-]{36}/${operatorId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    }
    for (const banner of bannerRows.data ?? []) {
      const path = String(banner.image_url ?? '').split('/storage/v1/object/public/banners/')[1]
      expect(path).toBeTruthy(); transientObjects.add(`banners:${path}`)
    }
    for (const product of productRows.data ?? []) {
      const paths = [product.image_url, ...(product.metadata?.gallery ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.includes('/'))
        .map(value => value.includes('/storage/v1/object/public/products/') ? value.split('/storage/v1/object/public/products/')[1] : value)
      paths.forEach(path => transientObjects.add(`products:${path}`))
    }
    if (baseline) {
      const restoredOrder = await service.from('orders').update(baseline.order).eq('id', FIXTURE.orderId).eq('user_id', buyerId).select('id')
      const restoredImport = await service.from('import_orders').update(baseline.importOrder).eq('id', FIXTURE.importId).eq('user_id', buyerId).select('id')
      const restoredProfile = await service.from('profiles').update(baseline.profile).eq('id', buyerId).eq('email', USERS.buyer).select('id')
      expect(restoredOrder.error).toBeNull(); expect(restoredOrder.data).toHaveLength(1)
      expect(restoredImport.error).toBeNull(); expect(restoredImport.data).toHaveLength(1)
      expect(restoredProfile.error).toBeNull(); expect(restoredProfile.data).toHaveLength(1)
    }
    for (const item of transientObjects) {
      const separator = item.indexOf(':')
      const bucket = item.slice(0, separator)
      const path = item.slice(separator + 1)
      const removed = await service.storage.from(bucket).remove([path])
      expect(removed.error).toBeNull()
      expect(removed.data).toHaveLength(1)
    }
    // Only rows bearing this run's exact marker are eligible for cleanup.
    const payments = await service.from('commission_payments').delete().eq('reference', RUN).select('id')
    const banners = await service.from('banners').delete().eq('title', RUN).select('id')
    const products = await service.from('products').delete().eq('name', RUN).eq('inventory_id', FIXTURE.inventoryId).select('id')
    expect(payments.error).toBeNull(); expect(payments.data).toHaveLength(paymentRows.data?.length ?? 0)
    expect(banners.error).toBeNull(); expect(banners.data).toHaveLength(bannerRows.data?.length ?? 0)
    expect(products.error).toBeNull(); expect(products.data).toHaveLength(productRows.data?.length ?? 0)
  })

  test('anonymous catalog and banners are public while admin is denied', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Synthetic Staging Card')).toBeVisible()
    const bannerPath = 'codex-staging-p0/banner.png'
    const banner = await service.storage.from('banners').info(bannerPath)
    expect(banner.error).toBeNull()
    const publicBanner = service.storage.from('banners').getPublicUrl(bannerPath).data.publicUrl
    const response = await page.request.get(publicBanner)
    expect(response.status()).toBe(200)
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
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^orders/${buyerId}/${FIXTURE.orderId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp)$`))
    expect(after.data?.payment_proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${after.data!.payment_proof_path}`)
    await page.getByRole('button', { name: /ver comprobante/i }).click()
    const frame = page.locator('iframe[title="Comprobante"]')
    assertSignedUrl(await frame.getAttribute('src') ?? '', 'payment_proofs', after.data!.payment_proof_path)
    expect(before.data).toEqual(expect.objectContaining({ payment_proof_path: baseline!.order.payment_proof_path }))
  })

  test('buyer can open own import and cross-user access is denied', async ({ page }) => {
    await login(page, USERS.buyer)
    await page.goto(`/profile/imports/${FIXTURE.importId}`)
    await expect(page.getByText(String(FIXTURE.importId), { exact: false })).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}-import.png`, mimeType: 'image/png', buffer: PNG })
    await expect(page.getByText(/verificando pago/i)).toBeVisible()
    const after = await service.from('import_orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.importId).single()
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^imports/${buyerId}/${FIXTURE.importId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    expect(after.data?.payment_proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${after.data!.payment_proof_path}`)
    await page.context().clearCookies()
    await login(page, USERS.operator)
    await page.goto(`/profile/imports/${FIXTURE.importId}`)
    await expect(page.getByText(/no encontrado|sin acceso|no autorizado/i)).toBeVisible()
    const operator = await roleClient(USERS.operator)
    const denied = await operator.from('import_orders').select('id').eq('id', FIXTURE.importId)
    expect(denied.data ?? []).toHaveLength(0)
  })

  test('admin media uploads preserve inventory and direct browser-role uploads remain denied', async ({ page }) => {
    const productBaseline = await service.from('products').select('stock,inventory_id').eq('id', FIXTURE.productId).single()
    expect(productBaseline.data?.inventory_id).toBe(FIXTURE.inventoryId)
    expect(productBaseline.data?.stock).toBe(10)
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

    const current = await service.from('products').select('stock,inventory_id').eq('id', FIXTURE.productId).single()
    expect(current.data?.stock).toBe(productBaseline.data?.stock)
    expect(current.data?.inventory_id).toBe(FIXTURE.inventoryId)
  })

  test('operator reports commission proof and store owner/admin obtains signed read', async ({ page }) => {
    await login(page, USERS.operator)
    await page.goto('/admin/commissions')
    await expect(page.getByRole('heading', { name: /registrar pago/i })).toBeVisible()
    await page.locator('label', { hasText: /^Monto$/ }).locator('xpath=following-sibling::input').fill('1')
    await page.locator('label', { hasText: /cómo se realizó el pago/i }).locator('xpath=following-sibling::input').fill('synthetic')
    await page.locator('label', { hasText: /^Referencia$/ }).locator('xpath=following-sibling::input').fill(RUN)
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}.png`, mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: /^registrar pago$/i }).click()
    const payment = await service.from('commission_payments').select('proof_path,proof_url,reported_by_user_id').eq('reference', RUN).single()
    expect(payment.error).toBeNull()
    expect(payment.data?.reported_by_user_id).toBe(operatorId)
    expect(payment.data?.proof_path).toMatch(new RegExp(`^commissions/[0-9a-f-]{36}/${operatorId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    expect(payment.data?.proof_url ?? null).toBeNull()
    transientObjects.add(`payment_proofs:${payment.data!.proof_path}`)
    await page.context().clearCookies()
    await login(page, USERS.admin)
    await page.goto('/admin/commissions')
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: /ver comprobante/i }).last().click()
    const proofPage = await popupPromise
    await proofPage.waitForURL(url => url.toString().includes('/storage/v1/object/sign/'))
    assertSignedUrl(proofPage.url(), 'payment_proofs', payment.data!.proof_path)
  })

  test('anon, buyer, operator and admin cannot bypass signed uploads', async () => {
    const roles: Array<[string, SupabaseClient]> = [
      ['anon', createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })],
    ]
    for (const email of Object.values(USERS)) roles.push([email, await roleClient(email)])
    for (const [role, client] of roles) {
      for (const bucket of ['products', 'banners', 'payment_proofs']) {
        await expectDirectUploadDenied(client, bucket, `${RUN}/${role}/${bucket}.png`)
      }
    }
  })
})
