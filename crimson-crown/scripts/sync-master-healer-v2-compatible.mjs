import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import StreamChainPkg from 'stream-chain'
const { chain } = StreamChainPkg
import StreamArrayPkg from 'stream-json/streamers/StreamArray.js'
const { streamArray } = StreamArrayPkg
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import { fileURLToPath } from 'url'
import { applyConditionMultiplier, MIN_STORE_PRICE } from './lib/pricing-rules.mjs'

// --- CONFIGURACIÓN ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '../.env.local')

// Cargar variables de entorno
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath, override: true })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Error Fatal: Faltan variables de entorno de Supabase.')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
})

const TEMP_SCRYFALL_FILE = './temp_scryfall_bulk.json'
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

// --- UTILIDADES ---
const sanitize = (str) => {
    if (!str) return ''
    return str.toLowerCase().replace(/['",.\-]/g, '').trim()
}

const toLowerTrim = (v) => String(v || '').toLowerCase().trim()

const detectFoilVariantFromScryfall = (card) => {
    const finishes = Array.isArray(card?.finishes) ? card.finishes.map(toLowerTrim) : []
    const promoTypes = Array.isArray(card?.promo_types) ? card.promo_types.map(toLowerTrim) : []

    if (promoTypes.includes('ripplefoil') || promoTypes.includes('ripple')) return 'Ripple Foil'
    if (promoTypes.includes('surgefoil')) return 'Surge Foil'
    if (finishes.includes('etched')) return 'Etched Foil'
    if (promoTypes.includes('galaxyfoil') || promoTypes.includes('galaxy')) return 'Galaxy Foil'
    if (promoTypes.includes('halofoil') || promoTypes.includes('halo')) return 'Halo Foil'
    if (finishes.includes('foil')) return 'Foil'
    return null
}

const detectFoilVariantFromCK = (variation) => {
    const v = toLowerTrim(variation)
    if (!v) return null
    if (v.includes('ripple')) return 'Ripple Foil'
    if (v.includes('surge')) return 'Surge Foil'
    if (v.includes('etched')) return 'Etched Foil'
    if (v.includes('galaxy')) return 'Galaxy Foil'
    if (v.includes('halo')) return 'Halo Foil'
    if (v.includes('foil')) return 'Foil'
    return null
}

const calculatePreferredMagicPrice = (ckPrice, tcgPrice, ckQty = 0) => {
    const ck = Number(ckPrice || 0)
    const tcg = Number(tcgPrice || 0)
    const qty = Number(ckQty || 0)

    if (ck <= 0) return tcg > 0 ? tcg : 0
    if (qty <= 0 && tcg > ck * 1.10 && tcg <= ck * 1.40) return tcg
    return ck
}

// Extrae números de un string (ej: "FTMT-0217" -> "217", "0217 - Borderless" -> "217")
const extractCollectorNumber = (str) => {
    if (!str) return null
    // Buscar secuencia de dígitos al final o entre separadores
    const matches = str.match(/(\d+)/g)
    if (!matches) return null
    // Retornamos todos los posibles candidatos numéricos parseados a string sin ceros a la izquierda
    return matches.map(m => parseInt(m, 10).toString())
}

async function main() {
    const startTime = Date.now()
    console.log('🚀 INICIANDO MASTER HEALER SYNC V2 COMPATIBLE (Scryfall Bulk x CardKingdom)')
    console.log('===========================================================')

    // PASO 1: DESCARGA SCRYFALL BULK DATA
    console.log('\n⬇️  [1/8] Obteniendo URI de Scryfall Bulk Data...')
    let downloadUri = ''
    try {
        const metaRes = await fetch('https://api.scryfall.com/bulk-data/default-cards')
        if (!metaRes.ok) throw new Error(`API Error ${metaRes.status}`)
        const meta = await metaRes.json()
        downloadUri = meta.download_uri
        console.log(`   URI detectada: ${downloadUri}`)
    } catch (e) {
        console.error('❌ Error obteniendo meta de Scryfall:', e)
        process.exit(1)
    }

    console.log('⬇️  Descargando archivo JSON masivo (esto puede tardar)...')
    try {
        // Forzamos la descarga siempre para asegurar tener los spoilers más recientes
        if (fs.existsSync(TEMP_SCRYFALL_FILE)) {
            fs.unlinkSync(TEMP_SCRYFALL_FILE)
        }
        const bulkRes = await fetch(downloadUri)
        if (!bulkRes.ok) throw new Error(`Download Error ${bulkRes.status}`)
        await pipeline(Readable.fromWeb(bulkRes.body), fs.createWriteStream(TEMP_SCRYFALL_FILE))
        console.log('✅ Archivo descargado correctamente.')
    } catch (e) {
        console.error('❌ Error descargando Bulk Data:', e)
        process.exit(1)
    }

    // PASO 2: DICCIONARIO EN MEMORIA (STREAMING)
    console.log('\n🧠 [2/8] Construyendo índices en memoria (Streaming)...')
    const scryfallById = new Map() // ID -> Objeto Minificado
    const scryfallByName = new Map() // Name -> [Objetos]

    let scryfallCount = 0
    
    const pipelineStream = chain([
        fs.createReadStream(TEMP_SCRYFALL_FILE),
        parser(),
        streamArray(),
    ])

    for await (const { value: card } of pipelineStream) {
        // Filtros básicos: Solo papel, no digital
        if (card.digital) continue 

        // Minificar objeto para ahorrar RAM
        const miniCard = {
            id: card.id,
            name: card.name,
            set_name: card.set_name,
            set_code: card.set || null,
            cn: card.collector_number,
            image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
            type_line: card.type_line || null,
            color_identity: card.color_identity || [],
            cmc: card.cmc !== undefined ? card.cmc : null,
            rarity: card.rarity || null,
            finishes: card.finishes || [], // ['foil', 'nonfoil', 'etched']
            promo_types: card.promo_types || [],
            tcg_id: card.tcgplayer_id,
            prices: {
                usd: parseFloat(card.prices?.usd || 0),
                usd_foil: parseFloat(card.prices?.usd_foil || 0)
            }
        }

        // Indexar por ID
        scryfallById.set(miniCard.id, miniCard)

        // Indexar por Nombre (para el Healer)
        const sName = sanitize(miniCard.name)
        if (!scryfallByName.has(sName)) {
            scryfallByName.set(sName, [])
        }
        scryfallByName.get(sName).push(miniCard)
        
        // Si es una carta de dos caras, CardKingdom suele usar solo la primera mitad.
        // Indexamos la primera mitad también para que el Healer la encuentre.
        if (miniCard.name.includes(' // ')) {
            const frontName = sanitize(miniCard.name.split(' // ')[0])
            if (!scryfallByName.has(frontName)) {
                scryfallByName.set(frontName, [])
            }
            scryfallByName.get(frontName).push(miniCard)
        }
        
        scryfallCount++
        if (scryfallCount % 50000 === 0) process.stdout.write(`   Procesadas: ${scryfallCount}...\r`)
    }
    console.log(`\n✅ Índices construidos. Total cartas Scryfall: ${scryfallCount}`)

    // PASO 3: DESCARGA CARDKINGDOM
    console.log('\n⬇️  [3/8] Descargando API CardKingdom...')
    let ckData = []
    try {
        const ckRes = await fetch(CK_API_URL)
        const ckJson = await ckRes.json()
        ckData = ckJson.data || []
    } catch (e) {
        console.error('❌ Error descargando CK:', e)
        process.exit(1)
    }
    console.log(`✅ ${ckData.length} items de CK descargados.`)

    // PASO 4 & 5: MOTOR DE HEURÍSTICA
    console.log('\n⚙️  [4-5/8] Ejecutando Motor de Matching...')
    
    const upsertMap = new Map() // scryfall_id -> Objeto Upsert
    
    let stats = {
        exactMatch: 0,
        healedMatch: 0,
        orphaned: 0
    }
    
    const orphansCK = []

    for (const item of ckData) {
        const priceRetail = parseFloat(item.price_retail || item.sell_price || 0)
        
        let match = null
        let method = ''

        // INTENTO 1: ID DIRECTO
        if (item.scryfall_id && scryfallById.has(item.scryfall_id)) {
            match = scryfallById.get(item.scryfall_id)
            method = 'exact'
        }

        // INTENTO 2: EL HEALER (Si falló el 1)
        if (!match) {
            const sName = sanitize(item.name)
            const candidates = scryfallByName.get(sName)

            if (candidates) {
                // Extraer números candidatos del item de CK
                const skuNums = extractCollectorNumber(item.sku) || []
                const varNums = extractCollectorNumber(item.variation) || []
                const allNums = new Set([...skuNums, ...varNums])

                // Determinar foilness de CK
                const ckIsFoil = String(item.is_foil) === 'true'

                // Buscar candidato perfecto
                match = candidates.find(cand => {
                    // Check Foil
                    const candHasFoil = cand.finishes.includes('foil') || cand.finishes.includes('etched')
                    const candHasNon = cand.finishes.includes('nonfoil')
                    
                    if (ckIsFoil && !candHasFoil) return false
                    if (!ckIsFoil && !candHasNon) return false

                    // Check Collector Number
                    if (allNums.has(cand.cn)) return true
                    
                    return false
                })

                if (match) method = 'healed'
            }
        }

        if (match) {
            if (method === 'exact') stats.exactMatch++
            else stats.healedMatch++

            const scryId = match.id

            // PASO 6: PREPARACIÓN UPSERT
            if (!upsertMap.has(scryId)) {
                upsertMap.set(scryId, {
                    scryfall_id: scryId,
                    name: match.name,
                    set_name: match.set_name,
                    set_code: match.set_code,
                    collector_number: match.cn,
                    image_url: match.image_url,
                    type_line: match.type_line,
                    color_identity: match.color_identity,
                    cmc: match.cmc,
                    rarity: match.rarity,
                    foil_variant: detectFoilVariantFromScryfall(match),
                    updated_at: new Date().toISOString(),
                    tcgplayer_id: match.tcg_id ? String(match.tcg_id) : null,
                    tcgplayer_market_normal: match.prices.usd || 0,
                    tcgplayer_market_foil: match.prices.usd_foil || 0,
                    active_price_normal: calculatePreferredMagicPrice(0, match.prices.usd || 0, 0),
                    active_price_foil: calculatePreferredMagicPrice(0, match.prices.usd_foil || 0, 0),
                })
            }

            const entry = upsertMap.get(scryId)
            const ckId = String(item.id)
            const buyPrice = parseFloat(item.price_buy || item.buy_price || 0)
            const qtyRetail = parseFloat(item.qty_retail || item.condition_values?.nm_qty || 0)
            const ckIsFoil = String(item.is_foil) === 'true'

            // --- PROTECCIÓN CONTRA DUPLICADOS DE CK ---
            // CK a veces usa el mismo scryfall_id para la versión base y las "Variants" o "Promos".
            // Queremos priorizar la versión base.
            const isVariant = item.edition.toLowerCase().includes('variant') || item.edition.toLowerCase().includes('promo')
            
            if (ckIsFoil) {
                // Si ya tenemos un ID Foil asignado y este nuevo es una variante, lo ignoramos para mantener el precio base
                if (entry.cardkingdom_id_foil && isVariant) {
                    // Do nothing
                } else {
                    entry.cardkingdom_id_foil = ckId
                    if (priceRetail > 0) entry.cardkingdom_retail_foil = priceRetail
                    if (buyPrice > 0) entry.cardkingdom_buylist_foil = buyPrice
                    entry.active_price_foil = calculatePreferredMagicPrice(priceRetail, entry.tcgplayer_market_foil || 0, qtyRetail)
                    
                    if (item.variation) {
                        const v = `Foil ${item.variation}`
                        entry.cardkingdom_variation = entry.cardkingdom_variation ? `${entry.cardkingdom_variation}, ${v}` : v
                    }
                }
                const ckVariant = detectFoilVariantFromCK(item.variation)
                if (ckVariant) {
                    entry.foil_variant = ckVariant
                } else if (!entry.foil_variant) {
                    entry.foil_variant = 'Foil'
                }
            } else {
                if (entry.cardkingdom_id_normal && isVariant) {
                    // Do nothing
                } else {
                    entry.cardkingdom_id_normal = ckId
                    if (priceRetail > 0) entry.cardkingdom_retail_normal = priceRetail
                    if (buyPrice > 0) entry.cardkingdom_buylist_normal = buyPrice
                    entry.active_price_normal = calculatePreferredMagicPrice(priceRetail, entry.tcgplayer_market_normal || 0, qtyRetail)
                    
                    if (item.variation) {
                        entry.cardkingdom_variation = entry.cardkingdom_variation ? `${entry.cardkingdom_variation}, ${item.variation}` : item.variation
                    }
                }
            }

        } else {
            stats.orphaned++
            // Guardamos las huérfanas de CK para el Rescate en Vivo
            orphansCK.push(item)
        }
    }

    console.log('\n📊 ESTADÍSTICAS DEL MOTOR:')
    console.log(`   - Matches Exactos (ID): ${stats.exactMatch}`)
    console.log(`   - Matches Curados (Healer): ${stats.healedMatch}`)
    console.log(`   - Huérfanos (Sin Match): ${stats.orphaned}`)
    console.log(`   - Total Cartas Únicas a Actualizar: ${upsertMap.size}`)

    // PASO 7: INYECTAR CARTAS HUÉRFANAS VALIOSAS (SPOILERS / SETS FUTUROS)
    console.log('\n🌟 [7/8] Rescatando Spoilers y cartas sin CardKingdom pero con precio TCGPlayer...')
    let orphansAdded = 0
    
    // Recorremos todo el diccionario de Scryfall para ver cuáles no entraron al upsertMap
    for (const [scryId, match] of scryfallById.entries()) {
        if (!upsertMap.has(scryId)) {
            // Es una carta huérfana (CardKingdom no la listó o no hizo match)
            // Filtro: Solo la agregamos si tiene un precio válido en TCGPlayer (USD o USD_FOIL > 0)
            const hasUsdPrice = (match.prices.usd && match.prices.usd > 0) || (match.prices.usd_foil && match.prices.usd_foil > 0)
            
            if (hasUsdPrice) {
                upsertMap.set(scryId, {
                    scryfall_id: scryId,
                    name: match.name,
                    set_name: match.set_name,
                    set_code: match.set_code,
                    collector_number: match.cn,
                    image_url: match.image_url,
                    type_line: match.type_line,
                    color_identity: match.color_identity,
                    cmc: match.cmc,
                    rarity: match.rarity,
                    foil_variant: detectFoilVariantFromScryfall(match),
                    updated_at: new Date().toISOString(),
                    tcgplayer_id: match.tcg_id ? String(match.tcg_id) : null,
                    tcgplayer_market_normal: match.prices.usd || 0,
                    tcgplayer_market_foil: match.prices.usd_foil || 0,
                    active_price_normal: calculatePreferredMagicPrice(0, match.prices.usd || 0, 0),
                    active_price_foil: calculatePreferredMagicPrice(0, match.prices.usd_foil || 0, 0),
                    cardkingdom_retail_normal: 0,
                    cardkingdom_retail_foil: 0,
                    cardkingdom_retail_etched: 0,
                    cardkingdom_buylist_normal: 0,
                    cardkingdom_buylist_foil: 0,
                    cardkingdom_id_normal: null,
                    cardkingdom_id_foil: null
                })
                orphansAdded++
            }
        }
    }
    
    console.log(`   Rescatadas ${orphansAdded} cartas desde Bulk Scryfall.`)

    console.log('\n🌟 [7.5/8] Rescatando Huérfanas Recientes de CardKingdom en Vivo (Scryfall Fallback)...')
    // Filtramos las huérfanas de CK para no golpear la API con tokens o cartas viejas.
    // Solo buscamos las que digan "Variant", "Promo" o de sets que nos interesen, 
    // o simplemente tomamos un máximo de 50 huérfanas que tengan precio > 0 para no demorar.
    const valuableOrphans = orphansCK.filter(o => {
        const price = parseFloat(o.price_retail || o.sell_price || 0)
        const isToken = o.edition.toLowerCase().includes('token') || o.name.toLowerCase().includes('token')
        const isArt = o.edition.toLowerCase().includes('art series')
        return price > 0 && !isToken && !isArt
    })
    
    // Ordenamos por ID de CardKingdom descendente. 
    // Los IDs más altos corresponden a las cartas más nuevas (los spoilers que más nos importan).
    valuableOrphans.sort((a, b) => (b.id || 0) - (a.id || 0))
    
    // Tomamos solo las primeras 1000 huérfanas más nuevas para no demorar más de 2-3 minutos en la ejecución
    const orphansToProcess = valuableOrphans.slice(0, 1000)
    console.log(`   Analizando las ${orphansToProcess.length} huérfanas de CK más recientes con valor (sin Tokens/Art).`)
    
    let liveRescues = 0
    
    // Para no saturar la API de Scryfall (10 request per second, usaremos 150ms de seguridad)
    const delay = ms => new Promise(res => setTimeout(res, ms))
    
    // Procesamos todas las huérfanas valiosas (esto puede tardar unos minutos si son miles, pero garantiza 100% cobertura)
    for (const item of orphansToProcess) {
        const cnList = extractCollectorNumber(item.sku) || extractCollectorNumber(item.variation) || []
        const cn = cnList[0] || ''
        
        if (!cn) continue
        
        // Hacemos una llamada directa a Scryfall
        try {
            const scryUrl = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(item.name)}+cn:${cn}&unique=prints`
            const res = await fetch(scryUrl)
            
            if (res.ok) {
                const data = await res.json()
                const cards = data.data || []
                
                if (cards.length > 0) {
                    const c = cards[0] // Tomamos el primer match exacto
                    const scryId = c.id
                    
                    if (!upsertMap.has(scryId)) {
                        upsertMap.set(scryId, {
                            scryfall_id: scryId,
                            name: c.name,
                            set_name: c.set_name,
                            set_code: c.set || null,
                            collector_number: c.collector_number,
                            image_url: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '',
                            type_line: c.type_line,
                            color_identity: c.color_identity,
                            cmc: c.cmc,
                            rarity: c.rarity,
                            foil_variant: detectFoilVariantFromScryfall(c),
                            updated_at: new Date().toISOString(),
                            tcgplayer_id: String(c.tcgplayer_id || ''),
                            tcgplayer_market_normal: Number(c.prices?.usd || 0),
                            tcgplayer_market_foil: Number(c.prices?.usd_foil || c.prices?.usd_etched || 0),
                            active_price_normal: calculatePreferredMagicPrice(0, Number(c.prices?.usd || 0), 0),
                            active_price_foil: calculatePreferredMagicPrice(0, Number(c.prices?.usd_foil || c.prices?.usd_etched || 0), 0),
                            cardkingdom_retail_normal: 0,
                            cardkingdom_retail_foil: 0,
                            cardkingdom_retail_etched: 0,
                            cardkingdom_buylist_normal: 0,
                            cardkingdom_buylist_foil: 0,
                            cardkingdom_id_normal: null,
                            cardkingdom_id_foil: null
                        })
                    }
                    
                    // Asignamos el precio de CardKingdom
                    const entry = upsertMap.get(scryId)
                    const ckId = String(item.id)
                    const priceRetail = parseFloat(item.price_retail || item.sell_price || 0)
                    const buyPrice = parseFloat(item.price_buy || item.buy_price || 0)
                    const qtyRetail = parseFloat(item.qty_retail || item.condition_values?.nm_qty || 0)
                    const ckIsFoil = String(item.is_foil) === 'true'
                    
                    if (ckIsFoil) {
                        entry.cardkingdom_id_foil = ckId
                        entry.cardkingdom_retail_foil = priceRetail
                        entry.cardkingdom_buylist_foil = buyPrice
                        entry.active_price_foil = calculatePreferredMagicPrice(priceRetail, entry.tcgplayer_market_foil || 0, qtyRetail)
                        const ckVariant = detectFoilVariantFromCK(item.variation)
                        if (ckVariant) {
                            entry.foil_variant = ckVariant
                        } else if (!entry.foil_variant) {
                            entry.foil_variant = 'Foil'
                        }
                    } else {
                        entry.cardkingdom_id_normal = ckId
                        entry.cardkingdom_retail_normal = priceRetail
                        entry.cardkingdom_buylist_normal = buyPrice
                        entry.active_price_normal = calculatePreferredMagicPrice(priceRetail, entry.tcgplayer_market_normal || 0, qtyRetail)
                    }
                    
                    liveRescues++
                }
            }
            await delay(150) // 150ms entre llamadas a Scryfall para evitar baneos
        } catch (e) {
            // Ignorar errores de red para no detener el script
        }
    }
    
    console.log(`   Rescatadas ${liveRescues} cartas directamente desde Scryfall en Vivo.`)

    // PASO 8: EJECUCIÓN BD
    console.log('\n💾 [8/8] Guardando en base de datos (Batch Upsert)...')
    
    const allUpdates = Array.from(upsertMap.values())
    // Reducimos el BATCH_SIZE a 500 para evitar timeouts de Supabase (statement timeout)
    const BATCH_SIZE = 500
    let savedCount = 0

    for (let i = 0; i < allUpdates.length; i += BATCH_SIZE) {
        const batch = allUpdates.slice(i, i + BATCH_SIZE)
        
        const { error } = await supabase.from('external_prices').upsert(batch, { onConflict: 'scryfall_id' })
        
        if (error) {
            console.error(`⚠️ Error en batch ${i}: ${error.message}`)
        } else {
            savedCount += batch.length
            process.stdout.write(`   Progreso: ${savedCount} / ${allUpdates.length}\r`)
        }
    }

    // PASO 8: PROPAGACIÓN A INVENTARIO (PRODUCTS)
    console.log('\n🔄 [8/8] Propagando precios a inventario local (products)...')
    
    // Descargar productos locales (Paginado)
    let localProducts = []
    let page = 0
    const PAGE_SIZE = 1000 // Limite seguro de Supabase
    let hasMore = true

    console.log('   Descargando inventario...')
    while (hasMore) {
        const { data, error } = await supabase
            .from('products')
            .select('id, name, finish, condition, scryfall_id, price_usd, is_manual_price, language')
            .eq('tcg', 'Magic')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        
        if (error) { console.error('Error fetching products:', error); break }
        
        if (data && data.length > 0) {
            localProducts = localProducts.concat(data)
            page++
            process.stdout.write(`\r   Cargados: ${localProducts.length}...`)
            if (data.length < PAGE_SIZE) hasMore = false // Si trae menos del límite, ya terminamos
        } else {
            hasMore = false
        }
    }
    console.log(`\n   ✅ Inventario cargado. Analizando ${localProducts.length} items.`)

    let productsUpdated = 0
    let productsSkippedManual = 0
    let productsSkippedNoPrice = 0
    const productUpdates = []
    const productUpdateById = new Map()

    for (const p of localProducts) {
        if (p.is_manual_price) {
            productsSkippedManual++
            continue
        }

        const scryId = p.scryfall_id
        if (!scryId) continue

        const extData = upsertMap.get(scryId)
        if (!extData) {
            productsSkippedNoPrice++
            continue
        }

        // Determinar variante
        const f = String(p.finish || '').toLowerCase()
        const isFoil = (f.includes('foil') && !f.includes('non')) || f.includes('etched') || f.includes('halo') || f.includes('surge') || f.includes('confetti') || f.includes('galaxy')
        let ckPrice = 0
        let tcgPrice = 0
        let activePrice = 0

        if (isFoil) {
            ckPrice = extData.cardkingdom_retail_foil || 0
            tcgPrice = extData.tcgplayer_market_foil || 0
            activePrice = extData.active_price_foil || 0
        } else {
            ckPrice = extData.cardkingdom_retail_normal || 0
            tcgPrice = extData.tcgplayer_market_normal || 0
            activePrice = extData.active_price_normal || 0
        }

        // Prioridad CK > TCG con Regla del 10% y Techo de Cordura (40%)
        let basePrice = 0
        if (activePrice > 0) {
            basePrice = activePrice
        } else if (ckPrice <= 0) {
            basePrice = tcgPrice
        } else if (tcgPrice > ckPrice * 1.10 && tcgPrice <= ckPrice * 1.40) {
            basePrice = tcgPrice
        } else {
            basePrice = ckPrice
        }

        if (basePrice <= 0) {
            productsSkippedNoPrice++
            continue
        }

        let finalPrice = applyConditionMultiplier(basePrice, p.condition || 'NM')
        if (finalPrice < MIN_STORE_PRICE) finalPrice = MIN_STORE_PRICE
        finalPrice = Math.round(finalPrice * 100) / 100

        let needsUpdate = false
        const updatePayload = {}

        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            updatePayload.price_usd = finalPrice
            needsUpdate = true
        }

        if (needsUpdate) {
            updatePayload.id = p.id
            productUpdates.push(updatePayload)
            productUpdateById.set(p.id, updatePayload)
        }
    }

    // Reconciliación conservadora por condición:
    // si existe una variante NM hermana del mismo scryfall_id + finish + language,
    // verificamos que la variante no-NM respete el multiplicador esperado.
    let productsReconciledByCondition = 0
    const siblingGroups = new Map()
    for (const p of localProducts) {
        const key = [p.scryfall_id || '', p.finish || '', p.language || 'English'].join('|')
        if (!siblingGroups.has(key)) siblingGroups.set(key, [])
        siblingGroups.get(key).push(p)
    }

    for (const group of siblingGroups.values()) {
        const nmRow = group.find((row) => String(row.condition || 'NM').toUpperCase() === 'NM' && Number(row.price_usd || 0) > 0)
        if (!nmRow) continue

        const nmPrice = Number(productUpdateById.get(nmRow.id)?.price_usd ?? nmRow.price_usd ?? 0)
        if (!Number.isFinite(nmPrice) || nmPrice <= 0) continue

        for (const row of group) {
            const cond = String(row.condition || 'NM').toUpperCase()
            if (cond === 'NM' || row.is_manual_price) continue

            let expected = applyConditionMultiplier(nmPrice, cond)
            if (expected < MIN_STORE_PRICE) expected = MIN_STORE_PRICE
            expected = Math.round(expected * 100) / 100

            const current = Number(productUpdateById.get(row.id)?.price_usd ?? row.price_usd ?? 0)
            if (!Number.isFinite(current) || Math.abs(current - expected) <= 0.01) continue

            const existingPayload = productUpdateById.get(row.id)
            if (existingPayload) {
                existingPayload.price_usd = expected
            } else {
                const updatePayload = { id: row.id, price_usd: expected }
                productUpdates.push(updatePayload)
                productUpdateById.set(row.id, updatePayload)
            }
            productsReconciledByCondition++
        }
    }

    console.log(`   Calculados ${productUpdates.length} cambios.`)

    if (productUpdates.length > 0) {
        console.log(`   Aplicando actualizaciones a products...`)
        let saved = 0
        
        for (const p of productUpdates) {
            const { id, ...payload } = p
            const { error } = await supabase
                .from('products')
                .update(payload)
                .eq('id', id)
            
            if (!error) saved++
            if (saved % 50 === 0) process.stdout.write(`\r   Actualizados: ${saved} / ${productUpdates.length}`)
        }
        productsUpdated = saved
        console.log('\n')
    }

    console.log(`\n📊 INVENTARIO LOCAL (Products):`)
    console.log(`   - Precios Actualizados: ${productsUpdated}`)
    console.log(`   - Manuales (Intactos): ${productsSkippedManual}`)
    console.log(`   - Sin Precio Referencia: ${productsSkippedNoPrice}`)
    console.log(`   - Reconciliados por condición: ${productsReconciledByCondition}`)
    console.log('\nℹ️  CONSIGNACIÓN OMITIDA: este proyecto no usa seller_inventory.')

    console.log('\n\n🧹 Limpiando archivos temporales...')
    try {
        fs.unlinkSync(TEMP_SCRYFALL_FILE)
    } catch (e) {}

    console.log('===========================================================')
    console.log(`🎉 PROCESO FINALIZADO EN ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
}

main().catch(e => {
    console.error('🔥 Error Fatal:', e)
    process.exit(1)
})
