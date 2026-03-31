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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'

// --- HELPERS ---
const sanitize = (str) => {
    if (!str) return ''
    let s = str.toLowerCase()
    if (s.includes('//')) s = s.split('//')[0]
    return s.replace(/['",.\-]/g, '').trim()
}

async function main() {
    console.log('🔬 INSPECTOR DE DATOS CARDKINGDOM vs SCRYFALL')

    // 1. Descargar CK y mostrar estructura cruda
    console.log('\n🌐 Descargando API CardKingdom...')
    const ckRes = await fetch(CK_API_URL)
    const json = await ckRes.json()
    const ckData = json.data || []
    
    console.log(`✅ CK tiene ${ckData.length} items.`)
    
    // ANÁLISIS DE SCRYFALL_ID EN CK
    let withScryfall = 0
    let withoutScryfall = 0
    
    ckData.forEach(c => {
        if (c.scryfall_id && c.scryfall_id.length > 10) withScryfall++
        else withoutScryfall++
    })
    
    console.log(`\n📊 ESTADÍSTICAS DE SCRYFALL ID:`)
    console.log(`   - Con ID: ${withScryfall} (${((withScryfall / ckData.length) * 100).toFixed(2)}%)`)
    console.log(`   - Sin ID: ${withoutScryfall}`)
    
    if (withoutScryfall > 0) {
        console.log('\n⚠️ Ejemplo de carta SIN Scryfall ID:')
        console.log(ckData.find(c => !c.scryfall_id))
    }

    console.log('\n--- ESTRUCTURA CRUDA DE UN ITEM CK (Ejemplo) ---')
    // Tomamos una carta compleja (ej: con paréntesis) para ver cómo la guardan
    const sampleCK = ckData.find(c => c.name.includes('(') && c.is_foil === 'true') || ckData[0]
    console.log(JSON.stringify(sampleCK, null, 2))
}

main().catch(console.error)
