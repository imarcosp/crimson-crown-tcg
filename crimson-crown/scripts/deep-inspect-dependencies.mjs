import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) process.exit(1)

const supabase = createClient(supabaseUrl, supabaseKey)

async function deepInspect() {
    console.log('🕵️ Deep Inspection of Foreign Keys pointing to "products"...')
    
    // Consultar information_schema para obtener TODAS las relaciones
    // Nota: Esto requiere permisos de lectura sobre information_schema, que el service_role suele tener.
    const { data: fks, error } = await supabase.rpc('get_foreign_keys_to_products') 
    // Como no tenemos esa RPC, intentaremos deducirlo probando tablas comunes o
    // usando una query raw si tuvieramos acceso sql directo, pero via cliente js es limitado.
    
    // Plan B: Fuerza bruta sobre tablas probables.
    const suspectTables = [
        'cart_items', 'wishlists', 'wishlist_items', 
        'order_items', 'deck_cards', 'decks', 
        'inventory', 'stock_history', 'price_history',
        'product_prices', 'card_market_prices', 
        'featured_products', 'daily_deals'
    ]

    const targetId = process.argv[2] || '106028b0-8509-4b30-b746-ad38fde718fe'
    console.log(`Checking references for Product ID: ${targetId}`)

    for (const table of suspectTables) {
        // Intentar leer la tabla filtrando por product_id
        // Si la tabla no tiene la columna, dará error y lo ignoramos.
        const { data, error } = await supabase
            .from(table)
            .select('id') // Asumimos que tiene PK id
            .eq('product_id', targetId)
            .limit(1)
        
        if (error) {
            // console.log(`   [${table}] Skipped/Error: ${error.message}`)
        } else {
            if (data && data.length > 0) {
                console.log(`🚨 FOUND REFERENCE in table: "${table}"`)
            } else {
                // console.log(`   [${table}] Clean`)
            }
        }
    }
}

deepInspect()
