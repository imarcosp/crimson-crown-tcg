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

async function main() {
    console.log('🔍 ANALIZANDO CARTAS SIN ID DE CARDKINGDOM EN EXTERNAL_PRICES...')

    // Traer registros de external_prices que tengan null en los IDs de CK
    // pero que tengamos en la tabla 'products' (es decir, que nos importen)
    
    // Paso 1: Traer IDs de external_prices incompletos (Paginado)
    let missingIds = []
    let page = 0
    const PAGE_SIZE = 5000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('external_prices')
            .select('scryfall_id')
            .is('cardkingdom_id_normal', null)
            .is('cardkingdom_id_foil', null)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (error) {
            console.error('Error fetching ids:', error)
            break
        }

        if (data.length > 0) {
            missingIds = missingIds.concat(data)
            page++
            process.stdout.write(`\r   Escaneando registros vacíos: ${missingIds.length}...`)
        } else {
            hasMore = false
        }
    }
    console.log('\n')

    if (!missingIds || missingIds.length === 0) {
        console.log('✅ ¡Felicidades! No hay cartas sin ID de CK en external_prices.')
        return
    }

    const scryfallIds = missingIds.map(x => x.scryfall_id)
    console.log(`⚠️  Encontramos ${scryfallIds.length} registros en external_prices sin ningún ID de CK.`)
    console.log('   (Verificando cuántos de estos son productos reales en nuestro inventario...)')

    // Paso 2: Cruzar con tabla Products en lotes
    let products = []
    const BATCH_SIZE = 100 // Lotes pequeños para no saturar URL
    
    for (let i = 0; i < scryfallIds.length; i += BATCH_SIZE) {
        const batch = scryfallIds.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabase
            .from('products')
            .select('name, set_name, finish, scryfall_id, stock')
            .in('scryfall_id', batch)
        
        if (error) {
            console.error(`Error en batch ${i}:`, error.message)
        } else if (data) {
            products = products.concat(data)
        }
    }

    if (products.length === 0) {
        console.log('ℹ️  Ninguno de los IDs faltantes corresponde a productos en tu catálogo actual.')
        return
    }

    console.log(`\n📋 DETALLE DE CARTAS RELEVANTES SIN ID CK (${products.length}):`)
    console.log('----------------------------------------------------------------')
    
    // Agrupar por Set para mejor lectura
    const bySet = {}
    products.forEach(p => {
        if (!bySet[p.set_name]) bySet[p.set_name] = []
        bySet[p.set_name].push(p)
    })

    Object.keys(bySet).forEach(set => {
        console.log(`\n📂 SET: ${set} (${bySet[set].length} cartas)`)
        bySet[set].forEach(p => {
            console.log(`   - ${p.name} [${p.finish}] (Stock: ${p.stock}) (ID: ${p.scryfall_id})`)
        })
    })

    console.log('\n----------------------------------------------------------------')
    console.log(`TOTAL A REVISAR: ${products.length} cartas.`)
}

main().catch(console.error)
