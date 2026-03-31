import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cargar variables de entorno desde .env.staging
const envPath = path.resolve(__dirname, '../.env.staging')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath })
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    const cardName = "Raphael, Fiendish Savior" 
    // Nota: "Raphael, Ninja Destroyer" es el nombre del arte alternativo (Godzilla Series)
    // Pero en la base de datos oficial suele estar como "Raphael, Fiendish Savior".
    // Buscaremos por ambos para asegurar.

    console.log(`🔍 Buscando "${cardName}" y variantes...`)

    // 1. Buscar en tabla 'products' (Precios finales)
    const { data: products, error: errProd } = await supabase
        .from('products')
        .select('id, name, set_name, finish, price_usd, scryfall_id')
        .or(`name.ilike.%Raphael%`) // Búsqueda amplia
        .order('price_usd', { ascending: false })

    if (errProd) {
        console.error('Error buscando productos:', errProd)
        return
    }

    console.log('\n📦 TABLA PRODUCTS (Precio Final al Cliente):')
    if (products.length === 0) console.log('   No se encontraron productos.')
    
    const scryfallIds = []

    products.forEach(p => {
        console.log(`   - [${p.set_name}] ${p.name} (${p.finish}) -> $${p.price_usd} (ID: ${p.scryfall_id})`)
        if (p.scryfall_id) scryfallIds.push(p.scryfall_id)
    })

    // 2. Buscar en tabla 'external_prices' (Precios Origen CK/TCG)
    if (scryfallIds.length > 0) {
        const { data: external, error: errExt } = await supabase
            .from('external_prices')
            .select('*')
            .in('scryfall_id', scryfallIds)

        if (errExt) {
            console.error('Error buscando precios externos:', errExt)
            return
        }

        console.log('\n🌐 TABLA EXTERNAL_PRICES (Origen de Datos):')
        if (external.length === 0) console.log('   No hay datos externos para estos IDs.')

        external.forEach(e => {
            console.log(`   ID: ${e.scryfall_id}`)
            console.log(`      CK Normal: $${e.cardkingdom_retail_normal} | Foil: $${e.cardkingdom_retail_foil}`)
            console.log(`      TCG Normal: $${e.tcgplayer_market_normal} | Foil: $${e.tcgplayer_market_foil}`)
            console.log(`      Actualizado: ${new Date(e.updated_at).toLocaleString()}`)
        })
    }
}

main()
