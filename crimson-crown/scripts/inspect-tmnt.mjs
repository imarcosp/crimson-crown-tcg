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

const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

async function main() {
    console.log('🔬 INSPECTOR TMNT')

    console.log('\n🌐 Descargando API CardKingdom...')
    const ckRes = await fetch(CK_API_URL)
    const json = await ckRes.json()
    const ckData = json.data || []
    
    console.log(`✅ CK tiene ${ckData.length} items.`)
    
    // Buscar TMNT Específicos (Secret Lair)
    const tmnt = ckData.filter(c => 
        c.edition.includes('Ninja Turtles') || 
        (c.name.includes('Leonardo') && c.name.includes('Turtle'))
    )

    console.log(`\n🐢 Encontrados ${tmnt.length} items de TMNT Secret Lair en CK:`)
    
    tmnt.forEach(c => {
        console.log(`\n[${c.edition}] ${c.name} (Foil: ${c.is_foil})`)
        console.log(`   ID CK: ${c.id}`)
        console.log(`   Scryfall ID: ${c.scryfall_id ? c.scryfall_id : '❌ NULO'}`)
    })
}

main().catch(console.error)
