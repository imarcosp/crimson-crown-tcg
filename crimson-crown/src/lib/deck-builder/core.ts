export const DECK_BUILDER_FORMATS = [
  { slug: 'commander', label: 'Commander', source: 'edhrec', order: 10 },
  { slug: 'standard', label: 'Standard', source: 'mtgtop8', order: 20 },
  { slug: 'pioneer', label: 'Pioneer', source: 'mtgtop8', order: 30 },
  { slug: 'modern', label: 'Modern', source: 'mtgtop8', order: 40 },
  { slug: 'legacy', label: 'Legacy', source: 'mtgtop8', order: 50 },
  { slug: 'vintage', label: 'Vintage', source: 'mtgtop8', order: 60 },
  { slug: 'pauper', label: 'Pauper', source: 'mtgtop8', order: 70 },
  { slug: 'premodern', label: 'Premodern', source: 'mtgtop8', order: 80 },
  { slug: 'duel-commander', label: 'Duel Commander', source: 'mtgtop8', order: 90 },
] as const

export type DeckBuilderFormat = (typeof DECK_BUILDER_FORMATS)[number]
export type DeckBuilderFormatSlug = DeckBuilderFormat['slug']
export type DeckBuilderCardRole = 'commander' | 'main' | 'sideboard' | 'companion' | 'maybeboard'

export function getDeckBuilderFormat(value: string | undefined | null): DeckBuilderFormat | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return DECK_BUILDER_FORMATS.find((format) => format.slug === normalized) ?? null
}

export function normalizeDeckBuilderSearch(value: string | undefined | null): string {
  const normalized = value?.trim().replace(/\s+/gu, ' ') ?? ''
  if (normalized.length > 80 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('La búsqueda no es válida.')
  }
  return normalized
}

type CoverageInput = {
  quantity: number
  availableLocalQuantity: number
}

export type DeckCoverage = {
  requiredUniqueCards: number
  coveredUniqueCards: number
  requiredQuantity: number
  availableLocalQuantity: number
  missingLocalQuantity: number
  coveragePercent: number
}

export function calculateDeckCoverage(cards: CoverageInput[]): DeckCoverage {
  const requiredUniqueCards = cards.length
  let coveredUniqueCards = 0
  let requiredQuantity = 0
  let availableLocalQuantity = 0

  for (const card of cards) {
    const required = Math.max(0, Math.trunc(Number(card.quantity) || 0))
    const available = Math.max(0, Math.trunc(Number(card.availableLocalQuantity) || 0))
    const covered = Math.min(required, available)
    if (covered > 0) coveredUniqueCards += 1
    requiredQuantity += required
    availableLocalQuantity += covered
  }

  return {
    requiredUniqueCards,
    coveredUniqueCards,
    requiredQuantity,
    availableLocalQuantity,
    missingLocalQuantity: Math.max(0, requiredQuantity - availableLocalQuantity),
    coveragePercent: requiredUniqueCards === 0
      ? 0
      : Math.round((coveredUniqueCards / requiredUniqueCards) * 100),
  }
}

type RoleCarrier = { role?: string | null }

export function groupDeckCards<T extends RoleCarrier>(cards: T[]) {
  const commanders: T[] = []
  const mainboard: T[] = []
  const sideboard: T[] = []
  const companions: T[] = []
  const maybeboard: T[] = []

  for (const card of cards) {
    switch (card.role) {
      case 'commander': commanders.push(card); break
      case 'sideboard': sideboard.push(card); break
      case 'companion': companions.push(card); break
      case 'maybeboard': maybeboard.push(card); break
      default: mainboard.push(card)
    }
  }

  return { commanders, mainboard, sideboard, companions, maybeboard }
}
