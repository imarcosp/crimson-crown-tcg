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
}

async function performSearch(query: string, numberQuery: string | null, supabase: any, withDebug: boolean) {
  const localMap = new Map<string, HybridProduct>()
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
  } else {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,set_name.ilike.%${query}%`)
  }

  if (numberQuery) dbQuery = dbQuery.eq('collector_number', numberQuery)
  dbQuery = dbQuery.limit(100)

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
      })
      if (debug) debug.ids.push(String(p.id))
    })
  }

  // Ordenar
  if (debug) debug.localRawCount = localRaw.length
  let local = localRaw.sort((a, b) => b.stock - a.stock)

  // 2. EXTERNA (Scryfall)
  let scryfallQueryString = ''
  if (numberQuery) {
    scryfallQueryString = `!"${query}" cn:${numberQuery} game:paper unique:prints`
  } else {
    scryfallQueryString = `${encodeURIComponent(query)} game:paper unique:prints`
  }
  
  try {
      const extRes = await fetch(`https://api.scryfall.com/cards/search?q=${scryfallQueryString}&order=released`)
      const json = await extRes.json()
      const list = Array.isArray(json?.data) ? json.data : []
      
      list.slice(0, 50).forEach((c: any) => {
        if (Array.isArray(c?.games) && !c.games.includes('paper')) return
        
        const isLocal = local.some(l => l.name === c.name && l.set_name === c.set_name && l.collector_number === c.collector_number)
        if (isLocal) return

        const pNonFoil = Number(c?.prices?.usd || 0)
        const pFoil = Number(c?.prices?.usd_foil || 0)
        
        external.push({
            id: c.id, // Para externos, el ID es el de Scryfall
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
            isImport: true,
            finishes: c.finishes || [],
        })
      })
  } catch (e) {}

  return { local, external, debug }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawQ = (searchParams.get('q') || '').trim()
  const withDebug = searchParams.get('debug') === '1'
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value }, set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} }, remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} }, }, }
  )

  if (rawQ.length < 3) return NextResponse.json([])

  let nameQuery = rawQ
  let numberQuery: string | null = null
  
  // Solo separamos el número si el usuario usa el prefijo '#' explícitamente.
  // Esto evita romper nombres de cartas que incluyen números (ej. "Spider-Man 2099", "Android 18")
  const match = rawQ.match(/^(.*?)\s*#(\d+[a-zA-Z]?)$/i)
  
  if (match) {
    nameQuery = match[1].trim()
    numberQuery = match[2]
  }

  let { local, external, debug } = await performSearch(nameQuery, numberQuery, supabase, withDebug)
  let results = [...local, ...external]

  // Lógica Fuzzy
  if (results.length === 0 && !numberQuery) {
    try {
      const fuzzyRes = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(nameQuery)}`)
      if (fuzzyRes.ok) {
        const fuzzyData = await fuzzyRes.json()
        const correctedName = fuzzyData.name
        if (correctedName && correctedName.toLowerCase() !== nameQuery.toLowerCase()) {
          const secondTry = await performSearch(correctedName, null, supabase, false)
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
        const { data: dbPrices } = await clientForPrices.from('external_prices').select('*').in('scryfall_id', scryIds)
        const priceMap = new Map<string, any>()
        ;(dbPrices || []).forEach((row: any) => { if (row?.scryfall_id) priceMap.set(String(row.scryfall_id), row) })
        
        results.forEach((r) => {
          // Buscamos precio usando la misma lógica: scryfall_id o id
          const lookupId = r.scryfall_id || r.id
          const dbPrice = priceMap.get(lookupId)
          
          if (dbPrice) { // Eliminamos la restricción && r.isImport para que enriquezca también los locales
             const ckNormal = Number(dbPrice.cardkingdom_retail_normal || 0)
             const ckFoil = Number(dbPrice.cardkingdom_retail_foil || 0)
             if (ckNormal > 0) { r.price_usd = ckNormal; r.priceUsd = ckNormal }
             if (ckFoil > 0) { r.price_usd_foil = ckFoil; r.priceUsdFoil = ckFoil }
          }
        })
    }
    
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
