import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const { data, error } = await supabase
    .from('external_prices')
    .select('*')
    .ilike('scryfall_id', 'riftbound%')
    .limit(5)

  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log('Sample Riftbound external_prices:', JSON.stringify(data, null, 2))
}

run()
