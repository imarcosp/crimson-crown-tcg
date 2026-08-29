import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.resolve(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath, override: true })
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

// DICCIONARIO DE SETS PARA FUZZY MATCH
const SET_MAP = {
    "Teenage Mutant Ninja Turtles Source Material": "Teenage Mutant Ninja Turtles Source Material Cards", // Mapeo especial para TMNT
    "Teenage Mutant Ninja Turtles": "Teenage Mutant Ninja Turtles",
    "Universes Beyond: Assassin's Creed": "Assassin's Creed"
}

const sanitize = (str) => {
    if (!str) return ''
    return str.toLowerCase().replace(/['",.\-]/g, '').trim()
}

async function main() {
    console.log('🐢 HEALER TMNT & MISSING IDs')

    // 1. Descargar CK y filtrar los SIN ID
    console.log('⬇️  Descargando CK...')
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || []
    
    const brokenCk = ckData.filter(c => !c.scryfall_id || c.scryfall_id.length < 10)
    console.log(`⚠️  ${brokenCk.length} items en CK no tienen Scryfall ID.`)

    // 2. Cargar nuestros productos candidatos (TMNT y otros)
    // Buscamos productos en nuestra BD que NO tengan ID de CK asignado
    console.log('📥 Buscando huérfanos locales...')
    const { data: orphans } = await supabase
        .from('external_prices')
        .select('scryfall_id')
        .is('cardkingdom_id_normal', null)
        .is('cardkingdom_id_foil', null)
    
    const orphanIds = orphans.map(o => o.scryfall_id)
    
    // Traer info de Scryfall para esos huérfanos (necesitamos nombre y set para fuzzy match)
    // Como son muchos, lo haremos en lotes, o mejor: Consultamos 'products' si ya los tenemos en inventario
    // (Priorizamos inventario activo)
    const { data: localProducts } = await supabase
        .from('products')
        .select('scryfall_id, name, set_name, finish')
        .in('scryfall_id', orphanIds)
    
    console.log(`🎯 ${localProducts.length} productos locales huérfanos para intentar matchear.`)

    // 3. FUZZY MATCHING
    let updates = []
    
    for (const p of localProducts) {
        const pName = sanitize(p.name)
        const pSet = sanitize(p.set_name)
        const isFoil = p.finish.toLowerCase().includes('foil') || p.finish.toLowerCase().includes('etched')

        // Buscar en brokenCk
        const match = brokenCk.find(c => {
            const cName = sanitize(c.name)
            const cSet = sanitize(c.edition)
            const cFoil = String(c.is_foil) === 'true'

            if (cFoil !== isFoil) return false
            
            // Match Set (Directo o Mapeado)
            let setMatch = cSet === pSet
            if (!setMatch) {
                // Probar diccionario
                for (const [k, v] of Object.entries(SET_MAP)) {
                    if (sanitize(k) === pSet && sanitize(v) === cSet) {
                        setMatch = true; break;
                    }
                }
            }
            // Match especial TMNT (CK usa sufijos raros como "Variants")
            if (!setMatch && pSet.includes('ninja turtles') && cSet.includes('ninja turtles')) setMatch = true

            if (!setMatch) return false

            // Match Nombre
            if (cName === pName) return true
            if (cName.includes(pName) && Math.abs(cName.length - pName.length) < 10) return true // "Leonardo" vs "Leonardo (Variant)"

            return false
        })

        if (match) {
            console.log(`✅ MATCH: ${p.name} (${p.finish}) -> CK: ${match.name} [ID: ${match.id}]`)
            
            const payload = { 
                scryfall_id: p.scryfall_id,
                updated_at: new Date().toISOString()
            }
            
            const sell = parseFloat(match.price_retail || match.sell_price || 0)
            const buy = parseFloat(match.price_buy || match.buy_price || 0)

            if (isFoil) {
                payload.cardkingdom_id_foil = String(match.id)
                if (sell > 0) payload.cardkingdom_retail_foil = sell
                if (buy > 0) payload.cardkingdom_buylist_foil = buy
            } else {
                payload.cardkingdom_id_normal = String(match.id)
                if (sell > 0) payload.cardkingdom_retail_normal = sell
                if (buy > 0) payload.cardkingdom_buylist_normal = buy
            }
            updates.push(payload)
        }
    }

    // 4. GUARDAR
    if (updates.length > 0) {
        console.log(`💾 Guardando ${updates.length} reparaciones...`)
        for (const u of updates) {
            await supabase.from('external_prices').upsert(u, { onConflict: 'scryfall_id' })
        }
        console.log('✅ Listo.')
    } else {
        console.log('🤷 No se encontraron coincidencias automáticas.')
    }
}

main().catch(console.error)
