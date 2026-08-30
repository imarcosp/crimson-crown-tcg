const COMMISSION_TIMEZONE = 'America/Argentina/Buenos_Aires'
export const COMMISSION_START_PERIOD_KEY = '2026-06'

function parsePeriodKey(periodKey: string) {
  const [year, month] = periodKey.split('-').map(Number)
  return { year, month }
}

export function getCurrentCommissionMonthKey(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: COMMISSION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  })

  const parts = formatter.formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value

  return `${year}-${month}`
}

export function shiftCommissionMonthKey(periodKey: string, offset: number) {
  const { year, month } = parsePeriodKey(periodKey)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${nextYear}-${nextMonth}`
}

export function isBeforeCommissionStart(periodKey: string) {
  return periodKey < COMMISSION_START_PERIOD_KEY
}

export function clampCommissionMonthKey(periodKey: string) {
  return isBeforeCommissionStart(periodKey) ? COMMISSION_START_PERIOD_KEY : periodKey
}

export function formatCommissionPeriodLabel(periodKey: string) {
  const { year, month } = parsePeriodKey(periodKey)
  // Use mid-month at noon UTC to avoid crossing into the previous month when formatting in AR timezone.
  const date = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0))
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: COMMISSION_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatUsd(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return `US$ ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatArs(value: number | string | null | undefined) {
  const amount = Number(value || 0)
  return `$ ${amount.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function getPreviousCommissionMonthKey(now = new Date()) {
  return shiftCommissionMonthKey(getCurrentCommissionMonthKey(now), -1)
}

export function getClientPayableCommissionMonthKey(
  now = new Date(),
  env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: process.env.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF,
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: process.env.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET,
  },
) {
  if (isExactStagingEnvironment(env)) return '2099-12'
  return clampCommissionMonthKey(getPreviousCommissionMonthKey(now))
}

export function isPastCommissionMonth(periodKey: string) {
  return periodKey < getCurrentCommissionMonthKey()
}
import { isExactStagingEnvironment } from './auth/admin-access.ts'
