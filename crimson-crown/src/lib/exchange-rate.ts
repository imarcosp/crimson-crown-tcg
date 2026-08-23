import { EXCHANGE_RATE as DEFAULT_EXCHANGE_RATE } from './constants.ts'

export const EXCHANGE_RATE = DEFAULT_EXCHANGE_RATE

export function parseStoredExchangeRate(stored: string | null): number {
  if (!stored) return EXCHANGE_RATE

  const parsed = Number(stored)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : EXCHANGE_RATE
}
