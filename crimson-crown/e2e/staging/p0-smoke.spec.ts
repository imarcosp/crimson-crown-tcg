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
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

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

async function captureSignedUpload(page: Page, bucket: string, expectedPath: RegExp, trigger: () => Promise<void>) {
  let resolvePath!: (path: string) => void
  let rejectPath!: (error: unknown) => void
  const captured = new Promise<string>((resolve, reject) => { resolvePath = resolve; rejectPath = reject })
  await page.route('**/storage/v1/object/upload/sign/**', async route => {
    try {
      const url = new URL(route.request().url())
      const prefix = `/storage/v1/object/upload/sign/${bucket}/`
      expect(url.pathname.startsWith(prefix)).toBe(true)
      const path = decodeURIComponent(url.pathname.slice(prefix.length))
      expect(path).toMatch(expectedPath)
      expect(url.searchParams.get('token')).toBeTruthy()
      resolvePath(path)
      await route.continue()
    } catch (error) {
      rejectPath(error)
      await route.abort()
    }
  }, { times: 1 })
  await trigger()
  return captured
}

function assertSignedUrl(url: string, bucket: string, expectedPath: string, nowMs = Date.now()) {
  const parsed = new URL(url)
  expect(decodeURIComponent(parsed.pathname)).toBe(`/storage/v1/object/sign/${bucket}/${expectedPath}`)
  const token = parsed.searchParams.get('token')
  expect(token).toBeTruthy()
  const payload = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8')) as { exp: number; iat: number }
  expect(payload.exp - payload.iat).toBe(300)
  expect(Math.abs(payload.iat - Math.floor(nowMs / 1000))).toBeLessThanOrEqual(30)
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
    const failures: string[] = []
    const attempt = async (label: string, operation: () => Promise<void>) => {
      try { await operation() } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const assertDeletedCount = (data: unknown[] | null, expected: number | null) => {
      if (expected === null) expect((data ?? []).length).toBeLessThanOrEqual(1)
      else expect(data).toHaveLength(expected)
    }
    let paymentCount: number | null = null
    let bannerCount: number | null = null
    let productCount: number | null = null
    const addChangedProof = (path: unknown, original: unknown, pattern: RegExp) => {
      if (!path || path === original) return
      expect(String(path)).toMatch(pattern)
      transientObjects.add(`payment_proofs:${String(path)}`)
    }
    await attempt('discover transient resources', async () => {
      const [currentOrder, currentImport, paymentRows, bannerRows, productRows] = await Promise.all([
        service.from('orders').select('payment_proof_path').eq('id', FIXTURE.orderId).eq('user_id', buyerId).single(),
        service.from('import_orders').select('payment_proof_path').eq('id', FIXTURE.importId).eq('user_id', buyerId).single(),
        service.from('commission_payments').select('id,proof_path,reported_by_user_id').eq('reference', RUN),
        service.from('banners').select('id,image_url').eq('title', RUN),
        service.from('products').select('id,image_url,metadata').eq('name', RUN).eq('inventory_id', FIXTURE.inventoryId),
      ])
      for (const result of [currentOrder, currentImport, paymentRows, bannerRows, productRows]) expect(result.error).toBeNull()
      paymentCount = (paymentRows.data ?? []).length; bannerCount = (bannerRows.data ?? []).length; productCount = (productRows.data ?? []).length
      expect(paymentCount).toBeLessThanOrEqual(1); expect(bannerCount).toBeLessThanOrEqual(1); expect(productCount).toBeLessThanOrEqual(1)
      addChangedProof(currentOrder.data?.payment_proof_path, baseline?.order.payment_proof_path,
        new RegExp(`^orders/${buyerId}/${FIXTURE.orderId}/${UUID}\\.(?:jpe?g|png|webp)$`))
      addChangedProof(currentImport.data?.payment_proof_path, baseline?.importOrder.payment_proof_path,
        new RegExp(`^imports/${buyerId}/${FIXTURE.importId}/${UUID}\\.(?:jpe?g|png|webp|pdf)$`))
      for (const payment of paymentRows.data ?? []) {
        expect(payment.reported_by_user_id).toBe(operatorId)
        addChangedProof(payment.proof_path, null, new RegExp(`^commissions/${UUID}/${operatorId}/${UUID}\\.(?:jpe?g|png|webp|pdf)$`))
      }
      for (const banner of bannerRows.data ?? []) {
        const path = String(banner.image_url ?? '').split('/storage/v1/object/public/banners/')[1]
        expect(path).toMatch(new RegExp(`^site/${UUID}\\.(?:jpe?g|png|webp)$`)); transientObjects.add(`banners:${path}`)
      }
      for (const product of productRows.data ?? []) {
        const paths = [product.image_url, ...(product.metadata?.gallery ?? [])]
          .filter((value): value is string => typeof value === 'string' && value.includes('/'))
          .map(value => value.includes('/storage/v1/object/public/products/') ? value.split('/storage/v1/object/public/products/')[1] : value)
        for (const path of paths) {
          expect(path).toMatch(new RegExp(`^catalog/${FIXTURE.inventoryId}/${UUID}\\.(?:jpe?g|png|webp)$`))
          transientObjects.add(`products:${path}`)
        }
      }
    })
    if (baseline) {
      await attempt('restore order', async () => { const result = await service.from('orders').update(baseline!.order).eq('id', FIXTURE.orderId).eq('user_id', buyerId).select('id'); expect(result.error).toBeNull(); expect(result.data).toHaveLength(1) })
      await attempt('restore import', async () => { const result = await service.from('import_orders').update(baseline!.importOrder).eq('id', FIXTURE.importId).eq('user_id', buyerId).select('id'); expect(result.error).toBeNull(); expect(result.data).toHaveLength(1) })
      await attempt('restore profile', async () => { const result = await service.from('profiles').update(baseline!.profile).eq('id', buyerId).eq('email', USERS.buyer).select('id'); expect(result.error).toBeNull(); expect(result.data).toHaveLength(1) })
    }
    for (const item of transientObjects) {
      const separator = item.indexOf(':')
      const bucket = item.slice(0, separator)
      const path = item.slice(separator + 1)
      await attempt(`remove ${bucket}/${path}`, async () => {
        const info = await service.storage.from(bucket).info(path)
        if (info.error) {
          const error = info.error as typeof info.error & { status?: number; statusCode?: string | number }
          expect(error.name).toBe('StorageApiError'); expect([400, 404]).toContain(error.status); expect(String(error.statusCode)).toBe('404')
          return
        }
        const removed = await service.storage.from(bucket).remove([path])
        expect(removed.error).toBeNull(); expect(removed.data).toHaveLength(1)
      })
    }
    await attempt('delete commission row', async () => { const result = await service.from('commission_payments').delete().eq('reference', RUN).select('id'); expect(result.error).toBeNull(); assertDeletedCount(result.data, paymentCount) })
    await attempt('delete banner row', async () => { const result = await service.from('banners').delete().eq('title', RUN).select('id'); expect(result.error).toBeNull(); assertDeletedCount(result.data, bannerCount) })
    await attempt('delete product row', async () => { const result = await service.from('products').delete().eq('name', RUN).eq('inventory_id', FIXTURE.inventoryId).select('id'); expect(result.error).toBeNull(); assertDeletedCount(result.data, productCount) })
    expect(failures, `best-effort cleanup failures:\n${failures.join('\n')}`).toEqual([])
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
    const ticketPath = await captureSignedUpload(page, 'payment_proofs',
      new RegExp(`^orders/${buyerId}/${FIXTURE.orderId}/${UUID}\\.png$`),
      () => page.locator('input[type=file]').setInputFiles({ name: `${RUN}.png`, mimeType: 'image/png', buffer: PNG }))
    transientObjects.add(`payment_proofs:${ticketPath}`)
    await expect(page.getByText(/comprobante subido|revisaremos/i)).toBeVisible()
    const after = await service.from('orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.orderId).single()
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^orders/${buyerId}/${FIXTURE.orderId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp)$`))
    expect(after.data?.payment_proof_path).toBe(ticketPath)
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
    const ticketPath = await captureSignedUpload(page, 'payment_proofs',
      new RegExp(`^imports/${buyerId}/${FIXTURE.importId}/${UUID}\\.png$`),
      () => page.locator('input[type=file]').setInputFiles({ name: `${RUN}-import.png`, mimeType: 'image/png', buffer: PNG }))
    transientObjects.add(`payment_proofs:${ticketPath}`)
    await expect(page.getByText(/verificando pago/i)).toBeVisible()
    const after = await service.from('import_orders').select('payment_proof_path,payment_proof_url').eq('id', FIXTURE.importId).single()
    expect(after.data?.payment_proof_path).toMatch(new RegExp(`^imports/${buyerId}/${FIXTURE.importId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    expect(after.data?.payment_proof_path).toBe(ticketPath)
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
    const productTicketPath = await captureSignedUpload(page, 'products',
      new RegExp(`^catalog/${FIXTURE.inventoryId}/${UUID}\\.png$`),
      () => page.getByRole('button', { name: /guardar producto/i }).click())
    transientObjects.add(`products:${productTicketPath}`)
    const product = await service.from('products').select('id,image_url,metadata').eq('name', RUN).single()
    expect(product.error).toBeNull()
    const productPaths = [product.data?.image_url, ...(product.data?.metadata?.gallery ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.includes('/'))
      .map(value => value.includes('/storage/v1/object/public/products/') ? value.split('/storage/v1/object/public/products/')[1] : value)
    productPaths.forEach(path => transientObjects.add(`products:${path}`))
    expect(productPaths).toContain(productTicketPath)

    await page.goto('/admin/banners')
    await page.getByRole('button', { name: /nuevo banner/i }).click()
    await page.locator('label', { hasText: /título principal/i }).locator('xpath=following-sibling::input').fill(RUN)
    await page.locator('input[type=file]').setInputFiles({ name: `${RUN}-banner.png`, mimeType: 'image/png', buffer: PNG })
    const bannerTicketPath = await captureSignedUpload(page, 'banners', new RegExp(`^site/${UUID}\\.png$`),
      () => page.getByRole('button', { name: /guardar cambios/i }).click())
    transientObjects.add(`banners:${bannerTicketPath}`)
    const banner = await service.from('banners').select('image_url').eq('title', RUN).single()
    expect(banner.error).toBeNull()
    const bannerPath = String(banner.data?.image_url ?? '').split('/storage/v1/object/public/banners/')[1]
    expect(bannerPath).toBeTruthy()
    expect(bannerPath).toBe(bannerTicketPath)
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
    const commissionTicketPath = await captureSignedUpload(page, 'payment_proofs',
      new RegExp(`^commissions/${UUID}/${operatorId}/${UUID}\\.png$`),
      () => page.getByRole('button', { name: /^registrar pago$/i }).click())
    transientObjects.add(`payment_proofs:${commissionTicketPath}`)
    const payment = await service.from('commission_payments').select('proof_path,proof_url,reported_by_user_id').eq('reference', RUN).single()
    expect(payment.error).toBeNull()
    expect(payment.data?.reported_by_user_id).toBe(operatorId)
    expect(payment.data?.proof_path).toMatch(new RegExp(`^commissions/[0-9a-f-]{36}/${operatorId}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|pdf)$`))
    expect(payment.data?.proof_path).toBe(commissionTicketPath)
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
