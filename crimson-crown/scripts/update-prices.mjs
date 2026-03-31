import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'node:stream'
import streamChain from 'stream-chain'
const { chain } = streamChain
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import PickPkg from 'stream-json/filters/Pick.js'
const { pick } = PickPkg
import StreamObjectPkg from 'stream-json/streamers/StreamObject.js'
const { streamObject } = StreamObjectPkg

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta env: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const PRICES_URL = 'https://mtgjson.com/api/v5/AllPrices.json'
const IDENTIFIERS_URL = 'https://mtgjson.com/api/v5/AllIdentifiers.json'
const TEMP_PRICES_FILE = './temp_prices.json'
const TEMP_ID_FILE = './temp_identifiers.json'

const MIN_STORE_PRICE = 0.35

// --- DEBUG ---
const DEBUG_CARD = "Mental Misstep" 

function getLatestData(obj) {
  try {
    if (!obj || typeof obj !== 'object') return null
    const entries = Object.entries(obj)
    if (!entries.length) return null
    entries.sort((a, b) => a[0].localeCompare(b[0]))
    const [lastDate, lastValue] = entries[entries.length - 1]
    const price = Number(lastValue)
    if (!Number.isFinite(price)) return null
    return { price, date: lastDate } 
  } catch { return null }
}

function safeGet(path, root) {
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), root)
}

// LÓGICA DE PRECIO (CK vs TCG)
const calculatePrice = (ckPrice, tcgPrice) => {
    const ck = Number(ckPrice) || 0
    const tcg = Number(tcgPrice) || 0

    if (ck <= 0 && tcg <= 0) return 0
    if (ck <= 0) return tcg // Fallback TCG
    if (tcg > (ck * 1.10)) return tcg // Regla 10%
    return ck
}

// Nueva función: Fetch directo a Scryfall para casos desesperados
async function fetchScryfallDirect(scryId) {
    try {
        const res = await fetch(`https://api.scryfall.com/cards/${scryId}`)
        if (!res.ok) return null
        const card = await res.json()
        
        // Intentar sacar precio de USD o USD_FOIL o USD_ETCHED
        const pN = Number(card.prices?.usd || 0)
        const pF = Number(card.prices?.usd_foil || 0)
        const pE = Number(card.prices?.usd_etched || 0)
        
        return { pN, pF, pE }
    } catch (e) {
        return null
    }
}

async function main() {
  console.log('🚀 INICIANDO ACTUALIZACIÓN DE PRECIOS V6 (SELF-HEALING)...')
  
  // 1. IDENTIFIERS
  console.log('⬇️  Descargando Identificadores...')
  const idRes = await fetch(IDENTIFIERS_URL)
  if (!idRes.ok) throw new Error('Error descargando identifiers')
  await pipeline(Readable.fromWeb(idRes.body), fs.createWriteStream(TEMP_ID_FILE))
  
  const uuidMap = new Map()
  const idPipeline = chain([
    fs.createReadStream(TEMP_ID_FILE),
    parser(),
    pick({ filter: 'data' }),
    streamObject(),
  ])

  for await (const { value } of idPipeline) {
    const uuid = value?.uuid
    const scry = value?.identifiers?.scryfallId || value?.scryfallId
    if (uuid && scry) {
        uuidMap.set(uuid, { scryfall_id: scry, name: value.name })
    }
  }
  
  if (fs.existsSync(TEMP_ID_FILE)) fs.unlinkSync(TEMP_ID_FILE)
  console.log(`✅ ${uuidMap.size} identificadores cargados.`)

  // 2. PRECIOS
  console.log('⬇️  Descargando Precios...')
  const pricesRes = await fetch(PRICES_URL)
  if (!pricesRes.ok) throw new Error('Failed to fetch prices')
  await pipeline(Readable.fromWeb(pricesRes.body), fs.createWriteStream(TEMP_PRICES_FILE))
  
  const pricePipeline = chain([
    fs.createReadStream(TEMP_PRICES_FILE),
    parser(),
    pick({ filter: 'data' }),
    streamObject(),
  ])

  let externalPricesBatch = []
  const BATCH_SIZE = 1000
  let stats = { externalUpserted: 0, productsUpdated: 0, skippedZero: 0, missingPrices: [], healed: 0, skippedManual: 0 }
  
  const priceCache = new Map()

  console.log('⚙️  Procesando Precios...')

  for await (const { key: uuid, value: priceRoot } of pricePipeline) {
    const cardData = uuidMap.get(uuid)
    if (!cardData) continue

    const paper = priceRoot?.paper || {}
    const ckRetail = safeGet(['cardkingdom', 'retail'], paper) || {}
    const tcgRetail = safeGet(['tcgplayer', 'retail'], paper) || {}

    const ckN = (getLatestData(safeGet(['normal'], ckRetail)))?.price || 0
    const ckF = (getLatestData(safeGet(['foil'], ckRetail)))?.price || 0
    const ckE = (getLatestData(safeGet(['etched'], ckRetail)))?.price || 0

    // MEJORA: Buscar 'mid' si 'market' no existe (para cartas raras)
    let tcgN = (getLatestData(safeGet(['normal', 'market'], tcgRetail)))?.price || 0
    if (!tcgN) tcgN = (getLatestData(safeGet(['normal', 'mid'], tcgRetail)))?.price || 0

    let tcgF = (getLatestData(safeGet(['foil', 'market'], tcgRetail)))?.price || 0
    if (!tcgF) tcgF = (getLatestData(safeGet(['foil', 'mid'], tcgRetail)))?.price || 0

    let tcgE = (getLatestData(safeGet(['etched', 'market'], tcgRetail)))?.price || 0
    if (!tcgE) tcgE = (getLatestData(safeGet(['etched', 'mid'], tcgRetail)))?.price || 0

    if (cardData.name.includes(DEBUG_CARD)) {
        console.log(`🔍 DEBUG ${cardData.name}: CK[N:${ckN}, F:${ckF}] TCG[N:${tcgN}, F:${tcgF}]`)
    }

    priceCache.set(cardData.scryfall_id, { ckN, ckF, ckE, tcgN, tcgF, tcgE })

    externalPricesBatch.push({
        scryfall_id: cardData.scryfall_id,
        cardkingdom_retail_normal: ckN,
        cardkingdom_retail_foil: ckF,
        cardkingdom_retail_etched: ckE,
        tcgplayer_market_normal: tcgN,
        tcgplayer_market_foil: tcgF,
        updated_at: new Date().toISOString()
    })

    if (externalPricesBatch.length >= BATCH_SIZE) {
        const unique = [...new Map(externalPricesBatch.map(item => [item.scryfall_id, item])).values()]
        await supabase.from('external_prices').upsert(unique, { onConflict: 'scryfall_id' })
        stats.externalUpserted += unique.length
        externalPricesBatch = []
        if (stats.externalUpserted % 10000 === 0) console.log(`⏳ External Prices: ${stats.externalUpserted}...`)
    }
  }

  if (externalPricesBatch.length > 0) {
      const unique = [...new Map(externalPricesBatch.map(item => [item.scryfall_id, item])).values()]
      await supabase.from('external_prices').upsert(unique, { onConflict: 'scryfall_id' })
      stats.externalUpserted += unique.length
  }

  if (fs.existsSync(TEMP_PRICES_FILE)) fs.unlinkSync(TEMP_PRICES_FILE)
  console.log(`✅ external_prices completo (${stats.externalUpserted} registros).`)

  // 3. ACTUALIZAR PRODUCTOS LOCALES
  console.log('🔄 ACTUALIZANDO PRECIOS DE INVENTARIO LOCAL...')
  
  let localProducts = []
  let from = 0
  const FETCH_SIZE = 1000
  let fetchMore = true

  while (fetchMore) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, finish, price_usd, scryfall_id, is_manual_price, condition')
      .eq('tcg', 'Magic')
      .range(from, from + FETCH_SIZE - 1)

    if (error) { console.error(error); break }
    if (data && data.length > 0) {
      localProducts = localProducts.concat(data)
      from += FETCH_SIZE
      if (data.length < FETCH_SIZE) fetchMore = false
    } else {
      fetchMore = false
    }
  }

  console.log(`📦 Inventario Local: ${localProducts.length} productos.`)

  const chunkSize = 50 // Lotes más pequeños para dar tiempo a la API si es necesario
  for (let i = 0; i < localProducts.length; i += chunkSize) {
    const chunk = localProducts.slice(i, i + chunkSize)
    
    await Promise.all(chunk.map(async (p) => {
        if (p.is_manual_price && p.price_usd < 9000) {
            stats.skippedManual++
            return 
        }

        const scryId = p.scryfall_id
        if (!scryId) return

        let prices = priceCache.get(scryId)
        
        // Determinar variante
        const f = String(p.finish || '').toLowerCase()
        const isEtched = f.includes('etched')
        const isFoil = (f.includes('foil') && !f.includes('non')) || f.includes('holo') || f.includes('raised') || f.includes('surge') // Soporte para foils exóticos
        
        let finalPrice = 0

        // INTENTO 1: USAR DATOS MASIVOS (MTGJSON)
        if (prices) {
            if (isEtched) finalPrice = calculatePrice(prices.ckE, prices.tcgE)
            else if (isFoil) finalPrice = calculatePrice(prices.ckF, prices.tcgF)
            else finalPrice = calculatePrice(prices.ckN, prices.tcgN)
        }
        if (!Number.isFinite(finalPrice)) finalPrice = 0

        // INTENTO 2: AUTO-HEALING (SI FALLÓ EL JSON, IR A SCRYFALL API)
        if (finalPrice <= 0) {
            // Solo para cartas que quedaron en 0, hacemos una llamada extra
            const livePrices = await fetchScryfallDirect(scryId)
            if (livePrices) {
                // Scryfall no distingue CK vs TCG en la API pública simple, usa TCG Market como 'usd'
                if (isEtched && livePrices.pE > 0) finalPrice = livePrices.pE
                else if (isFoil && livePrices.pF > 0) finalPrice = livePrices.pF
                else if (livePrices.pN > 0) finalPrice = livePrices.pN
                
                if (finalPrice > 0) {
                     // Guardamos el hallazgo
                     stats.healed++
                     console.log(`💊 HEALED: ${p.name} (${p.finish}) -> $${finalPrice}`)
                }
            }
        }
        if (!Number.isFinite(finalPrice)) finalPrice = 0

        if (finalPrice <= 0) {
            stats.skippedZero++
            stats.missingPrices.push(`${p.name} (${p.finish}) [ID: ${scryId}]`)
            return 
        }

        // Multiplicador Condición
        const conditionKey = (p.condition || 'NM').toUpperCase()
        const multiplier = (conditionKey === 'NM') ? 1.0 : (conditionKey === 'PL' ? 0.85 : (conditionKey === 'HP' ? 0.75 : 0.50))
        finalPrice = finalPrice * multiplier
        if (!Number.isFinite(finalPrice)) {
            stats.skippedZero++
            stats.missingPrices.push(`${p.name} (${p.finish}) [ID: ${scryId}]`)
            return
        }
        
        finalPrice = Math.max(MIN_STORE_PRICE, finalPrice)
        if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
            stats.skippedZero++
            stats.missingPrices.push(`${p.name} (${p.finish}) [ID: ${scryId}]`)
            return
        }

        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            await supabase.from('products').update({ 
                price_usd: finalPrice,
                is_manual_price: false
            }).eq('id', p.id)
            stats.productsUpdated++
        }
    }))
  }

  // 4. AUDITORÍA FINAL
  console.log('\n🕵️  EJECUTANDO AUDITORÍA FINAL...')

  const { data: riskyItems } = await supabase
    .from('products')
    .select('id, name, set_name, finish, stock')
    .eq('tcg', 'Magic')
    .gt('stock', 0)
    .lte('price_usd', 0)

  if (riskyItems && riskyItems.length > 0) {
      console.warn(`⚠️ ATENCIÓN: ${riskyItems.length} cartas quedaron sin precio (El script NO las tocó porque no encontró precio en origen):`)
      riskyItems.forEach(item => {
          console.warn(`   🔸 [${item.set_name}] ${item.name} (${item.finish})`)
      })
  } else {
      console.log('✅ AUDITORÍA APROBADA: Todas las cartas con stock tienen precio.')
  }

  console.log('------------------------------------------------')
  console.log(`✅ RESULTADOS`)
  console.log(`🔄 Actualizados: ${stats.productsUpdated}`)
  console.log(`🔒 Precios Manuales Omitidos: ${stats.skippedManual}`)
  console.log(`💊 Recuperados por API (Healed): ${stats.healed}`)
  console.log(`⛔ Sin precio en origen (Omitidos): ${stats.skippedZero}`)
  console.log('------------------------------------------------')
}

main().catch((e) => {
  console.error('🔥 Error Fatal:', e)
  process.exit(1)
})
