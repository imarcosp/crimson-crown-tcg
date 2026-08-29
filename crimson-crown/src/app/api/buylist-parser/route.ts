import { NextResponse } from 'next/server'
import { createGuardedServerClient as createServerClient } from '@/lib/supabase/guarded-constructors'
import { cookies } from 'next/headers'
import { buildCardsToProcessFromMoxfieldData, extractMoxfieldDeckId, fetchMoxfieldDeckWithDiagnostics, mapMoxfieldAttemptsToError } from '@/lib/moxfield'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const requestId = `mox-${crypto.randomUUID().slice(0, 8)}`
  const body = await req.json()
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value }, set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} }, remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} }, }, }
  )

  let cardsToProcess: any[] = []

  // --- MODO 1: Importación URL Moxfield (NUEVO: Server-Side Fetch) ---
  if (body.moxfieldUrl && typeof body.moxfieldUrl === 'string') {
      const deckId = extractMoxfieldDeckId(body.moxfieldUrl)
      if (!deckId) {
          return NextResponse.json({ error: 'Enlace de Moxfield inválido.', requestId }, { status: 400 })
      }

      const moxfield = await fetchMoxfieldDeckWithDiagnostics(deckId, requestId)
      if (!moxfield.ok) {
          return NextResponse.json({ error: mapMoxfieldAttemptsToError(moxfield.attempts), requestId }, { status: 400 })
      }

      cardsToProcess = buildCardsToProcessFromMoxfieldData(moxfield.data)
  }
  // --- MODO 2: Objetos ricos (Moxfield) ---
  else if (body.cards && Array.isArray(body.cards)) {
      cardsToProcess = body.cards
  } 
  // --- MODO 3: Texto plano (Copy Paste) ---
  else if (body.deckList && typeof body.deckList === 'string') {
      const lines = body.deckList.split('\n').filter((l: string) => l.trim().length > 0)
      const regex = /^(\d+)\s+(.+?)(?:\s+\(([\w\d]+)\)\s+(\d+[a-z]*))?(?:\s+\*(F|E)\*)?$/i
      cardsToProcess = lines.map((line: string) => {
          let cleanLine = line
          let explicitFinish = 'nonfoil'
          if (cleanLine.includes('*E*')) { explicitFinish = 'etched'; cleanLine = cleanLine.replace('*E*', '').trim() }
          else if (cleanLine.includes('*F*') || cleanLine.toLowerCase().includes(' foil')) { explicitFinish = 'foil'; cleanLine = cleanLine.replace('*F*', '').replace(/ foil/i, '').trim() }
          const match = cleanLine.match(regex)
          if (match) {
              return {
                  quantity: parseInt(match[1]),
                  name: match[2].trim(),
                  set: match[3] || null,
                  cn: match[4] || null,
                  finish: match[5] === 'E' ? 'etched' : (match[5] === 'F' ? 'foil' : explicitFinish)
              }
          }
          const simple = cleanLine.match(/^(\d+)\s+(.+)$/)
          if (simple) return { quantity: parseInt(simple[1]), name: simple[2].trim(), finish: explicitFinish }
          return null
      }).filter(Boolean)
  } else {
      return NextResponse.json({ error: 'Formato inválido', requestId }, { status: 400 })
  }

  const results = []
  const names = cardsToProcess.map(c => c.name)

  if (names.length > 0) {
      // 1. Buscamos en el catálogo (Sin importar stock, queremos identificar la carta)
      const orFilters = names.map(n => `name.ilike.%${n.replace(/%/g, '')}%`).join(',')
      const { data: catalogMatches } = await supabase
          .from('products')
          .select('id, name, set_name, collector_number, image_url, scryfall_id, tcg')
          .or(orFilters)
      
      const catalogMap = catalogMatches || []

      // 2. Recolectamos IDs para buscar precios
      const scryfallIdsToFetch = new Set<string>()
      // IDs de los inputs directos (Moxfield)
      cardsToProcess.forEach(c => { if (c.scryfall_id) scryfallIdsToFetch.add(c.scryfall_id) })
      // IDs de los matches de DB
      catalogMap.forEach(p => { if (p.scryfall_id) scryfallIdsToFetch.add(p.scryfall_id) })

      // 3. Traemos Precios Externos (CardKingdom retail como precio de mercado)
      const pricesMap = new Map<string, any>()
      if (scryfallIdsToFetch.size > 0) {
          const { data: extPrices } = await supabase
              .from('external_prices')
              .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched')
              .in('scryfall_id', Array.from(scryfallIdsToFetch))
          
          extPrices?.forEach((p: any) => pricesMap.set(p.scryfall_id, p))
      }

      // 4. Procesamos
      for (const reqCard of cardsToProcess) {
          // Intentamos encontrar el match más preciso en DB para sacar imagen/set
          let match = null
          
          if (reqCard.set && reqCard.cn) {
              match = catalogMap.find(p => 
                  p.name.toLowerCase() === reqCard.name.toLowerCase() && 
                  String(p.collector_number).toLowerCase() === String(reqCard.cn).toLowerCase()
              )
          }
          if (!match) {
              const variants = catalogMap.filter(p => p.name.toLowerCase() === reqCard.name.toLowerCase())
              if (variants.length > 0) match = variants[0]
          }

          let finalScryfallId = reqCard.scryfall_id || match?.scryfall_id
          let dedImage: string | null = null
          let dedSetName: string | null = null
          let dedCn: string | null = null
          const looksLikeUuid = typeof finalScryfallId === 'string' && /^[0-9a-fA-F-]{36}$/.test(finalScryfallId)
          if (!finalScryfallId || !looksLikeUuid) {
            try {
              const qName = encodeURIComponent(reqCard.name)
              const qSet = reqCard.set ? ` set:${encodeURIComponent(reqCard.set)}` : ''
              const qCn = reqCard.cn ? ` cn:${encodeURIComponent(reqCard.cn)}` : ''
              const r = await fetch(`https://api.scryfall.com/cards/search?q=!"${qName}"${qSet}${qCn} game:paper unique:prints&order=released`)
              const j = await r.json()
              const list = Array.isArray(j?.data) ? j.data : []
              let cand: any = null
              if (reqCard.set) cand = list.find((c: any) => String(c.set).toLowerCase() === String(reqCard.set).toLowerCase()) || null
              if (!cand && reqCard.cn) cand = list.find((c: any) => String(c.collector_number).toLowerCase() === String(reqCard.cn).toLowerCase()) || null
              if (!cand) cand = list.find((c: any) => Array.isArray(c.games) && c.games.includes('paper')) || null
              if (cand) {
                finalScryfallId = cand.id
                dedImage = cand.image_uris?.normal || cand.card_faces?.[0]?.image_uris?.normal || null
                dedSetName = cand.set_name || null
                dedCn = cand.collector_number || null
              }
              } catch {}
          }

          if (finalScryfallId && !pricesMap.has(finalScryfallId)) {
            try {
              const { data: one } = await supabase
                .from('external_prices')
                .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched')
                .eq('scryfall_id', finalScryfallId)
                .single()
              if (one && one.scryfall_id) pricesMap.set(String(one.scryfall_id), one)
            } catch {}
          }
          
          let priceNormal = 0
          let priceFoil = 0
          let retailN = 0
          let retailF = 0
          let retailE = 0
          let source = 'none'

          if (finalScryfallId && pricesMap.has(finalScryfallId)) {
              const p = pricesMap.get(finalScryfallId)
              retailN = Number(p.cardkingdom_retail_normal || 0)
              retailF = Number(p.cardkingdom_retail_foil || 0)
              retailE = Number(p.cardkingdom_retail_etched || 0)
              if (reqCard.finish === 'foil') { priceFoil = retailF; source = 'ck-retail-foil' }
              else if (reqCard.finish === 'etched') { priceFoil = retailE; source = 'ck-retail-etched' }
              else { priceNormal = retailN; source = 'ck-retail-normal' }
          }

          // Fallback: si no conseguimos precio en BD, usamos el de Moxfield
          if (priceNormal === 0 && (reqCard.finish !== 'foil' && reqCard.finish !== 'etched')) { priceNormal = reqCard.price_usd || 0; if (priceNormal > 0) source = 'input-normal' }
          if (priceFoil === 0 && (reqCard.finish === 'foil' || reqCard.finish === 'etched')) { priceFoil = reqCard.price_usd_foil || 0; if (priceFoil > 0) source = 'input-foil' }

          try {
            const chosen = (reqCard.finish === 'foil' || reqCard.finish === 'etched') ? priceFoil : priceNormal
            console.log('BUYLIST_MARKET_PRICE', {
              name: reqCard.name,
              finish: reqCard.finish,
              scryfall_id: finalScryfallId,
              market: { normal: retailN, foil: retailF, etched: retailE },
              chosen,
              source
            })
          } catch {}

          results.push({
              // Datos básicos para BuylistStore
              id: match?.id || reqCard.scryfall_id || `${reqCard.name}-${Math.random()}`, // ID temporal si no existe en DB
              name: match?.name || reqCard.name,
              set_name: match?.set_name || reqCard.set_name || reqCard.set || dedSetName || undefined,
              collector_number: match?.collector_number || reqCard.cn || dedCn || undefined,
              image_url: reqCard.image_url || match?.image_url || dedImage || undefined,
              tcg: match?.tcg || 'Magic',
              
              // Datos de la solicitud
              quantity: reqCard.quantity,
              finish: reqCard.finish,
              
              // Precios para cálculo de oferta
              priceUsd: priceNormal,
              priceUsdFoil: priceFoil
          })
      }
  }

  return NextResponse.json(results)
}
