import { load as loadHtml } from 'cheerio'

const EDHREC_TAG_PRIORITY = [
  'highsynergycards',
  'topcards',
  'gamechangers',
  'newcards',
  'manaartifacts',
  'utilitylands',
  'creatures',
  'instants',
  'sorceries',
  'enchantments',
  'utilityartifacts',
  'lands',
]

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

function validUuid(value) {
  const normalized = cleanText(value).toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)
    ? normalized
    : null
}

export function parseEdhrecWeekly(payload, limit = 12) {
  const jsonRoot = payload?.container?.json_dict ?? {}
  const weeklyList = Array.isArray(jsonRoot.cardlists)
    ? jsonRoot.cardlists.find((list) => list?.tag === 'pastweek')
    : null
  const rows = Array.isArray(payload?.cardviews)
    ? payload.cardviews
    : Array.isArray(jsonRoot.cardviews)
      ? jsonRoot.cardviews
      : Array.isArray(weeklyList?.cardviews)
        ? weeklyList.cardviews
        : []

  return rows
    .map((row) => ({
      slug: cleanText(row?.slug || row?.url).replace(/^.*\/commanders\//u, '').replace(/\/?$/u, ''),
      name: cleanText(row?.name),
      deckCount: positiveInteger(row?.num_decks ?? row?.deck_count),
    }))
    .filter((row) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(row.slug) && row.name)
    .slice(0, Math.max(0, positiveInteger(limit, 12)))
}

export function parseEdhrecCommander(slug, payload, options = {}) {
  const root = payload?.container?.json_dict ?? payload?.json_dict ?? payload ?? {}
  const commander = root.card ?? {}
  const maxCards = Math.min(100, positiveInteger(options.maxCards, 99))
  const cards = []
  const seen = new Set()

  const append = (card, role = 'main') => {
    const name = cleanText(card?.name)
    if (!name) return
    const key = name.toLocaleLowerCase('en-US')
    if (seen.has(key) || cards.length >= maxCards + 1) return
    seen.add(key)
    cards.push({
      scryfallId: validUuid(card?.id ?? card?.scryfall_id),
      name,
      quantity: 1,
      role,
      imageUrl: cleanText(card?.image_uris?.normal ?? card?.image_url) || null,
    })
  }

  append(commander, 'commander')
  const lists = Array.isArray(root.cardlists) ? root.cardlists : []
  const orderedLists = [...lists].sort((left, right) => {
    const leftIndex = EDHREC_TAG_PRIORITY.indexOf(cleanText(left?.tag).toLowerCase())
    const rightIndex = EDHREC_TAG_PRIORITY.indexOf(cleanText(right?.tag).toLowerCase())
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
  })
  for (const list of orderedLists) {
    for (const card of Array.isArray(list?.cardviews) ? list.cardviews : []) append(card)
  }

  const externalId = cleanText(slug)
  return {
    externalId,
    name: cleanText(commander.name) || externalId,
    archetype: 'Commander',
    commanderNames: cleanText(commander.name) ? [cleanText(commander.name)] : [],
    sourceUrl: `https://edhrec.com/commanders/${encodeURIComponent(externalId)}`,
    imageUrl: cleanText(commander?.image_uris?.art_crop ?? commander?.image_url) || null,
    stats: { deckCount: positiveInteger(options.deckCount) },
    cards,
  }
}

export function parseMtgtop8FormatPage(html) {
  const $ = loadHtml(String(html ?? ''))
  const results = []
  $('.hover_tr').each((index, element) => {
    const row = $(element)
    const anchor = row.find('a[href*="archetype"]').first()
    const href = anchor.attr('href')
    const name = cleanText(anchor.text())
    if (!href || !name) return
    const image = row.find('img').first().attr('src') ?? ''
    const imageMatch = image.match(/metas_thumbs\/([^./]+)/u)
    const queryMatch = href.match(/[?&]a=([^&]+)/u)
    const percentText = cleanText(row.find('.S14').first().text() || row.text())
    const percentMatch = percentText.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/u)
    results.push({
      id: cleanText(imageMatch?.[1] ?? queryMatch?.[1] ?? String(index + 1)),
      name,
      metaShare: percentMatch ? Number(percentMatch[1].replace(',', '.')) / 100 : null,
      url: new URL(href, 'https://www.mtgtop8.com/').toString(),
    })
  })
  return results
}

export function parseMtgtop8ArchetypePage(html) {
  const $ = loadHtml(String(html ?? ''))
  const decks = []
  const seen = new Set()
  $('input[type="hidden"][name^="deck_ref["]').each((_index, element) => {
    const deckId = cleanText($(element).attr('value'))
    const row = $(element).closest('tr')
    const anchor = row.find('a[href*="event?"][href*="&d="]').first()
    const href = anchor.attr('href')
    if (!deckId || !href || seen.has(deckId)) return
    seen.add(deckId)
    decks.push({
      deckId,
      deckName: cleanText(anchor.text()) || `Deck ${deckId}`,
      eventDeckUrl: new URL(href, 'https://www.mtgtop8.com/').toString(),
    })
  })
  return decks
}

export function parseMtgtop8EventDeckPage(html) {
  const $ = loadHtml(String(html ?? ''))
  const href = $('a[href*="dec?d="]').first().attr('href')
  return href ? new URL(href, 'https://www.mtgtop8.com/').toString() : null
}

export function parseMtgtop8DeckExport(source) {
  let name = ''
  const cards = []
  for (const rawLine of String(source ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) continue
    const nameMatch = line.match(/^\/\/\s*NAME\s*:\s*(.+)$/iu)
    if (nameMatch) {
      name = cleanText(nameMatch[1])
      continue
    }
    const cardMatch = line.match(/^(SB:\s*)?(\d+)\s+(?:\[[^\]]+\]\s*)?(.+)$/iu)
    if (!cardMatch) continue
    const cardName = cleanText(cardMatch[3]).replace(/\s+\*[^*]+\*\s*$/u, '')
    const quantity = positiveInteger(cardMatch[2])
    if (!cardName || !quantity) continue
    cards.push({ name: cardName, quantity, role: cardMatch[1] ? 'sideboard' : 'main' })
  }
  return { name, cards }
}
