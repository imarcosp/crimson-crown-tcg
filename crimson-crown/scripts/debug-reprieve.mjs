import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TARGET_ID = 'ab9eef1c-8e8e-45e6-aaef-98ff569a1845'

async function main() {
    console.log(`🕵️  DEBUG RANGER-CAPTAIN: ${TARGET_ID}`)

    // 1. Ver en CK API
    console.log('\n--- BUSCANDO EN CK API ---')
    const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || []
    
    const ckMatches = ckData.filter(c => c.name.includes('Ranger-Captain') || c.scryfall_id === TARGET_ID)
    console.log(`Encontradas ${ckMatches.length} entradas en CK:`)
    ckMatches.forEach(c => {
        if (c.scryfall_id === TARGET_ID) {
            console.log(`✅ [MATCH ID] [${c.edition}] Foil: ${c.is_foil} - Precio: ${c.price_retail} - ScryID: ${c.scryfall_id}`)
        } else {
            console.log(`   [${c.edition}] Foil: ${c.is_foil} - Precio: ${c.price_retail} - ScryID: ${c.scryfall_id}`)
        }
    })

    // 2. Ver external_prices
    const { data: ext } = await supabase.from('external_prices').select('*').eq('scryfall_id', TARGET_ID).single()
    console.log('\n--- EXTERNAL PRICES (BD) ---')
    console.log(`CK Normal: $${ext?.cardkingdom_retail_normal}`)
    console.log(`CK Foil: $${ext?.cardkingdom_retail_foil}`)
    console.log(`TCG Normal: $${ext?.tcgplayer_market_normal}`)
    console.log(`TCG Foil: $${ext?.tcgplayer_market_foil}`)

    // 3. Ver products
    const { data: prods } = await supabase.from('products').select('id, name, finish, condition, price_usd, is_manual_price').eq('scryfall_id', TARGET_ID)
    console.log('\n--- PRODUCTS (BD) ---')
    if (!prods || prods.length === 0) console.log('No existe en products.')
    
    prods?.forEach(p => {
        console.log(`[${p.id}] ${p.name} (${p.finish}) - Cond: ${p.condition} - Precio Actual: $${p.price_usd} - Manual: ${p.is_manual_price}`)
        
        // CÓDIGO EXACTO DEL PASO 8
        const f = String(p.finish || '').toLowerCase()
        const isFoil = (f.includes('foil') && !f.includes('non')) || f.includes('etched') || f.includes('halo') || f.includes('surge') || f.includes('confetti') || f.includes('galaxy')
        
        let ckPrice = 0
        let tcgPrice = 0

        if (isFoil) {
            ckPrice = ext?.cardkingdom_retail_foil || 0
            tcgPrice = ext?.tcgplayer_market_foil || 0
        } else {
            ckPrice = ext?.cardkingdom_retail_normal || 0
            tcgPrice = ext?.tcgplayer_market_normal || 0
        }

        let basePrice = ckPrice > 0 ? ckPrice : tcgPrice

        const cond = (p.condition || 'NM').toUpperCase()
        let multiplier = 1.0
        if (cond === 'PL' || cond === 'SP') multiplier = 0.85
        if (cond === 'HP' || cond === 'MP') multiplier = 0.75
        if (cond === 'DMG') multiplier = 0.50

        let finalPrice = basePrice * multiplier
        if (finalPrice < 0.35) finalPrice = 0.35
        finalPrice = Math.round(finalPrice * 100) / 100

        console.log(`   🧮 Lógica Paso 8: isFoil=${isFoil} -> CK($${ckPrice}) > 0 ? CK : TCG($${tcgPrice}) -> Base: $${basePrice} * Mult(${multiplier}) = FINAL: $${finalPrice}`)
        
        if (Math.abs(finalPrice - Number(p.price_usd || 0)) > 0.01) {
            console.log(`   ✅ SÍ DEBERÍA ACTUALIZARSE`)
        } else {
            console.log(`   🚫 NO SE ACTUALIZA`)
        }
    })
}

main().catch(console.error)
