import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const searchTerm = process.argv[2] || 'Relentless'

function normalizeLoose(str) {
  return String(str || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,set_name,collector_number,finish,tcg,is_manual_price')
    .eq('tcg', 'Riftbound')
    .ilike('name', `%${searchTerm}%`)

  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log('Found rows:', data.length)
  data.forEach(d => {
       console.log(`Name: "${d.name}", Manual: ${d.is_manual_price}`)
   })
}

run()
