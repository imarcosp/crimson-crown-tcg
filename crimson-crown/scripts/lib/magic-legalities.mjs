const LEGALITY_STATUSES = new Set(['legal', 'not_legal', 'restricted', 'banned'])

function stableObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

export function normalizeScryfallLegalities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const entries = []
  for (const [rawKey, rawStatus] of Object.entries(value)) {
    const key = String(rawKey || '').trim().toLowerCase()
    const status = String(rawStatus || '').trim().toLowerCase()
    if (!/^[a-z0-9_]+$/.test(key) || !LEGALITY_STATUSES.has(status)) continue
    entries.push([key, status])
  }

  return stableObject(Object.fromEntries(entries))
}

export function chunkScryfallIdentifiers(ids, size = 75) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
  const batches = []
  for (let index = 0; index < uniqueIds.length; index += size) {
    batches.push(uniqueIds.slice(index, index + size).map((id) => ({ id })))
  }
  return batches
}

export function buildLegalityUpdates(cards, currentLegalities) {
  const updates = []
  let unchanged = 0
  let skipped = 0

  for (const card of cards) {
    const id = String(card?.id || '').trim()
    if (!id || !currentLegalities.has(id)) {
      skipped++
      continue
    }

    const legalities = normalizeScryfallLegalities(card?.legalities)
    const current = normalizeScryfallLegalities(currentLegalities.get(id))
    if (JSON.stringify(legalities) === JSON.stringify(current)) {
      unchanged++
      continue
    }

    updates.push({ scryfall_id: id, legalities })
  }

  return { updates, unchanged, skipped }
}
