import { expect, test, type Page } from '@playwright/test'

const adminEmail = 'admin.local@example.test'
const adminPassword = 'CrimsonLocalAdmin!2026'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(adminEmail)
  await page.locator('input[type="password"]').fill(adminPassword)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar', exact: true }).click()
  await page.waitForURL(/\/$/)
}

async function expectDocumentFitsViewport(page: Page, route: string) {
  await page.goto(route)
  await expect(page.locator('[data-admin-content]')).toBeVisible()
  const dimensions = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const uncontainedTables = [...document.querySelectorAll('table')]
      .filter((table) => {
        if (table.scrollWidth <= viewportWidth) return false
        let ancestor = table.parentElement
        while (ancestor && ancestor !== document.body) {
          const overflowX = window.getComputedStyle(ancestor).overflowX
          if (overflowX === 'auto' || overflowX === 'scroll') return false
          ancestor = ancestor.parentElement
        }
        return true
      })
      .map((table) => table.textContent?.trim().slice(0, 40) ?? 'tabla sin texto')

    return {
      clientWidth: viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      uncontainedTables,
    }
  })
  expect(dimensions.scrollWidth, `${route} desborda el viewport`).toBeLessThanOrEqual(dimensions.clientWidth)
  expect(dimensions.uncontainedTables, `${route} contiene tablas anchas sin scroll local`).toEqual([])
}

test.describe.serial('panel administrativo responsive', () => {
  test.setTimeout(180_000)

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAsAdmin(page)
  })

  test('móvil usa navegación administrativa colapsable', async ({ page }) => {
    await page.goto('/admin')
    const trigger = page.getByRole('button', { name: 'Abrir navegación administrativa' })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('navigation', { name: 'Navegación administrativa móvil' })).toBeHidden()

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('navigation', { name: 'Navegación administrativa móvil' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Inventarios', exact: true })).toBeVisible()
  })

  test('rutas operativas no desbordan el documento en móvil ni tablet', async ({ page }) => {
    const routes = [
      '/admin',
      '/admin/inventories',
      '/admin/orders',
      '/admin/imports',
      '/admin/buylists',
      '/admin/users',
      '/admin/coupons',
      '/admin/searches',
      '/admin/wishlists',
      '/admin/credits',
      '/admin/quick-links',
    ]

    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of routes) await expectDocumentFitsViewport(page, route)
    }
  })

  test('modal de inventario permanece operable en viewport móvil', async ({ page }) => {
    await page.goto('/admin/inventories')
    await expect(page.getByText('Cargando inventarios…')).toHaveCount(0)
    await page.getByRole('button', { name: 'Nuevo inventario' }).click()

    const dialog = page.getByRole('dialog', { name: 'Nuevo inventario' })
    await expect(dialog).toBeVisible()
    const box = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
    })
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(390)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(844)
  })
})
