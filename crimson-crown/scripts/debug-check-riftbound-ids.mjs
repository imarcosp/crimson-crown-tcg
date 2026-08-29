import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('tcg', 'Riftbound')
    .limit(1)

  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log('Sample Riftbound product:', JSON.stringify(data[0], null, 2))
}

run()
