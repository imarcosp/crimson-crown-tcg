import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function resetManualPrices() {
    console.log('🔄 Resetting manual price flag for Riftbound products...')
    
    // Contamos primero para el reporte
    const { count, error: countError } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('tcg', 'Riftbound')
        .eq('is_manual_price', true)
    
    if (countError) {
        console.error('❌ Error counting products:', countError.message)
        process.exit(1)
    }

    if (count === 0) {
        console.log('✅ No products found with manual price set.')
        return
    }

    console.log(`Found ${count} products with manual price flag set. Updating...`)

    // Actualizamos
    const { error } = await supabase
        .from('products')
        .update({ is_manual_price: false })
        .eq('tcg', 'Riftbound')
        .eq('is_manual_price', true)

    if (error) {
        console.error('❌ Error updating products:', error.message)
    } else {
        console.log(`✅ Successfully reset manual prices for Riftbound products.`)
    }
}

resetManualPrices()
