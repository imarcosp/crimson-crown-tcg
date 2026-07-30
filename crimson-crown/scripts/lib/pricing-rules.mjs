export const MIN_STORE_PRICE = 0.49

export function applyConditionMultiplier(basePrice, condition) {
  const base = Number(basePrice || 0)
  if (!Number.isFinite(base) || base <= 0) return 0

  const cond = String(condition || 'NM').toUpperCase()
  let multiplier = 1.0

  if (cond === 'PL' || cond === 'SP') multiplier = 0.85
  if (cond === 'HP' || cond === 'MP') multiplier = 0.75
  if (cond === 'DMG') multiplier = 0.5

  return base * multiplier
}
