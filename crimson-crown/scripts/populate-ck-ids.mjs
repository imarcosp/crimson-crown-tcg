import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { Readable } from 'node:stream'

import streamChain from 'stream-chain'
const { chain } = streamChain
import ParserPkg from 'stream-json/Parser.js'
const { parser } = ParserPkg
import PickPkg from 'stream-json/filters/Pick.js'
const { pick } = PickPkg
import StreamObjectPkg from 'stream-json/streamers/StreamObject.js'
const { streamObject } = StreamObjectPkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const envPath = path.resolve(__dirname, '../.env.staging')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    // Override: true fuerza a usar las variables de este archivo aunque ya existan
    dotenv.config({ path: envPath, override: true })
}

console.log('🔗 Conectando a:', process.env.NEXT_PUBLIC_SUPABASE_URL) // Debug para confirmar URL

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const MTGJSON_URL = 'https://mtgjson.com/api/v5/AllIdentifiers.json'
const TEMP_ID_FILE = './temp_identifiers_populate.json'

async function main() {
    console.log('🏗️  POBLANDO IDs DE CARDKINGDOM EN EXTERNAL_PRICES...')
    
    // 1. Descargar MTGJSON
    if (!fs.existsSync(TEMP_ID_FILE)) {
        console.log('⬇️  Descargando diccionario MTGJSON...')
        const res = await fetch(MTGJSON_URL)
        if (!res.ok) throw new Error('Error descargando MTGJSON')
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(TEMP_ID_FILE))
    }

    // 2. Procesar y preparar batch
    console.log('⚙️  Procesando stream...')
    const pipelineStream = chain([
        fs.createReadStream(TEMP_ID_FILE),
        parser(),
        pick({ filter: 'data' }),
        streamObject(),
    ])

    let batch = []
    const BATCH_SIZE = 100 // Reducido de 1000 a 100 para evitar Timeouts
    let processed = 0
    let updated = 0

    for await (const { value } of pipelineStream) {
        const ids = value?.identifiers
        if (!ids || !ids.scryfallId) continue
        if (!ids.cardKingdomId && !ids.cardKingdomFoilId) continue // Si no tiene IDs de CK, no nos sirve

        batch.push({
            scryfall_id: ids.scryfallId,
            cardkingdom_id_normal: ids.cardKingdomId || null,
            cardkingdom_id_foil: ids.cardKingdomFoilId || null,
            updated_at: new Date().toISOString()
        })

        if (batch.length >= BATCH_SIZE) {
            await upsertBatch(batch)
            updated += batch.length
            batch = []
            process.stdout.write(`\r   IDs Guardados: ${updated}`)
        }
        processed++
    }

    if (batch.length > 0) {
        await upsertBatch(batch)
        updated += batch.length
    }

    console.log(`\n✅ Proceso completado. ${updated} registros actualizados con IDs de CK.`)
    
    // Limpieza
    if (fs.existsSync(TEMP_ID_FILE)) fs.unlinkSync(TEMP_ID_FILE)
}

async function upsertBatch(batch) {
    // Usamos upsert pero SOLO actualizamos los IDs, no tocamos precios
    // Ojo: Si el registro no existe, se crea (con precios en null, lo cual está bien)
    const { error } = await supabase.from('external_prices').upsert(batch, { 
        onConflict: 'scryfall_id',
        ignoreDuplicates: false 
    })
    
    if (error) {
        console.error('\n❌ Error en batch:', error.message)
        // Retry simple granular
        for (const item of batch) {
            await supabase.from('external_prices').upsert(item, { onConflict: 'scryfall_id' })
        }
    }
}

main().catch(console.error)
