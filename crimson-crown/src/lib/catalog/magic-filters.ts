export const MAGIC_FORMAT_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'modern', label: 'Modern' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'commander', label: 'Commander' },
  { value: 'pauper', label: 'Pauper' },
  { value: 'brawl', label: 'Brawl' },
] as const

export type MagicFormat = (typeof MAGIC_FORMAT_OPTIONS)[number]['value']

export type PriceRange = {
  min: number | null
  max: number | null
  isValid: boolean
  isActive: boolean
}

function parsePriceBoundary(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return { value: null, isValid: true }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, isValid: false }
  }

  return { value: parsed, isValid: true }
}

export function parsePriceRange(rawMin: unknown, rawMax: unknown): PriceRange {
  const parsedMin = parsePriceBoundary(rawMin)
  const parsedMax = parsePriceBoundary(rawMax)
  const isActive = parsedMin.value !== null || parsedMax.value !== null
  const ordered = parsedMin.value === null || parsedMax.value === null || parsedMin.value <= parsedMax.value

  return {
    min: parsedMin.value,
    max: parsedMax.value,
    isValid: parsedMin.isValid && parsedMax.isValid && ordered,
    isActive,
  }
}

export function matchesPriceRange(price: unknown, range: PriceRange) {
  if (!range.isValid) return false
  if (!range.isActive) return true

  const value = Number(price)
  if (!Number.isFinite(value) || value < 0) return false
  if (range.min !== null && value < range.min) return false
  if (range.max !== null && value > range.max) return false
  return true
}

export function normalizeMagicFormat(value: unknown): MagicFormat | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  const match = MAGIC_FORMAT_OPTIONS.find((option) => option.value === normalized)
  return match?.value ?? null
}

export function matchesMagicFormat(legalities: unknown, format: MagicFormat | null) {
  if (!format) return true
  if (!legalities || typeof legalities !== 'object' || Array.isArray(legalities)) return false

  const status = String((legalities as Record<string, unknown>)[format] ?? '').trim().toLowerCase()
  return status === 'legal' || status === 'restricted'
}
