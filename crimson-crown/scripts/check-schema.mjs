import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Forzar carga de .env.staging
const envPath = path.resolve(__dirname, '../.env.staging')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath })
}

console.log('🔗 Conectando a:', process.env.NEXT_PUBLIC_SUPABASE_URL)

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    // Intentar insertar un dummy para ver si el esquema reconoce la columna
    // No guardamos nada, solo pedimos la definición
    console.log('🕵️  Verificando columnas en external_prices...')
    
    // Hack: Hacer un select dummy para ver si devuelve error de columna
    const { data, error } = await supabase
        .from('external_prices')
        .select('scryfall_id, cardkingdom_id_normal, cardkingdom_id_foil')
        .limit(1)

    if (error) {
        console.error('❌ Error de esquema:', error.message)
        console.log('   (Esto confirma que la API no ve las columnas nuevas)')
    } else {
        console.log('✅ Esquema correcto. Columnas detectadas.')
        console.log('   Data sample:', data)
    }
}

main()
