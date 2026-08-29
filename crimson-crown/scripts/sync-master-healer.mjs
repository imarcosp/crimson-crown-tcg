import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { createGunzip } from 'zlib'
import readline from 'readline'
import StreamChainPkg from 'stream-chain'
const { chain } = StreamChainPkg
import StreamArrayPkg from 'stream-json/streamers/StreamArray.js'
const { streamArray } = StreamArrayPkg
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import { fileURLToPath } from 'url'

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

const TEMP_SCRYFALL_FILE = './temp_scryfall_bulk.tmp'
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'
const SCRYFALL_HEADERS = {
    'User-Agent': 'CrimsonCrownTCG/1.0 (sync-master-healer; contact: mjperchezabala@gmail.com)',
    'Accept': 'application/json'
}

// --- UTILIDADES ---
const sanitize = (str) => {
    if (!str) return ''
    return str.toLowerCase().replace(/['",.\-]/g, '').trim()
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
    console.log('🚀 INICIANDO MASTER HEALER SYNC (Scryfall Bulk x CardKingdom)')
    console.log('===========================================================')

    // PASO 1: DESCARGA SCRYFALL BULK DATA
    console.log('\n⬇️  [1/8] Obteniendo URI de Scryfall Bulk Data...')
    let downloadUri = ''
    let bulkIsJsonlGz = false
    try {
        const metaRes = await fetch('https://api.scryfall.com/bulk-data/default-cards', {
            headers: SCRYFALL_HEADERS
        })
        if (!metaRes.ok) throw new Error(`API Error ${metaRes.status}`)
        const meta = await metaRes.json()
        downloadUri = meta.download_uri || meta.jsonl_download_uri || ''
        bulkIsJsonlGz = Boolean(meta.jsonl_download_uri && !meta.download_uri)
        if (!downloadUri) throw new Error('Scryfall no devolvió una URI de descarga válida')
        console.log(`   URI detectada: ${downloadUri}`)
    } catch (e) {
        console.error('❌ Error obteniendo meta de Scryfall:', e)
        process.exit(1)
    }

    // Verificar si el archivo ya existe y es reciente (menos de 24h) para ahorrar descarga en dev
    let skipDownload = false
    if (fs.existsSync(TEMP_SCRYFALL_FILE)) {
        const stats = fs.statSync(TEMP_SCRYFALL_FILE)
        const hoursOld = (Date.now() - stats.mtimeMs) / 1000 / 60 / 60
        if (hoursOld < 24) {
            console.log(`   Archivo temporal existe y es reciente (${hoursOld.toFixed(1)}h). Saltando descarga.`)
            skipDownload = true
        }
    }

    if (!skipDownload) {
        console.log('⬇️  Descargando archivo JSON masivo (esto puede tardar)...')
        try {
            const bulkRes = await fetch(downloadUri)
            if (!bulkRes.ok) throw new Error(`Download Error ${bulkRes.status}`)
            await pipeline(Readable.fromWeb(bulkRes.body), fs.createWriteStream(TEMP_SCRYFALL_FILE))
            console.log('✅ Archivo descargado correctamente.')
        } catch (e) {
            console.error('❌ Error descargando Bulk Data:', e)
            process.exit(1)
        }
    }

    // PASO 2: DICCIONARIO EN MEMORIA (STREAMING)
    console.log('\n🧠 [2/8] Construyendo índices en memoria (Streaming)...')
    const scryfallById = new Map() // ID -> Objeto Minificado
    const scryfallByName = new Map() // Name -> [Objetos]

    let scryfallCount = 0
    
    const handleCard = (card) => {
        // Filtros básicos: Solo papel, no digital
        if (card.digital) return

        // Minificar objeto para ahorrar RAM
        const miniCard = {
            id: card.id,
            name: card.name,
            cn: card.collector_number,
            finishes: card.finishes || [], // ['foil', 'nonfoil', 'etched']
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
        
        scryfallCount++
        if (scryfallCount % 50000 === 0) process.stdout.write(`   Procesadas: ${scryfallCount}...\r`)
    }

    if (bulkIsJsonlGz) {
        const lineReader = readline.createInterface({
            input: fs.createReadStream(TEMP_SCRYFALL_FILE).pipe(createGunzip()),
            crlfDelay: Infinity,
        })

        for await (const line of lineReader) {
            const trimmed = String(line || '').trim()
            if (!trimmed) continue
            handleCard(JSON.parse(trimmed))
        }
    } else {
        const pipelineStream = chain([
            fs.createReadStream(TEMP_SCRYFALL_FILE),
            parser(),
            streamArray(),
        ])

        for await (const { value: card } of pipelineStream) {
            handleCard(card)
        }
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

            // PASO 6: PREPARACIÓN UPSERT
            if (!upsertMap.has(match.id)) {
                upsertMap.set(match.id, {
                    scryfall_id: match.id,
                    updated_at: new Date().toISOString(),
                    tcgplayer_id: match.tcg_id ? String(match.tcg_id) : null,
                    tcgplayer_market_normal: match.prices.usd || 0,
                    tcgplayer_market_foil: match.prices.usd_foil || 0,
                })
            }

            const entry = upsertMap.get(match.id)
            const ckId = String(item.id)
            const buyPrice = parseFloat(item.price_buy || item.buy_price || 0)
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
                    
                    if (item.variation) {
                        const v = `Foil ${item.variation}`
                        entry.cardkingdom_variation = entry.cardkingdom_variation ? `${entry.cardkingdom_variation}, ${v}` : v
                    }
                }
            } else {
                if (entry.cardkingdom_id_normal && isVariant) {
                    // Do nothing
                } else {
                    entry.cardkingdom_id_normal = ckId
                    if (priceRetail > 0) entry.cardkingdom_retail_normal = priceRetail
                    if (buyPrice > 0) entry.cardkingdom_buylist_normal = buyPrice
                    
                    if (item.variation) {
                        entry.cardkingdom_variation = entry.cardkingdom_variation ? `${entry.cardkingdom_variation}, ${item.variation}` : item.variation
                    }
                }
            }

        } else {
            stats.orphaned++
        }
    }

    console.log('\n📊 ESTADÍSTICAS DEL MOTOR:')
    console.log(`   - Matches Exactos (ID): ${stats.exactMatch}`)
    console.log(`   - Matches Curados (Healer): ${stats.healedMatch}`)
    console.log(`   - Huérfanos (Sin Match): ${stats.orphaned}`)
    console.log(`   - Total Cartas Únicas a Actualizar: ${upsertMap.size}`)

    // PASO 7: EJECUCIÓN BD
    console.log('\n💾 [6-7/8] Guardando en base de datos (Batch Upsert)...')
    
    const allUpdates = Array.from(upsertMap.values())
    const BATCH_SIZE = 1000
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
            .select('id, name, finish, condition, scryfall_id, price_usd, is_manual_price')
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
        const isEtched = f.includes('etched') 

        let ckPrice = 0
        let tcgPrice = 0

        if (isFoil) {
            ckPrice = extData.cardkingdom_retail_foil || 0
            tcgPrice = extData.tcgplayer_market_foil || 0
        } else {
            ckPrice = extData.cardkingdom_retail_normal || 0
            tcgPrice = extData.tcgplayer_market_normal || 0
        }

        // Prioridad CK > TCG
        let basePrice = ckPrice > 0 ? ckPrice : tcgPrice

        if (basePrice <= 0) {
            productsSkippedNoPrice++
            continue
        }

        // Multiplicadores
        const cond = (p.condition || 'NM').toUpperCase()
        let multiplier = 1.0
        if (cond === 'PL' || cond === 'SP') multiplier = 0.85
        if (cond === 'HP' || cond === 'MP') multiplier = 0.75
        if (cond === 'DMG') multiplier = 0.50

        let finalPrice = basePrice * multiplier
        
        if (finalPrice < 0.35) finalPrice = 0.35
        finalPrice = Math.round(finalPrice * 100) / 100

        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            productUpdates.push({
                id: p.id,
                price_usd: finalPrice
            })
        }
    }

    console.log(`   Calculados ${productUpdates.length} cambios de precio.`)

    if (productUpdates.length > 0) {
        console.log(`   Aplicando actualizaciones a products...`)
        let saved = 0
        
        for (const p of productUpdates) {
            const { error } = await supabase
                .from('products')
                .update({ price_usd: p.price_usd })
                .eq('id', p.id)
            
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
