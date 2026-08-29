import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
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

async function main() {
    const targetName = "Trouble in Pairs"
    console.log(`🕵️  INVESTIGANDO: "${targetName}"`)

    // 1. Consultar precio actual en nuestra base de datos (external_prices y products)
    // Primero necesitamos el scryfall_id. Buscamos en products.
    const { data: products } = await supabase
        .from('products')
        .select('id, name, set_name, finish, price_usd, scryfall_id')
        .ilike('name', `%${targetName}%`)
    
    console.log('\n📦 NUESTRA BASE DE DATOS (Products):')
    const scryfallIds = []
    products.forEach(p => {
        console.log(`   - [${p.set_name}] ${p.name} (${p.finish}) -> $${p.price_usd} (ID: ${p.scryfall_id})`)
        if (p.scryfall_id) scryfallIds.push(p.scryfall_id)
    })

    if (scryfallIds.length > 0) {
        const { data: external } = await supabase
            .from('external_prices')
            .select('*')
            .in('scryfall_id', scryfallIds)
        
        console.log('\n🌐 NUESTRA BASE DE DATOS (External Prices):')
        external.forEach(e => {
            console.log(`   ID: ${e.scryfall_id}`)
            console.log(`      CK ID Normal: ${e.cardkingdom_id_normal} | Foil: ${e.cardkingdom_id_foil}`)
            console.log(`      CK Price Normal: $${e.cardkingdom_retail_normal} | Foil: $${e.cardkingdom_retail_foil}`)
            console.log(`      Updated: ${new Date(e.updated_at).toLocaleString()}`)
        })
    }

    // 2. Consultar API de CardKingdom en tiempo real para ver qué dice
    console.log('\n📡 CONSULTANDO API CARDKINGDOM (Tiempo Real)...')
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || (Array.isArray(json) ? json : [])

    // Buscar por nombre
    const matches = ckData.filter(item => item.name.toLowerCase().includes(targetName.toLowerCase()))
    
    console.log(`✅ Encontrados ${matches.length} coincidencias en CK API:`)
    matches.forEach(m => {
        console.log(`   - [ID: ${m.id}] ${m.name} (${m.edition})`)
        console.log(`     Precio Retail: $${m.price_retail || m.sell_price}`)
        console.log(`     Foil: ${m.is_foil}`)
    })
}

main().catch(console.error)
