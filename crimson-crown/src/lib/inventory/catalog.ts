import { buildCatalogListings, buildVariantKey, type InventoryOffer, type PricingSource } from './domain.ts'

type CatalogRow = Record<string, any>

function isFoilFinish(value: unknown) {
  const finish = String(value || '').toLowerCase()
  return (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched') || finish.includes('holo')
}

function externalPrice(row: CatalogRow | undefined, finish: unknown, source: 'ck' | 'tcg') {
  if (!row) return 0
  const foil = isFoilFinish(finish)
  if (source === 'ck') {
    return Number(foil
      ? (row.cardkingdom_retail_foil || row.cardkingdom_retail_etched || 0)
      : (row.cardkingdom_retail_normal || 0))
  }
  return Number(foil ? (row.tcgplayer_market_foil || 0) : (row.tcgplayer_market_normal || 0))
}

export function inferPricingSource(product: CatalogRow, external?: CatalogRow): PricingSource {
  if (product.is_manual_price) return 'manual'
  if (externalPrice(external, product.finish, 'ck') > 0) return 'cardkingdom'
  if (externalPrice(external, product.finish, 'tcg') > 0 || Number(product.price_usd || 0) > 0) return 'tcgplayer'
  return 'unknown'
}

function toInventoryOffer(product: CatalogRow, external?: CatalogRow): InventoryOffer {
  return {
    productId: String(product.id),
    inventoryId: String(product.inventory_id),
    inventoryKind: product.inventory_kind === 'primary' ? 'primary' : 'secondary',
    variantKey: String(product.variant_key || buildVariantKey({
      tcg: product.tcg,
      scryfallId: product.scryfall_id,
      name: product.name,
      setName: product.set_name,
      collectorNumber: product.collector_number,
      condition: product.condition,
      language: product.language,
      finish: product.finish,
    })),
    stock: Math.max(0, Number(product.stock || 0)),
    priceUsd: Number(product.price_usd || 0),
    pricingSource: inferPricingSource(product, external),
  }
}

export function buildHybridCatalogProducts(
  rows: CatalogRow[],
  externalPrices: Map<string, CatalogRow>,
  options: { activeInventoryIds?: Set<string>; includeOutOfStock?: boolean } = {},
) {
  const activeInventoryIds = options.activeInventoryIds
  const activeRows = rows.filter((row) => {
    const inventoryId = String(row.inventory_id || '')
    return (!activeInventoryIds || activeInventoryIds.has(inventoryId)) && !String(row.name || '').includes('(ARCHIVADO)')
  })
  const inStockRows = activeRows.filter((row) => Number(row.stock || 0) > 0)
  const offers = inStockRows.map((row) => toInventoryOffer(row, externalPrices.get(String(row.scryfall_id || row.id))))
  const listings = buildCatalogListings(offers)
  const rowsById = new Map(activeRows.map((row) => [String(row.id), row]))

  const products = listings.map((listing) => {
    const representative = rowsById.get(listing.productId)
    if (!representative) return null
    const { inventory_id: _inventoryId, inventory_kind: _inventoryKind, variant_key: _variantKey, ...publicProduct } = representative
    return {
      ...publicProduct,
      id: listing.productId,
      stock: listing.stock,
      price_usd: listing.priceUsd,
      inventory_count: listing.inventoryCount,
      pricing_source: listing.pricingSource,
      hybrid_variant_key: listing.variantKey,
    }
  }).filter(Boolean) as CatalogRow[]

  if (options.includeOutOfStock) {
    const groupedVariantKeys = new Set(listings.map((listing) => listing.variantKey))
    for (const row of activeRows.filter((item) => Number(item.stock || 0) <= 0)) {
      const offer = toInventoryOffer(row, externalPrices.get(String(row.scryfall_id || row.id)))
      if (groupedVariantKeys.has(offer.variantKey)) continue
      const { inventory_id: _inventoryId, inventory_kind: _inventoryKind, variant_key: _variantKey, ...publicProduct } = row
      products.push({
        ...publicProduct,
        id: String(row.id),
        stock: 0,
        inventory_count: 0,
        pricing_source: offer.pricingSource,
        hybrid_variant_key: offer.variantKey,
      })
    }
  }

  return products
}
