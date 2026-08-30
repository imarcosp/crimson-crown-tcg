import { randomUUID } from 'node:crypto'

import { createClient, type User } from '@supabase/supabase-js'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mailpitUrl = 'http://127.0.0.1:54624'
const initialPassword = 'CrimsonAuthLocal!2026'
const updatedPassword = 'CrimsonAuthUpdated!2026'
const run = randomUUID()
const signupEmail = `signup-${run}@example.test`
const recoveryEmail = `recovery-${run}@example.test`

if (!localUrl || !serviceRoleKey) {
  throw new Error('Los E2E de Auth requieren las credenciales de Supabase local.')
}

if (!new Set(['127.0.0.1', 'localhost', '::1']).has(new URL(localUrl).hostname)) {
  throw new Error('Los E2E de Auth sólo pueden ejecutarse contra Supabase local.')
}

const service = createClient(localUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type MailpitRecipient = { Address?: string }
type MailpitSummary = { ID?: string; To?: MailpitRecipient[] }
type MailpitList = { messages?: MailpitSummary[] }
type MailpitDetail = { HTML?: string; Text?: string }

async function listUsers(): Promise<User[]> {
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  return data.users
}

async function deleteSyntheticUser(email: string) {
  const user = (await listUsers()).find((candidate) => candidate.email === email)
  if (!user) return
  const { error: profileError } = await service.from('profiles').delete().eq('id', user.id)
  if (profileError) throw profileError
  const { error } = await service.auth.admin.deleteUser(user.id)
  if (error) throw error
}

function recoveryLinkFrom(content: string): string | null {
  const decoded = content.replaceAll('&amp;', '&')
  return decoded.match(/https?:\/\/127\.0\.0\.1:54621\/auth\/v1\/verify\?[^\s"'<>]+/u)?.[0] ?? null
}

async function waitForRecoveryLink(request: APIRequestContext, email: string) {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const response = await request.get(`${mailpitUrl}/api/v1/messages`)
    expect(response.ok()).toBe(true)
    const list = await response.json() as MailpitList
    const message = (list.messages ?? []).find((candidate) =>
      candidate.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
    )

    if (message?.ID) {
      const detailResponse = await request.get(`${mailpitUrl}/api/v1/message/${message.ID}`)
      expect(detailResponse.ok()).toBe(true)
      const detail = await detailResponse.json() as MailpitDetail
      const link = recoveryLinkFrom(`${detail.HTML ?? ''}\n${detail.Text ?? ''}`)
      if (link) return link
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error('Mailpit local no recibió el enlace sintético de recuperación.')
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('main').getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
}

test.describe.serial('Auth local', () => {
  test.beforeAll(async () => {
    await deleteSyntheticUser(signupEmail)
    await deleteSyntheticUser(recoveryEmail)
    const { error } = await service.auth.admin.createUser({
      email: recoveryEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { first_name: 'Recovery', last_name: 'Synthetic' },
    })
    if (error) throw error
  })

  test.afterAll(async () => {
    await deleteSyntheticUser(signupEmail)
    await deleteSyntheticUser(recoveryEmail)
  })

  test('registro crea la cuenta y el perfil sintéticos', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /no tienes cuenta.*regístrate/i }).click()
    await page.getByLabel('Nombre').fill('Signup')
    await page.getByLabel('Apellido').fill('Synthetic')
    await page.getByLabel('Email').fill(signupEmail)
    await page.getByLabel('Contraseña').fill(initialPassword)
    await page.getByRole('button', { name: 'Registrarse', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)

    const user = (await listUsers()).find((candidate) => candidate.email === signupEmail)
    expect(user?.id).toBeTruthy()
    const { data: profile, error } = await service
      .from('profiles')
      .select('email,first_name,last_name')
      .eq('id', user!.id)
      .single()
    expect(error).toBeNull()
    expect(profile).toMatchObject({
      email: signupEmail,
      first_name: 'Signup',
      last_name: 'Synthetic',
    })
  })

  test('recuperación canjea PKCE, cambia la contraseña y permite reingresar', async ({ page, request }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /olvidaste tu contraseña/i }).click()
    await page.getByLabel('Email').fill(recoveryEmail)
    await page.getByRole('button', { name: /enviar link de recuperación/i }).click()
    await expect(page.getByText(/te enviamos un correo/i)).toBeVisible()

    const recoveryLink = await waitForRecoveryLink(request, recoveryEmail)
    await page.goto(recoveryLink)
    await expect(page).toHaveURL(/\/auth\/update-password$/)
    await page.getByLabel(/ingresa tu nueva contraseña/i).fill(updatedPassword)
    await page.getByRole('button', { name: 'Actualizar Contraseña', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?password=updated$/)

    await signIn(page, recoveryEmail, updatedPassword)
  })
})
