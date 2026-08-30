import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const fixtureScope = 'LOCAL-E2E-DECK-BUILDER'
const fixtureName = `${fixtureScope}-${Date.now()}`

if (!localUrl || !serviceRoleKey) throw new Error('El E2E del deckbuilder requiere Supabase local.')
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(new URL(localUrl).hostname)) {
  throw new Error('El E2E del deckbuilder sólo puede ejecutarse contra Supabase local.')
}

const service = createClient(localUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let snapshotId: string | null = null
let externalPriceId: string | null = null

async function cleanupFixture() {
  if (snapshotId) {
    const { error } = await service.from('deck_builder_snapshots').delete().eq('id', snapshotId)
    if (error) throw error
    snapshotId = null
  }
  if (externalPriceId) {
    const { error } = await service.from('external_prices').delete().eq('scryfall_id', externalPriceId)
    if (error) throw error
    externalPriceId = null
  }
  const { data: orphaned } = await service
    .from('deck_builder_snapshots')
    .select('id')
    .eq('source', 'manual')
    .eq('format', 'standard')
    .contains('metadata', { scope: fixtureScope })
  const orphanedIds = (orphaned || []).map((row) => row.id)
  if (orphanedIds.length > 0) await service.from('deck_builder_snapshots').delete().in('id', orphanedIds)
}

test.beforeAll(async () => {
  await cleanupFixture()
  const { data: inventories, error: inventoriesError } = await service
    .from('inventories')
    .select('id')
    .eq('is_active', true)
    .is('archived_at', null)
  if (inventoriesError || !inventories?.length) throw inventoriesError || new Error('No hay inventarios activos para E2E.')

  const { data: product, error: productError } = await service
    .from('products')
    .select('id,name,scryfall_id')
    .eq('tcg', 'Magic')
    .in('inventory_id', inventories.map((inventory) => inventory.id))
    .gt('stock', 0)
    .limit(1)
    .single()
  if (productError || !product) throw productError || new Error('No hay producto Magic con stock para E2E.')

  externalPriceId = randomUUID()
  const missingName = `${fixtureName} Missing Card`
  const { error: externalError } = await service.from('external_prices').insert({
    scryfall_id: externalPriceId,
    name: missingName,
    set_name: 'Fixture Set',
    collector_number: 'E2E',
    cardkingdom_retail_normal: 12,
  })
  if (externalError) throw externalError

  const { data: snapshot, error: snapshotError } = await service
    .from('deck_builder_snapshots')
    .insert({ source: 'manual', format: 'standard', status: 'staging', metadata: { scope: fixtureScope } })
    .select('id')
    .single()
  if (snapshotError || !snapshot?.id) throw snapshotError || new Error('No se creó snapshot E2E.')
  snapshotId = snapshot.id

  const { data: deck, error: deckError } = await service
    .from('deck_builder_decks')
    .insert({ snapshot_id: snapshot.id, external_id: fixtureName, name: fixtureName, archetype: 'Fixture Control' })
    .select('id')
    .single()
  if (deckError || !deck?.id) throw deckError || new Error('No se creó deck E2E.')

  const { error: cardsError } = await service.from('deck_builder_cards').insert([
    { deck_id: deck.id, scryfall_id: product.scryfall_id || null, name: product.name, role: 'main', quantity: 1, display_order: 0 },
    { deck_id: deck.id, scryfall_id: externalPriceId, name: missingName, role: 'sideboard', quantity: 1, display_order: 1 },
  ])
  if (cardsError) throw cardsError
  const { error: promoteError } = await service.rpc('promote_deck_builder_snapshot', { p_snapshot_id: snapshot.id })
  if (promoteError) throw promoteError
})

test.afterAll(async () => {
  await cleanupFixture()
})

test('explora un deck, agrega stock local y cotiza la carta faltante', async ({ page }) => {
  await page.goto('/deck-builder/magic')
  await expect(page.getByRole('heading', { name: 'Elige un formato' })).toBeVisible()
  await page.locator('a[href="/deck-builder/magic/standard"]').click()

  await expect(page.getByRole('heading', { name: 'Standard' })).toBeVisible()
  await page.getByPlaceholder('Buscar deck o arquetipo').fill(fixtureName)
  await page.getByPlaceholder('Buscar deck o arquetipo').press('Enter')
  await expect(page.getByRole('heading', { name: fixtureName, exact: true })).toBeVisible()
  await page.getByRole('heading', { name: fixtureName, exact: true }).click()

  await expect(page.getByRole('heading', { name: fixtureName, exact: true })).toBeVisible()
  await expect(page.getByText('50%', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Agregar 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cotizar 1', exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Agregar 1', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Agregar 1', exact: true }).click()
  await expect(page.getByText('1 copia agregada')).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar carrito' }).click()

  await page.getByRole('button', { name: 'Cotizar 1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pedido a Japón' })).toBeVisible()
  await expect(page.getByText(`${fixtureName} Missing Card`, { exact: true }).last()).toBeVisible()
})
