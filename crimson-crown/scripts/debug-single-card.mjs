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

const TARGET_ID = '9011936a-ec69-4c1b-ae8e-c2d212047ca4'

async function main() {
    console.log(`🕵️  DEBUG SINGLE CARD: ${TARGET_ID}`)

    // 1. Ver estado en BD
    const { data: dbData } = await supabase
        .from('external_prices')
        .select('*')
        .eq('scryfall_id', TARGET_ID)
        .single()
    
    console.log('\n--- ESTADO EN BD ---')
    console.log(dbData || '❌ No existe en external_prices')

    // 2. Ver en CK
    console.log('\n--- BUSCANDO EN CK API ---')
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || []
    
    const matches = ckData.filter(c => c.scryfall_id === TARGET_ID)
    
    if (matches.length === 0) {
        console.log('❌ No encontrado en CK por scryfall_id.')
        // Buscar por nombre para ver si el ID es diferente
        const byName = ckData.filter(c => c.name === 'Channeler Initiate')
        console.log('   ¿Quizás alguno de estos? (Por nombre):')
        byName.forEach(c => console.log(`   - [${c.edition}] ID:${c.id} ScryID:${c.scryfall_id}`))
    } else {
        console.log(`✅ Encontrados ${matches.length} matches en CK:`)
        matches.forEach(m => {
            console.log(JSON.stringify(m, null, 2))
        })
    }

    // 3. Simular Lógica de Sync
    if (matches.length > 0) {
        console.log('\n--- SIMULACIÓN LOGICA SYNC ---')
        const entry = { scryfall_id: TARGET_ID }
        
        let matchNormal = matches.find(i => String(i.is_foil) !== 'true')
        let matchFoil = matches.find(i => String(i.is_foil) === 'true')

        if (matchNormal) {
            console.log('-> Match Normal encontrado.')
            const sell = parseFloat(matchNormal.price_retail || matchNormal.sell_price || 0)
            console.log(`   Precio: ${sell}`)
            console.log(`   ID: ${matchNormal.id}`)
            entry.cardkingdom_id_normal = String(matchNormal.id)
            entry.cardkingdom_retail_normal = sell
        } else {
            console.log('-> Match Normal NO encontrado.')
        }
        
        console.log('Resultado Final a Guardar:', entry)
    }
}

main().catch(console.error)
