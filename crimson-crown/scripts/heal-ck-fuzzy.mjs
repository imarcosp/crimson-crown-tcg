import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
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

// DICCIONARIO DE SETS (Para ayudar cuando el nombre no se contiene a sí mismo)
const SET_MAP = {
    "Warhammer 40,000 Commander": "Universes Beyond: Warhammer 40,000",
    "Doctor Who Commander": "Universes Beyond: Doctor Who",
    "Tales of Middle-earth Commander": "Universes Beyond: Lord of the Rings: Tales of Middle Earth",
    "The Lord of the Rings: Tales of Middle-earth": "Universes Beyond: Lord of the Rings: Tales of Middle Earth",
    "Fallout": "Universes Beyond: Fallout",
    "Assassin's Creed": "Universes Beyond: Assassin's Creed",
    "Transformers": "Universes Beyond: Transformers",
    "Jurassic World Collection": "Universes Beyond: Jurassic World Collection",
    "Teenage Mutant Ninja Turtles": "Teenage Mutant Ninja Turtles"
}

const sanitize = (str) => {
    if (!str) return ''
    return str.toLowerCase().replace(/['",.\-]/g, '').trim()
}

async function main() {
    console.log('🚑 HEALER AVANZADO (Fuzzy Match + Collector Number)')

    // 1. Descargar CK y filtrar los SIN ID
    console.log('⬇️  Descargando CK...')
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || []
    
    // Solo nos interesan los items de CK que NO tienen scryfall_id (los rotos)
    const brokenCk = ckData.filter(c => !c.scryfall_id || c.scryfall_id.length < 10)
    console.log(`⚠️  ${brokenCk.length} items en CK no tienen Scryfall ID.`)

    // Indexar brokenCk por nombre sanitizado para búsqueda rápida
    const ckIndex = new Map()
    brokenCk.forEach(c => {
        const sName = sanitize(c.name)
        if (!ckIndex.has(sName)) ckIndex.set(sName, [])
        ckIndex.get(sName).push(c)
    })

    // 2. Cargar huérfanos locales (Paginado)
    console.log('📥 Buscando huérfanos locales en external_prices...')
    let orphanIds = []
    let page = 0
    const PAGE_SIZE = 5000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('external_prices')
            .select('scryfall_id')
            .is('cardkingdom_id_normal', null)
            .is('cardkingdom_id_foil', null)
            .neq('ignore_ck', true)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        
        if (error) { console.error('Error fetching orphans:', error); break }
        
        if (data.length > 0) {
            orphanIds = orphanIds.concat(data.map(o => o.scryfall_id))
            page++
            process.stdout.write(`\r   Cargados: ${orphanIds.length}...`)
        } else {
            hasMore = false
        }
    }
    console.log(`\n🎯 Total ${orphanIds.length} huérfanos a investigar.`)

    if (orphanIds.length === 0) {
        console.log('✅ No hay huérfanos pendientes.')
        return
    }

    // 3. Consultar Scryfall en lotes
    let updates = []
    const BATCH_SIZE = 75
    
    for (let i = 0; i < orphanIds.length; i += BATCH_SIZE) {
        const batch = orphanIds.slice(i, i + BATCH_SIZE)
        
        try {
            const sRes = await fetch('https://api.scryfall.com/cards/collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifiers: batch.map(id => ({ id })) })
            })
            const sData = await sRes.json()
            const cards = sData.data || []

            // Procesar cada carta
            for (const card of cards) {
                // Filtro basura digital
                if (card.digital || ['alchemy', 'arena', 'mtgo'].some(k => card.set_name.toLowerCase().includes(k))) continue

                const sName = sanitize(card.name)
                const candidates = ckIndex.get(sName)
                
                if (!candidates) continue // No hay match de nombre en los rotos

                // Buscar el mejor candidato
                const match = candidates.find(ck => {
                    // 1. Foil Match
                    const sFinishes = card.finishes || []
                    const sIsFoil = sFinishes.includes('foil') || sFinishes.includes('etched')
                    // Scryfall puede tener [foil, nonfoil]. Necesitamos saber cuál estamos buscando arreglar.
                    // Como external_prices tiene columnas separadas, si la carta existe en foil y nonfoil, 
                    // deberíamos intentar matchear ambas variantes en CK.
                    // Pero aquí simplificamos: Buscamos si CK tiene una variante que coincida con ALGUNO de los acabados de Scryfall.
                    
                    const ckIsFoil = String(ck.is_foil) === 'true'
                    if (ckIsFoil && !sIsFoil) return false
                    if (!ckIsFoil && !card.finishes.includes('nonfoil')) return false

                    // 2. Set Match
                    const ckSet = sanitize(ck.edition)
                    const sSet = sanitize(card.set_name)
                    let setMatch = ckSet === sSet
                    
                    if (!setMatch) {
                        // Contiene
                        if (ckSet.includes(sSet) || sSet.includes(ckSet)) setMatch = true
                        // Diccionario
                        for (const [k, v] of Object.entries(SET_MAP)) {
                            if (sanitize(k) === sSet && sanitize(v) === ckSet) {
                                setMatch = true; break
                            }
                        }
                        // Caso especial TMNT Variants
                        if (sSet.includes('ninja turtles') && ckSet.includes('ninja turtles')) setMatch = true
                    }
                    if (!setMatch) return false

                    // 3. Collector Number Match (La prueba de fuego)
                    // CK Variation suele ser "0217 - Borderless" o "Prerelease"
                    const cn = card.collector_number
                    const ckVar = (ck.variation || '').toLowerCase()
                    const ckSku = (ck.sku || '').toLowerCase()
                    
                    // Si el CN está en variation o SKU, es un match muy fuerte
                    // Ojo con falsos positivos (ej: CN "1" en "10th edition"), verificar bordes o padding si es posible
                    // Pero para TMNT "0217" contiene "217" -> True
                    
                    // Normalizar CN a 3 o 4 digitos con ceros a la izquierda para comparar con CK? 
                    // CK suele usar padding (0217). Scryfall usa raw (217).
                    const paddedCN = cn.padStart(4, '0') // 0217
                    const paddedCN3 = cn.padStart(3, '0') // 217
                    
                    if (ckVar.includes(cn) || ckVar.includes(paddedCN) || ckVar.includes(paddedCN3)) return true
                    if (ckSku.includes(cn) || ckSku.includes(paddedCN)) return true

                    // Si no hay CN en variation, confiar en el match de Set + Foil si el nombre es exacto
                    // Y si CK variation está vacío o es genérico
                    if (!ckVar || ckVar === 'foil') return true

                    return false
                })

                if (match) {
                    console.log(`✅ MATCH: [${card.set_name}] ${card.name} (#${card.collector_number})`)
                    console.log(`   -> CK: [${match.edition}] ${match.name} (${match.variation}) ID:${match.id}`)
                    
                    const payload = { 
                        scryfall_id: card.id,
                        updated_at: new Date().toISOString()
                    }
                    const sell = parseFloat(match.price_retail || match.sell_price || 0)
                    const buy = parseFloat(match.price_buy || match.buy_price || 0)
                    const ckIsFoil = String(match.is_foil) === 'true'

                    if (ckIsFoil) {
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

            await new Promise(r => setTimeout(r, 100))
            process.stdout.write('.')
        } catch (e) {
            console.error('Error batch:', e)
        }
    }

    // 4. Guardar
    if (updates.length > 0) {
        console.log(`\n💾 Guardando ${updates.length} correcciones...`)
        let saved = 0
        for (const u of updates) {
            const { error } = await supabase.from('external_prices').upsert(u, { onConflict: 'scryfall_id' })
            if (!error) saved++
        }
        console.log(`✅ ${saved} guardados exitosamente.`)
    } else {
        console.log('\n🤷 No se encontraron matches automáticos.')
    }
}

main().catch(console.error)
