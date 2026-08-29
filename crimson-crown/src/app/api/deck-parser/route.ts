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
  else if (body.cards && Array.isArray(body.cards)) cardsToProcess = body.cards
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
              return { quantity: parseInt(match[1]), name: match[2].trim(), set: match[3] || null, cn: match[4] || null, finish: match[5] === 'E' ? 'etched' : (match[5] === 'F' ? 'foil' : explicitFinish) }
          }
          const simple = cleanLine.match(/^(\d+)\s+(.+)$/)
          if (simple) return { quantity: parseInt(simple[1]), name: simple[2].trim(), finish: explicitFinish }
          return null
      }).filter(Boolean)
  }

  const results = { inStock: [] as any[], missing: [] as any[] }
  const names = cardsToProcess.map(c => c.name)
  
  if (names.length > 0) {
      const { data: stockMatches } = await supabase
          .from('products')
          .select('id, name, set_name, collector_number, price_usd, stock, finish, image_url, scryfall_id, tcg, language, condition')
          .in('name', names)
          .gt('stock', 0)
      
      const stockMap = stockMatches || []

      for (const reqCard of cardsToProcess) {
          const stockVariants = stockMap.filter(p => p.name.toLowerCase() === reqCard.name.toLowerCase())
          let totalStockFound = 0
          if (stockVariants.length > 0) {
              stockVariants.forEach(variant => {
                  results.inStock.push({ ...variant, requested_qty: Math.min(variant.stock, reqCard.quantity) })
                  totalStockFound += variant.stock
              })
          }
          const missingQty = Math.max(0, reqCard.quantity - totalStockFound)
          if (missingQty > 0) results.missing.push({ ...reqCard, quantity: missingQty })
      }

      if (results.missing.length > 0) {
          const missingNames = results.missing.map(m => m.name)
          const { data: metadataMatches } = await supabase.from('products').select('name, scryfall_id, image_url').in('name', missingNames)
          const metaMap = new Map()
          metadataMatches?.forEach(p => metaMap.set(p.name.toLowerCase(), p))

          const scryfallIdsToFetch = new Set<string>()

          for (const item of results.missing) {
              const meta = metaMap.get(item.name.toLowerCase())
              const isGenericMatchSafe = !item.scryfall_id && !item.set && !item.cn
              const isSameId = item.scryfall_id && meta?.scryfall_id === item.scryfall_id

              if (isGenericMatchSafe || isSameId) {
                  if (!item.image_url && meta?.image_url) item.image_url = meta.image_url
                  if (!item.scryfall_id && meta?.scryfall_id) item.scryfall_id = meta.scryfall_id
              }

              // Resolver impresión exacta cuando no hay UUID válido o cuando viene set/cn (para asegurar match correcto)
              const hasValidUuid = typeof item.scryfall_id === 'string' && /^[0-9a-fA-F-]{36}$/.test(item.scryfall_id)
              const hasSpecificPrinting = Boolean(item.set || item.cn)
              if (!item.image_url || !hasValidUuid || hasSpecificPrinting) {
                  try {
                      let cardData: any = null
                      if (hasValidUuid && !hasSpecificPrinting) {
                          const rId = await fetch(`https://api.scryfall.com/cards/${item.scryfall_id}`)
                          if (rId.ok) cardData = await rId.json()
                      }
                      // Búsqueda exacta por nombre + set/cn para garantizar la impresión correcta (paper)
                      if (!cardData) {
                          const nameQ = encodeURIComponent(item.name)
                          const setQ = item.set ? ` set:${encodeURIComponent(item.set)}` : ''
                          const cnQ = item.cn ? ` cn:${encodeURIComponent(item.cn)}` : ''
                          const rSearch = await fetch(`https://api.scryfall.com/cards/search?q=!"${nameQ}"${setQ}${cnQ} game:paper unique:prints&order=released`)
                          if (rSearch.ok) {
                              const listJson = await rSearch.json()
                              const list = Array.isArray(listJson?.data) ? listJson.data : []
                              let candidate: any = null
                              if (item.cn) candidate = list.find((c: any) => String(c.collector_number).toLowerCase() === String(item.cn).toLowerCase()) || null
                              if (!candidate && item.set) candidate = list.find((c: any) => String(c.set).toLowerCase() === String(item.set).toLowerCase()) || null
                              if (!candidate) candidate = list.find((c: any) => Array.isArray(c.games) && c.games.includes('paper')) || null
                              if (candidate) cardData = candidate
                          }
                      }

                      let invalidPhysical = false
                      if (cardData) {
                          const games = Array.isArray(cardData.games) ? cardData.games : []
                          const digital = Boolean(cardData.digital)
                          invalidPhysical = digital || (games.length && !games.includes('paper'))
                          if (!invalidPhysical) {
                              if (!item.scryfall_id && cardData.id) item.scryfall_id = cardData.id
                              if (!item.image_url) item.image_url = cardData.image_uris?.normal || cardData.card_faces?.[0]?.image_uris?.normal || item.image_url
                          }
                      }
                      if ((!cardData || invalidPhysical) && !item.image_url) {
                          const qSearch = encodeURIComponent(item.name)
                          const rSearch = await fetch(`https://api.scryfall.com/cards/search?q=!"${qSearch}" game:paper unique:prints&order=released`)
                          if (rSearch.ok) {
                              const listJson = await rSearch.json()
                              const list = Array.isArray(listJson?.data) ? listJson.data : []
                              let candidate = null
                              if (item.set) candidate = list.find((c: any) => String(c.set).toLowerCase() === String(item.set).toLowerCase())
                              if (!candidate && item.cn) candidate = list.find((c: any) => String(c.collector_number).toLowerCase() === String(item.cn).toLowerCase())
                              if (!candidate) candidate = list.find((c: any) => Array.isArray(c.games) && c.games.includes('paper'))
                              if (candidate) {
                                  if (!item.scryfall_id) item.scryfall_id = candidate.id
                                  item.image_url = candidate.image_uris?.normal || candidate.card_faces?.[0]?.image_uris?.normal || item.image_url
                                  invalidPhysical = false
                              }
                          }
                      }
                      if (invalidPhysical) (item as any).__invalidPhysical = true
                  } catch {}
              }
              if (item.scryfall_id) scryfallIdsToFetch.add(item.scryfall_id)
          }

          results.missing = results.missing.filter((it: any) => !it.__invalidPhysical)
          results.missing.forEach((it: any) => { if (it.__invalidPhysical !== undefined) delete it.__invalidPhysical })

          if (scryfallIdsToFetch.size > 0) {
              const { data: extPrices } = await supabase.from('external_prices').select('*').in('scryfall_id', Array.from(scryfallIdsToFetch))
              const priceMap = new Map()
              extPrices?.forEach((p: any) => priceMap.set(p.scryfall_id, p))

              results.missing.forEach(item => {
                  let bestNormal = 0
                  let bestFoil = 0
                  if (item.scryfall_id && priceMap.has(item.scryfall_id)) {
                      const p = priceMap.get(item.scryfall_id)
                      const ckN = Number(p.cardkingdom_retail_normal || 0)
                      const tcgN = Number(p.tcgplayer_market_normal || 0)
                      const ckF = Number(p.cardkingdom_retail_foil || 0)
                      const ckE = Number(p.cardkingdom_retail_etched || 0)
                      const tcgF = Number(p.tcgplayer_market_foil || 0)
                      // Igual que HangOrderModal
                      bestNormal = ckN > 0 ? ckN : tcgN
                      bestFoil = (ckF > 0 || ckE > 0) ? Math.max(ckF, ckE) : Math.max(tcgF, 0)
                  }
                  // Importante: forzar a ignorar valores de Moxfield; si no hay precio en BD/TCG, queda 0
                  item.price_usd = bestNormal
                  item.price_usd_foil = bestFoil
              })
          }
      }
  } else {
      results.missing = cardsToProcess
  }

  return NextResponse.json(results)
}
