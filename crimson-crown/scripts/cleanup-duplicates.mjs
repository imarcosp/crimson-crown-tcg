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
  console.log('🧹 INICIANDO LIMPIEZA AUTOMÁTICA (MODO ROBUSTO)...')
  console.log('   Este script reintentará automáticamente si falla la conexión.')

  let totalGroups = 0
  let keepRunning = true
  const BATCH_SIZE = 50 

  while (keepRunning) {
    const start = Date.now()
    
    try {
        // Llamada RPC
        const { data, error } = await supabase.rpc('merge_duplicate_products', { batch_size: BATCH_SIZE })

        if (error) throw error

        // Parsear respuesta
        const match = data ? data.match(/(\d+)/) : null
        const processed = match ? parseInt(match[1]) : 0
        const duration = ((Date.now() - start) / 1000).toFixed(2)

        if (processed > 0) {
            totalGroups += processed
            // Log más limpio para no saturar consola, muestra cada 10 lotes o si es lento
            if (totalGroups % 500 === 0 || duration > 2) {
                console.log(`✅ Progreso: ${totalGroups} grupos fusionados... (Último lote: ${duration}s)`)
            }
        } else {
            console.log('🎉 ¡Limpieza terminada! No quedan duplicados pendientes.')
            keepRunning = false
        }

    } catch (e) {
        // DETECTOR DE ERRORES RECUPERABLES
        const errMsg = (e.message || '').toLowerCase()
        const isNetworkError = 
            errMsg.includes('fetch failed') || 
            errMsg.includes('timeout') || 
            errMsg.includes('socket') || 
            errMsg.includes('network') ||
            errMsg.includes('connection');

        if (isNetworkError) {
            console.warn(`⏳ Error de conexión (${e.message}). Esperando 5s para reintentar...`)
            await new Promise(r => setTimeout(r, 5000))
            // El bucle 'while' continuará automáticamente
        } else {
            console.error('🔥 Error FATAL no recuperable:', e)
            keepRunning = false
        }
    }
  }
}

main().catch(e => console.error(e))