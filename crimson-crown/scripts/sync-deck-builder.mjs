import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createOperationalSupabaseClient } from './lib/guarded-supabase-client.mjs'
import {
  parseEdhrecCommander,
  parseEdhrecWeekly,
  parseMtgtop8ArchetypePage,
  parseMtgtop8DeckExport,
  parseMtgtop8EventDeckPage,
  parseMtgtop8FormatPage,
} from './lib/deck-builder-sync.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH)
const EDHREC_WEEKLY_URL = 'https://json.edhrec.com/pages/commanders/week.json'
const MTGTOP8_BASE_URL = 'https://www.mtgtop8.com/'
const MTGTOP8_FORMAT_CODES = {
  standard: 'ST', pioneer: 'PI', modern: 'MO', legacy: 'LE', vintage: 'VI',
  pauper: 'PAU', premodern: 'PREM', 'duel-commander': 'EDH',
}
const REQUEST_HEADERS = {
  'User-Agent': 'CrimsonCrownTCG/1.0 (deck-builder sync)',
  Accept: 'application/json, text/plain, text/html;q=0.9, */*;q=0.8',
}

function parseBoundedInteger(raw, name, fallback, maximum) {
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 1 || value > maximum) {
    throw new Error(`El límite ${name} debe estar entre 1 y ${maximum}.`)
  }
  return value
}

export function parseDeckBuilderSyncCli(arguments_) {
  const known = new Set(['--plan', '--apply'])
  let mode = 'plan'
  let source = 'edhrec'
  let format = 'commander'
  let maxDecksRaw
  let maxCardsRaw

  for (const argument of arguments_) {
    if (known.has(argument)) {
      mode = argument === '--apply' ? 'apply' : 'plan'
    } else if (argument.startsWith('--source=')) {
      source = argument.slice('--source='.length).trim().toLowerCase()
    } else if (argument.startsWith('--format=')) {
      format = argument.slice('--format='.length).trim().toLowerCase()
    } else if (argument.startsWith('--max-decks=')) {
      maxDecksRaw = argument.slice('--max-decks='.length)
    } else if (argument.startsWith('--max-cards=')) {
      maxCardsRaw = argument.slice('--max-cards='.length)
    } else {
      throw new Error(`Argumento desconocido: ${argument}`)
    }
  }

  if (!['edhrec', 'mtgtop8'].includes(source)) throw new Error('Fuente no soportada.')
  if (source === 'edhrec' && format !== 'commander') throw new Error('EDHREC sólo admite el formato Commander.')
  if (source === 'mtgtop8' && !MTGTOP8_FORMAT_CODES[format]) throw new Error('Formato MTGTop8 no soportado.')

  return {
    mode,
    source,
    format,
    maxDecks: parseBoundedInteger(maxDecksRaw, 'de decks', 8, 20),
    maxCards: parseBoundedInteger(maxCardsRaw, 'de cartas', 100, 100),
  }
}

async function fetchChecked(url, fetchImpl, responseType) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetchImpl(url, { headers: REQUEST_HEADERS, signal: controller.signal })
    if (!response?.ok) throw new Error(`El proveedor respondió ${response?.status ?? 'sin estado'} para ${new URL(url).hostname}.`)
    return responseType === 'json' ? response.json() : response.text()
  } finally {
    clearTimeout(timeout)
  }
}

export async function collectEdhrecSnapshot({ maxDecks = 8, maxCards = 100, fetchImpl = fetch }) {
  const weeklyPayload = await fetchChecked(EDHREC_WEEKLY_URL, fetchImpl, 'json')
  const commanders = parseEdhrecWeekly(weeklyPayload, maxDecks)
  const decks = []

  for (const commander of commanders) {
    const url = `https://json.edhrec.com/pages/commanders/${encodeURIComponent(commander.slug)}.json`
    const payload = await fetchChecked(url, fetchImpl, 'json')
    const deck = parseEdhrecCommander(commander.slug, payload, {
      maxCards: Math.max(1, maxCards - 1),
      deckCount: commander.deckCount,
    })
    if (deck.cards.length > 0) decks.push(deck)
  }

  if (decks.length === 0) throw new Error('EDHREC no devolvió decks utilizables; no se creará un snapshot.')
  return {
    source: 'edhrec',
    format: 'commander',
    metadata: { ranking: 'weekly', requestedDecks: maxDecks, collectedDecks: decks.length },
    decks,
  }
}

export async function collectMtgtop8Snapshot({ format, maxDecks = 8, fetchImpl = fetch }) {
  const code = MTGTOP8_FORMAT_CODES[format]
  if (!code) throw new Error('Formato MTGTop8 no soportado.')
  const formatUrl = new URL(`format?f=${encodeURIComponent(code)}`, MTGTOP8_BASE_URL).toString()
  const formatHtml = await fetchChecked(formatUrl, fetchImpl, 'text')
  const archetypes = parseMtgtop8FormatPage(formatHtml).slice(0, maxDecks)
  const decks = []

  for (const archetype of archetypes) {
    const archetypeHtml = await fetchChecked(archetype.url, fetchImpl, 'text')
    const deckReference = parseMtgtop8ArchetypePage(archetypeHtml)[0]
    if (!deckReference) continue
    const eventHtml = await fetchChecked(deckReference.eventDeckUrl, fetchImpl, 'text')
    const exportUrl = parseMtgtop8EventDeckPage(eventHtml)
    if (!exportUrl) continue
    const exportSource = await fetchChecked(exportUrl, fetchImpl, 'text')
    const parsedDeck = parseMtgtop8DeckExport(exportSource)
    if (parsedDeck.cards.length === 0) continue
    decks.push({
      externalId: deckReference.deckId,
      name: parsedDeck.name || deckReference.deckName,
      archetype: archetype.name,
      commanderNames: [],
      sourceUrl: deckReference.eventDeckUrl,
      imageUrl: null,
      stats: { metaShare: archetype.metaShare },
      cards: parsedDeck.cards,
    })
  }

  if (decks.length === 0) throw new Error('MTGTop8 no devolvió decks utilizables; no se creará un snapshot.')
  return {
    source: 'mtgtop8',
    format,
    metadata: { requestedDecks: maxDecks, discoveredArchetypes: archetypes.length, collectedDecks: decks.length },
    decks,
  }
}

async function persistSnapshot(client, snapshot) {
  const { data: snapshotRow, error: snapshotError } = await client
    .from('deck_builder_snapshots')
    .insert({
      source: snapshot.source,
      format: snapshot.format,
      status: 'staging',
      fetched_at: new Date().toISOString(),
      metadata: snapshot.metadata,
    })
    .select('id')
    .single()
  if (snapshotError) throw snapshotError

  try {
    let cardCount = 0
    for (let deckIndex = 0; deckIndex < snapshot.decks.length; deckIndex += 1) {
      const deck = snapshot.decks[deckIndex]
      const { data: deckRow, error: deckError } = await client
        .from('deck_builder_decks')
        .insert({
          snapshot_id: snapshotRow.id,
          external_id: deck.externalId,
          name: deck.name,
          archetype: deck.archetype || null,
          commander_names: deck.commanderNames || [],
          source_url: deck.sourceUrl || null,
          image_url: deck.imageUrl || null,
          stats: deck.stats || {},
          payload: {},
          display_order: deckIndex,
        })
        .select('id')
        .single()
      if (deckError) throw deckError

      const cards = deck.cards.map((card, cardIndex) => ({
        deck_id: deckRow.id,
        scryfall_id: card.scryfallId || null,
        name: card.name,
        role: card.role || 'main',
        quantity: card.quantity || 1,
        display_order: cardIndex,
        image_url: card.imageUrl || null,
        type_line: card.typeLine || null,
      }))
      if (cards.length > 0) {
        const { error: cardsError } = await client.from('deck_builder_cards').insert(cards)
        if (cardsError) throw cardsError
      }
      cardCount += cards.length
    }

    const { error: promoteError } = await client.rpc('promote_deck_builder_snapshot', {
      p_snapshot_id: snapshotRow.id,
    })
    if (promoteError) throw promoteError
    return { snapshotId: snapshotRow.id, deckCount: snapshot.decks.length, cardCount }
  } catch (error) {
    await client.from('deck_builder_snapshots').update({ status: 'failed' }).eq('id', snapshotRow.id)
    throw error
  }
}

function loadRuntimeEnvironment() {
  const target = process.env.CRIMSON_OPERATION_TARGET?.trim() || 'local'
  const environmentPath = target === 'local'
    ? path.resolve(SCRIPT_DIRECTORY, '../.env.test.local')
    : path.resolve(SCRIPT_DIRECTORY, '../.env.local')
  if (fs.existsSync(environmentPath)) {
    return import('dotenv').then(({ default: dotenv }) => dotenv.config({ path: environmentPath, override: true }))
  }
  return Promise.resolve()
}

export async function runDeckBuilderSync(options) {
  const snapshot = options.source === 'edhrec'
    ? await collectEdhrecSnapshot(options)
    : await collectMtgtop8Snapshot(options)

  if (options.mode === 'plan') {
    return {
      mode: 'plan', source: snapshot.source, format: snapshot.format,
      decks: snapshot.decks.length,
      cards: snapshot.decks.reduce((total, deck) => total + deck.cards.length, 0),
      writes: 0,
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Faltan credenciales Supabase de Crimson para aplicar el snapshot.')
  const client = createOperationalSupabaseClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const persisted = await persistSnapshot(client, snapshot)
  return { mode: 'apply', source: snapshot.source, format: snapshot.format, ...persisted }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  await loadRuntimeEnvironment()
  const options = parseDeckBuilderSyncCli(process.argv.slice(2))
  const result = await runDeckBuilderSync(options)
  console.log(JSON.stringify(result, null, 2))
}
