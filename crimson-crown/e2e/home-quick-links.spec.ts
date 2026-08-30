import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const adminEmail = 'admin.local@example.test'
const adminPassword = 'CrimsonLocalAdmin!2026'
const marker = `Playwright acceso Home ${Date.now()}`
const editedMarker = `${marker} editado`

const localAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(adminEmail)
  await page.locator('input[type="password"]').fill(adminPassword)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/$/)
}

test.afterAll(async () => {
  const { error } = await localAdmin.from('home_quick_links').delete().like('label', `${marker}%`)
  if (error) throw error
})

test('admin administra un acceso y Home refleja sólo el estado activo', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin/quick-links')
  await expect(page.getByRole('heading', { name: 'Accesos rápidos de Home' })).toBeVisible()
  await expect(page.getByText('Cargando accesos…')).toHaveCount(0)

  await page.getByRole('button', { name: 'Nuevo acceso' }).click()
  await page.getByLabel('Etiqueta').fill(marker)
  await page.getByLabel('URL de destino').fill('/catalog?tcg=Magic')
  await page.getByLabel('Icono alternativo').selectOption('crown')
  await page.getByLabel('Orden').fill('9876')
  await page.getByRole('button', { name: 'Guardar acceso' }).click()

  await expect(page.getByText('Acceso rápido creado.')).toBeVisible()
  await expect(page.getByRole('heading', { name: marker })).toBeVisible()

  await page.getByRole('button', { name: `Editar ${marker}` }).click()
  await page.getByLabel('Etiqueta').fill(editedMarker)
  await page.getByLabel('URL de destino').fill('/catalog?tcg=Magic&sort=price_desc')
  await page.getByLabel('Orden').fill('9875')
  await page.getByRole('button', { name: 'Guardar acceso' }).click()

  await expect(page.getByText('Acceso rápido actualizado.')).toBeVisible()
  await expect(page.getByRole('heading', { name: editedMarker })).toBeVisible()

  await page.goto('/')
  const homeLink = page.getByRole('navigation', { name: 'Accesos rápidos' }).getByRole('link', { name: editedMarker })
  await expect(homeLink).toBeVisible()
  await expect(homeLink).toHaveAttribute('href', '/catalog?tcg=Magic&sort=price_desc')

  await page.goto('/admin/quick-links')
  await expect(page.getByText('Cargando accesos…')).toHaveCount(0)
  await page.getByRole('button', { name: `Desactivar ${editedMarker}` }).click()
  await expect(page.getByText('Acceso rápido desactivado.')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: editedMarker })).toHaveCount(0)

  await page.goto('/admin/quick-links')
  await expect(page.getByText('Cargando accesos…')).toHaveCount(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: `Eliminar ${editedMarker}` }).click()
  await expect(page.getByText('Acceso rápido eliminado.')).toBeVisible()
  await expect(page.getByRole('heading', { name: editedMarker })).toHaveCount(0)
})
