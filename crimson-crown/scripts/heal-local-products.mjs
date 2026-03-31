import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const sanitize = (str) => String(str || '').toLowerCase().replace(/['",.\-]/g, '').trim()

async function main() {
    console.log('🩺 HEALER DE INVENTARIO LOCAL (Asignación de Scryfall IDs faltantes)')

    // 1. Obtener productos sin Scryfall ID o con ID inválido
    console.log('📥 Buscando productos rotos...')
    
    // Obtener todos para revisar a fondo (o solo los que tienen scryfall_id nulo/corto)
    let badProducts = []
    let page = 0
    let hasMore = true
    
    while(hasMore) {
        const { data } = await supabase
            .from('products')
            .select('id, name, set_name, collector_number, scryfall_id')
            .eq('tcg', 'Magic')
            .range(page * 1000, (page + 1) * 1000 - 1)
            
        if (!data || data.length === 0) {
            hasMore = false
        } else {
            const rotos = data.filter(p => !p.scryfall_id || p.scryfall_id.length !== 36)
            badProducts = badProducts.concat(rotos)
            page++
        }
    }

    console.log(`⚠️ Encontrados ${badProducts.length} productos sin Scryfall ID válido.`)

    if (badProducts.length === 0) return

    // 2. Buscar en Scryfall API
    let updates = []
    
    for (let i = 0; i < badProducts.length; i++) {
        const p = badProducts[i]
        console.log(`\n🔍 Buscando: [${p.set_name}] ${p.name} #${p.collector_number}`)
        
        let query = `!"${p.name}"`
        if (p.collector_number) query += ` cn:${p.collector_number}`
        
        try {
            const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`)
            const json = await res.json()
            
            if (json.data && json.data.length > 0) {
                // Filtrar por set_name si hay varios (Scryfall devuelve todos los prints si no filtramos por set exacto, pero cn ayuda)
                let match = json.data[0] // Asumimos el primero si cn coincide
                
                // Si el set no coincide exactamente, buscar en los resultados
                if (json.data.length > 1) {
                    const exactSet = json.data.find(c => sanitize(c.set_name) === sanitize(p.set_name))
                    if (exactSet) match = exactSet
                }

                console.log(`   ✅ Match encontrado: ${match.id} (${match.set_name})`)
                updates.push({ id: p.id, scryfall_id: match.id })
            } else {
                console.log(`   ❌ No encontrado en Scryfall.`)
            }
            
            await new Promise(r => setTimeout(r, 100)) // Rate limit
        } catch (e) {
            console.error('Error API:', e.message)
        }
    }

    // 3. Guardar
    if (updates.length > 0) {
        console.log(`\n💾 Guardando ${updates.length} correcciones en products...`)
        let saved = 0
        for (const u of updates) {
            const { error } = await supabase.from('products').update({ scryfall_id: u.scryfall_id }).eq('id', u.id)
            if (!error) saved++
        }
        console.log(`✅ ${saved} productos reparados.`)
    }
}

main().catch(console.error)
