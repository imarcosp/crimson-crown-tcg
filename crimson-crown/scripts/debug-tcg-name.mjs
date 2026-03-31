import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Cargar variables de entorno desde .env.staging
const envPath = path.resolve(__dirname, '../.env.staging')
if (fs.existsSync(envPath)) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath })
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log('🔍 Verificando valores de la columna "tcg" en la tabla products...')
    
    // Contar 'Magic'
    const { count: countMagic, error: err1 } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('tcg', 'Magic')
    
    if (err1) console.error('Error counting Magic:', err1.message)
    else console.log(`Count 'Magic': ${countMagic}`)

    // Contar 'Magic: The Gathering'
    const { count: countMTG, error: err2 } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('tcg', 'Magic: The Gathering')

    if (err2) console.error('Error counting Magic: The Gathering:', err2.message)
    else console.log(`Count 'Magic: The Gathering': ${countMTG}`)

    // Ver otros valores
    const { data: samples } = await supabase.from('products').select('tcg').limit(5)
    console.log('Muestra de valores:', samples)
}

main()
