import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { Readable } from 'node:stream'

// --- STREAM JSON IMPORTS ---
import streamChain from 'stream-chain'
const { chain } = streamChain
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import PickPkg from 'stream-json/filters/Pick.js'
const { pick } = PickPkg
import StreamObjectPkg from 'stream-json/streamers/StreamObject.js'
const { streamObject } = StreamObjectPkg

// --- CONFIGURACIÓN ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cargar variables de entorno desde .env.staging
const envPath = path.resolve(__dirname, '../.env.staging')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath })
}

const MTGJSON_URL = 'https://mtgjson.com/api/v5/AllIdentifiers.json'
const CK_API_URL = 'https://api.cardkingdom.com/api/v2/pricelist'
const TEMP_ID_FILE = './temp_all_identifiers.json'

// IDs de Raphael para debuggear
const TARGET_SCRYFALL_ID = '183c6c8d-3e5c-4a7b-bd5a-cbaa0a781a58' // Raphael, Ninja Destroyer

async function main() {
    console.log('🕵️  DEBUG PROFUNDO: RASTREANDO "RAPHAEL" ENTRE MTGJSON Y CK API')

    // 1. ANALIZAR MTGJSON (Encontrar qué ID de CK tiene asignado este Scryfall ID)
    console.log('\n1️⃣  Analizando MTGJSON AllIdentifiers...')
    
    // Descargar si no existe
    if (!fs.existsSync(TEMP_ID_FILE)) {
        console.log('   Descargando...')
        const idRes = await fetch(MTGJSON_URL)
        await pipeline(Readable.fromWeb(idRes.body), fs.createWriteStream(TEMP_ID_FILE))
    }

    let ckIdFound = null
    let ckFoilIdFound = null

    const pipelineStream = chain([
        fs.createReadStream(TEMP_ID_FILE),
        parser(),
        pick({ filter: 'data' }),
        streamObject(),
    ])

    for await (const { key, value } of pipelineStream) {
        const ids = value?.identifiers
        if (ids && ids.scryfallId === TARGET_SCRYFALL_ID) {
            console.log(`   ✅ ENCONTRADO EN MTGJSON!`)
            console.log(`      UUID: ${key}`)
            console.log(`      Name: ${value.name}`)
            console.log(`      Scryfall ID: ${ids.scryfallId}`)
            console.log(`      CK ID (Normal): ${ids.cardKingdomId}`)
            console.log(`      CK ID (Foil): ${ids.cardKingdomFoilId}`)
            
            ckIdFound = ids.cardKingdomId
            ckFoilIdFound = ids.cardKingdomFoilId
            // No hacemos break porque podría haber múltiples entradas (aunque no debería para el mismo scryfallId)
        }
    }

    if (!ckIdFound && !ckFoilIdFound) {
        console.error('❌ ERROR: MTGJSON no tiene IDs de CardKingdom asociados a este Scryfall ID.')
        return
    }

    // 2. ANALIZAR API CARDKINGDOM (Buscar esos IDs en la lista de precios)
    console.log('\n2️⃣  Analizando API CardKingdom V2...')
    const ckRes = await fetch(CK_API_URL)
    const json = await ckRes.json()
    const ckData = json.data || (Array.isArray(json) ? json : [])

    console.log(`   Total items en CK API: ${ckData.length}`)

    let foundNormal = false
    let foundFoil = false

    // Buscar el ID Normal
    if (ckIdFound) {
        const item = ckData.find(c => String(c.id) === String(ckIdFound))
        if (item) {
            console.log(`   ✅ MATCH NORMAL ENCONTRADO!`)
            console.log(`      ID: ${item.id}`)
            console.log(`      Name: ${item.name}`)
            console.log(`      Price Retail: ${item.price_retail || item.sell_price}`)
            console.log(`      Price Buy: ${item.price_buy || item.buy_price}`)
            console.log(`      Stock: ${item.qty_retail}`)
            foundNormal = true
        } else {
            console.log(`   ❌ El ID Normal ${ckIdFound} NO aparece en la lista de precios actual de CK.`)
        }
    }

    // Buscar el ID Foil
    if (ckFoilIdFound) {
        const item = ckData.find(c => String(c.id) === String(ckFoilIdFound))
        if (item) {
            console.log(`   ✅ MATCH FOIL ENCONTRADO!`)
            console.log(`      ID: ${item.id}`)
            console.log(`      Name: ${item.name}`)
            console.log(`      Price Retail: ${item.price_retail || item.sell_price}`)
            console.log(`      Price Buy: ${item.price_buy || item.buy_price}`)
            foundFoil = true
        } else {
            console.log(`   ❌ El ID Foil ${ckFoilIdFound} NO aparece en la lista de precios actual de CK.`)
        }
    }

    // 3. BUSQUEDA POR NOMBRE (FALLBACK CHECK)
    // Si no encontramos por ID, busquemos por nombre para ver si el ID cambió
    if (!foundNormal || !foundFoil) {
        console.log('\n3️⃣  Búsqueda de respaldo por nombre en CK ("Raphael")...')
        const nameMatches = ckData.filter(c => c.name.toLowerCase().includes('raphael'))
        nameMatches.forEach(m => {
            console.log(`   - [ID: ${m.id}] ${m.name} (${m.edition}) -> $${m.price_retail || m.sell_price} (Foil: ${m.is_foil})`)
        })
    }
}

main().catch(console.error)
