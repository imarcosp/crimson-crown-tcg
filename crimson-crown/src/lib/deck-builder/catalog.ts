import { buildHybridCatalogProducts } from '../inventory/catalog.ts'
import { externalLibraryRowToSuggestion, type ExternalLibraryRow } from '../inventory/external-library.ts'

type CatalogRow = Record<string, unknown>

export type DeckBuilderCatalogCard = {
  id: string
  name: string
  quantity: number
  role: string
  scryfall_id?: string | null
  display_order?: number
  image_url?: string | null
  type_line?: string | null
}

export type EnrichedDeckBuilderCard = DeckBuilderCatalogCard & {
  availableLocalQuantity: number
  localProduct: CatalogRow | null
  importSuggestion: (ReturnType<typeof externalLibraryRowToSuggestion> & { price: number }) | null
}

function normalizedName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function matchDeckCardsToCatalog(
  cards: DeckBuilderCatalogCard[],
  productRows: CatalogRow[],
  externalRows: CatalogRow[],
): EnrichedDeckBuilderCard[] {
  const externalByScryfallId = new Map<string, CatalogRow>()
  const externalByName = new Map<string, CatalogRow>()
  for (const row of externalRows) {
    if (row.scryfall_id) externalByScryfallId.set(String(row.scryfall_id), row)
    const nameKey = normalizedName(row.name)
    if (nameKey && !externalByName.has(nameKey)) externalByName.set(nameKey, row)
  }

  const hybridProducts = buildHybridCatalogProducts(productRows, externalByScryfallId) as CatalogRow[]

  return cards.map((card) => {
    const scryfallId = String(card.scryfall_id || '')
    const nameKey = normalizedName(card.name)
    const localMatches = hybridProducts.filter((product) => (
      (scryfallId && String(product.scryfall_id || '') === scryfallId)
      || (!scryfallId && normalizedName(product.name) === nameKey)
    ))
    const availableLocalQuantity = localMatches.reduce(
      (total, product) => total + Math.max(0, Number(product.stock || 0)),
      0,
    )
    const localProduct = localMatches.slice().sort((left, right) => {
      const leftPrice = positiveNumber(left.price_usd) || Number.POSITIVE_INFINITY
      const rightPrice = positiveNumber(right.price_usd) || Number.POSITIVE_INFINITY
      return leftPrice - rightPrice || String(left.id).localeCompare(String(right.id))
    })[0] ?? null
    const external = (scryfallId && externalByScryfallId.get(scryfallId)) || externalByName.get(nameKey)

    const importSuggestion = external ? externalLibraryRowToSuggestion(external as ExternalLibraryRow) : null
    return {
      ...card,
      availableLocalQuantity,
      localProduct,
      importSuggestion: importSuggestion ? { ...importSuggestion, price: importSuggestion.priceUsd } : null,
    }
  })
}
