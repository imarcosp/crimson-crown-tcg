import { expect, test, type Page } from '@playwright/test'

const adminEmail = 'admin.local@example.test'
const adminPassword = 'CrimsonLocalAdmin!2026'

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

test('usuario estándar no puede abrir el panel administrativo', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('tester.local@example.test')
  await page.locator('input[type="password"]').fill('CrimsonLocalTester!2026')
  await page.getByRole('main').getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/$/)

  await page.goto('/admin/inventory')
  await expect(page).toHaveURL(/\/$/)
})

test('el host local alternativo se normaliza a 127.0.0.1', async ({ page }) => {
  await page.goto('http://localhost:3000/login?view=signup')
  await expect(page).toHaveURL('http://127.0.0.1:3000/login?view=signup')
})

test('admin puede abrir los formularios operativos sin warnings GoTrue', async ({ page }) => {
  const authWarnings: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/GoTrueClient|Multiple GoTrue|Multiple instances/i.test(text)) authWarnings.push(text)
  })

  await loginAsAdmin(page)
  await unlockAdminPanel(page)

  const routes = [
    { path: '/admin/inventory', heading: 'Inventario' },
    { path: '/admin/orders', heading: 'Gestión de Pedidos' },
    { path: '/admin/imports', heading: 'Importaciones' },
    { path: '/admin/buylists', heading: 'Solicitudes de Venta (Buylist)' },
    { path: '/admin/prices', heading: 'Configuración Maestra' },
  ]

  for (const route of routes) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible()
  }

  expect(authWarnings).toEqual([])
})
