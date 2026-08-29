import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspect() {
    console.log('Inspecting Tables related to Orders...')
    
    // Check if 'order_items' exists
    const { data: items, error } = await supabase.from('order_items').select('*').limit(1)
    
    if (error) {
        console.log("❌ 'order_items' table not found or error:", error.message)
        // Try 'orders' just in case
        const { error: ordError } = await supabase.from('orders').select('*').limit(1)
        if (ordError) console.log("❌ 'orders' table not found or error:", ordError.message)
        else console.log("✅ 'orders' table exists.")
    } else {
        console.log("✅ 'order_items' table exists.")
        if (items.length > 0) {
            console.log("Sample item keys:", Object.keys(items[0]))
        } else {
            console.log("Table is empty, checking columns via empty insert attempt (safe fail)...")
        }
    }
}

inspect()
