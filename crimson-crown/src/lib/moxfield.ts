import { siteConfig } from '@/config/site'

const siteOrigin = new URL(siteConfig.url).origin

export const MOXFIELD_HEADER_PROFILES = [
  {
    label: 'site-origin',
    headers: {
      'User-Agent': `CrimsonCrownTCG/1.0 (${siteOrigin})`,
      'Accept': 'application/json, text/plain, */*',
      'Origin': siteOrigin,
      'Referer': `${siteOrigin}/`,
    },
  },
  {
    label: 'minimal',
    headers: {
      'User-Agent': `CrimsonCrownTCG/1.0 (${siteOrigin})`,
      'Accept': 'application/json, text/plain, */*',
    },
  },
] as const

export function extractMoxfieldDeckId(url: string | null | undefined) {
  const match = String(url || '').match(/moxfield\.com\/decks\/([a-zA-Z0-9\-_]+)/i)
  return match?.[1] || null
}

export function buildCardsToProcessFromMoxfieldData(data: any) {
  const cards: any[] = []
  const zones = ['mainboard', 'sideboard', 'commanders', 'commander', 'companions', 'signatureSpells', 'attractions', 'stickers']

  zones.forEach((zone) => {
    const entries = data?.[zone]
    if (!entries) return

    Object.values(entries as Record<string, any>).forEach((entry: any) => {
      const card = entry?.card
      if (!card?.name) return

      let finish = 'nonfoil'
      if (entry?.printingData?.[0]?.finish === 'etched' || card?.finish === 'etched' || entry?.finish === 'etched') finish = 'etched'
      else if (entry?.printingData?.[0]?.finish === 'foil' || card?.finish === 'foil' || entry?.finish === 'foil') finish = 'foil'

      cards.push({
        quantity: entry?.quantity,
        name: card?.name,
        set: card?.set,
        set_name: card?.set_name,
        cn: card?.cn,
        finish,
        image_url: card?.image_uris?.normal || card?.card_faces?.[0]?.image_uris?.normal,
        price_usd: parseFloat(String(card?.prices?.usd || 0)),
        price_usd_foil: parseFloat(String(card?.prices?.usd_foil || 0)),
        scryfall_id: card?.scryfall_id || card?.id,
      })
    })
  })

  return cards
}

function pickMoxfieldDebugHeaders(res: Response) {
  const keys = ['cf-ray', 'cf-cache-status', 'server', 'content-type', 'retry-after', 'x-openai-public-ip', 'x-ipcountry']
  return Object.fromEntries(
    keys
      .map((key) => [key, res.headers.get(key)])
      .filter(([, value]) => Boolean(value))
  )
}

export async function fetchMoxfieldDeckWithDiagnostics(deckId: string, requestId: string) {
  const endpoints = [
    `https://api2.moxfield.com/v2/decks/all/${deckId}`,
    `https://api.moxfield.com/v2/decks/all/${deckId}`,
  ]

  const attempts: Array<{
    url: string
    headerProfile: string
    status?: number
    statusText?: string
    body?: string
    responseHeaders?: Record<string, string>
  }> = []

  for (const url of endpoints) {
    for (const profile of MOXFIELD_HEADER_PROFILES) {
      try {
        const res = await fetch(url, {
          headers: profile.headers,
          cache: 'no-store',
        })

        if (res.ok) {
          console.info('[moxfield] Fetch success', {
            requestId,
            deckId,
            url,
            headerProfile: profile.label,
            responseHeaders: pickMoxfieldDebugHeaders(res),
          })
          return { ok: true as const, data: await res.json(), url }
        }

        const body = await res.text().catch(() => '')
        attempts.push({
          url,
          headerProfile: profile.label,
          status: res.status,
          statusText: res.statusText,
          body: body.slice(0, 500),
          responseHeaders: pickMoxfieldDebugHeaders(res),
        })
      } catch (error: any) {
        attempts.push({
          url,
          headerProfile: profile.label,
          statusText: error?.message || 'fetch exception',
        })
      }
    }
  }

  console.error('[moxfield] Fetch failed', {
    requestId,
    deckId,
    runtime: {
      vercel: process.env.VERCEL,
      env: process.env.VERCEL_ENV,
      region: process.env.VERCEL_REGION,
      url: process.env.VERCEL_URL,
    },
    attempts,
  })

  return { ok: false as const, attempts }
}

export function mapMoxfieldAttemptsToError(attempts: Array<{ status?: number }>) {
  const statuses = attempts.map((attempt) => Number(attempt.status || 0)).filter(Boolean)
  if (statuses.includes(404)) return 'No se pudo acceder al mazo. Verifica que el enlace exista y sea público.'
  if (statuses.includes(429)) return 'Moxfield rechazó temporalmente la consulta. Intenta de nuevo en unos minutos.'
  if (statuses.includes(403)) return 'Moxfield bloqueó temporalmente la consulta del mazo. Intenta de nuevo en unos minutos.'
  return 'No se pudo acceder al mazo de Moxfield. Verifica que el enlace exista y sea público.'
}
