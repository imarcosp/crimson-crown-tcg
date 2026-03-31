import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs))
}

export const CONDITION_MULTIPLIERS: Record<string, number> = {
  NM: 1.0,
  LP: 0.85,
  PL: 0.85,
  MP: 0.7,
  HP: 0.7,
  Dmg: 0.4,
  Damage: 0.4,
}

export function getPriceForCondition(basePrice: number, condition: string): number {
  const cond = (condition || 'NM').trim()
  const multiplier = CONDITION_MULTIPLIERS[cond] || CONDITION_MULTIPLIERS[cond.toUpperCase()] || 1.0
  return basePrice * multiplier
}
