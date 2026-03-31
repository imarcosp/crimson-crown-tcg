import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import ProductCard from '@/components/catalog/ProductCard'
import FilterSidebar from '@/components/catalog/FilterSidebar'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, SearchX, Lightbulb, Sparkles } from 'lucide-react'
import { redirect } from 'next/navigation'
import { siteConfig } from '@/config/site'

export const revalidate = 0

// DICCIONARIO INTELIGENTE (Alias -> Categoría/TCG)
const SMART_ALIASES: Record<string, string> = {
    'mtg': 'Magic',
    'magic': 'Magic',
    'magic the gathering': 'Magic',
    'riftbound': 'Riftbound',
    'lol': 'Riftbound',
    'league': 'Riftbound',
    'league of legends': 'Riftbound',
    'pkmn': 'Pokémon',
    'pokemon': 'Pokémon',
    'folios': 'Folios',
    'fundas': 'Folios',
    'sleeves': 'Folios',
    'dados': 'Dados',
    'dice': 'Dados',
    'playmats': 'Playmats',
    'tableros': 'Playmats',
    'accesorios': 'Accesorios',
    'toploaders': 'Accesorios', // Mapeo temporal, luego se puede filtrar por subcategoría si se agrega
    'top loaders': 'Accesorios'
}

// Helper para obtener precios externos (CardKingdom)
async function getExternalPrices(supabase: any, products: any[]) {
    const scryfallIds = products.map((p: any) => p.scryfall_id || p.id).filter(Boolean)
    if (scryfallIds.length === 0) return new Map()

    const { data: externalPrices } = await supabase
      .from('external_prices')
      .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil')
      .in('scryfall_id', scryfallIds)
    
    const map = new Map()
    externalPrices?.forEach((row: any) => {
      map.set(String(row.scryfall_id), {
        n: Number(row.cardkingdom_retail_normal || 0),
        f: Number(row.cardkingdom_retail_foil || 0),
      })
    })
    return map
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    set?: string
    q?: string
    tcg?: string
    blocked?: string
    condition?: string
    rarity?: string
    finish?: string
    sort?: string
  }>
}) {
  const supabase = await createClient()
  const params = await searchParams

  const page = Number(params.page) || 1
  const pageSize = 25
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // 1. DETECCIÓN DE BÚSQUEDA INTELIGENTE
  let currentQ = (params.q || '').trim()
  let smartFilterTcg = params.tcg
  let isSmartSearch = false

  if (currentQ) {
      const lowerQ = currentQ.toLowerCase()
      // Detectar accesorios específicos del menú
      if (['folios', 'toploaders', 'top loaders', 'perfect fit', 'deck box', 'deck boxes', 'dados', 'carpetas', 'playmats'].some(k => lowerQ.includes(k))) {
          // Si busca accesorios específicos, mantenemos la query para filtrar por nombre, pero seteamos TCG o Accesorios si aplica
          // Por ahora dejamos que busque por nombre "q"
      } else if (SMART_ALIASES[lowerQ]) {
          smartFilterTcg = SMART_ALIASES[lowerQ]
          currentQ = '' // Convertimos la búsqueda en un filtro de categoría
          isSmartSearch = true
      }
  }

  // Guard de acceso: oculta categorías deshabilitadas
  // Para revertir, basta con poner los flags en true en siteConfig.features
  const requestedTcg = smartFilterTcg || params.tcg || ''
  const isBlocked =
    (requestedTcg === 'Riftbound' && !siteConfig.features.showRiftbound) ||
    (requestedTcg === 'Secret Lair' && !siteConfig.features.showSecretLair) ||
    (requestedTcg === 'Accesorios' && !siteConfig.features.showAccessories)
  if (isBlocked) {
    const { tcg, ...rest } = params as any
    const qs = new URLSearchParams({ ...rest, blocked: requestedTcg }).toString()
    redirect(`/catalog?${qs}`)
  }

  let products: any[] = []
  let count = 0
  let suggestion = ''

  // ---------------------------------------------------------
  // LÓGICA 1: CATÁLOGO PURO (Navegación / Filtros)
  // Regla: SOLO mostrar productos con STOCK > 0
  // Se activa si NO hay texto en el buscador (q)
  // ---------------------------------------------------------
  if (!currentQ) {
      let q = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .gt('stock', 0)
        .not('name', 'ilike', '%(ARCHIVADO)%') // <-- FILTRO DE ARCHIVADOS

      if (params.set) q = q.ilike('set_name', `%${params.set}%`)
      if (smartFilterTcg) q = q.eq('tcg', smartFilterTcg)
      if (params.condition) q = q.in('condition', params.condition.split(','))
      if (params.rarity) q = q.in('rarity', params.rarity.split(','))
      if (params.finish === 'foil') q = q.neq('finish', 'Non-Foil')
      else if (params.finish === 'nonfoil') q = q.eq('finish', 'Non-Foil')

      // MAPEO DE ORDENAMIENTO (Ahora 'newest' usa restocked_at)
      const sortMap: Record<string, { col: string; asc: boolean }> = {
          price_asc: { col: 'price_usd', asc: true },
          price_desc: { col: 'price_usd', asc: false },
          newest: { col: 'restocked_at', asc: false }, // <--- CAMBIO CLAVE
      }
      const sortConfig = sortMap[params.sort || 'price_desc']
      
      // Manejo de nulos en restocked_at (fallback a created_at si fuera necesario, pero SQL update lo cubrió)
      q = q.order(sortConfig.col, { ascending: sortConfig.asc, nullsFirst: false }).range(from, to)

      const res = await q
      products = res.data || []
      count = res.count || 0
  } 
  // ---------------------------------------------------------
  // LÓGICA 2: BÚSQUEDA REAL (Buscador Global)
  // ---------------------------------------------------------
  else {
      try {
        const hdrs = await headers()
        const host = hdrs.get('host') || 'localhost:3000'
        const proto = hdrs.get('x-forwarded-proto') || 'http'
        const origin = `${proto}://${host}`
        const res = await fetch(`${origin}/api/search?q=${encodeURIComponent(currentQ)}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const arr = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : [])
          if (arr.length > 0 && arr[0].didYouMean) suggestion = arr[0].didYouMean
          products = arr
          count = products.length
          products = products.slice(from, to + 1)
        } else {
          products = []
          count = 0
        }
      } catch {
        products = []
        count = 0
      }
  }

  const totalPages = Math.ceil(count / pageSize)
  const priceMap = await getExternalPrices(supabase, products)

  const mappedProducts = products.map((p: any) => {
    const finish = String(p.finish || '').toLowerCase()
    const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched')
    
    const basePrice = isFoil ? Number(p.price_usd_foil || p.price_usd || 0) : Number(p.price_usd || 0)
    let finalPrice = basePrice
    
    if (p.isImport) {
        const extPrice = priceMap.get(String(p.scryfall_id || p.id))
        if (extPrice) {
            const suggested = isFoil ? extPrice.f : extPrice.n
            if (suggested > 0) finalPrice = suggested
        }
    }

    // Mostrar siempre el precio del inventario sin imponer mínimo

    const variantStock = isFoil
      ? Number((p as any).stock_foil || (p as any).stockFoil || p.stock || 0)
      : Number(p.stock || 0)
    const hasStock = variantStock > 0
    return {
      id: String(p.id),
      name: String(p.name || ''),
      tcg: String(p.tcg || 'Magic'),
      priceUsd: finalPrice,
      stock: variantStock,
      condition: String(p.condition || 'NM'),
      isFoil,
      finish: p.finish,
      rarity: String(p.rarity || ''),
      image: p.image_url,
      setName: p.set_name,
      collectorNumber: p.collector_number,
      availability: (hasStock ? 'stock' : 'import') as any,
      language: p.language,
      isImport: p.isImport || !hasStock,
      metadata: p.metadata
    }
  })

  const prevQuery = { ...params, page: page - 1 }
  const nextQuery = { ...params, page: page + 1 }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-64 shrink-0"><FilterSidebar /></aside>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col">
                <h1 className="text-2xl font-bold text-[#1C1B22] flex items-center gap-2">
                    Catálogo 
                    {smartFilterTcg && <span className="text-slate-500 font-normal">/ {smartFilterTcg}</span>}
                    {isSmartSearch && <Sparkles size={18} className="text-[#9D1B1B]" />}
                </h1>
                {params.set && <span className="text-xs font-bold text-[#9D1B1B] bg-red-50 px-2 py-1 rounded w-fit mt-1">Set: {params.set}</span>}
            </div>
            <span className="text-sm text-slate-500 font-bold">{count} resultados</span>
          </div>
          
          {(params as any).blocked && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
              La categoría {(params as any).blocked} no está disponible actualmente. Te mostramos el catálogo general.
            </div>
          )}
          
          {suggestion && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-amber-800 animate-in fade-in">
                <Lightbulb className="shrink-0 mt-0.5" size={20}/>
                <div><p className="font-bold">No encontramos resultados exactos para "{currentQ}".</p><p>Quizás quisiste decir <Link href={{ query: { ...params, q: suggestion } }} className="font-extrabold underline hover:text-amber-900">{suggestion}</Link>.</p></div>
            </div>
          )}

          {isSmartSearch && (
             <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 text-sm flex gap-2 items-center">
                 <Sparkles size={16}/> <span>Entendimos que buscas <strong>{smartFilterTcg}</strong>. ¡Aquí tienes todo nuestro stock!</span>
             </div>
          )}

          {mappedProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                {mappedProducts.map((p: any, idx: number) => (
                  <ProductCard key={`${p.id}-${p.collectorNumber || ''}-${p.isFoil ? 'foil' : 'nonfoil'}-${idx}`} {...p} />
                ))}
              </div>
              <div className="mt-12 flex justify-center items-center gap-4">
                {page > 1 ? (
                  <Link href={{ query: prevQuery }} className="px-4 py-2 border rounded-lg hover:bg-slate-50 flex items-center gap-2 text-sm font-bold transition-colors"><ChevronLeft size={16} /> Anterior</Link>
                ) : <div className="w-24"></div>}
                <span className="text-sm font-bold text-slate-900">Página {page} de {totalPages}</span>
                {page < totalPages ? (
                  <Link href={{ query: nextQuery }} className="px-4 py-2 border rounded-lg hover:bg-slate-50 flex items-center gap-2 text-sm font-bold transition-colors">Siguiente <ChevronRight size={16} /></Link>
                ) : <div className="w-24"></div>}
              </div>
            </>
          ) : (
            <div className="py-20 text-center border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center">
              <SearchX className="text-slate-300 mb-4" size={48} />
              <p className="text-slate-500 mb-2 font-medium">No se encontraron productos.</p>
              <Link href="/catalog" className="px-6 py-2 bg-[#E91E63] text-white rounded-lg font-bold hover:bg-pink-600 transition-colors mt-4">Limpiar Filtros</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
