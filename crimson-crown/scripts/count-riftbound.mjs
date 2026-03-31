import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Falta configuración de Supabase')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data, error, count } = await supabase
    .from('products')
    .select('id', { count: 'exact' })
    .eq('tcg', 'Riftbound')
  if (error) {
    console.error('❌ Error contando:', error.message)
    process.exit(1)
  }
  console.log(`📦 Riftbound count: ${count ?? (data?.length ?? 0)}`)
}

main()
