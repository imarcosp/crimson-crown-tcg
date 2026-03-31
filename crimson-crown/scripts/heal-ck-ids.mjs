import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cargar variables de entorno desde .env.local (Producción)
const envPath = path.resolve(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath, override: true })
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

// --- DICCIONARIO DE SETS ---
const SET_NAME_DICTIONARY = {
    "Innistrad: Midnight Hunt": "Innistrad Midnight Hunt",
    "Innistrad: Crimson Vow": "Innistrad Crimson Vow",
    "Kamigawa: Neon Dynasty": "Kamigawa Neon Dynasty",
    "Magic 2010": "M10",
    "Magic 2011": "M11",
    "Magic 2012": "M12",
    "Magic 2013": "M13",
    "Magic 2014": "M14",
    "Magic 2015": "M15",
    "Dominaria United": "Dominaria United",
    "The Brothers' War": "The Brothers' War",
    "Phyrexia: All Will Be One": "Phyrexia All Will Be One",
    "March of the Machine": "March of the Machine",
    "Wilds of Eldraine": "Wilds of Eldraine",
    "Lost Caverns of Ixalan": "Lost Caverns of Ixalan",
    "Murders at Karlov Manor": "Murders at Karlov Manor",
    "Outlaws of Thunder Junction": "Outlaws of Thunder Junction",
    "Bloomburrow": "Bloomburrow",
    "Duskmourn: House of Horror": "Duskmourn House of Horror",
    "Teenage Mutant Ninja Turtles Source Material": "Teenage Mutant Ninja Turtles Source Material Cards",
    "Secret Lair Drop": "Secret Lair",
    "Wilds of Eldraine: Enchanting Tales": "Wilds of Eldraine Enchanting Tales",
    "The List": "Mystery Booster/The List",
    "Mystery Booster": "Mystery Booster/The List",
    "Warhammer 40,000 Commander": "Universes Beyond: Warhammer 40,000",
    "Universes Beyond: Warhammer 40,000": "Universes Beyond: Warhammer 40,000",
    "Doctor Who Commander": "Universes Beyond: Doctor Who",
    "Tales of Middle-earth Commander": "Universes Beyond: Lord of the Rings: Tales of Middle Earth",
    "The Lord of the Rings: Tales of Middle-earth": "Universes Beyond: Lord of the Rings: Tales of Middle Earth",
    "Fallout": "Universes Beyond: Fallout",
    "Assassin's Creed": "Universes Beyond: Assassin's Creed",
    "Transformers": "Universes Beyond: Transformers",
    "Jurassic World Collection": "Universes Beyond: Jurassic World Collection",
    "Rinascimento": "Renaissance",
    "Eighth Edition": "8th Edition",
    "The Thirteenth Doctor": "Universes Beyond: Doctor Who",
    "Fifth Edition": "5th Edition",
    "Seventh Edition": "7th Edition",
    "Ninth Edition": "9th Edition",
    "Tales of Middle-earth Commander": "Universes Beyond: Lord of the Rings: Tales of Middle Earth Commander Decks"
}

// --- HELPERS ---
const sanitize = (str) => {
    if (!str) return ''
    let s = str.toLowerCase()
    if (s.includes('//')) s = s.split('//')[0]
    return s.replace(/['",.\-]/g, '').trim()
}

const getCkSetName = (localSetName) => {
    const mapped = SET_NAME_DICTIONARY[localSetName] || localSetName
    return sanitize(mapped)
}

// Scryfall usa finishes: ['foil', 'nonfoil', 'etched']
// CK usa is_foil: true/false y pone variantes en el nombre
const isFoilScryfall = (finishes) => {
    if (!Array.isArray(finishes)) return false
    return finishes.includes('foil') || finishes.includes('etched')
}

// --- MAIN ---
const IGNORED_SETS_KEYWORDS = [
    'alchemy', 'arena', 'magic online', 'mtgo', 'digital', 'art series', 'unknown event', 'token', 'memorabilia',
    'oversized', 'foreign black border', 'world championship'
]

async function main() {
    console.log('🚑 INICIANDO HEALER SUPREMO (Scryfall API -> CK Fuzzy Match)...')

    // 3. DESCARGAR Y INDEXAR CK
    console.log('\n🌐 Descargando base de datos de CardKingdom...')
    const ckRes = await fetch(CK_API_URL)
    const json = await ckRes.json()
    const ckData = json.data || (Array.isArray(json) ? json : [])
    console.log(`✅ ${ckData.length} productos CK descargados.`)

    console.log('⚙️  Indexando CK para búsqueda rápida...')
    const ckIndex = new Map() 
    ckData.forEach(card => {
        const setName = sanitize(card.edition)
        card._sanitizedName = sanitize(card.name)
        if (!ckIndex.has(setName)) ckIndex.set(setName, [])
        ckIndex.get(setName).push(card)
    })

    // 1. OBTENER IDs HUÉRFANOS DE EXTERNAL_PRICES
    console.log('\n📥 Buscando IDs sin CardKingdom ID en external_prices...')
    
    // Bucle completo hasta terminar
    let hasMore = true
    let totalProcessed = 0
    const BATCH_SIZE = 2000

    while (hasMore) {
        const { data: missingData, error } = await supabase
            .from('external_prices')
            .select('scryfall_id')
            .is('cardkingdom_id_normal', null)
            .is('cardkingdom_id_foil', null)
            .range(0, BATCH_SIZE - 1) // Siempre tomamos los primeros N, porque los que arreglemos ya no saldrán en la query

        if (error) { console.error('Error fetching external:', error); break }
        if (!missingData || missingData.length === 0) {
            console.log('✅ No quedan cartas huérfanas por procesar.')
            hasMore = false
            break
        }

        const scryfallIds = missingData.map(x => x.scryfall_id)
        console.log(`\n⚠️  Procesando bloque de ${scryfallIds.length} IDs huérfanos...`)

        // ... (Aquí va la lógica de procesamiento por chunks) ...
        // Para simplificar la inyección de código, envolveremos el resto de la lógica en una función processBatch
        await processBatch(scryfallIds, ckIndex)
        
        totalProcessed += scryfallIds.length
        // Si procesamos menos del batch, es que ya acabamos
        if (scryfallIds.length < BATCH_SIZE) hasMore = false
        
        // Pausa de seguridad
        console.log('⏳ Pausa de 2s para no saturar APIs...')
        await new Promise(r => setTimeout(r, 2000))
    }
}

// --- FUNCIONES ---

async function processBatch(scryfallIds, ckIndex) {
    const cardDetails = []
    const chunks = []
    
    // Procesar todos los IDs del batch
    for (let i = 0; i < scryfallIds.length; i += 75) {
        chunks.push(scryfallIds.slice(i, i + 75))
    }

    console.log(`   Realizando ${chunks.length} peticiones a Scryfall API...`)

    for (const chunk of chunks) {
        try {
            const response = await fetch('https://api.scryfall.com/cards/collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifiers: chunk.map(id => ({ id })) })
            })
            
            if (!response.ok) throw new Error(`Scryfall API Error: ${response.status}`)
            
            const result = await response.json()
            if (result.data) {
                // Filtrar basura digital AQUÍ mismo
                const validCards = result.data.filter(c => {
                    const set = (c.set_name || '').toLowerCase()
                    if (IGNORED_SETS_KEYWORDS.some(k => set.includes(k))) return false
                    if (c.digital) return false 
                    return true
                })
                cardDetails.push(...validCards)
            }
            
            await new Promise(r => setTimeout(r, 100))
            process.stdout.write('.')
        } catch (e) {
            console.error('Error fetching chunk:', e.message)
        }
    }
    console.log(`\n✅ Recibidos detalles de ${cardDetails.length} cartas FÍSICAS válidas.`)

    // 4. MATCHING Y REPARACIÓN
    console.log('\n🤝 Buscando coincidencias...')
    const updates = []
    let matchesFound = 0

    for (const card of cardDetails) {
        const scryfallSet = card.set_name
        const targetSet = getCkSetName(scryfallSet)
        const scryfallName = card.name
        const sanitizedName = sanitize(scryfallName)
        const collectorNumber = card.collector_number
        
        // Determinar si es foil (Scryfall devuelve array de finishes disponibles para ese ID)
        // Ojo: Scryfall ID es único por impresión. Si el ID es foil, 'finishes' tendrá foil.
        // Pero un mismo ID puede tener ['nonfoil', 'foil'].
        // Aquí asumimos que queremos matchear AMBOS si es posible, o el que corresponda.
        const finishes = card.finishes || []
        const hasNonFoil = finishes.includes('nonfoil')
        const hasFoil = finishes.includes('foil') || finishes.includes('etched')

        const setCards = ckIndex.get(targetSet)
        
        let matchNormal = null
        let matchFoil = null

        if (setCards) {
            // Helper de búsqueda
            const findMatch = (isFoilTarget) => {
                // 1. Nombre Exacto
                let m = setCards.find(c => c._sanitizedName === sanitizedName && (String(c.is_foil) === 'true') === isFoilTarget)
                
                // 2. Fuzzy (Contiene nombre + variante)
                if (!m) {
                    m = setCards.find(c => {
                        if ((String(c.is_foil) === 'true') !== isFoilTarget) return false
                        if (!c._sanitizedName.includes(sanitizedName)) return false
                        
                        // Check variantes especiales en el nombre de Scryfall (ej: "Borderless")
                        // Scryfall suele poner variantes en 'frame_effects' o 'promo_types', no en 'name'.
                        // Pero CK las pone en el nombre.
                        // Si la carta Scryfall es "Borderless", buscar "Borderless" en CK.
                        const isBorderless = card.border_color === 'borderless' || (card.frame_effects || []).includes('borderless')
                        const isShowcase = (card.frame_effects || []).includes('showcase')
                        const isExtended = (card.frame_effects || []).includes('extendedart')
                        
                        if (isBorderless && !c._sanitizedName.includes('borderless')) return false
                        if (isShowcase && !c._sanitizedName.includes('showcase') && !c._sanitizedName.includes('variant')) return false
                        if (isExtended && !c._sanitizedName.includes('extended')) return false

                        // Check Collector Number (Muy fuerte si CK lo tuviera, pero CK no suele tenerlo en la API pública simple)
                        // A veces CK pone el numero en el nombre para cartas iguales.
                        
                        return true
                    })
                }
                return m
            }

            if (hasNonFoil) matchNormal = findMatch(false)
            if (hasFoil) matchFoil = findMatch(true)
        }

        if (matchNormal || matchFoil) {
            matchesFound++
            const updatePayload = { 
                scryfall_id: card.id,
                updated_at: new Date().toISOString()
            }
            let logMsg = `✅ MATCH: [${scryfallSet}] ${scryfallName}`

            if (matchNormal) {
                updatePayload.cardkingdom_id_normal = String(matchNormal.id)
                updatePayload.cardkingdom_retail_normal = parseFloat(matchNormal.price_retail || matchNormal.sell_price || 0)
                updatePayload.cardkingdom_buylist_normal = parseFloat(matchNormal.price_buy || matchNormal.buy_price || 0)
                logMsg += ` | N: ${matchNormal.id}`
            }
            if (matchFoil) {
                updatePayload.cardkingdom_id_foil = String(matchFoil.id)
                updatePayload.cardkingdom_retail_foil = parseFloat(matchFoil.price_retail || matchFoil.sell_price || 0)
                updatePayload.cardkingdom_buylist_foil = parseFloat(matchFoil.price_buy || matchFoil.buy_price || 0)
                logMsg += ` | F: ${matchFoil.id}`
            }
            
            console.log(logMsg)
            updates.push(updatePayload)
        } else {
            console.log(`❌ NO MATCH: [${scryfallSet}] ${scryfallName}`)
            
            // DIAGNÓSTICO EN TIEMPO REAL
            if (!setCards) {
                console.log(`   ⚠️  Set no encontrado en CK: "${targetSet}"`)
                // Sugerencias de set
                const ckSets = Array.from(ckIndex.keys())
                const suggestions = ckSets.filter(s => s.includes(sanitize(scryfallSet)) || sanitize(scryfallSet).includes(s)).slice(0, 3)
                if (suggestions.length) console.log(`      ¿Quizás quisiste decir?: "${suggestions.join('", "')}"`)
            } else {
                console.log(`   ⚠️  Set encontrado ("${targetSet}"), pero no la carta.`)
                // Sugerencias de carta en ese set
                const candidates = setCards.filter(c => c._sanitizedName.includes(sanitizedName) || sanitizedName.includes(c._sanitizedName)).slice(0, 3)
                if (candidates.length) {
                    console.log(`      Candidatos en set:`)
                    candidates.forEach(c => console.log(`      - "${c.name}" (Foil: ${c.is_foil})`))
                }
            }
        }
    }

    // 5. GUARDAR CAMBIOS
    if (updates.length > 0) {
        console.log(`\n💾 Guardando ${updates.length} reparaciones...`)
        
        let savedCount = 0
        for (const item of updates) {
            // Update individual para no sobreescribir otros campos si usamos upsert,
            // pero upsert es seguro si pasamos todas las columnas clave.
            // Aquí external_prices PK es scryfall_id.
            const { error } = await supabase.from('external_prices').upsert(item, { onConflict: 'scryfall_id' })
            
            if (error) console.error(`   Error guardando ${item.scryfall_id}:`, error.message)
            else savedCount++
            
            if (savedCount % 20 === 0) process.stdout.write('.')
        }
        console.log(`\n✅ ${savedCount} registros reparados exitosamente.`)
    }

    console.log('\n========================================')
    console.log(`RESUMEN:`)
    console.log(`Total analizado: ${cardDetails.length}`)
    console.log(`Reparados:       ${matchesFound}`)
    console.log(`Fallidos:        ${cardDetails.length - matchesFound}`)
    console.log('========================================')
}

main().catch(console.error)
