export type LanguageBadge = {
  label: string
  flagSrc: string | null
}

const LANGUAGE_BADGES: Record<string, LanguageBadge> = {
  English: { label: 'Inglés', flagSrc: '/flags/gb.svg' },
  Spanish: { label: 'Español', flagSrc: '/flags/es.svg' },
  Japanese: { label: 'Japonés', flagSrc: '/flags/jp.svg' },
  Portuguese: { label: 'Portugués', flagSrc: '/flags/pt.svg' },
  Italian: { label: 'Italiano', flagSrc: '/flags/it.svg' },
  German: { label: 'Alemán', flagSrc: '/flags/de.svg' },
  French: { label: 'Francés', flagSrc: '/flags/fr.svg' },
  Chinese: { label: 'Chino', flagSrc: '/flags/cn.svg' },
  Russian: { label: 'Ruso', flagSrc: '/flags/ru.svg' },
  Korean: { label: 'Coreano', flagSrc: '/flags/kr.svg' },
}

export function getLanguageBadge(language?: string | null): LanguageBadge | null {
  if (!language) return null

  const normalized = String(language).trim()
  if (!normalized) return null

  return LANGUAGE_BADGES[normalized] || { label: normalized, flagSrc: null }
}
