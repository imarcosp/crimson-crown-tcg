import { expect, test } from '@playwright/test'

const contactFixture = [
  { key: 'contact_whatsapp', value: '"011 2345-6789"' },
  { key: 'contact_instagram', value: '"@fixture_contact"' },
  { key: 'contact_email', value: 'fixture@example.test' },
  { key: 'contact_address', value: 'Fixture address' },
  { key: 'contact_address_note', value: 'Fixture note' },
  { key: 'contact_schedule', value: 'Fixture schedule' },
]

test('contacto de system_settings se refleja en footer y WhatsApp', async ({ page }) => {
  await page.route('**/rest/v1/system_settings**', async (route) => {
    const requestUrl = new URL(route.request().url())
    const isSingleContactRequest = requestUrl.searchParams.get('key') === 'eq.contact_whatsapp'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isSingleContactRequest ? { value: contactFixture[0].value } : contactFixture),
    })
  })

  await page.goto('/')
  const footer = page.locator('footer')
  await expect(footer).toContainText('WhatsApp: +5491123456789')
  await expect(footer).toContainText('Fixture address')
  await expect(footer).toContainText('Fixture note')
  await expect(footer).toContainText('Fixture schedule')
  await expect(footer.locator('a[href^="mailto:"]')).toHaveAttribute('href', 'mailto:fixture@example.test')
  await expect(footer.locator('a[href^="https://wa.me/"]')).toHaveAttribute('href', 'https://wa.me/5491123456789')

  await page.goto('/hang')
  await page.getByPlaceholder('Pega acá tu lista o links').fill('fixture contact')
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Enviar por WhatsApp' }).click()
  const popup = await popupPromise
  await expect.poll(() => popup.url()).toMatch(/https:\/\/(?:wa\.me|api\.whatsapp\.com)\//)
  await expect.poll(() => popup.url()).toContain('5491123456789')
  await expect.poll(() => popup.url()).toContain('fixture')
})
