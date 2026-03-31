import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const TARGET_ID = '55e6c31b-f9e9-4e42-a875-985d99300d9d'

async function main() {
    console.log(`🕵️  DEBUG OLIVIA: ${TARGET_ID}`)

    // 1. Ver external_prices
    const { data: ext } = await supabase.from('external_prices').select('*').eq('scryfall_id', TARGET_ID).single()
    console.log('\n--- EXTERNAL PRICES (BD) ---')
    console.log(`CK Normal: $${ext?.cardkingdom_retail_normal}`)
    console.log(`CK Foil: $${ext?.cardkingdom_retail_foil}`)
    console.log(`TCG Normal: $${ext?.tcgplayer_market_normal}`)
    console.log(`TCG Foil: $${ext?.tcgplayer_market_foil}`)
    console.log(`CK ID Normal Guardado: ${ext?.cardkingdom_id_normal}`)
    console.log(`CK ID Foil Guardado: ${ext?.cardkingdom_id_foil}`)

    // 2. Ver en CK API
    console.log('\n--- BUSCANDO EN CK API ---')
    const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'
    const res = await fetch(CK_API_URL)
    const json = await res.json()
    const ckData = json.data || []
    
    // Buscar por Scryfall ID exacto
    const matchesId = ckData.filter(c => c.scryfall_id === TARGET_ID)
    console.log(`\nEncontradas ${matchesId.length} entradas con Scryfall ID exacto:`)
    matchesId.forEach(c => {
        console.log(`[${c.edition}] Foil: ${c.is_foil} - Precio: $${c.price_retail} - CK_ID: ${c.id}`)
    })

    // Buscar por Nombre
    const matchesName = ckData.filter(c => c.name === 'Olivia, Opulent Outlaw')
    console.log(`\nEncontradas ${matchesName.length} entradas por Nombre:`)
    matchesName.forEach(c => {
        console.log(`[${c.edition}] Foil: ${c.is_foil} - Precio: $${c.price_retail} - ScryID: ${c.scryfall_id} - CK_ID: ${c.id}`)
    })

}

main().catch(console.error)
