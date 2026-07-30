import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Tipo Producto
type HybridProduct = {
  id: string
  name: string
  set_name?: string
  image_url?: string
  collector_number?: string
  scryfall_id?: string
  price_usd: number
  price_usd_foil?: number
  priceUsd: number
  priceUsdFoil?: number
  stock: number
  stock_foil: number
  tcg: string
  condition?: string
  finish?: string
  rarity?: string
  language?: string
  isImport?: boolean
  finishes?: string[]
  didYouMean?: string
  metadata?: any
  type_line?: string | null
  color_identity?: string[] | null
}

type AdvancedFilters = {
  name: string
  set: string
  collector: string
  tcg: string
  colors: string[]
  basicLand: boolean
}

const SCRYFALL_HEADERS = {
  'User-Agent': 'CrimsonCrownTCG/1.0 (search-api; contact: mjperchezabala@gmail.com)',
  Accept: 'application/json',
}

function normalizeCollectorSearchValue(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/^0+(?=\d)/, '')
  return normalized || '0'
}

function parseCsvParam(value: string | null) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeColorIdentity(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry || '').toUpperCase().trim()).filter(Boolean)
}

function matchesColorFilters(colorIdentity: unknown, selectedColors: string[]) {
  if (selectedColors.length === 0) return true
  const identity = normalizeColorIdentity(colorIdentity)
  const unique = [...new Set(identity)].sort()
  const selected = [...new Set(selectedColors.map((color) => color.toUpperCase().trim()).filter(Boolean))]
  const wantsColorless = selected.includes('C')
  const wantsMulticolor = selected.includes('M')
  const explicitColors = selected.filter((color) => color !== 'C' && color !== 'M').sort()

  if (wantsColorless) {
    return unique.length === 0 && explicitColors.length === 0 && !wantsMulticolor
  }

  if (explicitColors.length === 0) {
    return wantsMulticolor ? unique.length > 1 : true
  }

  const hasExactPalette =
    unique.length === explicitColors.length &&
    explicitColors.every((color, index) => unique[index] === color)

  if (wantsMulticolor) {
    return unique.length > 1 && hasExactPalette
  }

  return hasExactPalette
}

function matchesBasicLandFilter(typeLine: unknown, basicLandOnly: boolean) {
  if (!basicLandOnly) return true
  const value = String(typeLine || '').toLowerCase()
  return value.includes('basic') && value.includes('land')
}

function shouldUseSpecialFoilLabel(currentFinish: string | undefined, foilVariant: string | undefined) {
  if (!foilVariant) return false
  const current = String(currentFinish || '').toLowerCase().trim()
  if (!current) return true
  if (current === 'foil') return true
  if (current === 'etched') return true
  if (current === 'etched foil') return true
  return false
}

async function fetchExternalPricesByScryfallIds(client: any, ids: string[]) {
  const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))]
  const chunkSize = 100
  const rows: any[] = []

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const batch = uniqueIds.slice(index, index + chunkSize)
    const { data } = await client
      .from('external_prices')
      .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, active_price_normal, active_price_foil, foil_variant, type_line, color_identity')
      .in('scryfall_id', batch)

    if (Array.isArray(data)) rows.push(...data)
  }

  return rows
}

async function performSearch(query: string, numberQuery: string | null, filters: AdvancedFilters, supabase: any, withDebug: boolean) {
  const external: HybridProduct[] = []
  const debug: any = withDebug ? { dbCount: 0, variantsCount: 0, moreCount: 0, localRawCount: 0, ids: [], variantsIds: [], moreIds: [] } : null

  // 1. LOCAL (Supabase)
  const cleaned = String(query).replace(/[\,\.;:_\-]+/g, ' ').trim()
  const tokens = cleaned.split(/\s+/).filter((t: string) => t.length > 1).slice(0, 6)
  
  let dbQuery = supabase.from('products').select('*')

  if (tokens.length > 0) {
      tokens.forEach((t) => {
          dbQuery = dbQuery.or(`name.ilike.%${t}%,set_name.ilike.%${t}%`)
      })
  } else if (query) {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,set_name.ilike.%${query}%`)
  }

  if (filters.tcg) dbQuery = dbQuery.eq('tcg', filters.tcg)
  if (filters.set) dbQuery = dbQuery.ilike('set_name', `%${filters.set}%`)
  if (numberQuery) dbQuery = dbQuery.eq('collector_number', numberQuery)
  dbQuery = dbQuery.limit(200)

  const { data: dbData } = await dbQuery
  if (debug) debug.dbCount = Array.isArray(dbData) ? dbData.length : 0

  // Procesar Local
  const localRaw: HybridProduct[] = []
  if (dbData) {
    dbData.forEach((p: any) => {
      // FILTRO ESTRICTO EN MEMORIA: Evitar que salgan productos archivados
      if (p.name.includes('(ARCHIVADO)')) return;

      const f = String(p.finish || '').toLowerCase()
      const isFoil = (f.includes('foil') && !f.includes('non')) || f.includes('etched')
      const stockQty = Number(p.stock || 0)
      const basePrice = Number(p.price_usd || 0)
      localRaw.push({
        id: String(p.id),
        scryfall_id: p.scryfall_id, // Vital: Enviamos el Scryfall ID
        name: p.name,
        set_name: p.set_name,
        image_url: p.image_url,
        collector_number: String(p.collector_number || ''),
        price_usd: !isFoil ? basePrice : 0,
        price_usd_foil: isFoil ? basePrice : 0,
        priceUsd: !isFoil ? basePrice : 0,
        priceUsdFoil: isFoil ? basePrice : 0,
        stock: stockQty,
        stock_foil: isFoil ? stockQty : 0,
        tcg: p.tcg || 'Magic',
        condition: p.condition || 'NM',
        language: p.language || 'English',
        finish: p.finish || (isFoil ? 'Foil' : 'Non-Foil'),
        rarity: p.rarity,
        isImport: false,
        finishes: isFoil ? ['foil'] : ['nonfoil'],
        metadata: p.metadata || undefined,
        type_line: null,
        color_identity: null,
      })
      if (debug) debug.ids.push(String(p.id))
    })
  }

  // Ordenar
  if (debug) debug.localRawCount = localRaw.length
  let local = localRaw.sort((a, b) => b.stock - a.stock)

  // 2. EXTERNA (Scryfall)
  const canUseScryfall = !filters.tcg || filters.tcg === 'Magic'
  if (canUseScryfall && query) {
    let scryfallQueryString = ''
    if (numberQuery) {
      scryfallQueryString = `!"${query}" cn:${numberQuery} game:paper unique:prints`
    } else {
      scryfallQueryString = `${query} game:paper unique:prints`
    }
    
    try {
        const extRes = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(scryfallQueryString)}&order=released`, {
          headers: SCRYFALL_HEADERS,
        })
        const json = await extRes.json()
        const list = Array.isArray(json?.data) ? json.data : []
        
        list.slice(0, 80).forEach((c: any) => {
          if (Array.isArray(c?.games) && !c.games.includes('paper')) return
          if (filters.set && !String(c.set_name || '').toLowerCase().includes(filters.set.toLowerCase())) return
          
          const normalizedExternalCollector = normalizeCollectorSearchValue(c.collector_number)
          if (numberQuery && normalizedExternalCollector !== numberQuery) return
          
          const isLocal = local.some(l => l.name === c.name && l.set_name === c.set_name && normalizeCollectorSearchValue(l.collector_number) === normalizedExternalCollector)
          if (isLocal) return

          const pNonFoil = Number(c?.prices?.usd || 0)
          const pFoil = Number(c?.prices?.usd_foil || c?.prices?.usd_etched || 0)
          const externalFinish =
            Array.isArray(c.finishes) && c.finishes.includes('etched')
              ? 'Etched Foil'
              : Array.isArray(c.finishes) && c.finishes.includes('foil')
                ? 'Foil'
                : 'Non-Foil'
          
          external.push({
              id: c.id,
              scryfall_id: c.id,
              name: c.name,
              set_name: c.set_name,
              collector_number: c.collector_number,
              image_url: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal,
              price_usd: pNonFoil,
              price_usd_foil: pFoil,
              priceUsd: pNonFoil,
              priceUsdFoil: pFoil,
              stock: 0,
              stock_foil: 0,
              tcg: 'Magic',
              rarity: c.rarity,
              language: 'English',
              finish: externalFinish,
              isImport: true,
              finishes: c.finishes || [],
              type_line: c.type_line || null,
              color_identity: Array.isArray(c.color_identity) ? c.color_identity : [],
          })
        })
    } catch (e) {}
  }

  return { local, external, debug }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawQ = (searchParams.get('q') || '').trim()
  const mode = (searchParams.get('mode') || '').trim()
  const withDebug = searchParams.get('debug') === '1'
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value }, set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} }, remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} }, }, }
  )

  if (mode === 'sets') {
    const q = String(searchParams.get('q') || '').trim()
    const tcg = String(searchParams.get('tcg') || '').trim()
    let query = supabase.from('products').select('set_name').not('set_name', 'is', null)
    if (tcg) query = query.eq('tcg', tcg)
    if (q) query = query.ilike('set_name', `%${q}%`)
    query = query.limit(200)
    const { data } = await query
    const unique = [...new Set((data || []).map((row: any) => String(row.set_name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return NextResponse.json(unique.slice(0, 50))
  }

  const filters: AdvancedFilters = {
    name: String(searchParams.get('adv_name') || '').trim(),
    set: String(searchParams.get('adv_set') || '').trim(),
    collector: normalizeCollectorSearchValue(searchParams.get('adv_collector')),
    tcg: String(searchParams.get('adv_tcg') || '').trim(),
    colors: parseCsvParam(searchParams.get('colors')).map((color) => color.toUpperCase()),
    basicLand: searchParams.get('basicLand') === 'true',
  }
  const allowMagicOnlyFilters = !filters.tcg || filters.tcg === 'Magic'
  if (!allowMagicOnlyFilters) {
    filters.colors = []
    filters.basicLand = false
  }

  const isAdvancedOnly = !!(filters.name || filters.set || filters.collector || filters.tcg || filters.colors.length > 0 || filters.basicLand)
  const rawQuerySeed = rawQ.toLowerCase() === 'advanced-search' ? '' : rawQ
  if (rawQuerySeed.length < 3 && !isAdvancedOnly) return NextResponse.json([])

  let nameQuery = filters.name || rawQuerySeed
  let numberQuery: string | null = null
  
  // Solo separamos el número si el usuario usa el prefijo '#' explícitamente.
  // Esto evita romper nombres de cartas que incluyen números (ej. "Spider-Man 2099", "Android 18")
  const match = rawQuerySeed.match(/^(.*?)\s*#(\d+[a-zA-Z]?)$/i)
  
  if (match) {
    nameQuery = match[1].trim()
    numberQuery = normalizeCollectorSearchValue(match[2])
  }

  if (filters.collector) numberQuery = filters.collector

  let { local, external, debug } = await performSearch(nameQuery, numberQuery, filters, supabase, withDebug)
  let results = [...local, ...external]

  // Lógica Fuzzy
  if (results.length === 0 && !numberQuery && nameQuery) {
    try {
      const fuzzyRes = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(nameQuery)}`, {
        headers: SCRYFALL_HEADERS,
      })
      if (fuzzyRes.ok) {
        const fuzzyData = await fuzzyRes.json()
        const correctedName = fuzzyData.name
        if (correctedName && correctedName.toLowerCase() !== nameQuery.toLowerCase()) {
          const secondTry = await performSearch(correctedName, null, { ...filters, name: correctedName }, supabase, false)
          results = [...secondTry.local, ...secondTry.external]
          results.forEach(r => r.didYouMean = correctedName)
        }
      }
    } catch (e) {}
  }

  // Precios Externos (CORREGIDO: Usar scryfall_id para locales también)
  try {
    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const admin = (serviceUrl && serviceKey) ? createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null

    // Usamos scryfall_id si existe, si no id (para externos)
    const scryIds = results.map(r => r.scryfall_id || r.id).filter(Boolean)
    
    if (scryIds.length > 0) {
        const clientForPrices = admin || supabase
        const dbPrices = await fetchExternalPricesByScryfallIds(clientForPrices, scryIds)
        const priceMap = new Map<string, any>()
        ;(dbPrices || []).forEach((row: any) => { if (row?.scryfall_id) priceMap.set(String(row.scryfall_id), row) })
        
        results.forEach((r) => {
          // Buscamos precio usando la misma lógica: scryfall_id o id
          const lookupId = r.scryfall_id || r.id
          const dbPrice = priceMap.get(lookupId)
          
          if (dbPrice) {
            const activeNormal = Number(dbPrice.active_price_normal || dbPrice.cardkingdom_retail_normal || 0)
            const activeFoil = Number(dbPrice.active_price_foil || dbPrice.cardkingdom_retail_foil || dbPrice.cardkingdom_retail_etched || 0)
            if (r.isImport) {
              if (activeNormal > 0) { r.price_usd = activeNormal; r.priceUsd = activeNormal }
              if (activeFoil > 0) { r.price_usd_foil = activeFoil; r.priceUsdFoil = activeFoil }
            }
            r.type_line = dbPrice.type_line || r.type_line || null
            r.color_identity = normalizeColorIdentity(dbPrice.color_identity || r.color_identity)
            if (shouldUseSpecialFoilLabel(r.finish, dbPrice.foil_variant)) {
              r.finish = dbPrice.foil_variant
            }
          }
        })
    }

    results = results.filter((r: any) =>
      matchesColorFilters(r.color_identity, filters.colors) &&
      matchesBasicLandFilter(r.type_line, filters.basicLand)
    )
    
    // Filtro final duplicados (A nivel de IMPRESIÓN visual)
    const seen = new Set<string>()
    const unique = results.filter((r: any) => {
      // Usamos solo el ID de Scryfall (si existe) o una combinación de Nombre+Set+CN
      // Esto agrupa todas las variantes (foil, normal) en una sola fila visual en el dropdown.
      // Cuando el usuario hace click, el ProductForm ya sabe manejar los diferentes acabados.
      
      let k = r.scryfall_id
      if (!k) {
          k = `${r.name}-${r.set_name}-${r.collector_number}`.toLowerCase()
      }
      
      // Si ya vimos esta impresión, la descartamos (priorizando siempre las locales porque van primero en 'results')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (withDebug) return NextResponse.json({ results: unique, debug })
    return NextResponse.json(unique)
  } catch (e) {
    if (withDebug) return NextResponse.json({ results, debug })
    return NextResponse.json(results)
  }
}
