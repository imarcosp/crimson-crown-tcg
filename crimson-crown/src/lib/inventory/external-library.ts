export type ExternalLibraryRow = {
  scryfall_id: string
  name: string
  set_name?: string | null
  collector_number?: string | null
  image_url?: string | null
  rarity?: string | null
  type_line?: string | null
  color_identity?: string[] | null
  foil_variant?: string | null
  cardkingdom_retail_normal?: number | string | null
  cardkingdom_retail_foil?: number | string | null
  cardkingdom_retail_etched?: number | string | null
  tcgplayer_market_normal?: number | string | null
  tcgplayer_market_foil?: number | string | null
  active_price_normal?: number | string | null
  active_price_foil?: number | string | null
}

function positivePrice(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function externalLibraryRowToSuggestion(row: ExternalLibraryRow) {
  const cardkingdomNormal = positivePrice(row.cardkingdom_retail_normal)
  const cardkingdomFoil = positivePrice(row.cardkingdom_retail_foil)
  const cardkingdomEtched = positivePrice(row.cardkingdom_retail_etched)
  const tcgplayerNormal = positivePrice(row.tcgplayer_market_normal)
  const tcgplayerFoil = positivePrice(row.tcgplayer_market_foil)
  const normalPrice = cardkingdomNormal || tcgplayerNormal
  const foilPrice = cardkingdomFoil || cardkingdomEtched || tcgplayerFoil
  const foilVariant = String(row.foil_variant || '').trim()
  const hasEtched = cardkingdomEtched > 0 || foilVariant.toLowerCase().includes('etched')
  const hasFoil = cardkingdomFoil > 0 || tcgplayerFoil > 0 || hasEtched
  const finishes = [
    normalPrice > 0 || !hasFoil ? 'nonfoil' : null,
    hasFoil ? 'foil' : null,
    hasEtched ? 'etched' : null,
  ].filter(Boolean) as string[]

  return {
    id: row.scryfall_id,
    scryfall_id: row.scryfall_id,
    name: row.name,
    set_name: row.set_name || '',
    collector_number: row.collector_number || '',
    image_url: row.image_url || '',
    price_usd: normalPrice,
    price_usd_foil: foilPrice,
    priceUsd: normalPrice,
    priceUsdFoil: foilPrice,
    stock: 0,
    stock_foil: 0,
    tcg: 'Magic',
    condition: 'NM',
    language: 'English',
    finish: normalPrice > 0 || !hasFoil ? 'Non-Foil' : (foilVariant || 'Foil'),
    rarity: row.rarity || undefined,
    isImport: true,
    search_source: 'external_prices' as const,
    finishes: finishes.length > 0 ? finishes : ['nonfoil'],
    type_line: row.type_line || null,
    color_identity: Array.isArray(row.color_identity) ? row.color_identity : [],
    pricing_source: cardkingdomNormal || cardkingdomFoil || cardkingdomEtched
      ? 'cardkingdom' as const
      : tcgplayerNormal || tcgplayerFoil
        ? 'tcgplayer' as const
        : 'unknown' as const,
  }
}
