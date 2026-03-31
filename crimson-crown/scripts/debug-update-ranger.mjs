import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TARGET_ID = 'ab9eef1c-8e8e-45e6-aaef-98ff569a1845' // Ranger-Captain

async function main() {
    console.log(`🕵️  DEBUG UPDATE DIRECTO: ${TARGET_ID}`)

    // 1. Obtener producto
    const { data: prods, error: fetchErr } = await supabase
        .from('products')
        .select('id, name, price_usd')
        .eq('scryfall_id', TARGET_ID)
    
    if (fetchErr) {
        console.error('Error fetching:', fetchErr)
        return
    }

    if (!prods || prods.length === 0) {
        console.log('No se encontró el producto.')
        return
    }

    const p = prods[0]
    console.log(`Encontrado: [${p.id}] ${p.name} - Precio Actual: $${p.price_usd}`)

    // 2. Intentar actualizar a 37.99
    const targetPrice = 37.99
    console.log(`Intentando actualizar a $${targetPrice}...`)

    const { data, error: updateErr } = await supabase
        .from('products')
        .update({ price_usd: targetPrice })
        .eq('id', p.id)
        .select()
        
    if (updateErr) {
        console.error('❌ ERROR AL ACTUALIZAR:', updateErr)
    } else {
        console.log('✅ ACTUALIZACIÓN EXITOSA. Resultado:', data)
    }
}

main().catch(console.error)
