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

// --- COPIA DEL DICCIONARIO ACTUAL (Para probarlo) ---
const SET_NAME_DICTIONARY = {
    "Innistrad: Midnight Hunt": "Innistrad Midnight Hunt",
    "Innistrad: Crimson Vow": "Innistrad Crimson Vow",
    "Kamigawa: Neon Dynasty": "Kamigawa Neon Dynasty",
    "Magic 2010": "M10",
    "Magic 2011": "M11",
    "Magic 2012": "M12",
    "Magic 2013": "M13",
    "Magic 2014": "M14",
    "Magic 2015": "M15",
    "Dominaria United": "Dominaria United",
    "The Brothers' War": "The Brothers' War",
    "Phyrexia: All Will Be One": "Phyrexia All Will Be One",
    "March of the Machine": "March of the Machine",
    "Wilds of Eldraine": "Wilds of Eldraine",
    "Lost Caverns of Ixalan": "Lost Caverns of Ixalan",
    "Murders at Karlov Manor": "Murders at Karlov Manor",
    "Outlaws of Thunder Junction": "Outlaws of Thunder Junction",
    "Bloomburrow": "Bloomburrow",
    "Duskmourn: House of Horror": "Duskmourn House of Horror",
    "Teenage Mutant Ninja Turtles Source Material": "Teenage Mutant Ninja Turtles Source Material Cards",
    "Secret Lair Drop": "Secret Lair"
}

const sanitize = (str) => {
    if (!str) return ''
    let s = str.toLowerCase()
    if (s.includes('//')) s = s.split('//')[0]
    return s.replace(/['",.\-]/g, '').trim()
}

const getCkSetName = (localSetName) => {
    const mapped = SET_NAME_DICTIONARY[localSetName] || localSetName
    return sanitize(mapped)
}

async function main() {
    console.log('🕵️  DIAGNÓSTICO DE FALLOS DE HEALER...')

    // 1. Descargar CK para ver qué sets existen realmente
    console.log('🌐 Descargando lista de sets de CardKingdom...')
    const ckRes = await fetch(CK_API_URL)
    const json = await ckRes.json()
    const ckData = json.data || []
    
    // Crear Set de nombres de sets disponibles en CK (Sanitizados)
    const ckSets = new Set()
    ckData.forEach(c => ckSets.add(sanitize(c.edition)))
    console.log(`✅ CK tiene ${ckSets.size} sets únicos.`)

    // 2. Obtener muestra de fallos (IDs nulos)
    const { data: missingData } = await supabase
        .from('external_prices')
        .select('scryfall_id')
        .is('cardkingdom_id_normal', null)
        .is('cardkingdom_id_foil', null)
        .limit(20) // Analizar solo 20 casos para no saturar

    if (!missingData || missingData.length === 0) { console.log('No hay fallos para analizar.'); return }

    const ids = missingData.map(x => x.scryfall_id)
    
    // 3. Consultar Scryfall
    console.log(`🔍 Analizando ${ids.length} casos de fallo...`)
    const response = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: ids.map(id => ({ id })) })
    })
    const result = await response.json()
    const cards = result.data || []

    // 4. Reporte
    console.log('\n--- REPORTE DE ERRORES ---')
    
    const missingSets = new Set()

    for (const card of cards) {
        const scryfallSet = card.set_name
        const targetSet = getCkSetName(scryfallSet)
        const exists = ckSets.has(targetSet)

        console.log(`\nCarta: ${card.name}`)
        console.log(`   Scryfall Set: "${scryfallSet}"`)
        console.log(`   Target CK Set: "${targetSet}"`)
        console.log(`   ¿Existe en CK?: ${exists ? '✅ SÍ' : '❌ NO'}`)

        if (!exists) {
            missingSets.add(scryfallSet)
            // Intentar buscar sugerencias en CK
            const suggestions = Array.from(ckSets).filter(s => s.includes(sanitize(scryfallSet)) || sanitize(scryfallSet).includes(s))
            if (suggestions.length > 0) {
                console.log(`   💡 Sugerencias en CK: "${suggestions.slice(0, 3).join('", "')}"`)
            }
        }
    }

    console.log('\n--- RESUMEN DE SETS FALTANTES EN DICCIONARIO ---')
    missingSets.forEach(s => console.log(`"${s}": "???",`))
}

main().catch(console.error)
