import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('./admin-quick-links.ts', import.meta.url), 'utf8')

test('las acciones de accesos rápidos exigen admin y delegan autorización final a RLS', () => {
  assert.match(source, /'use server'/u)
  assert.match(source, /isAdminEmail\(user[.]email\)/u)
  assert.match(source, /from\('home_quick_links'\)/u)
  assert.doesNotMatch(source, /createAdminClient|service.role|SUPABASE_SERVICE_ROLE_KEY/iu)
})

test('las cuatro operaciones administrativas usan validación y revalidan Home', () => {
  for (const operation of [
    'getAdminQuickLinks',
    'saveAdminQuickLink',
    'setAdminQuickLinkActive',
    'deleteAdminQuickLink',
  ]) {
    assert.match(source, new RegExp(`export async function ${operation}\\b`, 'u'))
  }
  assert.match(source, /normalizeQuickLinkInput\(rawInput\)/u)
  assert.match(source, /revalidatePath\('\/'\)/u)
})
