import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  assertLegacyRpcMigrationOptIn,
  createOperationalSupabaseClient as createClient,
} from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
async function run() {
  // Legacy RPC execution is deprecated. It remains quarantined behind both this
  // script-specific opt-in and the guarded operational target declaration.
  assertLegacyRpcMigrationOptIn()
  const supabase = createClient(supabaseUrl, supabaseKey)
  const sqlPath = path.join(process.cwd(), 'supabase/migrations/20240701000000_search_functions.sql')
  console.log(`Reading migration from: ${sqlPath}`)
  
  if (!fs.existsSync(sqlPath)) {
    console.error('Migration file not found!')
    process.exit(1)
  }

  const sql = fs.readFileSync(sqlPath, 'utf8')
  
  // Como no podemos ejecutar SQL arbitrario sin la extension o un RPC helper (que no tenemos),
  // vamos a intentar crear las funciones una por una usando REST si fuera posible, 
  // PERO la forma standard en Supabase sin dashboard es usar migraciones o un cliente postgres.
  // Dado que esto es un entorno restringido, asumiremos que tenemos un RPC 'exec_sql' o similar
  // O BIEN que el usuario debe correrlo manualmente.
  
  // INTENTO 1: Usar RPC 'exec_sql' si existe (algunos setups lo tienen)
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql })
  
  if (error) {
    console.error('RPC exec_sql failed:', error.message)
    console.log('\n--- ATENCIÓN ---')
    console.log('No se pudo aplicar la migración automáticamente porque falta un helper RPC.')
    console.log('Por favor, copia el contenido de supabase/migrations/20240701000000_search_functions.sql')
    console.log('y ejecútalo en el Editor SQL de tu Dashboard de Supabase.')
    console.log('----------------\n')
    process.exit(1)
  } else {
    console.log('Migration applied successfully via RPC!')
  }
}

run().catch((error) => {
  if (error instanceof Error && error.name === 'UnsafeEnvironmentError') {
    console.error('UnsafeEnvironmentError: La migración RPC heredada no está habilitada.')
    process.exitCode = 1
    return
  }

  throw error
})
