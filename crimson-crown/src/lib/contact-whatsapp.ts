export function cleanSystemSettingValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      return typeof parsed === 'string' ? parsed.trim() : trimmed
    } catch {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

export function normalizeWhatsAppNumber(value: unknown): string {
  const raw = cleanSystemSettingValue(value).replace(/\D/g, '')
  if (!raw) return ''

  if (raw.startsWith('549')) return raw
  if (raw.startsWith('54')) {
    const national = raw.slice(2)
    return national.startsWith('9') ? `54${national}` : `549${national}`
  }
  if (raw.startsWith('0')) return `549${raw.slice(1)}`
  return `549${raw}`
}

export function buildWhatsAppUrl(phone: unknown, message: string): string {
  const normalized = normalizeWhatsAppNumber(phone)
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}
