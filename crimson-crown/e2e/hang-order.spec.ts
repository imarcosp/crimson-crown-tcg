import { expect, test } from '@playwright/test'

test('modal Hang Order calcula total con precios', async ({ page }) => {
  await page.route('**/api/search?*', async (route) => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') || ''
    if (q.toLowerCase().includes('sol ring')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'test-sol-ring',
            name: 'Sol Ring',
            set_name: 'Commander Masters',
            collector_number: '123',
            image_url: '',
            tcg: 'Magic',
            price_usd: 10,
            price_usd_foil: 20,
            priceUsd: 10,
            priceUsdFoil: 20,
            finishes: ['nonfoil', 'foil'],
          },
        ]),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  await page.goto('/')
  await page.getByRole('link', { name: 'Colgar Pedido' }).click()
  await expect(page.getByRole('heading', { name: 'Colgar Pedido' })).toBeVisible()

  await page.getByPlaceholder('Buscar carta...').fill('Sol Ring')
  await page.getByRole('button', { name: /Sol Ring/i }).first().click()

  const totalText = await page
    .getByText('Total Estimado')
    .locator('..')
    .getByText(/US\$/)
    .textContent()
  const n = Number(String(totalText || '').replace(/[^\d.]/g, ''))
  expect(n).toBeGreaterThan(0)
})

test('api/search devuelve precios (smoke)', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}/api/search?q=${encodeURIComponent('Sol Ring')}`)
  expect(res.ok()).toBeTruthy()
  const data = await res.json()
  expect(Array.isArray(data)).toBeTruthy()
  const anyWithPrice = (Array.isArray(data) ? data : []).some((r: any) => {
    const n = Number(r?.priceUsd ?? r?.price_usd ?? 0)
    const f = Number(r?.priceUsdFoil ?? r?.price_usd_foil ?? 0)
    return n > 0 || f > 0
  })
  expect(anyWithPrice).toBeTruthy()
})
