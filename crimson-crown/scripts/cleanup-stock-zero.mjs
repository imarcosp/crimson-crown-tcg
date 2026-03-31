import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta env: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('🗑️  INICIANDO PROTOCOLO DE LIMPIEZA V2 (SERVER-SIDE)...')
  console.log('   Objetivo: Borrar cartas sin stock directamente en la DB.')

  let totalDeleted = 0
  let keepRunning = true
  const BATCH_SIZE = 2000 // Ahora podemos usar lotes más grandes porque es interno

  while (keepRunning) {
    const start = Date.now()
    
    try {
        // Llamamos a la función que borra internamente
        const { data: count, error } = await supabase.rpc('delete_trash_products', { batch_size: BATCH_SIZE })

        if (error) throw new Error(`RPC Error: ${error.message}`)

        const deletedNow = count || 0
        const duration = ((Date.now() - start) / 1000).toFixed(2)

        if (deletedNow > 0) {
            totalDeleted += deletedNow
            console.log(`🔥 Lote eliminado: ${deletedNow} cartas en ${duration}s | Total acumulado: ${totalDeleted.toLocaleString()}`)
        } else {
            console.log('\n✨ ¡Limpieza completada! No quedan productos borrables.')
            keepRunning = false
        }

    } catch (e) {
        const msg = e.message || ''
        if (msg.includes('fetch') || msg.includes('timeout') || msg.includes('network')) {
            console.warn(`⏳ Error de conexión. Reintentando...`)
            await new Promise(r => setTimeout(r, 3000))
        } else {
            console.error('❌ Error FATAL:', e)
            keepRunning = false
        }
    }
  }
}

main().catch(e => console.error(e))