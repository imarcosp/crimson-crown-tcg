import { expect, test } from '@playwright/test'

test.describe('filtros Magic de catálogo', () => {
  test('combina rango y formato conservando la URL y valida límites inválidos', async ({ page }) => {
    await page.goto('/catalog?tcg=Magic&priceMin=5&priceMax=10&format=modern')

    const minimum = page.getByRole('spinbutton', { name: 'Mínimo' })
    const maximum = page.getByRole('spinbutton', { name: 'Máximo' })
    const format = page.getByRole('combobox', { name: 'Formato de Magic' })

    await expect(minimum).toHaveValue('5')
    await expect(maximum).toHaveValue('10')
    await expect(format).toHaveValue('modern')
    await expect(page.getByText(/\d+ resultados$/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Siguiente' })).toHaveAttribute(
      'href',
      /tcg=Magic.*priceMin=5.*priceMax=10.*format=modern.*page=2/,
    )

    await maximum.fill('6')
    await page.getByRole('button', { name: 'Aplicar precio' }).click()
    await expect(page).toHaveURL(/tcg=Magic.*priceMin=5.*priceMax=6.*format=modern/)

    await format.selectOption('standard')
    await expect(page).toHaveURL(/tcg=Magic.*priceMin=5.*priceMax=6.*format=standard/)
    await expect(minimum).toHaveValue('5')
    await expect(maximum).toHaveValue('6')

    const validUrl = page.url()
    await minimum.fill('10')
    await maximum.fill('5')
    await page.getByRole('button', { name: 'Aplicar precio' }).click()
    await expect(page.getByText(/mínimo no supere al máximo/)).toBeVisible()
    expect(page.url()).toBe(validUrl)
  })

  test('expone los filtros nuevos sin overflow en móvil', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/catalog?tcg=Magic&priceMin=5&priceMax=10&format=commander')

    await page.getByRole('button', { name: 'Filtros' }).click()
    await expect(page.getByRole('spinbutton', { name: 'Mínimo' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Formato de Magic' })).toHaveValue('commander')

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
  })
})
