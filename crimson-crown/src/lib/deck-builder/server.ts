import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { calculateDeckCoverage, getDeckBuilderFormat, normalizeDeckBuilderSearch } from './core'
import { matchDeckCardsToCatalog, type DeckBuilderCatalogCard } from './catalog'

type DatabaseRow = Record<string, unknown>
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type DeckBuilderSnapshot = {
  id: string
  source: string
  format: string
  fetched_at: string
  metadata: Record<string, unknown>
}

export type DeckBuilderDeckSummary = {
  id: string
  snapshot_id: string
  external_id: string
  name: string
  archetype: string | null
  commander_names: string[]
  source_url: string | null
  image_url: string | null
  stats: Record<string, unknown>
  display_order: number
}

function normalizedName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function toDeckSummary(row: DatabaseRow): DeckBuilderDeckSummary {
  return {
    id: String(row.id),
    snapshot_id: String(row.snapshot_id),
    external_id: String(row.external_id),
    name: String(row.name),
    archetype: row.archetype ? String(row.archetype) : null,
    commander_names: stringArray(row.commander_names),
    source_url: row.source_url ? String(row.source_url) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    stats: objectValue(row.stats),
    display_order: Number(row.display_order || 0),
  }
}

async function activeSnapshotsForFormat(supabase: SupabaseServerClient, format: string): Promise<DeckBuilderSnapshot[]> {
  const { data, error } = await supabase
    .from('deck_builder_snapshots')
    .select('id, source, format, fetched_at, metadata')
    .eq('format', format)
    .eq('status', 'active')
    .order('fetched_at', { ascending: false })
  if (error) throw error
  return ((data || []) as DatabaseRow[]).map((snapshot) => ({
    id: String(snapshot.id),
    source: String(snapshot.source),
    format: String(snapshot.format),
    fetched_at: String(snapshot.fetched_at),
    metadata: objectValue(snapshot.metadata),
  }))
}

export async function getDeckBuilderFormatOverview() {
  const supabase = await createClient()
  const { data: snapshots, error: snapshotError } = await supabase
    .from('deck_builder_snapshots')
    .select('id, source, format, fetched_at, metadata')
    .eq('status', 'active')
    .order('fetched_at', { ascending: false })
  if (snapshotError) throw snapshotError
  const snapshotRows = (snapshots || []) as DatabaseRow[]
  const snapshotIds = snapshotRows.map((snapshot) => String(snapshot.id))
  const decksBySnapshot = new Map<string, number>()

  if (snapshotIds.length > 0) {
    const { data: decks, error: decksError } = await supabase
      .from('deck_builder_decks')
      .select('snapshot_id')
      .in('snapshot_id', snapshotIds)
    if (decksError) throw decksError
    for (const deck of decks || []) {
      decksBySnapshot.set(deck.snapshot_id, (decksBySnapshot.get(deck.snapshot_id) || 0) + 1)
    }
  }

  return snapshotRows.map((snapshot) => ({
    id: String(snapshot.id),
    source: String(snapshot.source),
    format: String(snapshot.format),
    fetched_at: String(snapshot.fetched_at),
    metadata: objectValue(snapshot.metadata),
    deckCount: decksBySnapshot.get(String(snapshot.id)) || 0,
  }))
}

export async function getDeckBuilderDecks(formatValue: string, searchValue?: string) {
  const format = getDeckBuilderFormat(formatValue)
  if (!format) return null
  const search = normalizeDeckBuilderSearch(searchValue)
  const supabase = await createClient()
  const snapshots = await activeSnapshotsForFormat(supabase, format.slug)
  const snapshotIds = snapshots.map((snapshot) => snapshot.id)
  if (snapshotIds.length === 0) return { format, snapshots: [], decks: [] }

  const { data, error } = await supabase
    .from('deck_builder_decks')
    .select('id, snapshot_id, external_id, name, archetype, commander_names, source_url, image_url, stats, display_order')
    .in('snapshot_id', snapshotIds)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error

  const deckRows = ((data || []) as DatabaseRow[]).map(toDeckSummary)
  const needle = normalizedName(search)
  const decks = needle
    ? deckRows.filter((deck) => normalizedName(`${deck.name} ${deck.archetype || ''} ${deck.commander_names.join(' ')}`).includes(needle))
    : deckRows

  return { format, snapshots, decks }
}

async function fetchCatalogRows(supabase: SupabaseServerClient, cards: DatabaseRow[]) {
  const scryfallIds = uniqueStrings(cards.map((card) => card.scryfall_id))
  const names = uniqueStrings(cards.map((card) => card.name))
  const { data: inventories, error: inventoriesError } = await supabase
    .from('inventories')
    .select('id, kind')
    .eq('is_active', true)
    .is('archived_at', null)
  if (inventoriesError) throw inventoriesError
  const inventoryKinds = new Map<string, string>(((inventories || []) as DatabaseRow[]).map((inventory) => [String(inventory.id), String(inventory.kind)]))
  const activeInventoryIds = [...inventoryKinds.keys()]

  let productRows: DatabaseRow[] = []
  if (names.length > 0 && activeInventoryIds.length > 0) {
    const { data, error } = await supabase
      .from('products')
      .select('id, inventory_id, variant_key, name, set_name, collector_number, price_usd, stock, finish, image_url, scryfall_id, tcg, language, condition, is_manual_price')
      .eq('tcg', 'Magic')
      .in('inventory_id', activeInventoryIds)
      .in('name', names)
    if (error) throw error
    productRows = (data || []).map((row: DatabaseRow) => ({
      ...row,
      inventory_kind: inventoryKinds.get(String(row.inventory_id)) || 'secondary',
    }))
  }

  let externalRows: DatabaseRow[] = []
  if (scryfallIds.length > 0 || names.length > 0) {
    let query = supabase
      .from('external_prices')
      .select('scryfall_id, name, set_name, collector_number, image_url, rarity, type_line, color_identity, foil_variant, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, tcgplayer_market_normal, tcgplayer_market_foil, active_price_normal, active_price_foil')
    if (scryfallIds.length > 0) query = query.in('scryfall_id', scryfallIds)
    else query = query.in('name', names)
    const { data, error } = await query
    if (error) throw error
    externalRows = data || []
  }

  const externalNames = new Set(externalRows.map((row) => normalizedName(row.name)))
  const missingNames = names.filter((name) => !externalNames.has(normalizedName(name)))
  if (missingNames.length > 0) {
    const { data, error } = await supabase
      .from('external_prices')
      .select('scryfall_id, name, set_name, collector_number, image_url, rarity, type_line, color_identity, foil_variant, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, tcgplayer_market_normal, tcgplayer_market_foil, active_price_normal, active_price_foil')
      .in('name', missingNames)
    if (error) throw error
    externalRows.push(...(data || []))
  }

  return { productRows, externalRows }
}

export async function getDeckBuilderDeck(formatValue: string, deckId: string) {
  const format = getDeckBuilderFormat(formatValue)
  if (!format || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(deckId)) return null
  const supabase = await createClient()
  const snapshots = await activeSnapshotsForFormat(supabase, format.slug)
  const snapshotIds = snapshots.map((snapshot) => snapshot.id)
  if (snapshotIds.length === 0) return null

  const { data: deck, error: deckError } = await supabase
    .from('deck_builder_decks')
    .select('id, snapshot_id, external_id, name, archetype, commander_names, source_url, image_url, stats')
    .eq('id', deckId)
    .in('snapshot_id', snapshotIds)
    .maybeSingle()
  if (deckError) throw deckError
  if (!deck) return null
  const deckSummary = toDeckSummary(deck as DatabaseRow)

  const { data: cards, error: cardsError } = await supabase
    .from('deck_builder_cards')
    .select('id, scryfall_id, name, role, quantity, display_order, image_url, type_line')
    .eq('deck_id', deckSummary.id)
    .order('display_order', { ascending: true })
  if (cardsError) throw cardsError
  const { productRows, externalRows } = await fetchCatalogRows(supabase, cards || [])
  const enrichedCards = matchDeckCardsToCatalog((cards || []) as DeckBuilderCatalogCard[], productRows, externalRows)

  return {
    format,
    deck: deckSummary,
    cards: enrichedCards,
    coverage: calculateDeckCoverage(enrichedCards),
  }
}
