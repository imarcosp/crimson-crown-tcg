export const QUICK_LINK_ICON_OPTIONS = [
  { value: 'sparkles', label: 'Destacado' },
  { value: 'crown', label: 'Corona' },
  { value: 'package', label: 'Producto' },
  { value: 'shopping-bag', label: 'Tienda' },
  { value: 'search', label: 'Buscar' },
  { value: 'tag', label: 'Oferta' },
  { value: 'heart', label: 'Favoritos' },
  { value: 'truck', label: 'Envíos' },
] as const

export type QuickLinkIconKey = (typeof QUICK_LINK_ICON_OPTIONS)[number]['value']

export type NormalizedQuickLinkInput = {
  label: string
  url: string
  imageUrl: string | null
  iconKey: QuickLinkIconKey
  displayOrder: number
  active: boolean
}

export type HomeQuickLinkRecord = {
  id: string
  label: string
  url: string
  image_url: string | null
  icon_key: QuickLinkIconKey
  display_order: number
  active: boolean
  created_at: string
  updated_at: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function invalidUrl(): never {
  throw new Error('URL inválida para el acceso rápido.')
}

export function normalizeQuickLinkUrl(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 500 || /[\u0000-\u001f\u007f\\]/u.test(raw)) invalidUrl()

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) invalidUrl()
    return raw
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    invalidUrl()
  }

  if (parsed.username || parsed.password) invalidUrl()
  if (parsed.protocol === 'https:') return parsed.toString()
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return parsed.toString()
  invalidUrl()
}

function normalizeLabel(value: unknown) {
  const label = String(value ?? '').trim().replace(/\s+/gu, ' ')
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error('La etiqueta del acceso rápido es inválida.')
  }
  return label
}

function normalizeIconKey(value: unknown): QuickLinkIconKey {
  const normalized = String(value ?? '').trim().toLowerCase()
  return QUICK_LINK_ICON_OPTIONS.find((option) => option.value === normalized)?.value ?? 'sparkles'
}

function normalizeDisplayOrder(value: unknown) {
  const order = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isSafeInteger(order) || order < 0 || order > 9999) {
    throw new Error('El orden del acceso rápido es inválido.')
  }
  return order
}

function normalizeActive(value: unknown) {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return true
  if (value === 'true') return true
  if (value === 'false') return false
  return Boolean(value)
}

export function normalizeQuickLinkInput(value: unknown): NormalizedQuickLinkInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El acceso rápido es inválido.')
  }

  const input = value as Record<string, unknown>
  const rawImageUrl = String(input.imageUrl ?? '').trim()

  return {
    label: normalizeLabel(input.label),
    url: normalizeQuickLinkUrl(input.url),
    imageUrl: rawImageUrl ? normalizeQuickLinkUrl(rawImageUrl) : null,
    iconKey: normalizeIconKey(input.iconKey),
    displayOrder: normalizeDisplayOrder(input.displayOrder),
    active: normalizeActive(input.active),
  }
}
