import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import {
  buildLegalityUpdates,
  chunkScryfallIdentifiers,
} from './lib/magic-legalities.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const configuredTarget = process.env.CRIMSON_OPERATION_TARGET?.trim() || 'local'
const localTestEnvPath = path.resolve(scriptDirectory, '../.env.test.local')
const envPath = configuredTarget === 'local' && fs.existsSync(localTestEnvPath)
  ? localTestEnvPath
  : path.resolve(scriptDirectory, '../.env.local')
if (fs.existsSync(envPath)) {
  const dotenv = await import('dotenv')
  dotenv.config({ path: envPath, override: true })
}

const SCRYFALL_COLLECTION_URL = 'https://api.scryfall.com/cards/collection'
const SCRYFALL_HEADERS = {
  'User-Agent': 'CrimsonCrownTCG/1.0 (catalog-legalities; contact: mjperchezabala@gmail.com)',
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

function parseMode(arguments_) {
  if (arguments_.length === 0) return '--plan'
  if (arguments_.length === 1 && ['--plan', '--apply'].includes(arguments_[0])) return arguments_[0]
  throw new Error('Uso: node scripts/backfill-magic-legalities.mjs [--plan|--apply]')
}

async function fetchAllMagicProductIds(client) {
  const ids = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('products')
      .select('scryfall_id')
      .eq('tcg', 'Magic')
      .not('scryfall_id', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    ids.push(...(data || []).map((row) => row.scryfall_id))
    if (!data || data.length < pageSize) break
  }
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

async function fetchCurrentLegalities(client, ids) {
  const current = new Map()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100)
    const { data, error } = await client
      .from('external_prices')
      .select('scryfall_id, legalities')
      .in('scryfall_id', batch)
    if (error) throw error
    for (const row of data || []) current.set(String(row.scryfall_id), row.legalities || {})
  }
  return current
}

async function fetchScryfallCards(ids) {
  const cards = []
  let notFound = 0
  const batches = chunkScryfallIdentifiers(ids)

  for (let index = 0; index < batches.length; index++) {
    const response = await fetch(SCRYFALL_COLLECTION_URL, {
      method: 'POST',
      headers: SCRYFALL_HEADERS,
      body: JSON.stringify({ identifiers: batches[index] }),
    })
    if (!response.ok) throw new Error(`Scryfall collection respondió ${response.status}.`)
    const payload = await response.json()
    cards.push(...(payload.data || []))
    notFound += (payload.not_found || []).length
    if (index < batches.length - 1) await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return { cards, notFound, requests: batches.length }
}

async function applyUpdates(client, updates) {
  for (let offset = 0; offset < updates.length; offset += 250) {
    const batch = updates.slice(offset, offset + 250)
    const { error } = await client
      .from('external_prices')
      .upsert(batch, { onConflict: 'scryfall_id' })
    if (error) throw error
  }
}

export async function runMagicLegalitiesBackfill(mode = '--plan') {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')

  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const productIds = await fetchAllMagicProductIds(client)
  const currentLegalities = await fetchCurrentLegalities(client, productIds)
  const { cards, notFound, requests } = await fetchScryfallCards([...currentLegalities.keys()])
  const result = buildLegalityUpdates(cards, currentLegalities)

  if (mode === '--apply') await applyUpdates(client, result.updates)

  return {
    mode: mode === '--apply' ? 'apply' : 'plan',
    target: process.env.CRIMSON_OPERATION_TARGET?.trim() || 'local',
    productIds: productIds.length,
    externalRows: currentLegalities.size,
    scryfallRequests: requests,
    notFound,
    pendingUpdates: result.updates.length,
    unchanged: result.unchanged,
    skipped: result.skipped,
    applied: mode === '--apply' ? result.updates.length : 0,
  }
}

const mode = parseMode(process.argv.slice(2))
const summary = await runMagicLegalitiesBackfill(mode)
console.log(JSON.stringify(summary, null, 2))
