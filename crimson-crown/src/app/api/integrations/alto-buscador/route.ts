import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { siteConfig } from '@/config/site'

// 🔐 CLAVE DE SEGURIDAD
const API_SECRET = process.env.ALTO_BUSCADOR_KEY
const SITE_URL = siteConfig.url.replace(/\/$/, '')
const SCRYFALL_HEADERS = {
  'User-Agent': 'CrimsonCrownTCG/1.0 (https://www.crimsoncrownimports.com)',
  'Accept': 'application/json',
}

// 🌍 CONFIGURACIÓN CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')
  const apiKey = request.headers.get('x-api-key')

  // 1. VERIFICACIÓN DE SEGURIDAD
  if (!API_SECRET || apiKey !== API_SECRET) {
    return NextResponse.json(
      { error: 'Unauthorized' }, 
      { status: 401, headers: corsHeaders }
    )
  }

  if (!query || query.length < 3) {
    return NextResponse.json(
      { error: 'Query too short (min 3 chars)' }, 
      { status: 400, headers: corsHeaders }
    )
  }

  const supabase = await createClient()

  // 2. BÚSQUEDA HÍBRIDA
  const [localResults, scryfallResults] = await Promise.all([
    // A) Búsqueda Local (Supabase) - Traemos collector_number
    supabase
      .from('products')
      .select('*')
      .ilike('name', `%${query}%`)
      .order('stock', { ascending: false }) 
      .limit(50),
    
    // B) Búsqueda Externa (Scryfall)
    fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints`, {
      headers: SCRYFALL_HEADERS,
    })
      .then(res => res.ok ? res.json() : { data: [] })
      .catch(() => ({ data: [] }))
  ])

  const localProducts = localResults.data || []
  const externalCards = scryfallResults.data || []
  const localIds = new Set(localProducts.map(p => p.scryfall_id))
  
  const formattedResults: any[] = []

  // A) Procesar Locales (Tu Stock)
  localProducts.forEach(p => {
    const finish = (p.finish || 'Normal').trim()
    const isFoil = finish.toLowerCase().includes('foil') && !finish.toLowerCase().includes('non') || finish.toLowerCase().includes('etched')
    const hasStock = p.stock > 0
    const linkId = p.scryfall_id || p.id

    // LÓGICA DE FORMATO VISUAL
    // 1. Título con Finish para diferenciar Foil/Etched/Non-Foil
    const displayTitle = `${p.name} [${finish}]`

    // 2. Expansión con Número de Coleccionista
    const displaySet = p.collector_number 
      ? `${p.set_name} (#${p.collector_number})`
      : p.set_name

    // 3. Mensaje "Verde" con Emoji
    const displayMessage = hasStock 
      ? "✅ En Stock (Envío Inmediato)"  // Emoji verde para simular el color
      : "🇯🇵 Podés pedirlas desde Japón. Sumalo a tu cotización para saber el precio y tiempo de entrega."

    formattedResults.push({
      id: linkId,
      title: displayTitle,       // "Sheoldred [Foil]"
      precio: p.price_usd,
      imageurl: p.image_url,
      condition: p.condition || 'NM',
      expansion: displaySet,     // "Dominaria United (#123)"
      foil: isFoil,
      lenguaje: p.language || 'English',
      stock: hasStock ? p.stock : 0,
      availability_message: displayMessage,
      link: `${SITE_URL}/product/${linkId}`,
      game: p.tcg || 'Magic'
    })
  })

  // B) Procesar Scryfall (Importación)
  externalCards.forEach((card: any) => {
    if (localIds.has(card.id)) return 
    if (card.games && !card.games.includes('paper')) return

    let imageUrl = card.image_uris?.normal || card.image_uris?.large
    if (!imageUrl && card.card_faces?.[0]?.image_uris) {
        imageUrl = card.card_faces[0].image_uris.normal
    }

    // Título para importación
    const isFoilPrice = !!card.prices?.usd_foil && !card.prices?.usd
    const importFinish = isFoilPrice ? 'Foil' : 'Normal'
    const displayTitle = `${card.name} [${importFinish}]`
    
    // Expansión para importación
    const displaySet = card.collector_number 
      ? `${card.set_name} (#${card.collector_number})` 
      : card.set_name

    formattedResults.push({
      id: card.id,
      title: displayTitle,
      precio: 0, 
      imageurl: imageUrl || '',
      condition: 'NM',
      expansion: displaySet,
      foil: isFoilPrice,
      lenguaje: 'English',
      stock: 0,
      availability_message: "🇯🇵 Podés pedirlas desde Japón. Sumalo a tu cotización para saber el precio y tiempo de entrega.",
      link: `${SITE_URL}/product/${card.id}`,
      game: 'Magic'
    })
  })

  return NextResponse.json({
    meta: { count: formattedResults.length, query: query },
    results: formattedResults.slice(0, 50) 
  }, {
    headers: corsHeaders
  })
}
