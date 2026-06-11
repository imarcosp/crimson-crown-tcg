export type ExternalPriceFinishContext = {
  foil_variant?: string | null
  active_price_normal?: number | string | null
  active_price_foil?: number | string | null
  cardkingdom_retail_normal?: number | string | null
  cardkingdom_retail_foil?: number | string | null
  cardkingdom_retail_etched?: number | string | null
  tcgplayer_market_normal?: number | string | null
  tcgplayer_market_foil?: number | string | null
}

function toPositiveNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function titleizeFinish(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function finishKeyToValue(key: string) {
  const k = String(key || '').toLowerCase().trim()
  if (k === 'nonfoil') return 'Non-Foil'
  if (k === 'foil') return 'Foil'
  if (k === 'etched') return 'Etched Foil'
  if (!k) return 'Non-Foil'
  return canonicalizeMagicFinishLabel(k)
}

export function finishKeyToLabel(key: string) {
  const k = String(key || '').toLowerCase().trim()
  if (k === 'nonfoil') return 'Normal / Non-Foil'
  if (k === 'foil') return 'Foil'
  if (k === 'etched') return 'Etched Foil'
  return finishKeyToValue(k)
}

export function finishValueToKey(value: string) {
  const v = String(value || '').toLowerCase()
  if (v.includes('etched')) return 'etched'
  if (v.includes('non') && v.includes('foil')) return 'nonfoil'
  if (
    v.includes('foil') ||
    v.includes('holo') ||
    v.includes('surge') ||
    v.includes('ripple') ||
    v.includes('halo') ||
    v.includes('confetti') ||
    v.includes('galaxy') ||
    v.includes('gilded') ||
    v.includes('raised') ||
    v.includes('glossy')
  ) {
    return 'foil'
  }
  return 'nonfoil'
}

export function canonicalizeMagicFinishLabel(value: string) {
  const raw = String(value || '').trim()
  const lower = raw.toLowerCase()

  if (!raw) return 'Non-Foil'
  if (lower === 'nonfoil' || lower === 'non-foil' || lower === 'normal') return 'Non-Foil'
  if (lower === 'foil') return 'Foil'
  if (lower === 'etched' || lower === 'etched foil') return 'Etched Foil'
  if (lower.includes('non') && lower.includes('foil')) return 'Non-Foil'
  if (lower.includes('etched')) return 'Etched Foil'
  if (lower.includes('foil')) return titleizeFinish(lower)
  return titleizeFinish(lower)
}

export function resolveMagicFinishSelection(
  desiredFinish: string,
  availableFinishKeys?: string[] | null,
  externalContext?: ExternalPriceFinishContext | null
) {
  const desiredLabel = canonicalizeMagicFinishLabel(desiredFinish)
  const desiredKey = finishValueToKey(desiredLabel)
  const availableKeys = Array.isArray(availableFinishKeys)
    ? Array.from(new Set(availableFinishKeys.map((key) => String(key || '').toLowerCase().trim()).filter(Boolean)))
    : []

  if (availableKeys.length > 0) {
    if (availableKeys.includes(desiredKey)) {
      return finishKeyToValue(desiredKey)
    }

    const bestFallbackKey =
      availableKeys.find((key) => key === 'etched') ||
      availableKeys.find((key) => !['nonfoil', 'foil'].includes(key)) ||
      availableKeys.find((key) => key === 'foil') ||
      availableKeys[0]

    return bestFallbackKey ? finishKeyToValue(bestFallbackKey) : desiredLabel
  }

  if (!externalContext) return desiredLabel

  const hasNormal =
    toPositiveNumber(externalContext.active_price_normal) > 0 ||
    toPositiveNumber(externalContext.cardkingdom_retail_normal) > 0 ||
    toPositiveNumber(externalContext.tcgplayer_market_normal) > 0

  const hasFoil =
    toPositiveNumber(externalContext.active_price_foil) > 0 ||
    toPositiveNumber(externalContext.cardkingdom_retail_etched) > 0 ||
    toPositiveNumber(externalContext.cardkingdom_retail_foil) > 0 ||
    toPositiveNumber(externalContext.tcgplayer_market_foil) > 0

  const foilLabel = canonicalizeMagicFinishLabel(externalContext.foil_variant || 'Foil')

  if (desiredKey === 'nonfoil' && !hasNormal && hasFoil) {
    return foilLabel
  }

  if (desiredKey !== 'nonfoil' && !hasFoil && hasNormal) {
    return 'Non-Foil'
  }

  return desiredLabel
}

export function getReferencePriceForFinish(
  externalContext: ExternalPriceFinishContext | null | undefined,
  finish: string
) {
  if (!externalContext) return 0

  const finishKey = finishValueToKey(finish)
  const ckNormal = toPositiveNumber(externalContext.cardkingdom_retail_normal)
  const ckFoil = toPositiveNumber(externalContext.cardkingdom_retail_foil)
  const ckEtched = toPositiveNumber(externalContext.cardkingdom_retail_etched) || ckFoil
  const tcgNormal = toPositiveNumber(externalContext.tcgplayer_market_normal)
  const tcgFoil = toPositiveNumber(externalContext.tcgplayer_market_foil)

  if (finishKey === 'etched') return ckEtched || tcgFoil
  if (finishKey === 'foil') return ckFoil || tcgFoil
  return ckNormal || tcgNormal
}
