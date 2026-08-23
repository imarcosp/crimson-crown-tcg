# Contact Settings Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the browser behavior that reads contact settings from local `system_settings`, normalizes the WhatsApp value, and uses it consistently in the footer and request-to-WhatsApp flows.

**Architecture:** The E2E test intercepts only the browser's local Supabase REST request for `system_settings`; it does not write to the shared local database or contact production. The fixture uses values different from the local fallback so the test proves the client actually consumes the response.

**Tech Stack:** Next.js App Router, React client components, Supabase REST, Playwright.

**Spec:** `docs/crimson-crown-backlog.md` — P1 contact configuration regression.

## Global Constraints

- Tests must load `.env.test.local` and target Supabase at loopback only.
- No production URL, credential, migration, deployment, or remote database write is allowed.
- The test must clean up browser routes through the Playwright page lifecycle; no persistent database fixture is created.
- WhatsApp assertions must use the normalized Argentine number `5491123456789`.

### Task 1: Add isolated contact-settings E2E regression

**Files:**
- Create: `e2e/contact-settings.spec.ts`
- Check: `src/components/layout/Footer.tsx`
- Check: `src/hooks/useContactWhatsapp.ts`
- Check: `src/lib/contact-whatsapp.ts`

**Interfaces:**
- Consumes: browser requests to `system_settings` and the existing `cleanSystemSettingValue`, `normalizeWhatsAppNumber`, and `buildWhatsAppUrl` behavior.
- Produces: a repeatable E2E guard proving contact settings override local fallback values in Footer and `/hang`.

- [x] **Step 1: Add the failing/guarding test before changing production code**

Create `e2e/contact-settings.spec.ts` with a local-only Supabase REST route fixture:

```ts
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(contactFixture),
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
  await expect.poll(() => popup.url()).toMatch(/^https:\/\/wa\.me\/5491123456789\?text=/)
})
```

- [x] **Step 2: Run the targeted regression**

Run:

```powershell
npm run test:e2e -- e2e/contact-settings.spec.ts
```

Expected: the new test passes using only the intercepted local REST response; no row is inserted or updated in Supabase.

- [x] **Step 3: Run the full local verification gate**

Run:

```powershell
npm run test:e2e
npm run test:environment-safety
npm run test:local-security
npm run test:local-storage
```

Expected: all existing E2E flows remain green, the environment guard reports loopback endpoints, and both local matrices report `ok: true`.

- [ ] **Step 4: Review and commit only this lot**

Run:

```powershell
git diff --check
git status --short
git add e2e/contact-settings.spec.ts docs/superpowers/plans/2026-08-23-contact-settings-regression.md docs/crimson-crown-backlog.md
git commit -m "test: cover local contact settings"
```

Expected: only the new regression test, plan, and backlog status change are committed; no migration or production file is included.
