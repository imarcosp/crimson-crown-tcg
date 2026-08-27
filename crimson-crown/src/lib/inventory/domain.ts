export type VariantIdentity = {
  tcg?: unknown
  scryfallId?: unknown
  name?: unknown
  setName?: unknown
  collectorNumber?: unknown
  condition?: unknown
  language?: unknown
  finish?: unknown
}

export type InventoryKind = 'primary' | 'secondary'
export type PricingSource = 'cardkingdom' | 'tcgplayer' | 'manual' | 'unknown'

export type InventoryOffer = {
  productId: string
  inventoryId: string
  inventoryKind: InventoryKind
  variantKey: string
  stock: number
  priceUsd: number
  pricingSource: PricingSource
}

export type CatalogOffer = {
  productId: string
  inventoryId: string
  inventoryKind: InventoryKind
  pricingSource: PricingSource
  priceUsd: number
  stock: number
  inventoryCount: number
}

export type CatalogListing = {
  variantKey: string
  productId: string
  inventoryId: string
  priceUsd: number
  stock: number
  pricingSource: PricingSource
  inventoryCount: number
}

export type CatalogGroup = {
  variantKey: string
  totalStock: number
  representative: InventoryOffer
  offers: CatalogOffer[]
}

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function normalizeFinish(value: unknown) {
  const finish = normalize(value).replace(/[\s_-]+/g, '')
  if (finish === 'normal' || finish === 'nonfoil') return 'nonfoil'
  if (finish === 'foil') return 'foil'
  if (finish === 'etched' || finish === 'etchedfoil') return 'etched'
  return finish
}

export function buildVariantKey(input: VariantIdentity): string {
  const tcg = normalize(input.tcg)
  const scryfallId = normalize(input.scryfallId)
  const shared = [
    normalize(input.condition),
    normalize(input.language),
    normalizeFinish(input.finish),
  ]

  if (scryfallId && tcg === 'magic') {
    return ['magic', 'print', scryfallId, ...shared].join('\u001f')
  }

  return [
    'tcg',
    tcg,
    normalize(input.name),
    normalize(input.setName),
    normalize(input.collectorNumber),
    ...shared,
  ].join('\u001f')
}

function offerOrder(a: InventoryOffer, b: InventoryOffer) {
  if (a.inventoryKind !== b.inventoryKind) return a.inventoryKind === 'primary' ? -1 : 1
  return a.inventoryId.localeCompare(b.inventoryId) || a.productId.localeCompare(b.productId)
}

export function allocateOffers(offers: InventoryOffer[], requestedQuantity: number) {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { allocations: [] as Array<{ offer: InventoryOffer; quantity: number }>, remaining: requestedQuantity }
  }

  let remaining = requestedQuantity
  const allocations: Array<{ offer: InventoryOffer; quantity: number }> = []

  for (const offer of offers.filter((item) => Number.isInteger(item.stock) && item.stock > 0).slice().sort(offerOrder)) {
    if (remaining === 0) break
    const quantity = Math.min(remaining, offer.stock)
    allocations.push({ offer, quantity })
    remaining -= quantity
  }

  return { allocations, remaining }
}

const pricingOrder: PricingSource[] = ['cardkingdom', 'tcgplayer', 'manual', 'unknown']
const automaticSources = new Set<PricingSource>(['cardkingdom', 'tcgplayer'])

export function groupOffers(offers: InventoryOffer[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>()

  for (const offer of offers.filter((item) => item.stock > 0)) {
    const current = groups.get(offer.variantKey)
    if (!current) {
      groups.set(offer.variantKey, {
        variantKey: offer.variantKey,
        totalStock: offer.stock,
        representative: offer,
        offers: [{
          productId: offer.productId,
          inventoryId: offer.inventoryId,
          inventoryKind: offer.inventoryKind,
          pricingSource: offer.pricingSource,
          priceUsd: offer.priceUsd,
          stock: offer.stock,
          inventoryCount: 1,
        }],
      })
      continue
    }

    current.totalStock += offer.stock
    if (offerOrder(offer, current.representative) < 0) current.representative = offer
    const merged = current.offers.find((item) => {
      const samePrice = item.priceUsd === offer.priceUsd
      const sameSource = item.pricingSource === offer.pricingSource
      const bothAutomatic = automaticSources.has(item.pricingSource) && automaticSources.has(offer.pricingSource)
      return samePrice && (sameSource || bothAutomatic)
    })
    if (merged) {
      merged.stock += offer.stock
      merged.inventoryCount += 1
      if (pricingOrder.indexOf(offer.pricingSource) < pricingOrder.indexOf(merged.pricingSource)) {
        merged.pricingSource = offer.pricingSource
      }
      if (offerOrder(offer, {
        productId: merged.productId,
        inventoryId: merged.inventoryId,
        inventoryKind: merged.inventoryKind,
        variantKey: current.variantKey,
        stock: 0,
        priceUsd: merged.priceUsd,
        pricingSource: merged.pricingSource,
      }) < 0) {
        merged.productId = offer.productId
        merged.inventoryId = offer.inventoryId
        merged.inventoryKind = offer.inventoryKind
      }
    } else {
      current.offers.push({
        productId: offer.productId,
        inventoryId: offer.inventoryId,
        inventoryKind: offer.inventoryKind,
        pricingSource: offer.pricingSource,
        priceUsd: offer.priceUsd,
        stock: offer.stock,
        inventoryCount: 1,
      })
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    offers: group.offers.slice().sort((a, b) => {
      const sourceDiff = pricingOrder.indexOf(a.pricingSource) - pricingOrder.indexOf(b.pricingSource)
      return sourceDiff || a.priceUsd - b.priceUsd
    }),
  }))
}

export function buildCatalogListings(offers: InventoryOffer[]): CatalogListing[] {
  return groupOffers(offers).flatMap((group) => group.offers.map((offer) => ({
    variantKey: group.variantKey,
    productId: offer.productId,
    inventoryId: offer.inventoryId,
    priceUsd: offer.priceUsd,
    stock: offer.stock,
    pricingSource: offer.pricingSource,
    inventoryCount: offer.inventoryCount,
  })))
}
