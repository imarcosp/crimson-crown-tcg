import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TARGET_ID = '470dd3c8-07c9-42ef-aa9e-3c73b23607ff'

async function main() {
    console.log(`🕵️  TEST PASO 8: ${TARGET_ID}`)

    // 1. Ver external_prices
    const { data: ext } = await supabase.from('external_prices').select('*').eq('scryfall_id', TARGET_ID).single()
    console.log('\n--- EXTERNAL PRICES ---')
    console.log(`CK Normal: $${ext?.cardkingdom_retail_normal}`)
    console.log(`CK Foil: $${ext?.cardkingdom_retail_foil}`)

    // 2. Ver products
    const { data: prods } = await supabase.from('products').select('id, name, finish, condition, price_usd, is_manual_price').eq('scryfall_id', TARGET_ID)
    console.log('\n--- PRODUCTS ---')
    if (!prods || prods.length === 0) console.log('No existe en products.')
    
    prods?.forEach(p => {
        console.log(`[${p.id}] ${p.name} (${p.finish}) - Cond: ${p.condition} - Precio Actual: $${p.price_usd} - Manual: ${p.is_manual_price}`)
        
        if (p.is_manual_price) {
            console.log('   ⚠️ Omitido por ser precio manual.')
            return
        }

        const isFoil = (p.finish || '').toLowerCase().includes('foil')
        const ckPrice = isFoil ? ext?.cardkingdom_retail_foil : ext?.cardkingdom_retail_normal
        
        let multiplier = 1.0
        const cond = (p.condition || 'NM').toUpperCase()
        if (cond === 'PL' || cond === 'SP') multiplier = 0.85
        if (cond === 'HP' || cond === 'MP') multiplier = 0.75
        if (cond === 'DMG') multiplier = 0.50

        let finalPrice = (ckPrice || 0) * multiplier
        finalPrice = Math.round(finalPrice * 100) / 100

        console.log(`   🧮 Cálculo: CK Base $${ckPrice} * ${multiplier} = Nuevo Precio Esperado: $${finalPrice}`)
        
        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            console.log(`   ✅ Debería actualizarse (Diferencia detectada).`)
        } else {
            console.log(`   🚫 NO se actualiza (Precio igual o diferencia mínima).`)
        }
    })
}

main().catch(console.error)
